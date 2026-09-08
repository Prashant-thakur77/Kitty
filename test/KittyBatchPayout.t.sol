// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {KittyLedger} from "../src/asc/KittyLedger.sol";
import {INativeQueryVerifier} from "@gluwa/asc-contracts/contracts/write-ability/common/INativeQueryVerifier.sol";
import {MockVerifier} from "./mocks/MockVerifier.sol";
import {MockChainInfo} from "./mocks/MockChainInfo.sol";
import {TxFixtures} from "./TxFixtures.sol";

/// @dev A5: payouts confirmed the way contributions are — one continuity proof, one precompile call,
///      per-query replay protection, and the same per-payout validation the single entry point does.
contract KittyBatchPayoutTest is Test {
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
    address dave = address(0xDA7E);

    uint256 constant AMOUNT = 100e6;
    uint256 constant POT = 2 * AMOUNT;
    uint64 constant START = 1_000;
    uint64 constant ROUND_BLOCKS = 50;

    uint256 circleA;
    uint256 circleB;

    function setUp() public {
        vm.etch(VERIFIER_PRECOMPILE, address(new MockVerifier()).code);
        vm.etch(CHAIN_INFO_PRECOMPILE, address(new MockChainInfo()).code);
        verifier = MockVerifier(VERIFIER_PRECOMPILE);
        chainInfo = MockChainInfo(CHAIN_INFO_PRECOMPILE);
        verifier.setAccept(true);

        ledger = new KittyLedger(CHAIN_KEY);
        ledger.setTrustedVault(vault, true);
        circleA = ledger.createCircle("A", _pair(alice, bob), AMOUNT, ROUND_BLOCKS, START, vault);
        circleB = ledger.createCircle("B", _pair(carol, dave), AMOUNT, ROUND_BLOCKS, START, vault);

        // Both circles pay round 0 in full and close early, leaving two Closed rounds awaiting payout.
        _payRound(circleA, alice, bob, 0, 1_010);
        _payRound(circleB, carol, dave, 0, 1_012);
        ledger.closeRound(circleA);
        ledger.closeRound(circleB);
        assertEq(ledger.getRound(circleA, 0).recipient, alice);
        assertEq(ledger.getRound(circleB, 0).recipient, carol);
    }

    // ───────────── helpers ─────────────

    function _pair(address a, address b) internal pure returns (address[] memory r) {
        r = new address[](2);
        r[0] = a;
        r[1] = b;
    }

    function _payRound(uint256 circleId, address m0, address m1, uint32 round, uint64 baseHeight) internal {
        uint64[] memory heights = new uint64[](2);
        heights[0] = baseHeight;
        heights[1] = baseHeight + 1;
        bytes[] memory txs = new bytes[](2);
        txs[0] = TxFixtures.contribution(vault, m0, circleId, round, AMOUNT);
        txs[1] = TxFixtures.contribution(vault, m1, circleId, round, AMOUNT);
        INativeQueryVerifier.MerkleProof[] memory proofs = new INativeQueryVerifier.MerkleProof[](2);
        proofs[0] = TxFixtures.merkle(uint256(keccak256(abi.encode(circleId, m0, round))));
        proofs[1] = TxFixtures.merkle(uint256(keccak256(abi.encode(circleId, m1, round))));
        ledger.recordContributions(CHAIN_KEY, heights, txs, proofs, TxFixtures.continuity());
    }

    function _payoutBatch(uint256 amountB)
        internal
        view
        returns (uint64[] memory heights, bytes[] memory txs, INativeQueryVerifier.MerkleProof[] memory proofs)
    {
        heights = new uint64[](2);
        heights[0] = 1_100;
        heights[1] = 1_101;
        txs = new bytes[](2);
        txs[0] = TxFixtures.payout(vault, operator, alice, circleA, 0, POT);
        txs[1] = TxFixtures.payout(vault, operator, carol, circleB, 0, amountB);
        proofs = new INativeQueryVerifier.MerkleProof[](2);
        proofs[0] = TxFixtures.merkle(901);
        proofs[1] = TxFixtures.merkle(902);
    }

    // ───────────── the batch ─────────────

    function test_twoClosedRoundsConfirmedInOneCall() public {
        uint256 batchesBefore = verifier.batchCalls();
        (uint64[] memory heights, bytes[] memory txs, INativeQueryVerifier.MerkleProof[] memory proofs) = _payoutBatch(POT);

        vm.expectEmit(true, true, true, false); // qid is derived inside; the indexed fields are the claim
        emit KittyLedger.PayoutConfirmed(circleA, 0, alice, POT, bytes32(0));
        ledger.confirmPayouts(CHAIN_KEY, heights, txs, proofs, TxFixtures.continuity());

        assertEq(uint8(ledger.getRound(circleA, 0).status), uint8(KittyLedger.RoundStatus.Paid));
        assertEq(uint8(ledger.getRound(circleB, 0).status), uint8(KittyLedger.RoundStatus.Paid));
        assertTrue(ledger.getRound(circleA, 0).payoutQueryId != bytes32(0));
        assertTrue(ledger.getRound(circleB, 0).payoutQueryId != bytes32(0));
        assertTrue(ledger.getRound(circleA, 0).payoutQueryId != ledger.getRound(circleB, 0).payoutQueryId);

        assertEq(verifier.batchCalls() - batchesBefore, 1, "two payouts, one precompile call");
        assertEq(verifier.lastBatchSize(), 2);
    }

    function test_singleConfirmPayoutStillWorks() public {
        uint256 singlesBefore = verifier.singleCalls();
        bytes memory t = TxFixtures.payout(vault, operator, alice, circleA, 0, POT);
        ledger.confirmPayout(CHAIN_KEY, 1_100, t, TxFixtures.merkle(901), TxFixtures.continuity());

        assertEq(uint8(ledger.getRound(circleA, 0).status), uint8(KittyLedger.RoundStatus.Paid));
        assertEq(verifier.singleCalls() - singlesBefore, 1, "the single entry point keeps the single overload");
    }

    function test_mismatchedAmountRevertsTheWholeBatch() public {
        (uint64[] memory heights, bytes[] memory txs, INativeQueryVerifier.MerkleProof[] memory proofs) =
            _payoutBatch(POT - 1);

        vm.expectRevert(KittyLedger.PayoutMismatch.selector);
        ledger.confirmPayouts(CHAIN_KEY, heights, txs, proofs, TxFixtures.continuity());

        // Nothing is settled: the good payout in slot 0 is rolled back with the bad one in slot 1.
        assertEq(uint8(ledger.getRound(circleA, 0).status), uint8(KittyLedger.RoundStatus.Closed));
        assertEq(uint8(ledger.getRound(circleB, 0).status), uint8(KittyLedger.RoundStatus.Closed));
        assertEq(ledger.getRound(circleA, 0).payoutQueryId, bytes32(0));
    }

    function test_wrongRecipientRevertsTheWholeBatch() public {
        (uint64[] memory heights, bytes[] memory txs, INativeQueryVerifier.MerkleProof[] memory proofs) = _payoutBatch(POT);
        txs[1] = TxFixtures.payout(vault, operator, dave, circleB, 0, POT); // dave did not win round 0

        vm.expectRevert(KittyLedger.PayoutMismatch.selector);
        ledger.confirmPayouts(CHAIN_KEY, heights, txs, proofs, TxFixtures.continuity());
        assertEq(uint8(ledger.getRound(circleA, 0).status), uint8(KittyLedger.RoundStatus.Closed));
    }

    function test_replayOfAConfirmedPayoutIsRejected() public {
        (uint64[] memory heights, bytes[] memory txs, INativeQueryVerifier.MerkleProof[] memory proofs) = _payoutBatch(POT);
        ledger.confirmPayouts(CHAIN_KEY, heights, txs, proofs, TxFixtures.continuity());

        vm.expectRevert(); // QueryAlreadyProcessed(qid)
        ledger.confirmPayouts(CHAIN_KEY, heights, txs, proofs, TxFixtures.continuity());

        // …and the single entry point cannot re-spend a query the batch already consumed.
        vm.expectRevert();
        ledger.confirmPayout(CHAIN_KEY, heights[0], txs[0], proofs[0], TxFixtures.continuity());
    }

    function test_inBatchDuplicateIsRejected() public {
        uint64[] memory heights = new uint64[](2);
        heights[0] = 1_100;
        heights[1] = 1_100;
        bytes[] memory txs = new bytes[](2);
        txs[0] = TxFixtures.payout(vault, operator, alice, circleA, 0, POT);
        txs[1] = txs[0];
        INativeQueryVerifier.MerkleProof[] memory proofs = new INativeQueryVerifier.MerkleProof[](2);
        proofs[0] = TxFixtures.merkle(901);
        proofs[1] = TxFixtures.merkle(901);

        vm.expectRevert(); // QueryAlreadyProcessed(qid) — caught before the prover is paid
        ledger.confirmPayouts(CHAIN_KEY, heights, txs, proofs, TxFixtures.continuity());
        assertEq(uint8(ledger.getRound(circleA, 0).status), uint8(KittyLedger.RoundStatus.Closed));
    }

    function test_openRoundCannotBePaidInABatch() public {
        // Round 1 of circle A is open, so a payout proof for it is refused even inside a valid batch.
        uint64[] memory heights = new uint64[](2);
        heights[0] = 1_100;
        heights[1] = 1_101;
        bytes[] memory txs = new bytes[](2);
        txs[0] = TxFixtures.payout(vault, operator, alice, circleA, 0, POT);
        txs[1] = TxFixtures.payout(vault, operator, bob, circleA, 1, POT);
        INativeQueryVerifier.MerkleProof[] memory proofs = new INativeQueryVerifier.MerkleProof[](2);
        proofs[0] = TxFixtures.merkle(901);
        proofs[1] = TxFixtures.merkle(902);

        vm.expectRevert(abi.encodeWithSelector(KittyLedger.RoundNotClosed.selector, circleA, uint32(1)));
        ledger.confirmPayouts(CHAIN_KEY, heights, txs, proofs, TxFixtures.continuity());
    }

    function test_batchShapeIsValidated() public {
        uint64[] memory heights = new uint64[](0);
        bytes[] memory txs = new bytes[](0);
        INativeQueryVerifier.MerkleProof[] memory proofs = new INativeQueryVerifier.MerkleProof[](0);
        vm.expectRevert(KittyLedger.EmptyBatch.selector);
        ledger.confirmPayouts(CHAIN_KEY, heights, txs, proofs, TxFixtures.continuity());

        uint64[] memory two = new uint64[](2);
        vm.expectRevert(KittyLedger.LengthMismatch.selector);
        ledger.confirmPayouts(CHAIN_KEY, two, txs, proofs, TxFixtures.continuity());
    }

    function test_payoutBatchIsBoundToTheCirclesChain() public {
        (uint64[] memory heights, bytes[] memory txs, INativeQueryVerifier.MerkleProof[] memory proofs) = _payoutBatch(POT);
        ledger.setTrustedVault(3, vault, true); // trusted on mainnet too, so this is a chain mismatch
        vm.expectRevert(abi.encodeWithSelector(KittyLedger.WrongChain.selector, uint64(3), CHAIN_KEY));
        ledger.confirmPayouts(3, heights, txs, proofs, TxFixtures.continuity());
    }
}
