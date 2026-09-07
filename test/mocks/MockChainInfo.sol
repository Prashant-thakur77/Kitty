// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @dev Stand-in for the ChainInfo precompile (0x0FD3). Etched at that address in tests.
contract MockChainInfo {
    mapping(uint64 => uint64) public attestedHeight;

    function setAttestedHeight(uint64 chainKey, uint64 h) external {
        attestedHeight[chainKey] = h;
    }

    function is_height_attested(uint64 chainKey, uint64 targetHeight) external view returns (bool) {
        return attestedHeight[chainKey] >= targetHeight;
    }
}
