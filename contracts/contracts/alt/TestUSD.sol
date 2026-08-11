// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.27;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { Ownable2Step, Ownable } from "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @title TestUSD (tUSD)
/// @notice Plain 6-decimal ERC-20 used as the pool's underlying asset on
/// Sepolia. This is the token judges obtain to try the app.
///
/// Deliberately a mock: Aave's Sepolia stablecoin reserves are ~100% utilised
/// (a few hundred units withdrawable against billions supplied), so no public
/// testnet stablecoin can back a pool that promises withdrawal at any time.
/// See the README's yield-source section.
///
/// Confidentiality note: this token is fully public. Privacy begins only after
/// wrapping into ConfidentialUSD.
contract TestUSD is ERC20, Ownable2Step {
    /// 1,000 tUSD per faucet claim (6 decimals → 1e9 base units).
    uint256 public constant FAUCET_AMOUNT = 1_000_000_000;

    /// Per-address throttle between faucet claims.
    uint256 public constant FAUCET_COOLDOWN = 1 hours;

    mapping(address => uint256) public lastClaimedAt;

    event FaucetClaimed(address indexed user, uint256 amount);

    error FaucetCooldownActive(uint256 availableAt);

    constructor(address initialOwner) ERC20("Test USD", "tUSD") Ownable(initialOwner) {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice Free faucet — mints FAUCET_AMOUNT to the caller, once per
    /// FAUCET_COOLDOWN. Permissionless.
    function faucet() external {
        uint256 availableAt = lastClaimedAt[msg.sender] + FAUCET_COOLDOWN;
        if (lastClaimedAt[msg.sender] != 0 && block.timestamp < availableAt) {
            revert FaucetCooldownActive(availableAt);
        }
        lastClaimedAt[msg.sender] = block.timestamp;
        _mint(msg.sender, FAUCET_AMOUNT);
        emit FaucetClaimed(msg.sender, FAUCET_AMOUNT);
    }

    /// @notice Unix timestamp when `user` may claim again; 0 if available now.
    function nextFaucetAt(address user) external view returns (uint256) {
        if (lastClaimedAt[user] == 0) return 0;
        uint256 next = lastClaimedAt[user] + FAUCET_COOLDOWN;
        return next > block.timestamp ? next : 0;
    }

    /// @notice Owner mint, for seeding demo accounts and tests.
    function mintTo(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
