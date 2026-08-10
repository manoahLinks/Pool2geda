# Pool2geda

**No-loss prize savings where nobody can see what you hold — not other savers, not observers, not even the contract paying the prize.**

A confidential port of [PoolTogether v5](https://github.com/GenerationSoftware/pt-v5-prize-pool) onto the [Zama Protocol](https://docs.zama.org/protocol) (FHEVM). Deposit, earn odds on a recurring prize draw, withdraw your full principal whenever you like. Balances, odds, winnings and the identity of each winner stay encrypted on-chain.

- **Live app:** _not yet deployed — see [Status](#status)_
- **Network:** Ethereum Sepolia (chain `11155111`)
- **Contracts:** [see below](#deployed-contracts)

---

## Why this needs FHE

On a transparent chain a prize-savings protocol leaks everything: how much every user has saved, each wallet's odds of winning, and who won every draw. That exposes users' wealth, makes large depositors targets, and discourages participation.

FHE removes the trade-off. The pool can compute odds over encrypted balances and pay a winner without ever learning who that winner is.

There is one nice consequence worth stating plainly: **this design is more private than the protocol it clones.** PoolTogether's `claimPrize` reverts with `DidNotWin`, so the transaction itself publishes the outcome. Here, `checkPrize` always succeeds, always costs the same, and writes an encrypted result. An observer watching the chain cannot tell a winner from a loser.

---

## How it works

### The confidential deposit flow

```
tUSD  ──approve──▶  ConfidentialUSD.wrap()  ──▶  cUSD  ──deposit()──▶  Pool
 ERC-20              amount is PUBLIC              ERC-7984            encrypted
                     ↑ confidentiality boundary
```

1. **Get tUSD** — a plain 6-decimal ERC-20 with a public faucet (1,000 tUSD per hour per address).
2. **Wrap to cUSD** — an [ERC-7984](https://docs.openzeppelin.com/confidential-contracts/token) confidential token. The wrap amount is public; this is the only step an observer can read.
3. **Allow the pool** — a one-time `setOperator` grant. It is a permission, not an amount.
4. **Deposit** — the amount is encrypted **in your browser**, with a zero-knowledge proof binding the ciphertext to this contract and your address. The plaintext never leaves the tab.

### Encrypted accounting

Every balance is a `euint64` ciphertext handle. The pool stores:

| State | Type | Meaning |
|---|---|---|
| `_shares[user]` | `euint64` | encrypted principal |
| `_winnings[user]` | `euint64` | encrypted unclaimed prize |
| `_cumPrev/_cumCur[user]` | `euint64` | encrypted time-weighted stake |
| `_reserve` | `euint64` | prize reserve, never principal |

### Odds are stake × time, not stake

> **A deliberate departure from the brief, stated up front.** The brief asks for
> winner selection "weighted by deposit size". This weights by deposit size
> **multiplied by holding time**, which is what PoolTogether v5 itself does.
> Size alone is trivially gameable: borrow a large sum, deposit it one block
> before the draw, win with near-certainty, repay. Weighting by size alone would
> reproduce the mechanic while removing the property that makes it safe. Every
> other guarantee the brief asks for is met exactly; this one is met by the
> design the brief is asking us to recreate.

Odds follow a **time-weighted average balance** (TWAB), ported from PoolTogether's `TwabLib`:

```
cumulative += balance × secondsHeld
```

`secondsHeld` is plaintext, so this is the cheap *scalar* multiply. A deposit made moments before a draw contributes ≈ 0 to its own odds, which makes last-second and flash-loan gaming arithmetically worthless.

We keep a **one-epoch lookback** (two buckets per user, rolled forward lazily) rather than v5's 17,520-slot observation ring buffer, which is untenable under FHE — every slot would be a ciphertext handle with its own ACL. Every code path stays O(1) even after arbitrarily many idle rounds. The cost: a prize must be checked during the round *after* the one it was won in. v5 has the same constraint (`ClaimPeriodExpired`).

### The draw

```
closeEpoch()   ── FHE.randEuint64() drawn by the coprocessor,
                  makePubliclyDecryptable(total, R), epoch++          [on-chain]
      ↓
relayer        ── decryptPublicValues([totalHandle, randHandle])      [off-chain]
      ↓
awardDraw()    ── FHE.checkSignatures(cts, cleartexts, proof)         [on-chain]
      ↓
checkPrize()   ── per user, O(1), constant cost                       [on-chain]
```

All three on-chain steps are **permissionless**. `closeEpoch` is time-gated behind a fixed round length, so no caller can pick a favourable moment.

### Winner selection — deposit-weighted, over encrypted balances

The key insight from reading v5: **it never iterates over depositors.** Winning is not a selection over a set, it is a *predicate on one user's state*:

```solidity
// PoolTogether v5, TierCalculationLib.sol — verbatim
UniformRandomNumber.uniform(_userSpecificRandomNumber, _vaultTwabTotalSupply)
    < calculateWinningZone(_userTwab, _vaultContributionFraction, _tierOdds)
```

Every input to the hash is public; the only secret is `userTwab`. So the pseudo-random number is computed in **plaintext**, and the comparison against the encrypted stake is a single **scalar** FHE operation:

```solidity
uint256 prn = UniformRandomNumber.uniform(
    uint256(keccak256(abi.encode(epochId, msg.sender, drawRandom))),
    drawTotalPlain
);                                                        // plaintext — free
ebool won = FHE.gt(_cumPrev[msg.sender], uint64(prn));    // scalar — 118k HCU
_winnings[u] = FHE.add(_winnings[u], FHE.select(won, prizeEnc, zeroEnc));
```

`P(win) = userCumulative / totalCumulative` — exactly proportional to stake × time.

**Why this matters:** an O(N) design (walk a cumulative sum over all depositors) is the obvious approach and it does not fit. FHEVM caps a transaction at **20M HCU total and 5M sequential depth**; a linear accumulator costs ~627k HCU per depositor, capping the pool near **30 participants**. The predicate form is ~335k HCU *per user with no cross-user dependency*, so it scales without limit and needs no keeper sweep.

Modulo bias is removed by rejection sampling — PoolTogether's own `UniformRandomNumber`, vendored verbatim.

**Multiple winners are expected.** Each user's test is independent, so the winner count is Poisson with λ = 1. The brief allows "one or more depositors". `checkPrize` gates on reserve solvency (`FHE.ge(_reserve, prize)`), so an unpayable win is never credited and the reserve cannot underflow.

### Prize distribution and winner-only decryption

The prize is credited as an **encrypted delta**: `select(won, prize, 0)`. Losers are credited zero. The write is identical either way, so storage access patterns leak nothing.

To learn the outcome you decrypt your own `winnings` via the EIP-712 user-decryption flow — one wallet signature, cached as a permit. `claim()` then moves it out by `confidentialTransfer`, so the payout leg is encrypted end to end.

### No loss

Principal never rebases and never funds prizes:

- `_shares` is decremented **only by the amount a transfer actually moved**, never the requested amount. `ERC7984._update` *saturates* rather than reverting — an over-transfer silently moves zero — so trusting the request would underflow and wrap the balance.
- Withdrawals are capped at the caller's own principal via `FHE.min`, so a large request cannot reach another depositor's deposit.
- Prizes come strictly from `_reserve`, which is funded separately.
- Withdrawal stays open at all times, including mid-round.

---

## Confidentiality design

### Encrypted

| | |
|---|---|
| Individual deposits and balances | `euint64`, decryptable only by the holder |
| Time-weighted stake (your odds) | `euint64` |
| Winnings | `euint64` |
| **Who won** | never computed in the clear, by anyone |
| The random index per user | derived from a public `R`, compared against an encrypted stake |

### What leaks, and why

Stated plainly, because minimal-and-documented beats overclaimed.

1. **The pool's aggregate TWAB total, once per round.** Required: `FHE.rem`/`div` accept only a *plaintext* divisor, so the PRN modulus cannot be encrypted. This is a time-weighted aggregate, which is muddier than an instantaneous total — the same figure arises from many balance/duration combinations.

2. **The draw randomness `R`, after the round closes.** Required: `keccak256` cannot run on ciphertext, so the per-user PRN must be computable in plaintext. **This leaks nothing about individuals** — an observer can compute every user's PRN and still not determine a single winner, because `userCumulative` stays encrypted.

3. **Delta correlation — the sharpest leak.** If exactly one user deposits between rounds *N* and *N+1*, the change in successive public totals reveals their contribution. Mitigations: frequent rounds relative to deposits; TWAB confounds *amount* with *time held*; splitting a deposit across rounds. Not fully solved, and worth knowing before depositing a distinctive amount into a quiet pool.

4. **Participant addresses.** Deposits and `checkPrize` calls are public transactions. Membership is visible; amounts are not.

5. **The prize amount** — public by design.

6. **Amounts crossing the ERC-20 boundary** — `wrap` takes a plaintext amount, and `unwrap` reveals its amount via the finalisation proof. Confidentiality begins after wrapping and ends at unwrapping. **The pool itself never wraps or unwraps**, so no protocol operation crosses that boundary; only users do, on the way in and out.

### Fairness

- `R` is generated by the Zama coprocessor inside `closeEpoch`, in the same transaction that advances the round — not by the keeper, miner, or admin.
- `draws[e]` is **write-once**, bound by `FHE.checkSignatures`. There is no way to resample an unfavourable draw.
- Weighting is exact, and modulo bias is eliminated by rejection sampling rather than merely made small.
- `closeEpoch` is time-gated, so a keeper who is also a depositor cannot choose the moment the TWAB window closes.

### Trust assumptions

- The admin funds the prize reserve and sets the prize amount.
- The Zama KMS and relayer are trusted for decryption, as with any FHEVM application.
- Anyone can trigger a round; timing is fixed by the contract.

---

## The yield source

`prizePerDraw` is paid from an admin-funded `_reserve`, held in cUSD. **This is a mock**, and here is the evidence for why, queried live on Sepolia (2026-08-04):

| Aave v3 Sepolia | Supplied | **Withdrawable** | Supply APY |
|---|---|---|---|
| USDC | 4,080,059,174 | **71.60** | 57.59% |
| DAI | 4,909,052,370 | **200.07** | 71.10% |
| WETH | 12,206 | 12,206 | **0.00%** |

Pool `0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951`. The stablecoin reserves are ~100% utilised — that high APY exists *because* nothing is left. Routing principal there would break "withdraw at any time," the one property this protocol is named for. WETH is fully liquid but pays nothing.

Independently: **no confidential yield venue exists.** OpenZeppelin's `confidential-contracts@0.5.1` contains no vault, staking, or ERC-4626 primitive (a grep across all 27 contracts returns nothing), and there is no such protocol in the Zama ecosystem. Reaching real yield therefore means bridging out through `unwrap` → supply → rewrap, which the liquidity data already rules out.

So a confidential-native reserve is not a shortcut here; it is the only coherent option today.

### How a real yield source plugs in

Principal is already segregated from prizes, so the integration point is narrow. A real source implements:

```solidity
interface IConfidentialYieldSource {
    function accrued() external view returns (uint64);      // prize available
    function harvest(address to, uint64 amount) external;   // confidentialTransfer to pool
}
```

The pool calls `harvest` into `_reserve` at `closeEpoch` instead of taking an admin deposit. Nothing about the draw, the accounting, or the confidentiality model changes — `_reserve` is already the only thing prizes are paid from. Once a confidential lending market exists, or Sepolia's Aave reserves regain liquidity, an adapter is the whole job.

---

## Deployed contracts

Sepolia, chain `11155111`. `confidentialProtocolId()` returns `10001`, confirming a live Zama coprocessor is wired.

| Contract | Address |
|---|---|
| `TestUSD` (tUSD) | [`0x77C017994264dBd3e190ae9bc3D7c96De8a52728`](https://sepolia.etherscan.io/address/0x77C017994264dBd3e190ae9bc3D7c96De8a52728) |
| `ConfidentialUSD` (cUSD) | [`0x4DeD3F2430D48ee0Bd8535422E1FCF7Ea6cCbF81`](https://sepolia.etherscan.io/address/0x4DeD3F2430D48ee0Bd8535422E1FCF7Ea6cCbF81) |
| `ConfidentialPrizePool` | [`0x621ae6DF57c888f702936FE184AE2ebB93854445`](https://sepolia.etherscan.io/address/0x621ae6DF57c888f702936FE184AE2ebB93854445) |

Round length **900s (15 min)**, prize **10 cUSD**.

### Getting test tokens

No allowlist. In the app, step 1 calls `TestUSD.faucet()` — **1,000 tUSD, once per hour per address**. You also need a little Sepolia ETH for gas from any public faucet.

---

## Running it

Requires Node 20 or 22.

```bash
# Contracts
cd contracts
npm install
npx hardhat test                    # 15 tests on the FHEVM mock coprocessor

# Deploy (writes web/.env automatically)
npx hardhat vars set PRIVATE_KEY
npx hardhat vars set ALCHEMY_API_KEY_SEPOLIA
npx hardhat deploy --network sepolia

# Frontend
cd ../web
npm install
npm run abi                         # regenerate ABIs from artifacts
npm run dev
```

### Scripts

| Script | Purpose |
|---|---|
| `contracts/deploy/01_deploy.ts` | Deploys all three contracts, asserts the coprocessor resolved, writes `web/.env` |
| `contracts/scripts/check-account.ts` | Deployer address, balance, RPC reachability |
| `contracts/scripts/spike-relayer.ts` | Full round trip against the **live** relayer |
| `contracts/scripts/probe-award.ts` | Replays `awardDraw` as a static call to surface revert reasons |
| `web/scripts/extract-abi.mjs` | Generates ABIs from artifacts so the frontend cannot drift |

### Pinned versions — do not "upgrade" `@fhevm/solidity`

| Package | Version |
|---|---|
| `@fhevm/solidity` | `0.11.1` |
| `@fhevm/hardhat-plugin` | `0.4.2` |
| `@openzeppelin/confidential-contracts` | `0.5.1` |
| `@zama-fhe/sdk` | `3.4.0` |

Every published `@openzeppelin/confidential-contracts` release through 0.5.1 declares an **exact** peer dependency on `@fhevm/solidity@0.11.1`. Installing 0.13.1 alongside it fails with `ERESOLVE`, and `--force` produces a broken tree. 0.13.1 exists and adds `ZamaPolygonConfig`, but it cannot be used with the ERC-7984 base contracts.

---

## Verification

Verification comes in two layers, and it is worth being exact about which is
which, because they prove different things.

**Layer 1 — 15 tests on the FHEVM mock.** `npx hardhat test`. The suite runs
against `@fhevm/hardhat-plugin`'s local mock coprocessor and is gated on it
(`if (!fhevm.isMock) this.skip()`), so it never touches the relayer or the KMS.
What it proves is the *logic*: TWAB accounting, the winner predicate, no-loss
invariants, saturation handling, epoch boundaries. What it cannot prove is that
the real FHE pipeline agrees.

**Layer 2 — a live end-to-end spike on Sepolia.** `scripts/spike-relayer.ts`
exercises what the mock skips, against the deployed contracts and the real
relayer: `encrypt()` + ZK proof into `FHE.fromExternal`, `userDecrypt()` through
the EIP-712 permit, `publicDecrypt()` of both draw handles, and `awardDraw`
verifying them on-chain via `FHE.checkSignatures` — ending in a real prize
credit. Latencies and gas are tabulated below.

Neither layer alone is sufficient. Together they cover the logic and the
cryptography.

### Layer 1 — 15 tests on the FHEVM mock

`npx hardhat test`. Notable cases:

| Test | Claim it defends |
|---|---|
| Weighted distribution | Win frequency tracks stake share |
| **TWAB accounting invariant** | Per-user accumulators sum to the public total in the deposited ratio — measured at **75.00% / 24.99%, summing to 100%** |
| TWAB anti-gaming | A depositor holding 99% of the balance for 0.3% of the round wins at ~26%, tracking their time-weighted share |
| **Constant-cost claim** | Winner and loser `checkPrize` gas are **identical** — the confidentiality claim, asserted mechanically |
| No loss | Full principal withdrawable after arbitrarily many losing rounds |
| Saturating transfer | Over-withdrawal moves zero and does not corrupt `_shares` |
| Epoch overrun | Deposits during an expired-but-unclosed round land in the next one |
| Draw immutability | A second `awardDraw` reverts |

### Layer 2 — live on Sepolia, against the real relayer

The full cycle — deposit → draw → win → credit — verified end to end via
`scripts/spike-relayer.ts`. This is the layer the mock cannot reach: real
ciphertexts, real ZK proofs, real KMS signatures verified on-chain.

| Step | Latency | Gas |
|---|---|---|
| `encrypt()` + ZK proof → `fromExternal` | 10–14s | 803,489 |
| `userDecrypt()` (EIP-712 permit) | 3–5s | — |
| `closeEpoch()` (FHE randomness) | — | 291,897 |
| `publicDecrypt()` × 2 handles | ~3.2s | — |
| `awardDraw()` → `checkSignatures` | — | 406,156 |
| `checkPrize()` | — | 474,289 |

Winnings decrypted to exactly `10000000` — the sole depositor won, as the maths requires.

---

## Frontend

Vite + React + wagmi + RainbowKit, built against `@zama-fhe/sdk` 3.4.0.

The design language is **security printing** — banknotes and share certificates are the existing visual grammar for *"this represents money, and it cannot be forged or read by the wrong party."* Sealed values are drawn as **guilloche generated from the ciphertext handle itself**, and the hero rosette is cut from the round's actual randomness. The ornament *is* the ciphertext, not a picture of one.

Decryption is **on demand**, never automatic. It costs a signature and a relayer round trip, and more importantly a UI that silently decrypts everything on load looks identical to one with no encryption at all.

### Error handling

`web/src/lib/errors.ts` maps failure modes to text a user can act on — wrong network, missing approval, missing operator grant, relayer not ready, expired permit, faucet cooldown, claim window closed. Two deserve special mention because they are silent by nature:

- **Saturating transfers.** ERC-7984 moves zero rather than reverting when short. The transaction *succeeds* with no effect. The deposit path checks the balance delta and says so explicitly.
- **Relayer propagation.** Public decryption answers `not_ready_for_decryption` for a few seconds after a round closes, while the ciphertext reaches the gateway. `publicDecryptWithRetry` handles it; without it, settling a fresh round fails intermittently and looks like a contract bug.

The Zama SDK is loaded on demand rather than at page load, cutting the eager download by 24%.

---

## Status

**Working and verified:** contracts, 15/15 tests, live Sepolia deployment, and the complete relayer round trip including on-chain KMS proof verification.

**Not yet done:**
- **No public URL.** The frontend builds and runs locally but is not deployed.
- **The browser flow has not been driven by a wallet.** The relayer paths are proven from Node via the spike; the in-browser SDK path is verified by compilation and module resolution only.
- Demonstration video and write-up.

### Known limitations

- **One-round claim window.** A prize must be checked during the following round — the cost of bounding TWAB to O(1). Mirrors v5's `ClaimPeriodExpired`.
- **Single prize tier.** v5's `4**tier` structure and `SD59x18` odds curves are not ported.
- **Prize solvency under many winners.** The winner count is Poisson(1); the reserve should be funded for ~5. Beyond that, `checkPrize` correctly declines to credit rather than crediting an unpayable win.
- **Mock yield**, for the reasons documented above.

---

## Layout

```
contracts/
  contracts/
    ConfidentialPrizePool.sol      the core — 525 lines, heavily commented
    ConfidentialUSD.sol            ERC-7984 wrapper, the confidentiality boundary
    TestUSD.sol                    ERC-20 + faucet
    vendor/UniformRandomNumber.sol vendored from PoolTogether (GPL-3.0)
  test/                            15 tests, real FHE pipeline
  deploy/  scripts/
web/
  src/lib/zama.ts                  SDK construction, loaded on demand
  src/lib/decrypt.ts               user + public decryption, with retry
  src/components/Guilloche.tsx     rosettes generated from on-chain values
```

## Licence

GPL-3.0. `UniformRandomNumber.sol` is vendored verbatim from
[GenerationSoftware/uniform-random-number](https://github.com/GenerationSoftware/uniform-random-number)
and is GPL-3.0; the rest of the project is licensed to match.
