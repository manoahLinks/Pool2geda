// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.27;

import { Ownable2Step, Ownable } from "@openzeppelin/contracts/access/Ownable2Step.sol";
import { FHE, euint64, externalEuint64 } from "@fhevm/solidity/lib/FHE.sol";
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

    event Funded(address indexed from);
    event PerRoundSet(uint64 amount);

    error OnlyPool();

    constructor(IERC7984 token_, address pool_, uint64 perRound_, address initialOwner)
        Ownable(initialOwner)
    {
        token = token_;
        pool = pool_;
        perRound = perRound_;
    }

    /// @notice Top the reserve up. Open to anyone.
    function fund(externalEuint64 encAmount, bytes calldata inputProof) external {
        euint64 amount = FHE.fromExternal(encAmount, inputProof);
        FHE.allowTransient(amount, address(token));
        token.confidentialTransferFrom(msg.sender, address(this), amount);
        emit Funded(msg.sender);
    }

    function setPerRound(uint64 amount) external onlyOwner {
        perRound = amount;
        emit PerRoundSet(amount);
    }

    /// @inheritdoc IConfidentialYieldSource
    function accrued() external view returns (uint64) {
        return perRound;
    }

    /// @inheritdoc IConfidentialYieldSource
    ///
    /// @dev Returns the amount that MOVED. If this contract holds less than
    /// `amount`, ERC-7984 moves what it has and the call still succeeds — so
    /// the pool's reserve grows by the real figure and never by the request.
    function harvest(address to, uint64 amount) external returns (euint64 moved) {
        if (msg.sender != pool) revert OnlyPool();

        euint64 request = FHE.asEuint64(amount);
        FHE.allowThis(request);
        FHE.allowTransient(request, address(token));

        moved = token.confidentialTransfer(to, request);
        FHE.allowThis(moved);
        // The pool has to be able to add this to its reserve.
        FHE.allow(moved, to);
    }
}
