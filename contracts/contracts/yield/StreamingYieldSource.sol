// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.27;

import { Ownable2Step, Ownable } from "@openzeppelin/contracts/access/Ownable2Step.sol";
import { FHE, euint64, externalEuint64 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";
import { IERC7984 } from "@openzeppelin/confidential-contracts/interfaces/IERC7984.sol";
import { IConfidentialYieldSource } from "../IConfidentialYieldSource.sol";

/// @title StreamingYieldSource
/// @notice A prize that grows with the clock instead of arriving in lumps.
///
/// # This is a simulation, and says so
///
/// Nothing here earns anything. It releases a pre-funded balance at a fixed
/// rate per second, so the prize a round pays depends on how long that round
/// ran. No interest is generated, no counterparty pays anything, and on a test
/// network there is no economic activity for yield to come from in the first
/// place — every token in existence here was minted free.
///
/// It exists because a fixed 10 cUSD prize misrepresents the mechanic. Real
/// prize savings pay out whatever the pooled capital happened to earn, so the
/// figure moves. Streaming reproduces that shape — the prize is larger after a
/// long round and smaller after a short one — without pretending to a source of
/// return that does not exist.
///
/// A genuine source implements the same two methods and this contract is
/// deleted.
contract StreamingYieldSource is ZamaEthereumConfig, Ownable2Step, IConfidentialYieldSource {
    IERC7984 public immutable token;
    address public immutable pool;

    /// Plaintext token units released per second.
    uint64 public ratePerSecond;

    /// Ceiling on a single harvest, so a long silence cannot drain the whole
    /// balance into one round.
    uint64 public maxPerHarvest;

    uint48 public lastHarvestAt;

    event Funded(address indexed from);
    event RateSet(uint64 ratePerSecond, uint64 maxPerHarvest);

    error OnlyPool();

    constructor(
        IERC7984 token_,
        address pool_,
        uint64 ratePerSecond_,
        uint64 maxPerHarvest_,
        address initialOwner
    ) Ownable(initialOwner) {
        token = token_;
        pool = pool_;
        ratePerSecond = ratePerSecond_;
        maxPerHarvest = maxPerHarvest_;
        lastHarvestAt = uint48(block.timestamp);
    }

    /// @notice Top the stream up. Open to anyone.
    function fund(externalEuint64 encAmount, bytes calldata inputProof) external {
        euint64 amount = FHE.fromExternal(encAmount, inputProof);
        FHE.allowTransient(amount, address(token));
        token.confidentialTransferFrom(msg.sender, address(this), amount);
        emit Funded(msg.sender);
    }

    function setRate(uint64 ratePerSecond_, uint64 maxPerHarvest_) external onlyOwner {
        ratePerSecond = ratePerSecond_;
        maxPerHarvest = maxPerHarvest_;
        emit RateSet(ratePerSecond_, maxPerHarvest_);
    }

    /// @inheritdoc IConfidentialYieldSource
    ///
    /// @dev Not capped by the balance held — that balance is a ciphertext and
    /// cannot be compared in plaintext. It does not need to be: the transfer
    /// saturates, so an over-request simply moves whatever is left and
    /// `harvest` reports the real figure.
    function accrued() external view returns (uint64) {
        uint256 elapsed = block.timestamp - lastHarvestAt;
        uint256 amount = elapsed * ratePerSecond;
        return amount > maxPerHarvest ? maxPerHarvest : uint64(amount);
    }

    /// @inheritdoc IConfidentialYieldSource
    function harvest(address to, uint64 amount) external returns (euint64 moved) {
        if (msg.sender != pool) revert OnlyPool();

        // Reset the clock even if the stream is dry, so a drained source does
        // not silently accumulate a claim it cannot honour.
        lastHarvestAt = uint48(block.timestamp);

        euint64 request = FHE.asEuint64(amount);
        FHE.allowThis(request);
        FHE.allowTransient(request, address(token));

        moved = token.confidentialTransfer(to, request);
        FHE.allowThis(moved);
        FHE.allow(moved, to);
    }
}
