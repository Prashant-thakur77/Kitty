// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {KittyLedger} from "../src/asc/KittyLedger.sol";
import {KittyViewer} from "../src/asc/KittyViewer.sol";
import {INativeQueryVerifier} from "@gluwa/asc-contracts/contracts/write-ability/common/INativeQueryVerifier.sol";
import {MockVerifier} from "./mocks/MockVerifier.sol";
import {MockChainInfo} from "./mocks/MockChainInfo.sol";
import {TxFixtures} from "./TxFixtures.sol";

contract KittyViewerTest is Test {
    address constant VERIFIER_PRECOMPILE = 0x0000000000000000000000000000000000000FD2;
    address constant CHAIN_INFO_PRECOMPILE = 0x0000000000000000000000000000000000000fD3;
    uint64 constant CHAIN_KEY = 1;

    KittyLedger ledger;
    KittyViewer viewer;
    MockVerifier verifier;
    MockChainInfo chainInfo;

    address vault = address(0xFA11);
    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    address carol = address(0xCA201);
    address nobody = address(0x0);

    uint256 constant AMOUNT = 100e6;
    uint64 constant START = 1_000;
    uint64 constant ROUND_BLOCKS = 50;
    uint256 circleId;
    uint256 circleId2;

    function setUp() public {
        vm.etch(VERIFIER_PRECOMPILE, address(new MockVerifier()).code);
        vm.etch(CHAIN_INFO_PRECOMPILE, address(new MockChainInfo()).code);
        verifier = MockVerifier(VERIFIER_PRECOMPILE);
        chainInfo = MockChainInfo(CHAIN_INFO_PRECOMPILE);
        verifier.setAccept(true);

        ledger = new KittyLedger(CHAIN_KEY);
        viewer = new KittyViewer(ledger);
        address[] memory members = new address[](3);
        members[0] = alice;
        members[1] = bob;
        members[2] = carol;
        circleId = ledger.createCircle("Lagos Susu", members, AMOUNT, ROUND_BLOCKS, START, vault);

        address[] memory two = new address[](2);
        two[0] = bob;
        two[1] = alice;
        circleId2 = ledger.createCircle("Side Pot", two, AMOUNT, ROUND_BLOCKS, START, vault);
    }

    function _record(uint256 id, address[] memory who, uint64[] memory heights, uint32 round) internal {
        bytes[] memory txs = new bytes[](who.length);
        INativeQueryVerifier.MerkleProof[] memory proofs = new INativeQueryVerifier.MerkleProof[](who.length);
        for (uint256 i; i < who.length; ++i) {
            txs[i] = TxFixtures.contribution(vault, who[i], id, round, AMOUNT);
            proofs[i] = TxFixtures.merkle(uint256(keccak256(abi.encode(id, who[i], heights[i], round))));
        }
        ledger.recordContributions(CHAIN_KEY, heights, txs, proofs, TxFixtures.continuity());
    }

    function test_getCircleFull_freshCircle() public view {
        KittyViewer.CircleFull memory f = viewer.getCircleFull(circleId);
        assertEq(f.circle.name, "Lagos Susu");
        assertEq(f.circle.members.length, 3);
        assertEq(f.rounds.length, 1);
        assertEq(uint8(f.rounds[0].status), uint8(KittyLedger.RoundStatus.Open));
        assertEq(f.current.length, 3);
        assertEq(f.current[0].queryId, bytes32(0));
        assertEq(f.scores.length, 3);
        assertEq(f.scores[0], 500);
        assertEq(f.tiers[0], "C");
        assertEq(f.records.length, 3);
        assertEq(f.records[0].onTime, 0);
        assertEq(f.deadline, START + ROUND_BLOCKS);
        assertEq(f.deadline, ledger.deadlineHeight(circleId, 0));
    }

    function test_getCircleFull_matchesLedgerAfterBatchAndClose() public {
        address[] memory who = new address[](2);
        who[0] = alice;
        who[1] = carol;
        uint64[] memory hs = new uint64[](2);
        hs[0] = 1_010;
        hs[1] = START + ROUND_BLOCKS + 5; // carol late
        _record(circleId, who, hs, 0);

        // Before close: current = round 0
        KittyViewer.CircleFull memory f = viewer.getCircleFull(circleId);
        assertEq(f.rounds.length, 1);
        assertEq(f.rounds[0].contributions, 2);
        assertEq(f.rounds[0].pot, 2 * AMOUNT);
        assertEq(f.current[0].height, 1_010);
        assertTrue(f.current[0].onTime);
        assertEq(f.current[1].queryId, bytes32(0), "bob pending");
        assertFalse(f.current[2].onTime, "carol late");
        assertEq(f.scores[0], 515);
        assertEq(f.scores[2], 480);
        assertEq(f.tiers[2], "D");

        chainInfo.setAttestedHeight(CHAIN_KEY, START + ROUND_BLOCKS);
        ledger.closeRound(circleId);

        f = viewer.getCircleFull(circleId);
        assertEq(f.circle.currentRound, 1);
        assertEq(f.rounds.length, 2, "rounds 0..currentRound");
        KittyLedger.Round memory r0 = ledger.getRound(circleId, 0);
        assertEq(uint8(f.rounds[0].status), uint8(r0.status));
        assertEq(f.rounds[0].recipient, alice);
        assertEq(f.rounds[0].pot, r0.pot);
        assertEq(uint8(f.rounds[1].status), uint8(KittyLedger.RoundStatus.Open));
        // current now refers to round 1 → nobody has paid
        for (uint256 i; i < 3; ++i) {
            assertEq(f.current[i].queryId, bytes32(0));
        }
        assertEq(f.records[1].missed, 1, "bob missed round 0");
        assertEq(f.records[0].received, 1, "alice received round 0");
        KittyLedger.MemberRecord memory rb = ledger.getRecord(bob);
        assertEq(f.records[1].missed, rb.missed);
        (uint16 sb, string memory tb) = ledger.creditScore(bob);
        assertEq(f.scores[1], sb);
        assertEq(f.tiers[1], tb);
        assertEq(f.deadline, ledger.deadlineHeight(circleId, 1));
    }

    function test_getCircleFull_completedCircleReturnsAllRounds() public {
        address[] memory all = new address[](3);
        all[0] = alice;
        all[1] = bob;
        all[2] = carol;
        for (uint32 r; r < 3; ++r) {
            uint64[] memory hs = new uint64[](3);
            hs[0] = START + r * ROUND_BLOCKS + 5;
            hs[1] = START + r * ROUND_BLOCKS + 6;
            hs[2] = START + r * ROUND_BLOCKS + 7;
            _record(circleId, all, hs, r);
            ledger.closeRound(circleId);
        }
        KittyViewer.CircleFull memory f = viewer.getCircleFull(circleId);
        assertEq(uint8(f.circle.status), uint8(KittyLedger.CircleStatus.Completed));
        assertEq(f.rounds.length, 3);
        assertEq(f.rounds[2].recipient, carol);
        assertEq(uint8(f.rounds[2].status), uint8(KittyLedger.RoundStatus.Closed));
        assertTrue(f.current[1].onTime, "current = last round, bob paid");
    }

    function test_getCircleFull_unknownCircleReverts() public {
        vm.expectRevert(abi.encodeWithSelector(KittyLedger.UnknownCircle.selector, 42));
        viewer.getCircleFull(42);
    }

    function test_getMemberDashboard_statusesAcrossCircles() public {
        // circle 1: alice on time; circle 2: nobody pays, deadline passes → alice missed
        address[] memory who = new address[](1);
        who[0] = alice;
        uint64[] memory hs = new uint64[](1);
        hs[0] = 1_010;
        _record(circleId, who, hs, 0);

        KittyViewer.MemberDashboard memory d = viewer.getMemberDashboard(alice);
        assertEq(d.circleIds.length, 2);
        assertEq(d.circleIds[0], circleId);
        assertEq(d.circleIds[1], circleId2);
        assertEq(d.names[0], "Lagos Susu");
        assertEq(d.names[1], "Side Pot");
        assertEq(d.currentRounds[0], 0);
        assertEq(d.myStatus[0], viewer.STATUS_PROVEN());
        assertEq(d.myStatus[1], viewer.STATUS_PENDING());
        assertEq(d.score, 515);
        assertEq(d.tier, "C");
        assertEq(d.record.onTime, 1);

        // bob: pending in both
        KittyViewer.MemberDashboard memory db = viewer.getMemberDashboard(bob);
        assertEq(db.circleIds.length, 2);
        assertEq(db.myStatus[0], viewer.STATUS_PENDING());
        assertEq(db.myStatus[1], viewer.STATUS_PENDING());

        // Complete circle 2 with nobody paying: last round is closed → both Missed, score matches ledger.
        chainInfo.setAttestedHeight(CHAIN_KEY, START + 2 * ROUND_BLOCKS);
        ledger.closeRound(circleId2);
        ledger.closeRound(circleId2);
        d = viewer.getMemberDashboard(alice);
        assertEq(d.currentRounds[1], 1);
        assertEq(d.myStatus[1], viewer.STATUS_MISSED());
        assertEq(d.myStatus[0], viewer.STATUS_PROVEN(), "circle 1 untouched");
        (uint16 s, string memory t) = ledger.creditScore(alice);
        assertEq(d.score, s);
        assertEq(d.tier, t);
        assertEq(d.record.missed, 2);

        // Late shows as Late
        address[] memory c1 = new address[](1);
        c1[0] = carol;
        uint64[] memory late = new uint64[](1);
        late[0] = START + ROUND_BLOCKS + 9;
        _record(circleId, c1, late, 0);
        KittyViewer.MemberDashboard memory dc = viewer.getMemberDashboard(carol);
        assertEq(dc.circleIds.length, 1);
        assertEq(dc.myStatus[0], viewer.STATUS_LATE());
    }

    function test_getMemberDashboard_strangerIsEmpty() public view {
        KittyViewer.MemberDashboard memory d = viewer.getMemberDashboard(address(0xDEAD));
        assertEq(d.circleIds.length, 0);
        assertEq(d.names.length, 0);
        assertEq(d.score, 500);
        assertEq(d.tier, "C");
        assertEq(d.record.volume, 0);
    }
}
