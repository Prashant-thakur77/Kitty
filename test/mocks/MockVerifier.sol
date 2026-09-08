// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {INativeQueryVerifier} from "@gluwa/asc-contracts/contracts/write-ability/common/INativeQueryVerifier.sol";

/// @dev Stand-in for the block-prover precompile (0x0FD2). Etched at that address in tests.
///      txIndex is derived from the merkle root so distinct fixtures get distinct query ids.
contract MockVerifier {
    bool public accept = true;
    uint256 public batchCalls;
    uint256 public singleCalls;
    uint256 public lastBatchSize;

    function setAccept(bool a) external {
        accept = a;
    }

    function calculateTxIndex(INativeQueryVerifier.MerkleProof calldata p) external pure returns (uint64) {
        return uint64(uint256(p.root) & 0xffff);
    }

    /// @dev The precompile's free view overloads, used as a preflight before paying to submit.
    function verify(
        uint64,
        uint64,
        bytes calldata,
        INativeQueryVerifier.MerkleProof calldata,
        INativeQueryVerifier.ContinuityProof calldata
    ) external view returns (bool) {
        return accept;
    }

    function verify(
        uint64,
        uint64[] calldata,
        bytes[] calldata,
        INativeQueryVerifier.MerkleProof[] calldata,
        INativeQueryVerifier.ContinuityProof calldata
    ) external view returns (bool) {
        return accept;
    }

    function verifyAndEmit(
        uint64,
        uint64,
        bytes calldata,
        INativeQueryVerifier.MerkleProof calldata,
        INativeQueryVerifier.ContinuityProof calldata
    ) external returns (bool) {
        singleCalls++;
        return accept;
    }

    function verifyAndEmit(
        uint64,
        uint64[] calldata heights,
        bytes[] calldata,
        INativeQueryVerifier.MerkleProof[] calldata,
        INativeQueryVerifier.ContinuityProof calldata
    ) external returns (bool) {
        batchCalls++;
        lastBatchSize = heights.length;
        return accept;
    }
}
