// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.27;

import { IERC20 } from "@openzeppelin/contracts/interfaces/IERC20.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";
import { ERC7984 } from "@openzeppelin/confidential-contracts/token/ERC7984/ERC7984.sol";
import {
    ERC7984ERC20Wrapper
} from "@openzeppelin/confidential-contracts/token/ERC7984/extensions/ERC7984ERC20Wrapper.sol";

/// @title WrappedUSD — the ERC-20 wrapper path, kept for reference
/// @notice ERC-7984 wrapper over TestUSD.
///
/// NOT used by the live pool. The pool's asset is `ConfidentialUSD`, which is
/// confidential from birth and never publishes a per-user amount. This contract
/// is retained, deployed and tested because the ERC-20 → wrap → confidential
/// flow is worth demonstrating, and because it documents exactly what that
/// design costs: `wrap` takes a PLAINTEXT amount, so every entry into the
/// confidential system is published per user, forever.
///
/// `unwrap` is two-phase and also reveals its amount via `finalizeUnwrap`'s
/// decryption proof. Everything between those two points stays encrypted.
///
/// `wrap(to, amount)` takes a PLAINTEXT amount and pulls the underlying via
/// approve — so wrapping is publicly visible. `unwrap` is two-phase and also
/// reveals the amount, via `finalizeUnwrap`'s decryption proof. Everything
/// between those two points — pool deposits, balances, TWAB, prize credits,
/// winnings — stays encrypted.
///
/// The prize pool itself never wraps or unwraps: it holds and pays cUSD only,
/// so no protocol operation ever crosses the public boundary. Users cross it
/// exactly twice, on the way in and on the way out.
///
/// Decimals are fixed at 6 by the wrapper base, matching TestUSD, so `rate()`
/// is 1 and there is no dust remainder on wrap.
contract WrappedUSD is ZamaEthereumConfig, ERC7984ERC20Wrapper {
    constructor(
        IERC20 underlying_
    ) ERC7984("Wrapped USD", "wUSD", "") ERC7984ERC20Wrapper(underlying_) {}
}
