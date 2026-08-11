// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.27;

import { FHE, euint64 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";
import { ERC7984 } from "@openzeppelin/confidential-contracts/token/ERC7984/ERC7984.sol";

/// @title ConfidentialUSD (cUSD)
/// @notice The pool's asset. Confidential from the moment it exists.
///
/// # Why there is no ERC-20 underneath
///
/// The obvious construction is a public ERC-20 wrapped into an ERC-7984, and
/// that is what this project shipped first (see `alt/`). It has a cost: `wrap`
/// takes a PLAINTEXT amount, so the size of every entry into the confidential
/// system is published, per user, forever. That is a real leak, and it was
/// documented as one.
///
/// Minting confidentially removes it. The faucet mints a FIXED, PUBLIC constant
/// — the same 1,000 for everybody — so the only thing an observer learns is
/// that an address claimed, which their transaction already told them. No
/// per-user amount is ever written in the clear, at any point in the lifecycle.
///
/// What is given up: there is no public token to unwrap back to. Balances live
/// and die confidential. On a test network that costs nothing, and it is the
/// honest shape for an asset whose entire premise is that its quantity is
/// nobody's business.
///
/// The ERC-20 → wrap path is kept in `alt/` and remains deployed, so the flow
/// is still demonstrable; the pool simply does not depend on it.
///
/// Decimals are 6, inherited from the ERC-7984 base.
contract ConfidentialUSD is ZamaEthereumConfig, ERC7984 {
    /// 1,000 cUSD per claim (6 decimals). Public and identical for everyone —
    /// that is precisely what makes it disclose nothing.
    uint64 public constant FAUCET_AMOUNT = 1_000_000_000;

    /// Per-address throttle between claims.
    uint256 public constant FAUCET_COOLDOWN = 1 hours;

    mapping(address => uint256) public lastClaimedAt;

    event FaucetClaimed(address indexed user);

    error FaucetCooldownActive(uint256 availableAt);

    constructor() ERC7984("Confidential USD", "cUSD", "") {}

    /// @notice Mint yourself 1,000 cUSD, once an hour. Permissionless.
    ///
    /// @dev The balance lands encrypted and already decryptable by the caller:
    /// `ERC7984._update` grants the receiver ACL rights on their new balance,
    /// so no extra permission plumbing is needed here.
    function faucet() external {
        uint256 availableAt = lastClaimedAt[msg.sender] + FAUCET_COOLDOWN;
        if (lastClaimedAt[msg.sender] != 0 && block.timestamp < availableAt) {
            revert FaucetCooldownActive(availableAt);
        }
        lastClaimedAt[msg.sender] = block.timestamp;

        euint64 amount = FHE.asEuint64(FAUCET_AMOUNT);
        FHE.allowThis(amount);
        _mint(msg.sender, amount);

        emit FaucetClaimed(msg.sender);
    }

    /// @notice Unix timestamp when `user` may claim again; 0 if available now.
    function nextFaucetAt(address user) external view returns (uint256) {
        if (lastClaimedAt[user] == 0) return 0;
        uint256 next = lastClaimedAt[user] + FAUCET_COOLDOWN;
        return next > block.timestamp ? next : 0;
    }
}
