// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.27;

import { Ownable2Step, Ownable } from "@openzeppelin/contracts/access/Ownable2Step.sol";
import { FHE, euint64 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";
import { IERC7984 } from "@openzeppelin/confidential-contracts/interfaces/IERC7984.sol";
import { IConfidentialYieldSource } from "../IConfidentialYieldSource.sol";

/// @title AdminFundedYieldSource
/// @notice A reserve somebody tops up by hand, released a fixed amount per round.
///
/// This is the mock, and it is deliberately the dullest possible implementation
/// of the interface: whatever has been deposited here is handed to the pool
/// `perRound` at a time. It earns nothing. It claims nothing.
///
/// Its job is to prove the seam is real. The pool calls `accrued()` and
/// `harvest()` on an interface and has no idea what is behind it, so replacing
/// this with something that genuinely earns is one `setYieldSource` call and no
/// change to the pool, the draw, or the confidentiality model.
///
/// Funding is permissionless on purpose — anyone may make the prize bigger, and
/// nobody can withdraw from here except the pool.
contract AdminFundedYieldSource is ZamaEthereumConfig, Ownable2Step, IConfidentialYieldSource {
    IERC7984 public immutable token;
    address public immutable pool;

    /// Plaintext amount released per harvest. Public, like the prize itself.
    uint64 public perRound;

    /// Plaintext record of what this source can actually pay.
    ///
    /// Load-bearing, not bookkeeping. ERC-7984 transfers are ALL-OR-NOTHING:
    /// `FHESafeMath.tryDecrease` returns `ge(balance, amount)` and `_update`
    /// then moves either the full amount or ZERO. Asking for one unit more than
    /// this source holds therefore moves nothing at all, leaves the pool's
    /// reserve empty, and — because a loss and an unpayable win are the same
    /// observation — presents as "nobody won" with no error anywhere.
    ///
    /// So the pool is never allowed to over-request: `accrued()` is capped by
    /// this figure. Keeping it in plaintext costs no privacy, because the prize
    /// pot is public by design; only depositor balances are secret.
    uint64 public available;


    event Funded(address indexed from);
    event PerRoundSet(uint64 amount);

    error OnlyPool();
    error InsufficientReserve(uint64 requested, uint64 available);

    constructor(IERC7984 token_, address pool_, uint64 perRound_, address initialOwner)
        Ownable(initialOwner)
    {
        token = token_;
        pool = pool_;
        perRound = perRound_;
    }

    /// @notice Top the reserve up. Open to anyone.
    /// @dev Takes a PLAINTEXT amount: the prize pot is public by design, and the
    /// source has to know its own balance in the clear to avoid over-promising.
    /// The caller must actually hold this much — if they do not, the transfer
    /// moves zero while `available` still rises, so fund from a script that
    /// verifies by balance delta.
    function fund(uint64 amount) external {
        euint64 enc = FHE.asEuint64(amount);
        FHE.allowThis(enc);
        FHE.allowTransient(enc, address(token));
        token.confidentialTransferFrom(msg.sender, address(this), enc);
        available += amount;
        emit Funded(msg.sender);
    }

    function setPerRound(uint64 amount) external onlyOwner {
        perRound = amount;
        emit PerRoundSet(amount);
    }

    /// @inheritdoc IConfidentialYieldSource
    /// @dev Capped by what is actually here — see `available`.
    function accrued() external view returns (uint64) {
        return perRound < available ? perRound : available;
    }

    /// @inheritdoc IConfidentialYieldSource
    ///
    /// @dev Returns the amount that MOVED. Guarded by `available` above,
    /// because an over-request would move ZERO rather than a partial amount.
    function harvest(address to, uint64 amount) external returns (euint64 moved) {
        if (msg.sender != pool) revert OnlyPool();

        if (amount > available) revert InsufficientReserve(amount, available);
        available -= amount;

        euint64 request = FHE.asEuint64(amount);
        FHE.allowThis(request);
        FHE.allowTransient(request, address(token));

        moved = token.confidentialTransfer(to, request);
        FHE.allowThis(moved);
        // The pool has to be able to add this to its reserve.
        FHE.allow(moved, to);
    }
}
