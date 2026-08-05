// SPDX-License-Identifier: GPL-3.0
/**
Copyright 2019 PoolTogether LLC

This file is part of PoolTogether.

PoolTogether is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation under version 3 of the License.

PoolTogether is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with PoolTogether.  If not, see <https://www.gnu.org/licenses/>.
*/

// VENDORED VERBATIM from GenerationSoftware/uniform-random-number
// (src/UniformRandomNumber.sol, main branch, retrieved 2026-08-05).
//
// Code is unmodified. The only additions are this note and the machine-readable
// licence tag on line 1, restating the GPL-3.0 grant the original header already
// makes (solc emits a warning without the tag).
// This is the same rejection-sampling routine PoolTogether v5 uses inside
// TierCalculationLib.isWinner to remove modulo bias from the per-user PRN.
// We rely on it for exactly the same purpose, on plaintext values only.

pragma solidity ^0.8.19;

error UpperBoundGtZero();

/**
 * @author Brendan Asselstine
 * @notice A library that uses entropy to select a random number within a bound.  Compensates for modulo bias.
 * @dev Thanks to https://medium.com/hownetworks/dont-waste-cycles-with-modulo-bias-35b6fdafcf94
 */
library UniformRandomNumber {
  /// @notice Select a random number without modulo bias using a random seed and upper bound
  /// @param _entropy The seed for randomness
  /// @param _upperBound The upper bound of the desired number
  /// @return A random number less than the _upperBound
  function uniform(uint256 _entropy, uint256 _upperBound) internal pure returns (uint256) {
    if(_upperBound == 0) {
        revert UpperBoundGtZero();
    }
    uint256 min = (type(uint256).max-_upperBound+1) % _upperBound;
    uint256 random = _entropy;
    while (true) {
      if (random >= min) {
        break;
      }
      random = uint256(keccak256(abi.encodePacked(random)));
    }
    return random % _upperBound;
  }
}
