// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {KittyLedger} from "../src/asc/KittyLedger.sol";
import {INativeQueryVerifier} from "@gluwa/asc-contracts/contracts/write-ability/common/INativeQueryVerifier.sol";
import {MockVerifier} from "./mocks/MockVerifier.sol";
import {MockChainInfo} from "./mocks/MockChainInfo.sol";
import {TxFixtures} from "./TxFixtures.sol";

contract KittyLedgerTest is Test {
    address constant VERIFIER_PRECOMPILE = 0x0000000000000000000000000000000000000FD2;
    address constant CHAIN_INFO_PRECOMPILE = 0x0000000000000000000000000000000000000fD3;
    uint64 constant CHAIN_KEY = 1;

    KittyLedger ledger;
    MockVerifier verifier;
    MockChainInfo chainInfo;

    address vault = address(0xFA11);
    address operator = address(0x0BE7);
    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    address carol = address(0xCA201);
    address mallory = address(0xBAD);

    uint256 constant AMOUNT = 100e6;
    uint64 constant START = 1_000;
    uint64 constant ROUND_BLOCKS = 50;
    uint256 circleId;

    function setUp() public {
        vm.etch(VERIFIER_PRECOMPILE, address(new MockVerifier()).code);
        vm.etch(CHAIN_INFO_PRECOMPILE, address(new MockChainInfo()).code);
        verifier = MockVerifier(VERIFIER_PRECOMPILE);
        chainInfo = MockChainInfo(CHAIN_INFO_PRECOMPILE);
        verifier.setAccept(true);

        ledger = new KittyLedger(CHAIN_KEY);
        address[] memory members = new address[](3);
        members[0] = alice;
        members[1] = bob;
        members[2] = carol;
        circleId = ledger.createCircle("Lagos Susu", members, AMOUNT, ROUND_BLOCKS, START, vault);
    }

    // ───────────── helpers ─────────────

    function _batch(address[] memory who, uint64[] memory heights, uint32 round)
        internal
        view
        returns (bytes[] memory txs, INativeQueryVerifier.MerkleProof[] memory proofs)
    {
        txs = new bytes[](who.length);
        proofs = new INativeQueryVerifier.MerkleProof[](who.length);
        for (uint256 i; i < who.length; ++i) {
            txs[i] = TxFixtures.contribution(vault, who[i], circleId, round, AMOUNT);
            proofs[i] = TxFixtures.merkle(uint256(keccak256(abi.encode(who[i], heights[i], round))));
        }
    }

    function _record(address[] memory who, uint64[] memory heights, uint32 round) internal {
        (bytes[] memory txs, INativeQueryVerifier.MerkleProof[] memory proofs) = _batch(who, heights, round);
        ledger.recordContributions(CHAIN_KEY, heights, txs, proofs, TxFixtures.continuity());
    }

    function _one(address a) internal pure returns (address[] memory r) {
        r = new address[](1);
        r[0] = a;
    }

    function _h(uint64 a) internal pure returns (uint64[] memory r) {
        r = new uint64[](1);
        r[0] = a;
    }

    function _all() internal view returns (address[] memory r) {
        r = new address[](3);
        r[0] = alice;
        r[1] = bob;
        r[2] = carol;
    }

    // ───────────── circle creation ─────────────

    function test_createCircle_storesMembersAndDeadline() public view {
        KittyLedger.Circle memory c = ledger.getCircle(circleId);
        assertEq(c.members.length, 3);
        assertEq(c.contribution, AMOUNT);
        assertEq(c.sourceVault, vault);
        assertEq(ledger.deadlineHeight(circleId, 0), START + ROUND_BLOCKS);
        assertEq(ledger.deadlineHeight(circleId, 2), START + 3 * ROUND_BLOCKS);
        assertTrue(ledger.isMember(circleId, alice));
        assertFalse(ledger.isMember(circleId, mallory));
    }

    function test_createCircle_rejectsBadInputs() public {
        address[] memory one = _one(alice);
        vm.expectRevert(abi.encodeWithSelector(KittyLedger.InvalidCircle.selector, "2..10 members"));
        ledger.createCircle("x", one, AMOUNT, 1, 0, vault);

        address[] memory dup = new address[](2);
        dup[0] = alice;
        dup[1] = alice;
        vm.expectRevert(abi.encodeWithSelector(KittyLedger.InvalidCircle.selector, "duplicate/zero member"));
        ledger.createCircle("x", dup, AMOUNT, 1, 0, vault);
    }

    // ───────────── batch verification ─────────────

    function test_batch_recordsWholeRoundInOnePrecompileCall() public {
        uint64[] memory hs = new uint64[](3);
        hs[0] = 1_010;
        hs[1] = 1_020;
        hs[2] = 1_030;
        _record(_all(), hs, 0);

        assertEq(verifier.batchCalls(), 1, "one precompile call for the whole round");
        assertEq(verifier.lastBatchSize(), 3);
        KittyLedger.Round memory rd = ledger.getRound(circleId, 0);
        assertEq(rd.contributions, 3);
        assertEq(rd.pot, 3 * AMOUNT);
        KittyLedger.Contribution memory cb = ledger.getContribution(circleId, 0, bob);
        assertEq(cb.height, 1_020);
        assertTrue(cb.onTime);
        assertTrue(cb.queryId != bytes32(0));
        assertTrue(ledger.processedQueries(cb.queryId));
        KittyLedger.MemberRecord memory r = ledger.getRecord(bob);
        assertEq(r.onTime, 1);
        assertEq(r.volume, AMOUNT);
    }

    function test_batch_rejectsWhenPrecompileRejects() public {
        verifier.setAccept(false);
        vm.expectRevert(KittyLedger.ProofRejected.selector);
        _record(_one(alice), _h(1_010), 0);
    }

    function test_batch_rejectsWrongChainKey() public {
        (bytes[] memory txs, INativeQueryVerifier.MerkleProof[] memory proofs) = _batch(_one(alice), _h(1_010), 0);
        vm.expectRevert(abi.encodeWithSelector(KittyLedger.WrongChain.selector, uint64(3), CHAIN_KEY));
        ledger.recordContributions(3, _h(1_010), txs, proofs, TxFixtures.continuity());
    }

    function test_batch_replayIsRejected() public {
        _record(_one(alice), _h(1_010), 0);
        (bytes[] memory txs, INativeQueryVerifier.MerkleProof[] memory proofs) = _batch(_one(alice), _h(1_010), 0);
        vm.expectRevert(); // QueryAlreadyProcessed(qid)
        ledger.recordContributions(CHAIN_KEY, _h(1_010), txs, proofs, TxFixtures.continuity());
    }

    function test_batch_duplicateInsideBatchIsRejected() public {
        address[] memory who = new address[](2);
        who[0] = alice;
        who[1] = alice;
        uint64[] memory hs = new uint64[](2);
        hs[0] = 1_010;
        hs[1] = 1_010;
        vm.expectRevert();
        _record(who, hs, 0);
    }

    function test_batch_sizeLimits() public {
        uint64[] memory none = new uint64[](0);
        bytes[] memory txs = new bytes[](0);
        INativeQueryVerifier.MerkleProof[] memory proofs = new INativeQueryVerifier.MerkleProof[](0);
        vm.expectRevert(KittyLedger.EmptyBatch.selector);
        ledger.recordContributions(CHAIN_KEY, none, txs, proofs, TxFixtures.continuity());

        uint64[] memory eleven = new uint64[](11);
        bytes[] memory txs11 = new bytes[](11);
        INativeQueryVerifier.MerkleProof[] memory proofs11 = new INativeQueryVerifier.MerkleProof[](11);
        vm.expectRevert(abi.encodeWithSelector(KittyLedger.BatchTooLarge.selector, 11));
        ledger.recordContributions(CHAIN_KEY, eleven, txs11, proofs11, TxFixtures.continuity());
    }

    // ───────────── decoding / binding checks ─────────────

    function test_rejectsSpoofedEmitter() public {
        bytes[] memory txs = new bytes[](1);
        txs[0] = TxFixtures.contribution(mallory, alice, circleId, 0, AMOUNT); // emitter is not the vault
        INativeQueryVerifier.MerkleProof[] memory proofs = new INativeQueryVerifier.MerkleProof[](1);
        proofs[0] = TxFixtures.merkle(1);
        vm.expectRevert(abi.encodeWithSelector(KittyLedger.WrongEmitter.selector, mallory, vault));
        ledger.recordContributions(CHAIN_KEY, _h(1_010), txs, proofs, TxFixtures.continuity());
    }

    function test_rejectsTxNotSentToVault() public {
        TxFixtures.VaultEvent[] memory evs = new TxFixtures.VaultEvent[](1);
        evs[0] = TxFixtures.VaultEvent(TxFixtures.CONTRIBUTED_SIG, vault, circleId, 0, alice, AMOUNT);
        bytes[] memory txs = new bytes[](1);
        txs[0] = TxFixtures.encode(alice, mallory, 1, evs); // tx.to != vault even though log claims vault
        INativeQueryVerifier.MerkleProof[] memory proofs = new INativeQueryVerifier.MerkleProof[](1);
        proofs[0] = TxFixtures.merkle(2);
        vm.expectRevert(abi.encodeWithSelector(KittyLedger.TxNotToVault.selector, mallory, vault));
        ledger.recordContributions(CHAIN_KEY, _h(1_010), txs, proofs, TxFixtures.continuity());
    }

    function test_rejectsRevertedSourceTx() public {
        TxFixtures.VaultEvent[] memory evs = new TxFixtures.VaultEvent[](1);
        evs[0] = TxFixtures.VaultEvent(TxFixtures.CONTRIBUTED_SIG, vault, circleId, 0, alice, AMOUNT);
        bytes[] memory txs = new bytes[](1);
        txs[0] = TxFixtures.encode(alice, vault, 0, evs); // receipt status 0
        INativeQueryVerifier.MerkleProof[] memory proofs = new INativeQueryVerifier.MerkleProof[](1);
        proofs[0] = TxFixtures.merkle(3);
        vm.expectRevert(KittyLedger.SourceTxFailed.selector);
        ledger.recordContributions(CHAIN_KEY, _h(1_010), txs, proofs, TxFixtures.continuity());
    }

    function test_rejectsNonMember() public {
        bytes[] memory txs = new bytes[](1);
        txs[0] = TxFixtures.contribution(vault, mallory, circleId, 0, AMOUNT);
        INativeQueryVerifier.MerkleProof[] memory proofs = new INativeQueryVerifier.MerkleProof[](1);
        proofs[0] = TxFixtures.merkle(4);
        vm.expectRevert(abi.encodeWithSelector(KittyLedger.NotAMember.selector, circleId, mallory));
        ledger.recordContributions(CHAIN_KEY, _h(1_010), txs, proofs, TxFixtures.continuity());
    }

    function test_rejectsWrongAmountAndWrongRound() public {
        bytes[] memory txs = new bytes[](1);
        txs[0] = TxFixtures.contribution(vault, alice, circleId, 0, AMOUNT - 1);
        INativeQueryVerifier.MerkleProof[] memory proofs = new INativeQueryVerifier.MerkleProof[](1);
        proofs[0] = TxFixtures.merkle(5);
        vm.expectRevert(abi.encodeWithSelector(KittyLedger.WrongAmount.selector, AMOUNT - 1, AMOUNT));
        ledger.recordContributions(CHAIN_KEY, _h(1_010), txs, proofs, TxFixtures.continuity());

        txs[0] = TxFixtures.contribution(vault, alice, circleId, 1, AMOUNT);
        proofs[0] = TxFixtures.merkle(6);
        vm.expectRevert(abi.encodeWithSelector(KittyLedger.NotCurrentRound.selector, uint32(1), uint32(0)));
        ledger.recordContributions(CHAIN_KEY, _h(1_010), txs, proofs, TxFixtures.continuity());
    }

    function test_rejectsDoubleContributionByMember() public {
        _record(_one(alice), _h(1_010), 0);
        (bytes[] memory txs, INativeQueryVerifier.MerkleProof[] memory proofs) = _batch(_one(alice), _h(1_011), 0);
        vm.expectRevert(abi.encodeWithSelector(KittyLedger.AlreadyContributed.selector, circleId, uint32(0), alice));
        ledger.recordContributions(CHAIN_KEY, _h(1_011), txs, proofs, TxFixtures.continuity());
    }

    // ───────────── deadlines from attested source-chain time ─────────────

    function test_lateContributionIsFlagged() public {
        _record(_one(alice), _h(START + ROUND_BLOCKS + 1), 0);
        KittyLedger.Contribution memory c = ledger.getContribution(circleId, 0, alice);
        assertFalse(c.onTime);
        assertEq(ledger.getRecord(alice).late, 1);
        assertEq(ledger.getRecord(alice).onTime, 0);
    }

    function test_closeRound_earlyWhenEveryonePaid() public {
        uint64[] memory hs = new uint64[](3);
        hs[0] = 1_010;
        hs[1] = 1_020;
        hs[2] = 1_030;
        _record(_all(), hs, 0);
        chainInfo.setAttestedHeight(CHAIN_KEY, 1_030); // deadline (1050) NOT attested yet
        ledger.closeRound(circleId);
        KittyLedger.Round memory rd = ledger.getRound(circleId, 0);
        assertEq(uint8(rd.status), uint8(KittyLedger.RoundStatus.Closed));
        assertEq(rd.recipient, alice, "round 0 goes to member 0");
        assertEq(ledger.getCircle(circleId).currentRound, 1);
        assertEq(ledger.getRecord(alice).received, 1);
    }

    function test_closeRound_blockedUntilDeadlineAttested() public {
        _record(_one(alice), _h(1_010), 0);
        chainInfo.setAttestedHeight(CHAIN_KEY, START + ROUND_BLOCKS - 1);
        vm.expectRevert(abi.encodeWithSelector(KittyLedger.RoundStillOpenOnSource.selector, START + ROUND_BLOCKS));
        ledger.closeRound(circleId);
    }

    function test_closeRound_afterDeadlineRecordsMissed() public {
        _record(_one(alice), _h(1_010), 0);
        chainInfo.setAttestedHeight(CHAIN_KEY, START + ROUND_BLOCKS);
        ledger.closeRound(circleId);
        assertEq(ledger.getRecord(bob).missed, 1);
        assertEq(ledger.getRecord(carol).missed, 1);
        assertEq(ledger.getRecord(alice).missed, 0);
        KittyLedger.Round memory rd = ledger.getRound(circleId, 0);
        assertEq(rd.pot, AMOUNT, "pot is what was actually proven");
        assertEq(rd.recipient, alice);
    }

    function test_fullCircleRotatesAndCompletes() public {
        for (uint32 r; r < 3; ++r) {
            uint64[] memory hs = new uint64[](3);
            hs[0] = START + r * ROUND_BLOCKS + 5;
            hs[1] = START + r * ROUND_BLOCKS + 6;
            hs[2] = START + r * ROUND_BLOCKS + 7;
            _record(_all(), hs, r);
            ledger.closeRound(circleId);
            assertEq(ledger.getRound(circleId, r).recipient, _all()[r]);
        }
        assertEq(uint8(ledger.getCircle(circleId).status), uint8(KittyLedger.CircleStatus.Completed));
        vm.expectRevert(abi.encodeWithSelector(KittyLedger.CircleNotActive.selector, circleId));
        ledger.closeRound(circleId);
    }

    // ───────────── payout proof ─────────────

    function test_confirmPayout_closesTheLoop() public {
        uint64[] memory hs = new uint64[](3);
        hs[0] = 1_010;
        hs[1] = 1_020;
        hs[2] = 1_030;
        _record(_all(), hs, 0);
        ledger.closeRound(circleId);

        bytes memory tx_ = TxFixtures.payout(vault, operator, alice, circleId, 0, 3 * AMOUNT);
        ledger.confirmPayout(CHAIN_KEY, 1_040, tx_, TxFixtures.merkle(99), TxFixtures.continuity());
        KittyLedger.Round memory rd = ledger.getRound(circleId, 0);
        assertEq(uint8(rd.status), uint8(KittyLedger.RoundStatus.Paid));
        assertTrue(rd.payoutQueryId != bytes32(0));
        assertEq(verifier.singleCalls(), 1);
    }

    function test_confirmPayout_rejectsWrongRecipientOrAmount() public {
        uint64[] memory hs = new uint64[](3);
        hs[0] = 1_010;
        hs[1] = 1_020;
        hs[2] = 1_030;
        _record(_all(), hs, 0);
        ledger.closeRound(circleId);

        bytes memory wrongWho = TxFixtures.payout(vault, operator, bob, circleId, 0, 3 * AMOUNT);
        vm.expectRevert(KittyLedger.PayoutMismatch.selector);
        ledger.confirmPayout(CHAIN_KEY, 1_040, wrongWho, TxFixtures.merkle(100), TxFixtures.continuity());

        bytes memory wrongAmt = TxFixtures.payout(vault, operator, alice, circleId, 0, AMOUNT);
        vm.expectRevert(KittyLedger.PayoutMismatch.selector);
        ledger.confirmPayout(CHAIN_KEY, 1_040, wrongAmt, TxFixtures.merkle(101), TxFixtures.continuity());
    }

    function test_confirmPayout_requiresClosedRound() public {
        bytes memory tx_ = TxFixtures.payout(vault, operator, alice, circleId, 0, AMOUNT);
        vm.expectRevert(abi.encodeWithSelector(KittyLedger.RoundNotClosed.selector, circleId, uint32(0)));
        ledger.confirmPayout(CHAIN_KEY, 1_040, tx_, TxFixtures.merkle(102), TxFixtures.continuity());
    }

    // ───────────── credit score ─────────────

    function test_creditScore_math() public {
        (uint16 s0, string memory t0) = ledger.creditScore(alice);
        assertEq(s0, 500);
        assertEq(t0, "C");

        uint64[] memory hs = new uint64[](3);
        hs[0] = 1_010;
        hs[1] = 1_020;
        hs[2] = START + ROUND_BLOCKS + 3; // carol late
        _record(_all(), hs, 0);
        (uint16 sa,) = ledger.creditScore(alice);
        (uint16 sc,) = ledger.creditScore(carol);
        assertEq(sa, 515);
        assertEq(sc, 480);

        chainInfo.setAttestedHeight(CHAIN_KEY, START + 2 * ROUND_BLOCKS);
        ledger.closeRound(circleId); // round 0 full
        ledger.closeRound(circleId); // round 1: nobody paid → 3 missed
        (uint16 sa2, string memory ta2) = ledger.creditScore(alice);
        assertEq(sa2, 395);
        assertEq(ta2, "D");
    }
}
