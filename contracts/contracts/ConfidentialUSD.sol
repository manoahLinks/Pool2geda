// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.27;

import { IERC20 } from "@openzeppelin/contracts/interfaces/IERC20.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";
import { ERC7984 } from "@openzeppelin/confidential-contracts/token/ERC7984/ERC7984.sol";
import {
    ERC7984ERC20Wrapper
} from "@openzeppelin/confidential-contracts/token/ERC7984/extensions/ERC7984ERC20Wrapper.sol";

/// @title ConfidentialUSD (cUSD)
/// @notice ERC-7984 wrapper over TestUSD. This is the confidentiality boundary
/// of the whole system.
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
contract ConfidentialUSD is ZamaEthereumConfig, ERC7984ERC20Wrapper {
    constructor(
        IERC20 underlying_
    ) ERC7984("Confidential USD", "cUSD", "") ERC7984ERC20Wrapper(underlying_) {}
}
