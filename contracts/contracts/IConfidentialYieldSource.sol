// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.27;

import { euint64 } from "@fhevm/solidity/lib/FHE.sol";

/// @title IConfidentialYieldSource
/// @notice Where a round's prize comes from.
///
/// The pool never touches this to pay principal. It calls `harvest` once per
/// round, at `closeEpoch`, and whatever arrives lands in `_reserve` — the only
/// pot prizes are ever paid from. That separation is what makes "no loss"
/// structural rather than a promise: there is no code path by which a yield
/// source failing, stalling, or returning zero can reach a depositor's stake.
///
/// # Why the seam is this narrow
///
/// A real source has to satisfy two constraints that rule out most of DeFi:
///
///   1. It must settle in the confidential token. The pool holds and pays cUSD
///      only, and never wraps or unwraps — that is what keeps the protocol
///      itself off the public side of the confidentiality boundary. A source
///      that requires unwrapping moves the boundary into the protocol.
///
///   2. It must not lock principal. Withdrawal is open at every moment,
///      including mid-round, so nothing may be deposited anywhere it cannot be
///      recalled on demand.
///
/// No venue satisfying both exists today — there is no confidential lending
/// market, and OpenZeppelin's confidential-contracts ships no vault primitive.
/// So the shipped implementations fund the reserve directly. The interface is
/// the whole of what a real source would have to implement, and swapping one in
/// is a single `setYieldSource` call.
interface IConfidentialYieldSource {
    /// @notice Prize available to move right now, in plaintext token units.
    /// @dev Plaintext by necessity — the pool needs it to size the request, and
    /// the prize amount is public by design anyway. Returning 0 is legal and
    /// means "nothing this round"; the pool skips the harvest entirely.
    function accrued() external view returns (uint64);

    /// @notice Move up to `amount` of the confidential token to `to`.
    /// @dev MUST return the amount that actually moved, not the amount asked
    /// for, and MUST NOT be callable for more than the source holds.
    ///
    /// ERC-7984 transfers are ALL-OR-NOTHING: `FHESafeMath.tryDecrease` returns
    /// `ge(balance, amount)`, so a short source moves ZERO and the transaction
    /// still succeeds. Crediting the request instead of the movement would
    /// inflate the pool's reserve against tokens it never received; requesting
    /// more than the source holds silently contributes nothing at all.
    ///
    /// Implementations MUST restrict this to the pool.
    function harvest(address to, uint64 amount) external returns (euint64 moved);
}
