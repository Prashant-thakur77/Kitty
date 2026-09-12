// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {EvmV1Decoder} from "@gluwa/asc-contracts/contracts/common/EvmV1Decoder.sol";
import {INativeQueryVerifier} from "@gluwa/asc-contracts/contracts/write-ability/common/INativeQueryVerifier.sol";

/// @dev Builds prover-style `txBytes` (EvmV1 encoding, type-2 tx) the way the real proof builder does:
///      abi.encode(uint8 txType, bytes[] chunks) with chunks = [common, type-specific, receipt].
library TxFixtures {
    bytes32 internal constant CONTRIBUTED_SIG = keccak256("Contributed(uint256,uint32,address,uint256)");
    bytes32 internal constant PAIDOUT_SIG = keccak256("PaidOut(uint256,uint32,address,uint256)");

    struct VaultEvent {
        bytes32 sig;
        address emitter;
        uint256 circleId;
        uint32 round;
        address who;
        uint256 amount;
    }

    function encode(address from, address to, uint8 status, VaultEvent[] memory evs) internal pure returns (bytes memory) {
        EvmV1Decoder.LogEntryTuple[] memory logs = new EvmV1Decoder.LogEntryTuple[](evs.length);
        for (uint256 i; i < evs.length; ++i) {
            bytes32[] memory topics = new bytes32[](4);
            topics[0] = evs[i].sig;
            topics[1] = bytes32(evs[i].circleId);
            topics[2] = bytes32(uint256(evs[i].round));
            topics[3] = bytes32(uint256(uint160(evs[i].who)));
            logs[i] = EvmV1Decoder.LogEntryTuple({address_: evs[i].emitter, topics: topics, data: abi.encode(evs[i].amount)});
        }
        bytes[] memory chunks = new bytes[](3);
        chunks[0] = abi.encode(uint64(7), uint64(120_000), from, false, to, uint256(0), bytes(hex"deadbeef"));
        EvmV1Decoder.AccessListEntryBytes32[] memory al = new EvmV1Decoder.AccessListEntryBytes32[](0);
        chunks[1] = abi.encode(uint64(11155111), uint128(1 gwei), uint128(30 gwei), al, uint8(1), bytes32(0), bytes32(0));
        chunks[2] = abi.encode(status, uint64(60_000), logs, bytes(""));
        return abi.encode(uint8(2), chunks);
    }

    function contribution(address vault, address member, uint256 circleId, uint32 round, uint256 amount)
        internal
        pure
        returns (bytes memory)
    {
        VaultEvent[] memory evs = new VaultEvent[](1);
        evs[0] = VaultEvent(CONTRIBUTED_SIG, vault, circleId, round, member, amount);
        return encode(member, vault, 1, evs);
    }

    /// A contribution whose log names `member` but whose transaction was sent by `sender` (a relayer or a
    /// smart-account paying on the member's behalf): the ledger must refuse it with SenderMismatch.
    function contributionSentBy(address sender, address vault, address member, uint256 circleId, uint32 round, uint256 amount)
        internal
        pure
        returns (bytes memory)
    {
        VaultEvent[] memory evs = new VaultEvent[](1);
        evs[0] = VaultEvent(CONTRIBUTED_SIG, vault, circleId, round, member, amount);
        return encode(sender, vault, 1, evs);
    }

    /// A contribution whose transaction targets `target` instead of the vault (a proxy or router in front of it).
    function contributionTo(address target, address vault, address member, uint256 circleId, uint32 round, uint256 amount)
        internal
        pure
        returns (bytes memory)
    {
        VaultEvent[] memory evs = new VaultEvent[](1);
        evs[0] = VaultEvent(CONTRIBUTED_SIG, vault, circleId, round, member, amount);
        return encode(member, target, 1, evs);
    }

    function payout(address vault, address operator, address recipient, uint256 circleId, uint32 round, uint256 amount)
        internal
        pure
        returns (bytes memory)
    {
        VaultEvent[] memory evs = new VaultEvent[](1);
        evs[0] = VaultEvent(PAIDOUT_SIG, vault, circleId, round, recipient, amount);
        return encode(operator, vault, 1, evs);
    }

    function merkle(uint256 seed) internal pure returns (INativeQueryVerifier.MerkleProof memory p) {
        p.root = keccak256(abi.encode("root", seed));
        p.siblings = new INativeQueryVerifier.MerkleProofEntry[](1);
        p.siblings[0] = INativeQueryVerifier.MerkleProofEntry({hash: keccak256(abi.encode("sib", seed)), isLeft: seed % 2 == 0});
    }

    function continuity() internal pure returns (INativeQueryVerifier.ContinuityProof memory c) {
        c.lowerEndpointDigest = keccak256("lower");
        c.roots = new bytes32[](1);
        c.roots[0] = keccak256("r0");
    }
}
