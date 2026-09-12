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
        ledger.setTrustedVault(vault, true);
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

    function test_createCircle_revertsWhenRound0DeadlineAlreadyAttested() public {
        address[] memory members = _all();
        // Frontier exactly at round 0's deadline: the round is already over on the source chain.
        chainInfo.setAttestedHeight(CHAIN_KEY, START + ROUND_BLOCKS);
        vm.expectRevert(abi.encodeWithSelector(KittyLedger.InvalidCircle.selector, "round 0 already attested"));
        ledger.createCircle("stale", members, AMOUNT, ROUND_BLOCKS, START, vault);
        vm.expectRevert(abi.encodeWithSelector(KittyLedger.InvalidCircle.selector, "round 0 already attested"));
        ledger.createOpenCircle("stale open", AMOUNT, ROUND_BLOCKS, START, vault, 3);

        // One block short of the deadline is still an open round: creation goes through.
        chainInfo.setAttestedHeight(CHAIN_KEY, START + ROUND_BLOCKS - 1);
        uint256 id = ledger.createCircle("fresh", members, AMOUNT, ROUND_BLOCKS, START, vault);
        assertEq(ledger.deadlineHeight(id, 0), START + ROUND_BLOCKS);
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
        vm.expectRevert(abi.encodeWithSelector(KittyLedger.WrongEmitter.selector, mallory, address(0)));
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

    function test_rejectsPaymentThatPredatesTheCircle() public {
        // a Sepolia payment mined before startHeight (for example one an earlier ledger instance already counted)
        (bytes[] memory txs, INativeQueryVerifier.MerkleProof[] memory proofs) = _batch(_one(alice), _h(START - 1), 0);
        vm.expectRevert(abi.encodeWithSelector(KittyLedger.BeforeCircleStart.selector, START - 1, START));
        ledger.recordContributions(CHAIN_KEY, _h(START - 1), txs, proofs, TxFixtures.continuity());
        // exactly at the start height is fine
        _record(_one(alice), _h(START), 0);
        assertTrue(ledger.getContribution(circleId, 0, alice).onTime);
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
        vm.expectRevert(abi.encodeWithSelector(KittyLedger.RoundStillOpenOnSource.selector, START + ROUND_BLOCKS + 64));
        ledger.closeRound(circleId);
    }

    function test_closeRound_afterDeadlineRecordsMissed() public {
        _record(_one(alice), _h(1_010), 0);
        vm.prank(bob);
        ledger.acceptMembership(circleId);
        vm.prank(carol);
        ledger.acceptMembership(circleId);
        chainInfo.setAttestedHeight(CHAIN_KEY, START + ROUND_BLOCKS + 64); // deadline + grace
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

        chainInfo.setAttestedHeight(CHAIN_KEY, START + 2 * ROUND_BLOCKS + 64);
        ledger.closeRound(circleId); // round 0 full
        ledger.closeRound(circleId); // round 1: nobody paid → 3 missed
        (uint16 sa2, string memory ta2) = ledger.creditScore(alice);
        assertEq(sa2, 395);
        assertEq(ta2, "D");
    }

    // ───────────── review fixes: trusted vault, consent, grace, eligibility, emitter filtering ─────────────

    function test_createCircle_rejectsUntrustedVault() public {
        address[] memory members = _all();
        vm.expectRevert(abi.encodeWithSelector(KittyLedger.VaultNotTrusted.selector, mallory));
        ledger.createCircle("x", members, AMOUNT, ROUND_BLOCKS, START, mallory);
    }

    function test_listedButUnconsentedMemberIsNeverPenalised() public {
        // alice pays (consents); bob and carol never touched this circle → their scores are untouched
        _record(_one(alice), _h(1_010), 0);
        chainInfo.setAttestedHeight(CHAIN_KEY, START + ROUND_BLOCKS + 64);
        ledger.closeRound(circleId);
        assertEq(ledger.getRecord(bob).missed, 0);
        assertEq(ledger.getRecord(carol).missed, 0);
        assertTrue(ledger.accepted(circleId, alice));
        assertFalse(ledger.accepted(circleId, bob));
        assertEq(ledger.getMemberCircles(bob).length, 0, "not in bob's dashboard until he opts in");
        assertEq(ledger.getMemberCircles(alice).length, 1);
    }

    function test_closeRound_recordsAttestationEvidence() public {
        // Round 0: alice pays and consents; bob consents but never pays → one miss with evidence.
        _record(_one(alice), _h(1_010), 0);
        vm.prank(bob);
        ledger.acceptMembership(circleId);
        uint64 deadline = START + ROUND_BLOCKS;
        uint64 closeAt = deadline + 64;
        bytes32 expectedHash = keccak256(abi.encode(CHAIN_KEY, closeAt)); // MockChainInfo._hash
        chainInfo.setAttestedHeight(CHAIN_KEY, closeAt);

        vm.expectEmit(true, true, true, true);
        emit KittyLedger.ContributionMissed(circleId, 0, bob, deadline, closeAt, expectedHash);
        vm.expectEmit(true, true, true, true);
        emit KittyLedger.RoundClosed(circleId, 0, alice, AMOUNT, 1, closeAt);
        ledger.closeRound(circleId);

        KittyLedger.Round memory r0 = ledger.getRound(circleId, 0);
        assertEq(r0.attestedCloseHeight, closeAt, "the attestation that proved the deadline");
        assertEq(r0.attestedCloseHash, expectedHash);
        assertEq(ledger.getRecord(bob).missed, 1);

        // Round 1: everyone pays → closes early on proofs alone; no attestation evidence is recorded.
        uint64[] memory hs = new uint64[](3);
        hs[0] = START + ROUND_BLOCKS + 5;
        hs[1] = START + ROUND_BLOCKS + 6;
        hs[2] = START + ROUND_BLOCKS + 7;
        _record(_all(), hs, 1);
        vm.expectEmit(true, true, true, true);
        emit KittyLedger.RoundClosed(circleId, 1, bob, 3 * AMOUNT, 0, 0);
        ledger.closeRound(circleId);
        KittyLedger.Round memory r1 = ledger.getRound(circleId, 1);
        assertEq(r1.attestedCloseHeight, 0, "early close carries no attestation");
        assertEq(r1.attestedCloseHash, bytes32(0));
    }

    function test_graceWindow_roundCannotCloseUntilDeadlinePlusGrace() public {
        _record(_one(alice), _h(1_010), 0);
        chainInfo.setAttestedHeight(CHAIN_KEY, START + ROUND_BLOCKS + 63);
        vm.expectRevert(abi.encodeWithSelector(KittyLedger.RoundStillOpenOnSource.selector, START + ROUND_BLOCKS + 64));
        ledger.closeRound(circleId);
        // a payment mined at the deadline block is still recordable during the grace window, as late? no — on time
        _record(_one(bob), _h(START + ROUND_BLOCKS), 0);
        assertTrue(ledger.getContribution(circleId, 0, bob).onTime);
        assertEq(ledger.closeHeight(circleId, 0), START + ROUND_BLOCKS + 64);
    }

    function test_fixedRotation_skipsNonPayer_andCarriesPotWhenNobodyEligible() public {
        // round 0: alice (index 0) does NOT pay, bob and carol do → bob receives, alice gets nothing
        address[] memory two = new address[](2);
        two[0] = bob;
        two[1] = carol;
        uint64[] memory hs = new uint64[](2);
        hs[0] = 1_010;
        hs[1] = 1_011;
        _record(two, hs, 0);
        vm.prank(alice);
        ledger.acceptMembership(circleId);
        chainInfo.setAttestedHeight(CHAIN_KEY, START + ROUND_BLOCKS + 64);
        ledger.closeRound(circleId);
        assertEq(ledger.getRound(circleId, 0).recipient, bob, "first eligible after index 0");
        assertEq(ledger.getRecord(alice).missed, 1);

        // round 1: nobody pays → no recipient, pot (0 here) carries; round advances
        chainInfo.setAttestedHeight(CHAIN_KEY, START + 2 * ROUND_BLOCKS + 64);
        ledger.closeRound(circleId);
        assertEq(ledger.getRound(circleId, 1).recipient, address(0));
        assertEq(ledger.getCircle(circleId).currentRound, 2);

        // payout proof for a round without a recipient is refused
        bytes memory tx_ = TxFixtures.payout(vault, operator, alice, circleId, 1, 0);
        vm.expectRevert();
        ledger.confirmPayout(CHAIN_KEY, 1_200, tx_, TxFixtures.merkle(5555), TxFixtures.continuity());
    }

    function test_potCarriesOverToNextRound() public {
        // round 0: only alice pays but she already... use ByScore-free path: alice pays, is eligible → receives.
        // Construct carry-over: round 0 alice pays; then round 1 nobody pays → pot 0 carries (trivial). Use a
        // 2-member circle where the only payer already received: round 0 alice pays (receives 100); round 1 alice
        // pays again, bob never → no eligible recipient (alice already received) → 100 carries to round... last round.
        address[] memory two = new address[](2);
        two[0] = alice;
        two[1] = bob;
        uint256 id = ledger.createCircle("carry", two, AMOUNT, ROUND_BLOCKS, START, vault);
        bytes[] memory txs = new bytes[](1);
        txs[0] = TxFixtures.contribution(vault, alice, id, 0, AMOUNT);
        INativeQueryVerifier.MerkleProof[] memory proofs = new INativeQueryVerifier.MerkleProof[](1);
        proofs[0] = TxFixtures.merkle(9001);
        ledger.recordContributions(CHAIN_KEY, _h(1_010), txs, proofs, TxFixtures.continuity());
        chainInfo.setAttestedHeight(CHAIN_KEY, START + ROUND_BLOCKS + 64);
        ledger.closeRound(id);
        assertEq(ledger.getRound(id, 0).recipient, alice);
        // round 1 (last): alice pays again, bob never → nobody eligible under the normal rule. On the final
        // round the pot cannot roll forward, so it goes to a member who paid (alice) rather than stranding.
        txs[0] = TxFixtures.contribution(vault, alice, id, 1, AMOUNT);
        proofs[0] = TxFixtures.merkle(9002);
        ledger.recordContributions(CHAIN_KEY, _h(START + ROUND_BLOCKS + 10), txs, proofs, TxFixtures.continuity());
        chainInfo.setAttestedHeight(CHAIN_KEY, START + 2 * ROUND_BLOCKS + 64);
        vm.expectEmit(true, true, true, true);
        emit KittyLedger.FallbackRecipient(id, 1, alice);
        ledger.closeRound(id);
        assertEq(ledger.getRound(id, 1).recipient, alice, "final round falls back to a member who paid");
        assertEq(ledger.getRound(id, 1).pot, AMOUNT, "pot stays on the round for the recipient");
        assertEq(uint8(ledger.getCircle(id).status), uint8(KittyLedger.CircleStatus.Completed));
        assertEq(ledger.getRecord(alice).received, 2);
    }

    function test_finalRound_fallbackPaysAPayer() public {
        // 3-member Fixed circle; alice never pays, bob and carol pay every round.
        address[] memory two = new address[](2);
        two[0] = bob;
        two[1] = carol;
        uint64[] memory hs = new uint64[](2);

        hs[0] = 1_010;
        hs[1] = 1_011;
        _record(two, hs, 0);
        chainInfo.setAttestedHeight(CHAIN_KEY, START + ROUND_BLOCKS + 64);
        ledger.closeRound(circleId);
        assertEq(ledger.getRound(circleId, 0).recipient, bob);

        hs[0] = START + ROUND_BLOCKS + 10;
        hs[1] = START + ROUND_BLOCKS + 11;
        _record(two, hs, 1);
        chainInfo.setAttestedHeight(CHAIN_KEY, START + 2 * ROUND_BLOCKS + 64);
        ledger.closeRound(circleId);
        assertEq(ledger.getRound(circleId, 1).recipient, carol);

        // round 2 (last): both payers already received; rotation from index 2 ignoring receivedPot → carol
        hs[0] = START + 2 * ROUND_BLOCKS + 10;
        hs[1] = START + 2 * ROUND_BLOCKS + 11;
        _record(two, hs, 2);
        chainInfo.setAttestedHeight(CHAIN_KEY, START + 3 * ROUND_BLOCKS + 64);
        vm.expectEmit(true, true, true, true);
        emit KittyLedger.FallbackRecipient(circleId, 2, carol);
        ledger.closeRound(circleId);
        KittyLedger.Round memory rd = ledger.getRound(circleId, 2);
        assertEq(rd.recipient, carol, "first payer in rotation order from index 2");
        assertEq(rd.pot, 2 * AMOUNT);
        assertTrue(ledger.getContribution(circleId, 2, rd.recipient).queryId != bytes32(0), "recipient paid round 2");
        assertEq(uint8(ledger.getCircle(circleId).status), uint8(KittyLedger.CircleStatus.Completed));
        assertEq(ledger.getRecord(carol).received, 2);

        // the vault pays whatever recipient the round holds; the proof closes the loop as usual
        bytes memory tx_ = TxFixtures.payout(vault, operator, carol, circleId, 2, 2 * AMOUNT);
        ledger.confirmPayout(CHAIN_KEY, START + 3 * ROUND_BLOCKS + 70, tx_, TxFixtures.merkle(7777), TxFixtures.continuity());
        assertEq(uint8(ledger.getRound(circleId, 2).status), uint8(KittyLedger.RoundStatus.Paid));
    }

    function test_extraContributedLogFromUntrustedEmitterIsIgnored() public {
        // Same tx carries a look-alike Contributed log from another contract plus the genuine vault log.
        TxFixtures.VaultEvent[] memory evs = new TxFixtures.VaultEvent[](2);
        evs[0] = TxFixtures.VaultEvent(TxFixtures.CONTRIBUTED_SIG, mallory, circleId, 0, alice, AMOUNT);
        evs[1] = TxFixtures.VaultEvent(TxFixtures.CONTRIBUTED_SIG, vault, circleId, 0, alice, AMOUNT);
        bytes[] memory txs = new bytes[](1);
        txs[0] = TxFixtures.encode(alice, vault, 1, evs);
        INativeQueryVerifier.MerkleProof[] memory proofs = new INativeQueryVerifier.MerkleProof[](1);
        proofs[0] = TxFixtures.merkle(4242);
        ledger.recordContributions(CHAIN_KEY, _h(1_010), txs, proofs, TxFixtures.continuity());
        assertTrue(ledger.getContribution(circleId, 0, alice).onTime);
    }

    function test_onlyUntrustedEmitterLogs_isWrongEmitter() public {
        bytes[] memory txs = new bytes[](1);
        txs[0] = TxFixtures.contribution(mallory, alice, circleId, 0, AMOUNT);
        INativeQueryVerifier.MerkleProof[] memory proofs = new INativeQueryVerifier.MerkleProof[](1);
        proofs[0] = TxFixtures.merkle(4243);
        vm.expectRevert(abi.encodeWithSelector(KittyLedger.WrongEmitter.selector, mallory, address(0)));
        ledger.recordContributions(CHAIN_KEY, _h(1_010), txs, proofs, TxFixtures.continuity());
    }
}
