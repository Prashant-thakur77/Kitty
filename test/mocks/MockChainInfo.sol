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

    struct HeightHash {
        uint64 height;
        bytes32 hash;
        bool isAttestation;
        bool exists;
    }

    function get_latest_attestation_height_and_hash(uint64 chainKey) external view returns (HeightHash memory) {
        uint64 h = attestedHeight[chainKey];
        return HeightHash({height: h, hash: keccak256(abi.encode(chainKey, h)), isAttestation: true, exists: h > 0});
    }
}
