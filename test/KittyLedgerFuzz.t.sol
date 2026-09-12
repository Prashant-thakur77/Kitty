// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {KittyLedger} from "../src/asc/KittyLedger.sol";
import {INativeQueryVerifier} from "@gluwa/asc-contracts/contracts/write-ability/common/INativeQueryVerifier.sol";
import {MockVerifier} from "./mocks/MockVerifier.sol";
import {MockChainInfo} from "./mocks/MockChainInfo.sol";
import {TxFixtures} from "./TxFixtures.sol";

/// @notice Property tests for the arithmetic and selection rules of KittyLedger:
///         deadline/close heights over the full range the constructor admits, the Kitty Score
///         formula over random counters, ByScore/Fixed recipient selection over random score
///         vectors, the grace-window boundary, and the startHeight bound against the frontier.
contract KittyLedgerFuzzTest is Test {
    address constant VERIFIER_PRECOMPILE = 0x0000000000000000000000000000000000000FD2;
    address constant CHAIN_INFO_PRECOMPILE = 0x0000000000000000000000000000000000000fD3;
    uint64 constant CHAIN_KEY = 1;
    uint64 constant MAX_START = type(uint64).max / 4; // KittyLedger._initCircle
    uint64 constant MAX_ROUND_BLOCKS = uint64(1) << 40; // KittyLedger._initCircle
    uint64 constant GRACE = 64;
    uint256 constant RECORDS_SLOT = 6; // `forge inspect KittyLedger storage-layout`: _records

    KittyLedger ledger;
    MockChainInfo chainInfo;
    address vault = address(0xFA11);
    address organiser = address(0x0111);
    uint256 seedNonce = 1;

    function setUp() public {
        vm.etch(VERIFIER_PRECOMPILE, address(new MockVerifier()).code);
        vm.etch(CHAIN_INFO_PRECOMPILE, address(new MockChainInfo()).code);
        chainInfo = MockChainInfo(CHAIN_INFO_PRECOMPILE);
        MockVerifier(VERIFIER_PRECOMPILE).setAccept(true);
        ledger = new KittyLedger(CHAIN_KEY);
        ledger.setTrustedVault(vault, true);
    }

    // ───────────── helpers ─────────────

    function _members(uint256 n) internal pure returns (address[] memory m) {
        m = new address[](n);
        for (uint256 i; i < n; ++i) {
            m[i] = address(uint160(0x1000 + i));
        }
    }

    function _create(uint256 n, uint64 roundBlocks, uint64 startHeight) internal returns (uint256 id) {
        vm.prank(organiser);
        id = ledger.createCircle("fuzz", _members(n), 1e6, roundBlocks, startHeight, vault);
    }

    function _pay(uint256 id, address who, uint32 round, uint64 height) internal {
        uint64[] memory hs = new uint64[](1);
        hs[0] = height;
        bytes[] memory txs = new bytes[](1);
        txs[0] = TxFixtures.contribution(vault, who, id, round, 1e6);
        INativeQueryVerifier.MerkleProof[] memory ps = new INativeQueryVerifier.MerkleProof[](1);
        ps[0] = TxFixtures.merkle(seedNonce++);
        ledger.recordContributions(CHAIN_KEY, hs, txs, ps, TxFixtures.continuity());
    }

    /// @dev Write a MemberRecord straight into storage (slot 6 mapping, counters packed in word 0)
    ///      and confirm the ledger reads it back, so the test cannot silently drift from the layout.
    function _setRecord(address m, uint32 onTime, uint32 late, uint32 missed) internal {
        bytes32 slot = keccak256(abi.encode(m, RECORDS_SLOT));
        uint256 packed = uint256(onTime) | (uint256(late) << 32) | (uint256(missed) << 64);
        vm.store(address(ledger), slot, bytes32(packed));
        KittyLedger.MemberRecord memory r = ledger.getRecord(m);
        assertEq(r.onTime, onTime, "layout: onTime");
        assertEq(r.late, late, "layout: late");
        assertEq(r.missed, missed, "layout: missed");
        assertEq(r.received, 0, "layout: received");
    }

    function _expectedScore(uint32 onTime, uint32 late, uint32 missed) internal pure returns (uint16) {
        int256 s = 500 + int256(uint256(onTime)) * 15 - int256(uint256(late)) * 20 - int256(uint256(missed)) * 120;
        if (s < 300) s = 300;
        if (s > 850) s = 850;
        return uint16(uint256(s));
    }

    // ───────────── deadline / close height arithmetic ─────────────

    /// @dev Over everything the constructor admits (start ≤ 2^64/4, roundBlocks ≤ 2^40, up to 10 rounds)
    ///      the deadline and close heights never overflow and follow the documented formula.
    function testFuzz_deadlineAndCloseHeight_fullRange(uint64 startHeight, uint64 roundBlocks, uint8 round, uint8 n) public {
        startHeight = uint64(bound(startHeight, 0, MAX_START));
        roundBlocks = uint64(bound(roundBlocks, 1, MAX_ROUND_BLOCKS));
        n = uint8(bound(n, 2, 10));
        round = uint8(bound(round, 0, n - 1));
        uint256 id = _create(n, roundBlocks, startHeight);

        uint256 expected = uint256(startHeight) + (uint256(round) + 1) * uint256(roundBlocks);
        assertLe(expected + GRACE, type(uint64).max, "constructor bounds must keep closeHeight in uint64");
        assertEq(ledger.deadlineHeight(id, round), uint64(expected));
        assertEq(ledger.closeHeight(id, round), uint64(expected) + GRACE);
        if (round > 0) {
            assertEq(ledger.deadlineHeight(id, round) - ledger.deadlineHeight(id, round - 1), roundBlocks, "rounds are equal length");
        }
        assertGt(ledger.deadlineHeight(id, 0), startHeight, "round 0 ends after the start");
    }

    /// @dev The worst admissible circle (max start, max roundBlocks, 10 members) still fits: this is
    ///      the exact reason the constructor caps start at 2^62 and roundBlocks at 2^40.
    function test_deadlineHeight_worstCaseFits() public {
        uint256 id = _create(10, MAX_ROUND_BLOCKS, MAX_START);
        uint64 last = ledger.closeHeight(id, 9);
        assertEq(uint256(last), uint256(MAX_START) + 10 * uint256(MAX_ROUND_BLOCKS) + GRACE);
    }

    function testFuzz_createCircle_rejectsOutOfRangeHeights(uint64 startHeight, uint64 roundBlocks) public {
        // either bound violated → "height range"
        vm.assume(startHeight > MAX_START || roundBlocks > MAX_ROUND_BLOCKS);
        vm.assume(roundBlocks != 0);
        vm.prank(organiser);
        vm.expectRevert(abi.encodeWithSelector(KittyLedger.InvalidCircle.selector, "height range"));
        ledger.createCircle("x", _members(2), 1e6, roundBlocks, startHeight, vault);
    }

    // ───────────── score arithmetic ─────────────

    function testFuzz_creditScore_formulaAndClamp(uint32 onTime, uint32 late, uint32 missed) public {
        address m = address(0xC0FFEE);
        _setRecord(m, onTime, late, missed);
        (uint16 score, string memory tier) = ledger.creditScore(m);
        assertEq(score, _expectedScore(onTime, late, missed));
        assertGe(score, 300);
        assertLe(score, 850);
        bytes32 t = keccak256(bytes(tier));
        if (score >= 700) assertEq(t, keccak256("A"));
        else if (score >= 600) assertEq(t, keccak256("B"));
        else if (score >= 500) assertEq(t, keccak256("C"));
        else assertEq(t, keccak256("D"));
    }

    /// @dev Scores are monotone in each counter: more on-time never lowers, more late/missed never raises.
    function testFuzz_creditScore_monotone(uint32 onTime, uint32 late, uint32 missed) public {
        onTime = uint32(bound(onTime, 0, type(uint32).max - 1));
        late = uint32(bound(late, 0, type(uint32).max - 1));
        missed = uint32(bound(missed, 0, type(uint32).max - 1));
        address m = address(0xC0FFEE);
        _setRecord(m, onTime, late, missed);
        (uint16 base,) = ledger.creditScore(m);
        _setRecord(m, onTime + 1, late, missed);
        (uint16 moreOnTime,) = ledger.creditScore(m);
        _setRecord(m, onTime, late + 1, missed);
        (uint16 moreLate,) = ledger.creditScore(m);
        _setRecord(m, onTime, late, missed + 1);
        (uint16 moreMissed,) = ledger.creditScore(m);
        assertGe(moreOnTime, base);
        assertLe(moreLate, base);
        assertLe(moreMissed, base);
        assertLe(moreMissed, moreLate, "a miss costs at least as much as a late payment");
    }

    // ───────────── rotation selection ─────────────

    /// @dev ByScore: among members who paid this round, the highest score wins; ties go to the lowest
    ///      index. Scores are random via injected records; the payer set is a random non-empty mask.
    function testFuzz_byScore_picksHighestEligible_tiesByLowestIndex(uint8 n, uint16 payMask, uint96[10] memory scoreSeed) public {
        n = uint8(bound(n, 2, 10));
        uint256 id = _create(n, 50, 1_000);
        vm.prank(organiser);
        ledger.setRotation(id, KittyLedger.Rotation.ByScore);
        address[] memory members = _members(n);
        for (uint256 i; i < n; ++i) {
            // small counters so the whole 300..850 band (and both clamps) is reachable
            _setRecord(members[i], uint32(scoreSeed[i] % 30), uint32((scoreSeed[i] >> 8) % 12), uint32((scoreSeed[i] >> 16) % 5));
        }
        uint256 paid;
        for (uint256 i; i < n; ++i) {
            if (((payMask >> i) & 1) == 1 || (paid == 0 && i == uint256(n) - 1)) {
                _pay(id, members[i], 0, 1_010 + uint64(i));
                paid |= 1 << i;
            }
        }
        if (paid != (uint256(1) << n) - 1) chainInfo.setAttestedHeight(CHAIN_KEY, ledger.closeHeight(id, 0));
        ledger.closeRound(id);

        // scores read after the close: closeRound records misses before it picks (no member accepted
        // here, so nothing changes, but this is the state the pick actually saw)
        address expected;
        uint16 best;
        for (uint256 i; i < n; ++i) {
            if (((paid >> i) & 1) == 0) continue;
            (uint16 sc,) = ledger.creditScore(members[i]);
            if (expected == address(0) || sc > best) {
                expected = members[i];
                best = sc;
            }
        }
        address got = ledger.getRound(id, 0).recipient;
        assertEq(got, expected, "ByScore recipient");
        (uint16 gotScore,) = ledger.creditScore(got);
        for (uint256 i; i < n; ++i) {
            if (((paid >> i) & 1) == 0) continue;
            (uint16 sc,) = ledger.creditScore(members[i]);
            assertLe(sc, gotScore, "a payer outscored the recipient");
            if (sc == gotScore) assertLe(_index(members, got), i, "tie not broken by lowest index");
        }
        assertTrue(ledger.receivedPot(id, got));
        assertEq(ledger.getRecord(got).received, 1);
    }

    /// @dev Fixed: rotation order starting at members[round], skipping non-payers. Round 0 with a
    ///      random payer set therefore selects the lowest-index payer regardless of score.
    function testFuzz_fixed_picksLowestIndexPayer(uint8 n, uint16 payMask, uint96[10] memory scoreSeed) public {
        n = uint8(bound(n, 2, 10));
        uint256 id = _create(n, 50, 1_000);
        address[] memory members = _members(n);
        for (uint256 i; i < n; ++i) {
            _setRecord(members[i], uint32(scoreSeed[i] % 30), uint32((scoreSeed[i] >> 8) % 12), uint32((scoreSeed[i] >> 16) % 5));
        }
        address expected;
        bool all = true;
        for (uint256 i; i < n; ++i) {
            if (((payMask >> i) & 1) == 1 || (expected == address(0) && i == uint256(n) - 1)) {
                _pay(id, members[i], 0, 1_010 + uint64(i));
                if (expected == address(0)) expected = members[i];
            } else {
                all = false;
            }
        }
        if (!all) chainInfo.setAttestedHeight(CHAIN_KEY, ledger.closeHeight(id, 0));
        ledger.closeRound(id);
        assertEq(ledger.getRound(id, 0).recipient, expected, "Fixed recipient");
    }

    /// @dev Whatever the rotation, the round-r recipient of an n-member circle where everyone always
    ///      pays is a member who has not received before, and after n rounds everyone received once.
    function testFuzz_everyoneReceivesExactlyOnce(uint8 n, bool byScore, uint96[10] memory scoreSeed) public {
        n = uint8(bound(n, 2, 10));
        uint256 id = _create(n, 50, 1_000);
        if (byScore) {
            vm.prank(organiser);
            ledger.setRotation(id, KittyLedger.Rotation.ByScore);
        }
        address[] memory members = _members(n);
        for (uint256 i; i < n; ++i) {
            _setRecord(members[i], uint32(scoreSeed[i] % 30), uint32((scoreSeed[i] >> 8) % 12), uint32((scoreSeed[i] >> 16) % 5));
        }
        for (uint32 r; r < n; ++r) {
            for (uint256 i; i < n; ++i) {
                _pay(id, members[i], r, 1_000 + uint64(r) * 50 + uint64(i) + 1);
            }
            ledger.closeRound(id);
            address got = ledger.getRound(id, r).recipient;
            assertTrue(got != address(0));
            for (uint32 q; q < r; ++q) {
                assertTrue(ledger.getRound(id, q).recipient != got, "member received twice");
            }
        }
        for (uint256 i; i < n; ++i) {
            assertEq(ledger.getRecord(members[i]).received, 1);
            assertTrue(ledger.receivedPot(id, members[i]));
        }
        assertEq(uint8(ledger.getCircle(id).status), uint8(KittyLedger.CircleStatus.Completed));
    }

    // ───────────── grace window boundary ─────────────

    /// @dev With a partial round, the frontier at closeHeight-1 cannot close it; closeHeight can.
    ///      A payment mined at the deadline block is on time; one block later is late.
    function testFuzz_graceWindowBoundary(uint64 startHeight, uint64 roundBlocks) public {
        startHeight = uint64(bound(startHeight, 0, 1 << 60));
        roundBlocks = uint64(bound(roundBlocks, 1, 1 << 30));
        uint256 id = _create(3, roundBlocks, startHeight);
        address[] memory members = _members(3);
        uint64 deadline = ledger.deadlineHeight(id, 0);
        uint64 closeAt = ledger.closeHeight(id, 0);
        assertEq(closeAt, deadline + GRACE);

        _pay(id, members[0], 0, deadline);
        assertTrue(ledger.getContribution(id, 0, members[0]).onTime, "deadline block is on time");
        _pay(id, members[1], 0, deadline + 1);
        assertFalse(ledger.getContribution(id, 0, members[1]).onTime, "deadline + 1 is late");

        chainInfo.setAttestedHeight(CHAIN_KEY, closeAt - 1);
        vm.expectRevert(abi.encodeWithSelector(KittyLedger.RoundStillOpenOnSource.selector, closeAt));
        ledger.closeRound(id);

        chainInfo.setAttestedHeight(CHAIN_KEY, closeAt);
        ledger.closeRound(id);
        KittyLedger.Round memory rd = ledger.getRound(id, 0);
        assertEq(uint8(rd.status), uint8(KittyLedger.RoundStatus.Closed));
        assertEq(rd.attestedCloseHeight, closeAt);
        assertEq(rd.contributions, 2);
    }

    /// @dev Everyone paid: the round closes at any frontier, even zero, and records no attestation.
    function testFuzz_fullRoundClosesRegardlessOfFrontier(uint64 frontier) public {
        uint256 id = _create(2, 50, 1_000);
        address[] memory members = _members(2);
        _pay(id, members[0], 0, 1_001);
        _pay(id, members[1], 0, 1_002);
        chainInfo.setAttestedHeight(CHAIN_KEY, frontier);
        ledger.closeRound(id);
        assertEq(ledger.getRound(id, 0).attestedCloseHeight, 0);
    }

    // ───────────── startHeight against the attested frontier ─────────────

    /// @dev Creation succeeds iff round 0's deadline lies strictly beyond the frontier (when one exists).
    function testFuzz_startHeightBoundAgainstFrontier(uint64 frontier, uint64 startHeight, uint64 roundBlocks) public {
        startHeight = uint64(bound(startHeight, 0, MAX_START));
        roundBlocks = uint64(bound(roundBlocks, 1, MAX_ROUND_BLOCKS));
        chainInfo.setAttestedHeight(CHAIN_KEY, frontier);
        bool frontierExists = frontier > 0; // MockChainInfo: exists ⇔ height > 0
        bool stale = frontierExists && uint256(startHeight) + uint256(roundBlocks) <= uint256(frontier);
        vm.prank(organiser);
        if (stale) {
            vm.expectRevert(abi.encodeWithSelector(KittyLedger.InvalidCircle.selector, "round 0 already attested"));
            ledger.createCircle("x", _members(2), 1e6, roundBlocks, startHeight, vault);
        } else {
            uint256 id = ledger.createCircle("x", _members(2), 1e6, roundBlocks, startHeight, vault);
            assertGt(ledger.deadlineHeight(id, 0), frontierExists ? frontier : 0);
        }
    }

    /// @dev A payment at any height below startHeight is refused; at or above it is accepted.
    function testFuzz_contributionHeightVsStart(uint64 startHeight, uint64 height) public {
        startHeight = uint64(bound(startHeight, 1, 1 << 60));
        uint256 id = _create(2, 50, startHeight);
        address[] memory members = _members(2);
        uint64[] memory hs = new uint64[](1);
        hs[0] = height;
        bytes[] memory txs = new bytes[](1);
        txs[0] = TxFixtures.contribution(vault, members[0], id, 0, 1e6);
        INativeQueryVerifier.MerkleProof[] memory ps = new INativeQueryVerifier.MerkleProof[](1);
        ps[0] = TxFixtures.merkle(seedNonce++);
        if (height < startHeight) {
            vm.expectRevert(abi.encodeWithSelector(KittyLedger.BeforeCircleStart.selector, height, startHeight));
            ledger.recordContributions(CHAIN_KEY, hs, txs, ps, TxFixtures.continuity());
        } else {
            ledger.recordContributions(CHAIN_KEY, hs, txs, ps, TxFixtures.continuity());
            KittyLedger.Contribution memory k = ledger.getContribution(id, 0, members[0]);
            assertEq(k.height, height);
            assertEq(k.onTime, height <= ledger.deadlineHeight(id, 0));
        }
    }

    function _index(address[] memory arr, address a) internal pure returns (uint256) {
        for (uint256 i; i < arr.length; ++i) {
            if (arr[i] == a) return i;
        }
        revert("not found");
    }
}
