// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console2} from "forge-std/Test.sol";
import {KittyLedger} from "../../src/asc/KittyLedger.sol";
import {MockVerifier} from "../mocks/MockVerifier.sol";
import {MockChainInfo} from "../mocks/MockChainInfo.sol";
import {KittyLedgerHandler} from "./KittyLedgerHandler.sol";
import {KittyLedgerAttacker} from "./KittyLedgerAttacker.sol";

/// @title KittyLedger stateful invariants
/// @notice The handler drives the ledger through random sequences of circle creation (listed and
///         open-invite), invites, rotation choice, proven contribution batches, early and deadline
///         closes, payout proofs, and a catalogue of attacks that must revert. After every call the
///         properties below are re-checked against the handler's ghost accounting.
///         Runs with `fail_on_revert = true`: the handler only issues calls it expects to succeed,
///         so any revert outside the attack catalogue is itself a finding.
contract KittyLedgerInvariantTest is Test {
    address constant VERIFIER_PRECOMPILE = 0x0000000000000000000000000000000000000FD2;
    address constant CHAIN_INFO_PRECOMPILE = 0x0000000000000000000000000000000000000fD3;
    uint64 constant CHAIN_KEY = 1;

    KittyLedger ledger;
    KittyLedgerHandler handler;
    KittyLedgerAttacker attacker;

    function setUp() public {
        vm.etch(VERIFIER_PRECOMPILE, address(new MockVerifier()).code);
        vm.etch(CHAIN_INFO_PRECOMPILE, address(new MockChainInfo()).code);
        MockVerifier verifier = MockVerifier(VERIFIER_PRECOMPILE);
        MockChainInfo chainInfo = MockChainInfo(CHAIN_INFO_PRECOMPILE);
        verifier.setAccept(true);

        ledger = new KittyLedger(CHAIN_KEY);
        handler = new KittyLedgerHandler(ledger, chainInfo, verifier);
        attacker = new KittyLedgerAttacker(handler);
        ledger.setTrustedVault(handler.vault(), true);

        targetContract(address(handler));
        targetContract(address(attacker));
        // Duplicated selectors weight the sampler toward the proof/close loop, which is where the
        // accounting lives; creation is capped inside the handler.
        bytes4[] memory selectors = new bytes4[](13);
        selectors[0] = handler.createCircle.selector;
        selectors[1] = handler.createOpenCircle.selector;
        selectors[2] = handler.redeemInvite.selector;
        selectors[3] = handler.closeInvites.selector;
        selectors[4] = handler.acceptMembership.selector;
        selectors[5] = handler.advanceFrontier.selector;
        selectors[6] = handler.recordContributions.selector;
        selectors[7] = handler.recordContributions.selector;
        selectors[8] = handler.recordContributions.selector;
        selectors[9] = handler.closeRound.selector;
        selectors[10] = handler.closeRound.selector;
        selectors[11] = handler.closeRound.selector;
        selectors[12] = handler.confirmPayout.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
        bytes4[] memory attackSelectors = new bytes4[](1);
        attackSelectors[0] = attacker.attack.selector;
        targetSelector(FuzzSelector({addr: address(attacker), selectors: attackSelectors}));
    }

    // ───────────── (a) exactly one contribution per (circle, round, member) ─────────────

    function invariant_oneContributionPerSlot() public view {
        uint256 nc = handler.circlesLength();
        for (uint256 ci; ci < nc; ++ci) {
            uint256 id = handler.circles(ci);
            KittyLedger.Circle memory c = ledger.getCircle(id);
            uint32 last = _lastRound(c);
            for (uint32 r; r <= last; ++r) {
                uint32 counted;
                for (uint256 i; i < c.members.length; ++i) {
                    address m = c.members[i];
                    uint256 ghost = handler.ghostContribCount(id, r, m);
                    KittyLedger.Contribution memory k = ledger.getContribution(id, r, m);
                    assertLe(ghost, 1, "member recorded twice in one round");
                    assertEq(k.queryId != bytes32(0) ? 1 : 0, ghost, "ledger contribution slot disagrees with ghost");
                    if (ghost == 1) ++counted;
                }
                assertEq(ledger.getRound(id, r).contributions, counted, "round.contributions != distinct payers");
            }
            // rounds beyond the current one hold nothing
            if (c.status == KittyLedger.CircleStatus.Active) {
                for (uint32 r = c.currentRound + 1; r < c.members.length; ++r) {
                    assertEq(ledger.getRound(id, r).contributions, 0, "future round has contributions");
                }
            }
        }
    }

    // ───────────── (b) pot accounting including carry-over ─────────────

    function invariant_potAccounting() public view {
        uint256 nc = handler.circlesLength();
        for (uint256 ci; ci < nc; ++ci) {
            uint256 id = handler.circles(ci);
            KittyLedger.Circle memory c = ledger.getCircle(id);
            uint256 n = c.members.length;
            uint32 last = _lastRound(c);
            uint256 carry;
            for (uint32 r; r <= last; ++r) {
                KittyLedger.Round memory rd = ledger.getRound(id, r);
                uint256 expected = c.contribution * rd.contributions + carry;
                bool closed = rd.status != KittyLedger.RoundStatus.Open;
                if (closed && rd.recipient == address(0) && uint256(r) + 1 < n) {
                    // no eligible recipient: the pot rolls forward and this round is zeroed
                    assertEq(rd.pot, 0, "carried-over round still holds a pot");
                    carry = expected;
                } else {
                    assertEq(rd.pot, expected, "pot != contribution * count + carry-in");
                    carry = 0;
                }
                if (closed && rd.recipient == address(0)) {
                    assertEq(rd.status == KittyLedger.RoundStatus.Paid ? 1 : 0, 0, "round without recipient marked Paid");
                }
            }
            // the round after the last closed one only ever holds carry-in
            if (c.status == KittyLedger.CircleStatus.Active) {
                for (uint32 r = c.currentRound + 1; r < n; ++r) {
                    assertEq(ledger.getRound(id, r).pot, 0, "pot leaked into a future round");
                }
            }
        }
    }

    // ───────────── (c) score = formula(counters), clamped to 300..850 ─────────────

    function invariant_scoreFormulaAndCounters() public view {
        uint256 na = handler.actorsLength();
        for (uint256 i; i < na; ++i) {
            address a = handler.actors(i);
            KittyLedger.MemberRecord memory rec = ledger.getRecord(a);
            assertEq(rec.onTime, handler.ghostOnTime(a), "onTime counter");
            assertEq(rec.late, handler.ghostLate(a), "late counter");
            assertEq(rec.missed, handler.ghostMissed(a), "missed counter");
            assertEq(rec.received, handler.ghostReceived(a), "received counter");
            assertEq(rec.volume, handler.ghostVolume(a), "volume");

            (uint16 score, string memory tier) = ledger.creditScore(a);
            int256 s = 500 + int256(uint256(rec.onTime)) * 15 - int256(uint256(rec.late)) * 20 - int256(uint256(rec.missed)) * 120;
            if (s < 300) s = 300;
            if (s > 850) s = 850;
            assertEq(score, uint16(uint256(s)), "score formula");
            assertGe(score, 300);
            assertLe(score, 850);
            bytes32 t = keccak256(bytes(tier));
            if (score >= 700) assertEq(t, keccak256("A"));
            else if (score >= 600) assertEq(t, keccak256("B"));
            else if (score >= 500) assertEq(t, keccak256("C"));
            else assertEq(t, keccak256("D"));
        }
        // nobody outside the actor set ever gains a record
        KittyLedger.MemberRecord memory m = ledger.getRecord(handler.mallory());
        assertEq(m.onTime + m.late + m.missed + m.received, 0, "outsider gained credit history");
    }

    // ───────────── (d) recipient eligibility and fallback semantics ─────────────

    function invariant_recipientEligibility() public view {
        assertFalse(handler.recipientViolation(), handler.recipientViolationLabel());
        uint256 nc = handler.circlesLength();
        for (uint256 ci; ci < nc; ++ci) {
            uint256 id = handler.circles(ci);
            KittyLedger.Circle memory c = ledger.getCircle(id);
            uint256 n = c.members.length;
            uint32 last = _lastRound(c);
            for (uint32 r; r <= last; ++r) {
                KittyLedger.Round memory rd = ledger.getRound(id, r);
                if (rd.status == KittyLedger.RoundStatus.Open) {
                    assertEq(rd.recipient, address(0), "open round has a recipient");
                    continue;
                }
                if (rd.recipient == address(0)) continue;
                assertTrue(ledger.isMember(id, rd.recipient), "recipient not a member");
                assertTrue(ledger.receivedPot(id, rd.recipient), "recipient not flagged as received");
                assertTrue(ledger.getContribution(id, r, rd.recipient).queryId != bytes32(0), "recipient did not pay the round");
                assertGt(rd.contributions, 0, "recipient chosen for an empty round");
                if (handler.ghostFallback(id, r)) {
                    assertEq(uint256(r) + 1, n, "fallback used outside the final round");
                }
            }
            // each member receives at most once outside the final-round fallback
            for (uint256 i; i < n; ++i) {
                uint256 wins;
                for (uint32 r; r <= last; ++r) {
                    if (ledger.getRound(id, r).recipient == c.members[i]) ++wins;
                }
                assertLe(wins, 2, "member received more than twice");
                if (wins == 2) assertTrue(handler.ghostFallback(id, uint32(n - 1)), "double receipt without fallback");
                assertEq(ledger.receivedPot(id, c.members[i]), wins > 0, "receivedPot flag");
            }
        }
    }

    // ───────────── (e) round bounds, Completed circles frozen ─────────────

    function invariant_roundBoundsAndCompletionFrozen() public view {
        uint256 nc = handler.circlesLength();
        for (uint256 ci; ci < nc; ++ci) {
            uint256 id = handler.circles(ci);
            KittyLedger.Circle memory c = ledger.getCircle(id);
            uint256 n = c.members.length;
            assertGe(n, 1);
            assertLe(n, ledger.MAX_MEMBERS());
            assertLt(c.currentRound, n, "currentRound >= member count");
            assertTrue(c.open || n >= 2, "closed-invite circle with < 2 members");
            if (c.open) {
                assertLe(n, c.maxMembers, "open circle over capacity");
                assertEq(c.currentRound, 0, "open circle advanced a round");
                assertEq(ledger.getRound(id, 0).contributions, 0, "open circle holds contributions");
            } else {
                assertEq(c.maxMembers, n, "maxMembers != members after invites close");
            }
            if (c.status == KittyLedger.CircleStatus.Completed) {
                assertEq(c.currentRound, n - 1, "completed circle not on its last round");
                assertEq(handler.snapshotCircle(id), handler.completedSnapshot(id), "Completed circle changed");
                for (uint32 r; r < n; ++r) {
                    assertTrue(ledger.getRound(id, r).status != KittyLedger.RoundStatus.Open, "completed circle has an open round");
                }
            } else {
                for (uint32 r; r < c.currentRound; ++r) {
                    assertTrue(ledger.getRound(id, r).status != KittyLedger.RoundStatus.Open, "past round still open");
                }
                assertEq(uint8(ledger.getRound(id, c.currentRound).status), uint8(KittyLedger.RoundStatus.Open), "current round not open");
            }
        }
        assertEq(ledger.circleCount(), nc, "circleCount drift");
    }

    // ───────────── (f) contribution heights and on-time flags ─────────────

    function invariant_heightsWithinCircle() public view {
        uint256 nr = handler.recordedLength();
        for (uint256 i; i < nr; ++i) {
            (uint256 id, uint32 r, address m, uint64 h, bytes32 qid) = handler.recorded(i);
            KittyLedger.Circle memory c = ledger.getCircle(id);
            KittyLedger.Contribution memory k = ledger.getContribution(id, r, m);
            assertEq(k.height, h, "stored height");
            assertEq(k.queryId, qid, "stored query id");
            assertGe(k.height, c.startHeight, "contribution predates the circle");
            assertEq(k.onTime, k.height <= ledger.deadlineHeight(id, r), "onTime flag");
        }
    }

    // ───────────── (g) query id uniqueness ─────────────

    function invariant_queryIdsUnique() public view {
        uint256 nq = handler.qidsLength();
        for (uint256 i; i < nq; ++i) {
            bytes32 q = handler.qids(i);
            assertEq(handler.qidSeen(q), 1, "query id recorded twice");
            assertTrue(ledger.processedQueries(q), "recorded query id not marked processed");
        }
    }

    // ───────────── attacks never land; deadline evidence is consistent ─────────────

    function invariant_attacksAlwaysRevert() public view {
        assertFalse(attacker.attackSucceeded(), attacker.attackLabel());
    }

    function invariant_closeEvidence() public view {
        uint256 nc = handler.circlesLength();
        for (uint256 ci; ci < nc; ++ci) {
            uint256 id = handler.circles(ci);
            KittyLedger.Circle memory c = ledger.getCircle(id);
            uint32 last = _lastRound(c);
            for (uint32 r; r <= last; ++r) {
                KittyLedger.Round memory rd = ledger.getRound(id, r);
                if (rd.status == KittyLedger.RoundStatus.Open) continue;
                if (handler.ghostClosedByDeadline(id, r)) {
                    uint64 closeAt = ledger.closeHeight(id, r);
                    assertEq(rd.attestedCloseHeight, closeAt, "deadline close must cite the close-height attestation");
                    assertEq(rd.attestedCloseHash, keccak256(abi.encode(CHAIN_KEY, closeAt)), "attestation hash");
                    assertLe(closeAt, handler.ghostCloseFrontier(id, r), "closed before the frontier reached closeHeight");
                    assertLt(rd.contributions, c.members.length, "deadline close with everyone paid");
                } else {
                    assertEq(rd.contributions, c.members.length, "early close without everyone paid");
                    assertEq(rd.attestedCloseHeight, 0, "early close carries attestation evidence");
                    assertEq(rd.attestedCloseHash, bytes32(0));
                }
                if (rd.status == KittyLedger.RoundStatus.Paid) {
                    assertTrue(handler.ghostPaid(id, r), "round Paid without a proven payout");
                    assertTrue(rd.payoutQueryId != bytes32(0));
                    assertTrue(ledger.processedQueries(rd.payoutQueryId));
                } else {
                    assertEq(rd.payoutQueryId, bytes32(0));
                    assertFalse(handler.ghostPaid(id, r));
                }
            }
        }
    }

    /// @dev Not a property: prints what the last run actually exercised so a reviewer can see the
    ///      campaign reaches completed circles, carry-over, fallback and deadline closes.
    function invariant_callSummary() public view {
        console2.log("circles created        ", handler.circlesLength());
        console2.log("invites redeemed       ", handler.effects("redeemInvite"));
        console2.log("invites closed         ", handler.effects("closeInvites"));
        console2.log("contributions recorded ", handler.recordedLength());
        console2.log("  batches size 1       ", handler.effects("batch=1"));
        console2.log("  batches size 2..3    ", handler.effects("batch=2..3"));
        console2.log("  batches size >=4     ", handler.effects("batch>=4"));
        console2.log("rounds closed          ", handler.effects("closeRound"));
        console2.log("  early (all paid)     ", handler.effects("close:early"));
        console2.log("  on attested deadline ", handler.effects("close:deadline"));
        console2.log("  ByScore picks        ", handler.effects("close:byScore"));
        console2.log("  pot carried over     ", handler.effects("close:carryOver"));
        console2.log("  final-round fallback ", handler.effects("close:fallback"));
        console2.log("  final round stranded ", handler.effects("close:strandedFinal"));
        console2.log("circles completed      ", handler.effects("circleCompleted"));
        console2.log("payouts confirmed      ", handler.effects("confirmPayout"));
        console2.log("attack calls           ", attacker.calls());
    }

    function _lastRound(KittyLedger.Circle memory c) internal pure returns (uint32) {
        return c.status == KittyLedger.CircleStatus.Completed ? uint32(c.members.length - 1) : c.currentRound;
    }
}
