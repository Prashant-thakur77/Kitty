// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {KittyLedger} from "../src/asc/KittyLedger.sol";
import {INativeQueryVerifier} from "@gluwa/asc-contracts/contracts/write-ability/common/INativeQueryVerifier.sol";
import {MockVerifier} from "./mocks/MockVerifier.sol";
import {MockChainInfo} from "./mocks/MockChainInfo.sol";
import {TxFixtures} from "./TxFixtures.sol";

/// @notice ByScore rotation: the best proven record receives first; missing a round pushes you back.
contract KittyRotationTest is Test {
    address constant VERIFIER_PRECOMPILE = 0x0000000000000000000000000000000000000FD2;
    address constant CHAIN_INFO_PRECOMPILE = 0x0000000000000000000000000000000000000fD3;
    uint64 constant CHAIN_KEY = 1;
    uint256 constant AMOUNT = 100e6;
    uint64 constant START = 1_000;
    uint64 constant ROUND_BLOCKS = 50;

    KittyLedger ledger;
    MockChainInfo chainInfo;
    address vault = address(0xFA11);
    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    address carol = address(0xCA201);
    address organiser = address(0x0111);
    uint256 circleId;

    function setUp() public {
        vm.etch(VERIFIER_PRECOMPILE, address(new MockVerifier()).code);
        vm.etch(CHAIN_INFO_PRECOMPILE, address(new MockChainInfo()).code);
        chainInfo = MockChainInfo(CHAIN_INFO_PRECOMPILE);
        MockVerifier(VERIFIER_PRECOMPILE).setAccept(true); // etch copies code, not storage
        ledger = new KittyLedger(CHAIN_KEY);
        ledger.setTrustedVault(vault, true);
        address[] memory members = new address[](3);
        members[0] = alice;
        members[1] = bob;
        members[2] = carol;
        vm.prank(organiser);
        circleId = ledger.createCircle("Score circle", members, AMOUNT, ROUND_BLOCKS, START, vault);
        vm.prank(organiser);
        ledger.setRotation(circleId, KittyLedger.Rotation.ByScore);
        vm.prank(alice);
        ledger.acceptMembership(circleId);
        vm.prank(bob);
        ledger.acceptMembership(circleId);
        vm.prank(carol);
        ledger.acceptMembership(circleId);
    }

    function _pay(address[] memory who, uint64[] memory heights, uint32 round) internal {
        bytes[] memory txs = new bytes[](who.length);
        INativeQueryVerifier.MerkleProof[] memory proofs = new INativeQueryVerifier.MerkleProof[](who.length);
        for (uint256 i; i < who.length; ++i) {
            txs[i] = TxFixtures.contribution(vault, who[i], circleId, round, AMOUNT);
            proofs[i] = TxFixtures.merkle(uint256(keccak256(abi.encode(who[i], heights[i], round, "rot"))));
        }
        ledger.recordContributions(CHAIN_KEY, heights, txs, proofs, TxFixtures.continuity());
    }

    function _pair(address a, address b, uint64 ha, uint64 hb) internal pure returns (address[] memory w, uint64[] memory h) {
        w = new address[](2);
        w[0] = a;
        w[1] = b;
        h = new uint64[](2);
        h[0] = ha;
        h[1] = hb;
    }

    function test_setRotation_onlyOrganiserAndOnlyBeforeFirstProof() public {
        vm.expectRevert(abi.encodeWithSelector(KittyLedger.NotOrganiser.selector, circleId));
        ledger.setRotation(circleId, KittyLedger.Rotation.Fixed);

        (address[] memory w, uint64[] memory h) = _pair(alice, bob, 1_010, 1_011);
        _pay(w, h, 0);
        vm.prank(organiser);
        vm.expectRevert(abi.encodeWithSelector(KittyLedger.RotationLocked.selector, circleId));
        ledger.setRotation(circleId, KittyLedger.Rotation.Fixed);
        assertEq(uint8(ledger.getCircle(circleId).rotation), uint8(KittyLedger.Rotation.ByScore));
    }

    function test_byScore_missingMemberGoesLast_andEveryoneReceivesOnce() public {
        // Round 0: alice and bob pay on time, carol misses → carol's score drops below the others.
        (address[] memory w, uint64[] memory h) = _pair(alice, bob, 1_010, 1_011);
        _pay(w, h, 0);
        chainInfo.setAttestedHeight(CHAIN_KEY, START + ROUND_BLOCKS + 64);
        ledger.closeRound(circleId);
        // alice and bob tie at 515 → earlier member (alice) receives round 0
        assertEq(ledger.getRound(circleId, 0).recipient, alice);
        assertTrue(ledger.receivedPot(circleId, alice));

        // Round 1: bob pays late, carol pays on time. Scores: bob 515-20=495, carol 500-120+15=395 → bob receives.
        (w, h) = _pair(bob, carol, START + 2 * ROUND_BLOCKS + 1, START + ROUND_BLOCKS + 5);
        _pay(w, h, 1);
        chainInfo.setAttestedHeight(CHAIN_KEY, START + 2 * ROUND_BLOCKS + 64);
        ledger.closeRound(circleId);
        assertEq(ledger.getRound(circleId, 1).recipient, bob);

        // Round 2: only carol is left, whatever the scores → carol.
        address[] memory one = new address[](1);
        one[0] = carol;
        uint64[] memory oh = new uint64[](1);
        oh[0] = START + 2 * ROUND_BLOCKS + 5;
        _pay(one, oh, 2);
        chainInfo.setAttestedHeight(CHAIN_KEY, START + 3 * ROUND_BLOCKS + 64);
        ledger.closeRound(circleId);
        assertEq(ledger.getRound(circleId, 2).recipient, carol);
        assertEq(uint8(ledger.getCircle(circleId).status), uint8(KittyLedger.CircleStatus.Completed));
        assertEq(ledger.getRecord(alice).received + ledger.getRecord(bob).received + ledger.getRecord(carol).received, 3);
    }

    function test_byScore_higherHistoryBeatsIndexOrder() public {
        // carol arrives with a better record from another circle: give her one on-time proof there first.
        address[] memory members = new address[](2);
        members[0] = carol;
        members[1] = address(0xD00D);
        vm.prank(organiser);
        uint256 other = ledger.createCircle("Earlier circle", members, AMOUNT, ROUND_BLOCKS, START, vault);
        bytes[] memory txs = new bytes[](1);
        txs[0] = TxFixtures.contribution(vault, carol, other, 0, AMOUNT);
        INativeQueryVerifier.MerkleProof[] memory proofs = new INativeQueryVerifier.MerkleProof[](1);
        proofs[0] = TxFixtures.merkle(777);
        uint64[] memory hh = new uint64[](1);
        hh[0] = 1_005;
        ledger.recordContributions(CHAIN_KEY, hh, txs, proofs, TxFixtures.continuity());

        // Now in the score circle everyone pays on time → carol 530 vs 515/515 → carol receives round 0 despite index 2.
        address[] memory w = new address[](3);
        w[0] = alice;
        w[1] = bob;
        w[2] = carol;
        uint64[] memory h = new uint64[](3);
        h[0] = 1_010;
        h[1] = 1_011;
        h[2] = 1_012;
        _pay(w, h, 0);
        ledger.closeRound(circleId);
        assertEq(ledger.getRound(circleId, 0).recipient, carol);
    }

    function test_fixedRotationUnchanged() public {
        address[] memory members = new address[](2);
        members[0] = alice;
        members[1] = bob;
        vm.prank(organiser);
        uint256 fixedId = ledger.createCircle("Fixed", members, AMOUNT, ROUND_BLOCKS, START, vault);
        bytes[] memory txs = new bytes[](2);
        txs[0] = TxFixtures.contribution(vault, alice, fixedId, 0, AMOUNT);
        txs[1] = TxFixtures.contribution(vault, bob, fixedId, 0, AMOUNT);
        INativeQueryVerifier.MerkleProof[] memory proofs = new INativeQueryVerifier.MerkleProof[](2);
        proofs[0] = TxFixtures.merkle(901);
        proofs[1] = TxFixtures.merkle(902);
        uint64[] memory h = new uint64[](2);
        h[0] = 1_010;
        h[1] = 1_011;
        ledger.recordContributions(CHAIN_KEY, h, txs, proofs, TxFixtures.continuity());
        ledger.closeRound(fixedId);
        assertEq(ledger.getRound(fixedId, 0).recipient, alice);
        assertTrue(ledger.receivedPot(fixedId, alice));
    }
}
