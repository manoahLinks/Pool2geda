// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.27;

import { Ownable2Step, Ownable } from "@openzeppelin/contracts/access/Ownable2Step.sol";
import { FHE, euint64, ebool, externalEuint64 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";
import { IERC7984 } from "@openzeppelin/confidential-contracts/interfaces/IERC7984.sol";
import { IConfidentialYieldSource } from "./IConfidentialYieldSource.sol";
import { UniformRandomNumber } from "./vendor/UniformRandomNumber.sol";

/// @title ConfidentialPrizePool
/// @notice No-loss prize savings with encrypted balances — a confidential port
/// of PoolTogether v5 onto Zama FHEVM.
///
/// # Why this shape
///
/// PoolTogether v5 never iterates over depositors. Winning is not a selection
/// over a set, it is a *predicate on one user's state*:
///
///   uniform(keccak256(drawId, user, R), totalTwab) < userTwab
///
/// Every input to that hash is public; the only secret is `userTwab`. So the
/// PRN is computed in plaintext and the comparison becomes a single **scalar**
/// FHE compare. Winner determination is O(1) per user with no cross-user
/// dependency, which is what makes this fit inside the FHEVM homomorphic
/// compute budget (20M HCU/tx, 5M sequential depth) at any pool size.
///
/// # What stays secret
///
/// Deposits, balances, TWAB, winnings — and **who won**, from everyone
/// including this contract. `checkPrize` always succeeds and always costs the
/// same, crediting `select(won, prize, 0)`. Compare v5's `claimPrize`, which
/// reverts `DidNotWin` and so publishes the outcome on-chain. Only the user,
/// decrypting their own `winnings`, learns the result.
///
/// # What leaks, deliberately
///
/// - `totalCumulative` per draw (needed as the PRN modulus)
/// - the draw randomness `R`, after the epoch closes (keccak cannot run on
///   ciphertext)
/// - participant addresses (transactions are public); amounts are not
/// - the prize amount
///
/// Revealing `R` leaks nothing about individuals: an observer can compute every
/// user's PRN and still not determine a single winner, because `userCumulative`
/// stays encrypted.
///
/// # No loss
///
/// Principal never rebases and never funds prizes. `_shares` is decremented
/// only by the amount a transfer *actually* moved, and prizes are paid strictly
/// from a separate `_reserve` that is gated so it can never go negative.
contract ConfidentialPrizePool is ZamaEthereumConfig, Ownable2Step {
    // ---------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------

    /// The confidential token this pool accepts and pays out (cUSD).
    IERC7984 public immutable token;

    /// Encrypted principal per depositor.
    mapping(address => euint64) private _shares;

    /// Encrypted total principal.
    euint64 private _totalShares;

    /// Encrypted unclaimed winnings per depositor.
    mapping(address => euint64) private _winnings;

    /// Encrypted prize reserve. Funded separately; never contains principal.
    euint64 private _reserve;

    // --- TWAB, bounded to a one-epoch lookback -------------------------------
    //
    // A full PoolTogether TWAB keeps a 17,520-slot observation ring buffer per
    // user. That is far too expensive under FHE (every slot is a ciphertext
    // handle with its own ACL). Instead we keep exactly two buckets per user —
    // the current epoch and the previous one — and roll them forward lazily.
    // Every path is O(1), and the cost is that a prize must be checked during
    // the epoch after the one it was won in. v5 has the same constraint
    // (`ClaimPeriodExpired`).

    mapping(address => euint64) private _cumCur; // accrued in `epoch`
    mapping(address => euint64) private _cumPrev; // accrued in `epoch - 1`
    mapping(address => uint48) private _userLastAt;
    mapping(address => uint256) private _userLastEpoch;

    euint64 private _totalCumCur;
    euint64 private _totalCumPrev;
    uint48 private _totalLastAt;

    // --- Epoch / draw state --------------------------------------------------

    uint256 public epoch;
    uint48 public epochStartedAt;
    uint48 public immutable epochDuration;

    struct Draw {
        uint64 totalCumulative; // decrypted TWAB total — the PRN modulus
        uint256 randomness; // decrypted R
        uint64 prize; // public prize amount
        bool awarded;
    }

    mapping(uint256 => Draw) public draws;
    mapping(uint256 => mapping(address => bool)) public checked;

    /// Handles published by `closeEpoch`, consumed by `awardDraw`.
    mapping(uint256 => bytes32) public pendingTotalHandle;
    mapping(uint256 => bytes32) public pendingRandomHandle;

    /// Public prize amount used for the next draw.
    uint64 public prizePerDraw;

    /// Where the prize comes from. Optional: unset, the reserve is filled by
    /// `fundPrize` alone. Set, every close pulls whatever has accrued.
    ///
    /// Deliberately swappable, because the shipped sources are stand-ins. The
    /// pool never learns what is behind this interface, so replacing a
    /// simulated source with a real one changes nothing here — not the draw,
    /// not the accounting, not the confidentiality model.
    IConfidentialYieldSource public yieldSource;

    // --- Participant registry -------------------------------------------------
    //
    // Purely for presentation. Winner selection is a per-user predicate and
    // never iterates anyone, so consensus does not need this list and NOTHING
    // on-chain reads it — `checkPrize` and `closeEpoch` stay O(1) regardless of
    // how long it grows.
    //
    // It exists because the alternative is worse. Reconstructing the roster from
    // `Deposited` logs means an `eth_getLogs` scan, and every RPC caps that
    // range differently and brutally: 1,000 blocks on the provider viem
    // defaults to, 50,000 on some public nodes, and ten on Alchemy's free tier.
    // A frontend cannot rely on any of it. One SSTORE per new depositor buys a
    // register that reads identically everywhere.
    //
    // Discloses nothing new: participant addresses are already public, because
    // deposits are public transactions. See "What leaks, and why".

    address[] private _participants;

    /// @notice Whether this address has ever deposited.
    mapping(address => bool) public isParticipant;

    /// Set once, by `_seed()`, on the first state-mutating call.
    bool private _seeded;

    // ---------------------------------------------------------------------
    // Events / errors
    // ---------------------------------------------------------------------

    event Deposited(address indexed user);
    event Withdrawn(address indexed user);
    event Claimed(address indexed user);
    event PrizeFunded(address indexed from);
    event PrizePerDrawSet(uint64 amount);
    event YieldSourceSet(address indexed source);
    /// `requested` is the plaintext figure asked for. What actually landed is a
    /// ciphertext and stays one.
    event YieldHarvested(address indexed source, uint64 requested);

    /// Emitted when an epoch closes. The two handles must be publicly decrypted
    /// off-chain and submitted to `awardDraw` **in this order** — the
    /// decryption proof is bound to handle order.
    event EpochClosed(
        uint256 indexed epochId,
        bytes32 totalCumulativeHandle,
        bytes32 randomnessHandle,
        uint64 prize
    );
    event DrawAwarded(uint256 indexed epochId, uint64 totalCumulative, uint256 randomness);
    event PrizeChecked(uint256 indexed epochId, address indexed user);

    /// Emitted when a close crosses dead time. `skipped` periods produced no
    /// draw because nobody was present to settle them within the claim window.
    event DeadEpochsSkipped(uint256 indexed fromEpochId, uint256 skipped);

    error EpochNotOver(uint48 closesAt);
    error DrawAlreadyAwarded(uint256 epochId);
    error DrawNotAwarded(uint256 epochId);
    error NothingToDraw();
    error ClaimWindowClosed(uint256 epochId);
    error AlreadyChecked(uint256 epochId);
    error BadCleartextsLength();

    // ---------------------------------------------------------------------

    constructor(
        IERC7984 token_,
        uint48 epochDuration_,
        uint64 prizePerDraw_,
        address initialOwner
    ) Ownable(initialOwner) {
        token = token_;
        epochDuration = epochDuration_;
        prizePerDraw = prizePerDraw_;
        epochStartedAt = uint48(block.timestamp);
        _totalLastAt = uint48(block.timestamp);
        // NOTE: no FHE calls here — see `_seed()`.
    }

    /// @dev Initialise the aggregate ciphertexts on first use.
    ///
    /// Operating on an uninitialised handle yields a zero handle and silently
    /// corrupts downstream arithmetic, so these must be set before anything
    /// touches them. They are deliberately NOT set in the constructor: FHE
    /// calls at construction time require the coprocessor to be reachable
    /// during deployment, which makes the contract undeployable on any chain
    /// where it is not (and reverts with no reason string, which is a miserable
    /// thing to debug). Seeding lazily costs the first caller four trivial
    /// encrypts — 32 HCU each — and makes deployment inert.
    function _seed() private {
        if (_seeded) return;
        _seeded = true;

        _totalShares = FHE.asEuint64(0);
        _totalCumCur = FHE.asEuint64(0);
        _totalCumPrev = FHE.asEuint64(0);
        _reserve = FHE.asEuint64(0);

        FHE.allowThis(_totalShares);
        FHE.allowThis(_totalCumCur);
        FHE.allowThis(_totalCumPrev);
        FHE.allowThis(_reserve);
    }

    // ---------------------------------------------------------------------
    // Views (handles — decrypt client-side via EIP-712)
    // ---------------------------------------------------------------------

    function sharesOf(address user) external view returns (euint64) {
        return _shares[user];
    }

    function winningsOf(address user) external view returns (euint64) {
        return _winnings[user];
    }

    function totalShares() external view returns (euint64) {
        return _totalShares;
    }

    /// @notice The caller's TWAB accumulator for the most recently closed
    /// epoch — the numerator of their winning odds. Decryptable by the owner
    /// of the balance; the frontend uses it to show odds.
    function cumulativePrevOf(address user) external view returns (euint64) {
        return _cumPrev[user];
    }

    function cumulativeCurrentOf(address user) external view returns (euint64) {
        return _cumCur[user];
    }

    /// @notice Encrypted prize reserve. Never contains depositor principal.
    function reserve() external view returns (euint64) {
        return _reserve;
    }

    function epochEndsAt() public view returns (uint48) {
        return epochStartedAt + epochDuration;
    }

    /// @notice Everyone who has ever deposited.
    /// @dev Unbounded, and deliberately not read by any state-mutating path.
    /// Call it from off-chain, or page with `participantCount`/`participantAt`.
    function participants() external view returns (address[] memory) {
        return _participants;
    }

    function participantCount() external view returns (uint256) {
        return _participants.length;
    }

    function participantAt(uint256 index) external view returns (address) {
        return _participants[index];
    }

    // ---------------------------------------------------------------------
    // TWAB accrual
    // ---------------------------------------------------------------------

    /// @dev Now, clamped to the end of the current epoch.
    ///
    /// An epoch can sit expired-but-unclosed for a while — `closeEpoch` is
    /// permissionless, so nothing forces it to run the instant the timer
    /// elapses. Any activity in that overrun window belongs to the NEXT epoch,
    /// not the one whose timer already ran out. Clamping here is what keeps
    /// that true; without it a deposit made during the overrun would push
    /// `_totalLastAt` past the boundary, `closeEpoch`'s accrual would no-op,
    /// and the epoch would settle with a zero TWAB total.
    function _clampedNow() private view returns (uint48) {
        uint48 cap = epochEndsAt();
        uint48 nowTs = uint48(block.timestamp);
        return nowTs > cap ? cap : nowTs;
    }

    /// @dev Bring the global accumulator up to `until`, never past the epoch end.
    function _accrueTotal(uint48 until) private {
        uint48 cap = epochEndsAt();
        uint48 to = until > cap ? cap : until;
        if (to <= _totalLastAt) return;
        uint64 elapsed = uint64(to - _totalLastAt);
        // Scalar multiply — `elapsed` is plaintext, so this is the cheap form.
        _totalCumCur = FHE.add(_totalCumCur, FHE.mul(_totalShares, elapsed));
        FHE.allowThis(_totalCumCur);
        _totalLastAt = to;
    }

    /// @dev Roll a user's two TWAB buckets forward to now. O(1) regardless of
    /// how many epochs the user has been idle, because a balance that never
    /// changed contributes exactly `balance * epochDuration` to each skipped
    /// epoch — no iteration required.
    function _accrueUser(address u) private {
        uint256 lastEpoch = _userLastEpoch[u];
        uint48 lastAt = _userLastAt[u];
        euint64 bal = _shares[u];

        // Clamped so activity during an expired-but-unclosed epoch is credited
        // to the next one rather than retroactively to the closing one.
        uint48 nowTs = _clampedNow();

        if (!FHE.isInitialized(bal)) {
            // First touch: nothing has accrued yet.
            _cumCur[u] = FHE.asEuint64(0);
            _cumPrev[u] = FHE.asEuint64(0);
            FHE.allowThis(_cumCur[u]);
            FHE.allowThis(_cumPrev[u]);
            _userLastAt[u] = nowTs;
            _userLastEpoch[u] = epoch;
            return;
        }

        if (lastEpoch == epoch) {
            // Same epoch — extend the current bucket.
            if (nowTs > lastAt) {
                _cumCur[u] = FHE.add(_cumCur[u], FHE.mul(bal, uint64(nowTs - lastAt)));
            }
        } else {
            // Crossed at least one boundary. The balance was constant the whole
            // time, so each bucket is a closed-form product.
            uint48 prevEnd = epochStartedAt;

            if (lastEpoch == epoch - 1) {
                // Finish the previous epoch from where the user left off.
                uint64 tail = lastAt < prevEnd ? uint64(prevEnd - lastAt) : 0;
                _cumPrev[u] = FHE.add(_cumCur[u], FHE.mul(bal, tail));
            } else {
                // Idle for the whole previous epoch.
                _cumPrev[u] = FHE.mul(bal, uint64(epochDuration));
            }
            // And the current epoch, from its start.
            _cumCur[u] = FHE.mul(bal, uint64(nowTs - epochStartedAt));
        }

        FHE.allowThis(_cumCur[u]);
        FHE.allowThis(_cumPrev[u]);
        FHE.allow(_cumCur[u], u);
        FHE.allow(_cumPrev[u], u);
        _userLastAt[u] = nowTs;
        _userLastEpoch[u] = epoch;
    }

    // ---------------------------------------------------------------------
    // Deposit / withdraw
    // ---------------------------------------------------------------------

    /// @notice Deposit an encrypted amount of cUSD.
    /// @dev Caller must first grant this contract operator rights on the token:
    /// `cUSD.setOperator(pool, expiry)`.
    function deposit(externalEuint64 encAmount, bytes calldata inputProof) external {
        _seed();
        euint64 requested = FHE.fromExternal(encAmount, inputProof);
        FHE.allowTransient(requested, address(token));

        _accrueTotal(uint48(block.timestamp));
        _accrueUser(msg.sender);

        // ERC7984 `_update` is ALL-OR-NOTHING and does not revert: if the
        // caller is short it moves ZERO, not a partial amount, and the call
        // still succeeds. Always credit the amount actually moved.
        euint64 moved = token.confidentialTransferFrom(msg.sender, address(this), requested);

        _shares[msg.sender] = FHE.add(_shares[msg.sender], moved);
        _totalShares = FHE.add(_totalShares, moved);

        FHE.allowThis(_shares[msg.sender]);
        FHE.allow(_shares[msg.sender], msg.sender);
        FHE.allowThis(_totalShares);

        // Registered on the attempt, not on the amount — `moved` is a ciphertext
        // and cannot be branched on. Same semantics as the event below, which
        // has always fired unconditionally.
        if (!isParticipant[msg.sender]) {
            isParticipant[msg.sender] = true;
            _participants.push(msg.sender);
        }

        emit Deposited(msg.sender);
    }

    /// @notice Withdraw principal. Available at any time — this is the no-loss
    /// guarantee, and it holds during an open draw too.
    function withdraw(externalEuint64 encAmount, bytes calldata inputProof) external {
        _seed();
        euint64 requested = FHE.fromExternal(encAmount, inputProof);

        _accrueTotal(uint48(block.timestamp));
        _accrueUser(msg.sender);

        // Cap at the caller's own principal so a request larger than their
        // balance can never reach into someone else's deposit.
        euint64 capped = FHE.min(requested, _shares[msg.sender]);
        FHE.allowThis(capped);
        FHE.allowTransient(capped, address(token));

        euint64 moved = token.confidentialTransfer(msg.sender, capped);

        _shares[msg.sender] = FHE.sub(_shares[msg.sender], moved);
        _totalShares = FHE.sub(_totalShares, moved);

        FHE.allowThis(_shares[msg.sender]);
        FHE.allow(_shares[msg.sender], msg.sender);
        FHE.allowThis(_totalShares);

        emit Withdrawn(msg.sender);
    }

    /// @notice Sweep unclaimed winnings to the caller as cUSD.
    function claim() external {
        _seed();
        euint64 amount = _winnings[msg.sender];
        if (!FHE.isInitialized(amount)) return;

        FHE.allowTransient(amount, address(token));
        euint64 moved = token.confidentialTransfer(msg.sender, amount);

        _winnings[msg.sender] = FHE.sub(_winnings[msg.sender], moved);
        FHE.allowThis(_winnings[msg.sender]);
        FHE.allow(_winnings[msg.sender], msg.sender);

        emit Claimed(msg.sender);
    }

    // ---------------------------------------------------------------------
    // Prize reserve
    // ---------------------------------------------------------------------

    /// @notice Fund the prize reserve with cUSD. Kept strictly separate from
    /// principal — prizes are never paid out of depositors' capital.
    function fundPrize(externalEuint64 encAmount, bytes calldata inputProof) external {
        _seed();
        euint64 requested = FHE.fromExternal(encAmount, inputProof);
        FHE.allowTransient(requested, address(token));

        euint64 moved = token.confidentialTransferFrom(msg.sender, address(this), requested);
        _reserve = FHE.add(_reserve, moved);
        FHE.allowThis(_reserve);

        emit PrizeFunded(msg.sender);
    }

    function setPrizePerDraw(uint64 amount) external onlyOwner {
        prizePerDraw = amount;
        emit PrizePerDrawSet(amount);
    }

    function setYieldSource(IConfidentialYieldSource source) external onlyOwner {
        yieldSource = source;
        emit YieldSourceSet(address(source));
    }

    /// @dev Pull whatever the source has accrued into the reserve.
    ///
    /// Runs once per round, inside `closeEpoch`. Everything about it is
    /// defensive, because a prize source must never be able to harm principal:
    /// an unset source is a no-op, a source reporting zero is a no-op, and the
    /// reserve grows by the amount that ACTUALLY moved rather than the amount
    /// requested — ERC-7984 transfers saturate, so a source that is short moves
    /// less and the call still succeeds.
    ///
    /// Note what is absent: no path here touches `_shares` or `_totalShares`.
    /// A yield source that fails, stalls, or lies cannot reach a depositor's
    /// stake, which is what makes "no loss" structural.
    function _harvest() private {
        if (address(yieldSource) == address(0)) return;

        uint64 amount = yieldSource.accrued();
        if (amount == 0) return;

        euint64 moved = yieldSource.harvest(address(this), amount);
        _reserve = FHE.add(_reserve, moved);
        FHE.allowThis(_reserve);

        emit YieldHarvested(address(yieldSource), amount);
    }

    // ---------------------------------------------------------------------
    // Draw lifecycle
    // ---------------------------------------------------------------------

    /// @notice Close the current epoch and draw randomness for it.
    ///
    /// Permissionless and time-gated, mirroring v5's `awardDraw`. Time-gating
    /// matters: a keeper who is also a depositor must not be able to pick the
    /// moment the TWAB window closes.
    ///
    /// `R` is generated by the coprocessor inside this call, in the same
    /// transaction that advances the epoch, and `draws[e]` is write-once — so
    /// there is no way to resample an unfavourable draw.
    /// @dev Dead time, and why it is skipped rather than drawn.
    ///
    /// Nothing forces this to run on schedule. If the pool sits untouched for
    /// days, the clock is far behind, and the obvious repair — fast-forward
    /// `epochStartedAt` to now — is **not safe**. `_accrueUser` scores a user's
    /// draw weight as `_cumCur + balance * (epochStartedAt - lastAt)`. Jump the
    /// clock across a five-day gap and that term becomes five days of weight,
    /// while `_totalCumPrev` still holds one epoch. `uniform(prn, total)` can
    /// then never exceed it, so anyone idle across the gap wins every draw with
    /// certainty. The naive catch-up does not skip time, it rigs the lottery.
    ///
    /// So the whole gap is crossed in one call by advancing `epoch` **and**
    /// `epochStartedAt` together, by the same number of periods. Advancing the
    /// counter by more than one is what makes this safe: a user last seen
    /// before the gap then fails the `lastEpoch == epoch - 1` test and takes
    /// `_accrueUser`'s other branch, which already caps their bucket at exactly
    /// `balance * epochDuration`.
    ///
    /// Skipped periods produce **no draw**. A round nobody was present to close
    /// cannot be settled anyway: the claim window is one epoch wide, so a draw
    /// created here would be unclaimable the moment it existed. Emitting a
    /// prize nobody can take would be worse than emitting none.
    ///
    /// With a keeper running, `late` is always zero and this reduces to the
    /// ordinary rollover.
    function closeEpoch() external {
        _seed();
        uint48 closesAt = epochEndsAt();
        if (block.timestamp < closesAt) revert EpochNotOver(closesAt);

        uint256 closing = epoch;

        // Top the reserve up before the round settles, so a prize won here is
        // backed by yield this round produced.
        _harvest();

        // Whole further periods elapsed since this epoch should have closed.
        // Zero on a punctual close.
        uint256 late = (block.timestamp - closesAt) / epochDuration;

        // Accrue the global total up to the epoch boundary exactly — not to
        // `block.timestamp`, which may be later if the keeper is slow.
        _accrueTotal(closesAt);
        _totalCumPrev = _totalCumCur;
        FHE.allowThis(_totalCumPrev);

        if (late == 0) {
            euint64 r = FHE.randEuint64();
            FHE.allowThis(r);

            FHE.makePubliclyDecryptable(_totalCumPrev);
            FHE.makePubliclyDecryptable(r);

            bytes32 totalHandle = FHE.toBytes32(_totalCumPrev);
            bytes32 randHandle = FHE.toBytes32(r);
            pendingTotalHandle[closing] = totalHandle;
            pendingRandomHandle[closing] = randHandle;
            draws[closing].prize = prizePerDraw;

            emit EpochClosed(closing, totalHandle, randHandle, draws[closing].prize);
        } else {
            emit DeadEpochsSkipped(closing, late);
        }

        // Roll over, crossing the entire gap. Counter and clock move by the
        // same number of periods — see the note above; they must not diverge.
        epoch = closing + 1 + late;
        epochStartedAt = closesAt + uint48(late * epochDuration);
        _totalCumCur = FHE.asEuint64(0);
        FHE.allowThis(_totalCumCur);
        _totalLastAt = epochStartedAt;
    }

    /// @notice Submit the publicly-decrypted TWAB total and randomness for a
    /// closed epoch, proven by the KMS.
    /// @dev `cleartexts` must be `abi.encode(uint256 totalCumulative, uint256 randomness)`
    /// and the handle order must match `EpochClosed` — the proof is bound to it.
    function awardDraw(
        uint256 epochId,
        bytes calldata cleartexts,
        bytes calldata decryptionProof
    ) external {
        Draw storage d = draws[epochId];
        if (d.awarded) revert DrawAlreadyAwarded(epochId);
        if (pendingTotalHandle[epochId] == bytes32(0)) revert DrawNotAwarded(epochId);
        if (cleartexts.length != 64) revert BadCleartextsLength();

        bytes32[] memory cts = new bytes32[](2);
        cts[0] = pendingTotalHandle[epochId];
        cts[1] = pendingRandomHandle[epochId];
        FHE.checkSignatures(cts, cleartexts, decryptionProof);

        uint64 total = uint64(uint256(bytes32(cleartexts[0:32])));
        uint256 randomness = uint256(bytes32(cleartexts[32:64]));

        // An empty pool has no valid PRN range — `uniform` reverts on a zero
        // upper bound, so reject the draw outright rather than bricking claims.
        if (total == 0) revert NothingToDraw();

        d.totalCumulative = total;
        d.randomness = randomness;
        d.awarded = true;

        emit DrawAwarded(epochId, total, randomness);
    }

    /// @notice Check whether the caller won `epochId`, crediting the prize if
    /// so. O(1), permissionless, and **constant cost** whether you won or lost
    /// — the transaction reveals nothing.
    function checkPrize(uint256 epochId) external {
        Draw memory d = draws[epochId];
        if (!d.awarded) revert DrawNotAwarded(epochId);
        // One-epoch claim window, forced by the bounded TWAB lookback.
        if (epochId + 1 != epoch) revert ClaimWindowClosed(epochId);
        _seed();
        if (checked[epochId][msg.sender]) revert AlreadyChecked(epochId);
        checked[epochId][msg.sender] = true;

        _accrueUser(msg.sender);

        // All plaintext — the PRN costs no homomorphic budget at all.
        uint256 prn = UniformRandomNumber.uniform(
            uint256(keccak256(abi.encode(epochId, msg.sender, d.randomness))),
            d.totalCumulative
        );

        // Scalar compare against the encrypted TWAB: P(win) = userTwab / totalTwab.
        ebool won = FHE.gt(_cumPrev[msg.sender], uint64(prn));

        // Pay what the reserve can actually afford, up to the advertised prize.
        //
        // This used to be an all-or-nothing solvency gate —
        // `and(won, ge(reserve, prize))` — which had a failure mode that is
        // invisible by construction: a reserve one cent short of the prize
        // credited every winner ZERO, and because winning and losing are
        // deliberately indistinguishable, the pool presented as "nobody won"
        // with nothing reverted and nothing logged. A streaming yield source
        // makes that the normal case rather than an edge one, since the reserve
        // tracks accrual and the prize was a fixed ceiling.
        //
        // `min` is strictly better: the payout can never exceed the reserve, so
        // it still cannot underflow, and a winner receives what is there rather
        // than nothing. It is also cheaper — one comparison instead of two.
        //
        // Consequence worth stating: the exact payout is now a ciphertext, so
        // `prizePerDraw` is a public CEILING rather than a public promise. With
        // several winners in one round the earlier checker may take more of the
        // reserve than the later one.
        euint64 award = FHE.select(
            won,
            FHE.min(_reserve, FHE.asEuint64(d.prize)),
            FHE.asEuint64(0)
        );

        _winnings[msg.sender] = FHE.add(_winnings[msg.sender], award);
        _reserve = FHE.sub(_reserve, award);

        FHE.allowThis(_winnings[msg.sender]);
        FHE.allow(_winnings[msg.sender], msg.sender);
        FHE.allowThis(_reserve);

        emit PrizeChecked(epochId, msg.sender);
    }
}
