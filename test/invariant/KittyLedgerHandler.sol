// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {CommonBase} from "forge-std/Base.sol";
import {StdCheats} from "forge-std/StdCheats.sol";
import {StdUtils} from "forge-std/StdUtils.sol";
import {KittyLedger} from "../../src/asc/KittyLedger.sol";
import {INativeQueryVerifier} from "@gluwa/asc-contracts/contracts/write-ability/common/INativeQueryVerifier.sol";
import {MockVerifier} from "../mocks/MockVerifier.sol";
import {MockChainInfo} from "../mocks/MockChainInfo.sol";
import {TxFixtures} from "../TxFixtures.sol";

/// @dev Drives KittyLedger through random-but-valid sequences and keeps *ghost* state that the
///      invariants compare against the ledger. Every action guards its own preconditions so the
///      campaign runs with `fail_on_revert = true`: an unexpected revert is a finding, not noise.
///      The attack catalogue (calls that must revert) lives in KittyLedgerAttacker.
contract KittyLedgerHandler is CommonBase, StdCheats, StdUtils {
    uint64 public constant CHAIN_KEY = 1;
    uint256 internal constant N_ACTORS = 10;
    /// @dev Cap on circles per run so the sequence budget is spent driving circles to completion.
    uint256 internal constant MAX_CIRCLES = 6;

    KittyLedger public ledger;
    MockChainInfo public chainInfo;
    MockVerifier public verifier;

    address public vault = address(0xFA11);
    address public operator = address(0x0BE7);
    address public mallory = address(0xBAD);

    address[] public actors;
    mapping(address => uint256) public pkOf;

    /// @dev Attested frontier on the source chain (mirrors MockChainInfo.attestedHeight[CHAIN_KEY]).
    uint64 public frontier;
    uint256 internal seedNonce = 1;
    uint256 internal inviteNonce = 1;

    // ───────────── ghost state ─────────────

    uint256[] public circles;

    struct Rec {
        uint256 circleId;
        uint32 round;
        address member;
        uint64 height;
        bytes32 qid;
    }

    Rec[] public recorded;
    mapping(uint256 => mapping(uint32 => mapping(address => uint256))) public ghostContribCount;
    bytes32[] public qids;
    mapping(bytes32 => uint256) public qidSeen;

    mapping(address => uint256) public ghostOnTime;
    mapping(address => uint256) public ghostLate;
    mapping(address => uint256) public ghostMissed;
    mapping(address => uint256) public ghostReceived;
    mapping(address => uint256) public ghostVolume;

    /// @dev Rounds that closed on the deadline path (contributions < n at close).
    mapping(uint256 => mapping(uint32 => bool)) public ghostClosedByDeadline;
    mapping(uint256 => mapping(uint32 => uint64)) public ghostCloseFrontier;
    /// @dev Rounds whose recipient came from the final-round fallback.
    mapping(uint256 => mapping(uint32 => bool)) public ghostFallback;
    /// @dev Rounds the handler proved a payout for.
    mapping(uint256 => mapping(uint32 => bool)) public ghostPaid;

    mapping(uint256 => bytes32) public completedSnapshot;

    bool public recipientViolation;
    string public recipientViolationLabel;

    struct Fixture {
        uint64 height;
        bytes encodedTx;
        INativeQueryVerifier.MerkleProof proof;
    }

    Fixture[] internal usedFixtures;

    function usedFixturesLength() external view returns (uint256) {
        return usedFixtures.length;
    }

    function usedFixture(uint256 i) external view returns (Fixture memory) {
        return usedFixtures[i];
    }

    // call counters (every dispatch) and effect counters (state actually changed), for the campaign summary
    mapping(string => uint256) public calls;
    mapping(string => uint256) public effects;

    constructor(KittyLedger ledger_, MockChainInfo chainInfo_, MockVerifier verifier_) {
        ledger = ledger_;
        chainInfo = chainInfo_;
        verifier = verifier_;
        for (uint256 i; i < N_ACTORS; ++i) {
            uint256 pk = 0xA0000 + i;
            address a = vm.addr(pk);
            actors.push(a);
            pkOf[a] = pk;
        }
    }

    // ───────────── views for the invariant contract ─────────────

    function actorsLength() external view returns (uint256) {
        return actors.length;
    }

    function circlesLength() external view returns (uint256) {
        return circles.length;
    }

    function recordedLength() external view returns (uint256) {
        return recorded.length;
    }

    function qidsLength() external view returns (uint256) {
        return qids.length;
    }

    // ───────────── actions: circle lifecycle ─────────────

    function createCircle(uint256 seed, uint8 nMembers, uint64 roundBlocks, uint64 startOffset, uint256 amount, bool byScore, uint16 acceptMask)
        external
    {
        calls["createCircle"]++;
        if (circles.length >= MAX_CIRCLES) return;
        // 3 in 4 circles are small (2..4 members) so they can complete within one sequence; the rest span 2..10
        uint256 n = nMembers % 4 == 0 ? bound(nMembers, 2, 10) : 2 + (nMembers % 3);
        roundBlocks = uint64(bound(roundBlocks, 1, 1 << 20));
        uint64 startHeight = frontier + uint64(bound(startOffset, 0, 1 << 20));
        amount = bound(amount, 1, 1e30);
        uint256 first = seed % N_ACTORS;
        address[] memory members = new address[](n);
        for (uint256 i; i < n; ++i) {
            members[i] = actors[(first + i) % N_ACTORS];
        }
        address organiser = actors[(seed >> 8) % N_ACTORS];
        vm.prank(organiser);
        uint256 id = ledger.createCircle("inv", members, amount, roundBlocks, startHeight, vault);
        circles.push(id);
        if (byScore) {
            vm.prank(organiser);
            ledger.setRotation(id, KittyLedger.Rotation.ByScore);
        }
        for (uint256 i; i < n; ++i) {
            if ((acceptMask >> i) & 1 == 1) {
                vm.prank(members[i]);
                ledger.acceptMembership(id);
            }
        }
    }

    function createOpenCircle(uint256 seed, uint8 maxMembers, uint64 roundBlocks, uint64 startOffset, uint256 amount) external {
        calls["createOpenCircle"]++;
        if (circles.length >= MAX_CIRCLES) return;
        uint32 max = maxMembers % 4 == 0 ? uint32(bound(maxMembers, 2, 10)) : uint32(2 + (maxMembers % 3));
        roundBlocks = uint64(bound(roundBlocks, 1, 1 << 20));
        uint64 startHeight = frontier + uint64(bound(startOffset, 0, 1 << 20));
        amount = bound(amount, 1, 1e30);
        address organiser = actors[seed % N_ACTORS];
        vm.prank(organiser);
        uint256 id = ledger.createOpenCircle("open", amount, roundBlocks, startHeight, vault, max);
        circles.push(id);
    }

    function redeemInvite(uint256 seed, uint256 circleSel) external {
        calls["redeemInvite"]++;
        (uint256 id, bool ok) = pickCircle(circleSel, true);
        if (!ok) return;
        KittyLedger.Circle memory c = ledger.getCircle(id);
        if (c.members.length >= c.maxMembers) return;
        address invitee = address(0);
        for (uint256 i; i < N_ACTORS; ++i) {
            address a = actors[(seed % N_ACTORS + i) % N_ACTORS];
            if (!ledger.isMember(id, a)) {
                invitee = a;
                break;
            }
        }
        if (invitee == address(0)) return;
        uint256 nonce = inviteNonce++;
        bytes memory sig = _sign(pkOf[c.organiser], ledger.inviteDigest(id, invitee, nonce));
        vm.prank(invitee);
        ledger.redeemInvite(id, nonce, sig);
        effects["redeemInvite"]++;
    }

    function closeInvites(uint256 circleSel, bool byScore) external {
        calls["closeInvites"]++;
        (uint256 id, bool ok) = pickCircle(circleSel, true);
        if (!ok) return;
        KittyLedger.Circle memory c = ledger.getCircle(id);
        if (c.members.length < 2) return;
        if (byScore) {
            vm.prank(c.organiser);
            ledger.setRotation(id, KittyLedger.Rotation.ByScore);
        }
        vm.prank(c.organiser);
        ledger.closeInvites(id);
        effects["closeInvites"]++;
    }

    function acceptMembership(uint256 seed, uint256 circleSel) external {
        calls["acceptMembership"]++;
        (uint256 id, bool ok) = pickCircle(circleSel, false);
        if (!ok) return;
        KittyLedger.Circle memory c = ledger.getCircle(id);
        address m = c.members[seed % c.members.length];
        vm.prank(m);
        ledger.acceptMembership(id);
    }

    function advanceFrontier(uint64 delta) external {
        calls["advanceFrontier"]++;
        frontier += uint64(bound(delta, 0, 1 << 18));
        chainInfo.setAttestedHeight(CHAIN_KEY, frontier);
    }

    // ───────────── actions: proofs ─────────────

    /// @dev Record a batch of 1..k contributions for the current round of one circle.
    ///      mode 0: `mask` selects which still-unpaid members pay (at least one).
    ///      mode 1: every still-unpaid member pays — the round can close early.
    ///      mode 2: only members who have already received a pot pay — the precondition for the
    ///              carry-over (non-final round) and fallback (final round) branches of closeRound.
    ///      mode 3: exactly one member pays.
    ///      `lateMask` selects which of the chosen payers pay after the deadline.
    function recordContributions(uint256 circleSel, uint8 mode, uint16 mask, uint16 lateMask, uint64 heightSeed) external {
        calls["recordContributions"]++;
        (uint256 id, bool ok) = pickActiveClosedInvites(circleSel);
        if (!ok) return;
        KittyLedger.Circle memory c = ledger.getCircle(id);
        uint32 r = c.currentRound;
        uint64 deadline = ledger.deadlineHeight(id, r);
        mode = mode % 4;

        address[] memory who = new address[](c.members.length);
        uint256 k;
        for (uint256 i; i < c.members.length; ++i) {
            address m = c.members[i];
            if (ledger.getContribution(id, r, m).queryId != bytes32(0)) continue;
            bool pick;
            if (mode == 0) pick = ((mask >> i) & 1) == 1 || (k == 0 && i == c.members.length - 1);
            else if (mode == 1) pick = true;
            else if (mode == 2) pick = ledger.receivedPot(id, m);
            else pick = k == 0 && ((mask >> i) & 1) == 1;
            if (pick) who[k++] = m;
        }
        if (k == 0) return;

        uint64[] memory heights = new uint64[](k);
        bytes[] memory txs = new bytes[](k);
        INativeQueryVerifier.MerkleProof[] memory proofs = new INativeQueryVerifier.MerkleProof[](k);
        bytes32[] memory batchQids = new bytes32[](k);
        for (uint256 i; i < k; ++i) {
            uint64 jitter = uint64(uint256(keccak256(abi.encode(heightSeed, i))) % (uint256(c.roundBlocks) + 1));
            bool late = (lateMask >> i) & 1 == 1;
            // on time: [startHeight, deadline]; late: (deadline, deadline + roundBlocks]
            heights[i] = late ? deadline + 1 + jitter : (deadline - jitter < c.startHeight ? c.startHeight : deadline - jitter);
            txs[i] = TxFixtures.contribution(vault, who[i], id, r, c.contribution);
            (proofs[i], batchQids[i]) = _freshProof(heights[i]);
        }
        ledger.recordContributions(CHAIN_KEY, heights, txs, proofs, TxFixtures.continuity());
        effects["recordContributions"]++;
        effects[k == 1 ? "batch=1" : k < 4 ? "batch=2..3" : "batch>=4"]++;

        for (uint256 i; i < k; ++i) {
            bool onTime = heights[i] <= deadline;
            recorded.push(Rec(id, r, who[i], heights[i], batchQids[i]));
            ghostContribCount[id][r][who[i]] += 1;
            qids.push(batchQids[i]);
            qidSeen[batchQids[i]] += 1;
            if (onTime) ghostOnTime[who[i]] += 1;
            else ghostLate[who[i]] += 1;
            ghostVolume[who[i]] += c.contribution;
            usedFixtures.push();
            Fixture storage f = usedFixtures[usedFixtures.length - 1];
            f.height = heights[i];
            f.encodedTx = txs[i];
            f.proof = proofs[i];
        }
    }

    function closeRound(uint256 circleSel, bool viaDeadline) external {
        calls["closeRound"]++;
        (uint256 id, bool ok) = pickActiveClosedInvites(circleSel);
        if (!ok) return;
        KittyLedger.Circle memory c = ledger.getCircle(id);
        uint32 r = c.currentRound;
        uint256 n = c.members.length;
        KittyLedger.Round memory before = ledger.getRound(id, r);
        bool deadlinePath = before.contributions < n;
        if (deadlinePath) {
            if (!viaDeadline) return;
            uint64 closeAt = ledger.closeHeight(id, r);
            if (frontier < closeAt) {
                frontier = closeAt;
                chainInfo.setAttestedHeight(CHAIN_KEY, frontier);
            }
        }

        // snapshot eligibility state before the close
        bool[] memory hadReceived = new bool[](n);
        bool[] memory paid = new bool[](n);
        for (uint256 i; i < n; ++i) {
            address m = c.members[i];
            hadReceived[i] = ledger.receivedPot(id, m);
            paid[i] = ledger.getContribution(id, r, m).queryId != bytes32(0);
            if (!paid[i] && ledger.accepted(id, m)) ghostMissed[m] += 1;
        }

        ledger.closeRound(id);
        effects["closeRound"]++;
        effects[deadlinePath ? "close:deadline" : "close:early"]++;
        if (c.rotation == KittyLedger.Rotation.ByScore) effects["close:byScore"]++;

        KittyLedger.Round memory after_ = ledger.getRound(id, r);
        if (deadlinePath) {
            ghostClosedByDeadline[id][r] = true;
            ghostCloseFrontier[id][r] = frontier;
        }
        address expected = _expectedRecipient(c, id, r, hadReceived, paid, false);
        bool usedFallback;
        if (expected == address(0) && uint256(r) + 1 == n) {
            expected = _expectedRecipient(c, id, r, hadReceived, paid, true);
            usedFallback = expected != address(0);
        }
        if (after_.recipient != expected) _flagRecipient("recipient differs from the documented rotation rule");
        if (usedFallback) effects["close:fallback"]++;
        if (after_.recipient == address(0) && before.pot > 0 && uint256(r) + 1 < n) effects["close:carryOver"]++;
        if (after_.recipient == address(0) && uint256(r) + 1 == n) effects["close:strandedFinal"]++;
        if (after_.recipient != address(0)) {
            ghostReceived[after_.recipient] += 1;
            ghostFallback[id][r] = usedFallback;
            uint256 idx = _indexOf(c.members, after_.recipient);
            if (idx == type(uint256).max) _flagRecipient("recipient is not a member");
            else {
                if (!paid[idx]) _flagRecipient("recipient did not pay this round");
                if (hadReceived[idx] && !usedFallback) _flagRecipient("recipient had already received outside the final-round fallback");
            }
        }

        if (uint256(r) + 1 == n) {
            completedSnapshot[id] = snapshotCircle(id);
            effects["circleCompleted"]++;
        }
    }

    function confirmPayout(uint256 circleSel, uint32 roundSel, uint64 heightSeed) external {
        calls["confirmPayout"]++;
        (uint256 id, bool ok) = pickCircle(circleSel, false);
        if (!ok) return;
        KittyLedger.Circle memory c = ledger.getCircle(id);
        uint32 last = c.status == KittyLedger.CircleStatus.Completed ? uint32(c.members.length - 1) : c.currentRound;
        uint32 r = uint32(bound(roundSel, 0, last));
        // walk forward to a payable round
        for (uint32 i; i <= last; ++i) {
            uint32 cand = uint32((uint256(r) + i) % (uint256(last) + 1));
            KittyLedger.Round memory rd = ledger.getRound(id, cand);
            if (rd.status == KittyLedger.RoundStatus.Closed && rd.recipient != address(0)) {
                r = cand;
                bytes memory tx_ = TxFixtures.payout(vault, operator, rd.recipient, id, r, rd.pot);
                (INativeQueryVerifier.MerkleProof memory p, bytes32 qid) = _freshProof(uint64(heightSeed));
                ledger.confirmPayout(CHAIN_KEY, uint64(heightSeed), tx_, p, TxFixtures.continuity());
                qids.push(qid);
                qidSeen[qid] += 1;
                ghostPaid[id][r] = true;
                effects["confirmPayout"]++;
                return;
            }
        }
    }

    // ───────────── helpers ─────────────

    function _flagRecipient(string memory label) internal {
        recipientViolation = true;
        recipientViolationLabel = label;
    }

    /// @dev A merkle proof whose derived query id (chainKey ‖ height ‖ txIndex) is not yet processed
    ///      and not handed out earlier in this call. Distinct seeds hash to distinct roots; txIndex is
    ///      the low 16 bits of the root, so collisions are possible and are skipped over.
    function _freshProof(uint64 height) internal returns (INativeQueryVerifier.MerkleProof memory p, bytes32 qid) {
        while (true) {
            p = TxFixtures.merkle(seedNonce++);
            qid = _queryId(height, p);
            if (!ledger.processedQueries(qid) && qidSeen[qid] == 0 && !_reservedQid[qid]) {
                _reservedQid[qid] = true;
                return (p, qid);
            }
        }
    }

    mapping(bytes32 => bool) internal _reservedQid;

    function _queryId(uint64 height, INativeQueryVerifier.MerkleProof memory p) internal pure returns (bytes32) {
        uint256 txIndex = uint64(uint256(p.root) & 0xffff); // MockVerifier.calculateTxIndex
        // KittyLedger._computeQueryId: keccak(uint256(chainKey) ‖ uint64(height) ‖ uint256(txIndex)) — 72 bytes
        return keccak256(abi.encodePacked(uint256(CHAIN_KEY), height, txIndex));
    }

    function _sign(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function pickCircle(uint256 sel, bool wantOpen) public view returns (uint256 id, bool ok) {
        uint256 n = circles.length;
        if (n == 0) return (0, false);
        for (uint256 i; i < n; ++i) {
            id = circles[(sel % n + i) % n];
            if (ledger.getCircle(id).open == wantOpen) return (id, true);
        }
        return (0, false);
    }

    function pickActiveClosedInvites(uint256 sel) public view returns (uint256 id, bool ok) {
        uint256 n = circles.length;
        if (n == 0) return (0, false);
        for (uint256 i; i < n; ++i) {
            id = circles[(sel % n + i) % n];
            KittyLedger.Circle memory c = ledger.getCircle(id);
            if (!c.open && c.status == KittyLedger.CircleStatus.Active) return (id, true);
        }
        return (0, false);
    }

    function _indexOf(address[] memory arr, address a) internal pure returns (uint256) {
        for (uint256 i; i < arr.length; ++i) {
            if (arr[i] == a) return i;
        }
        return type(uint256).max;
    }

    /// @dev Reimplementation of the documented rotation rule, evaluated with post-close scores (misses
    ///      are recorded before the pick) and pre-close receivedPot (the pick precedes the update).
    function _expectedRecipient(
        KittyLedger.Circle memory c,
        uint256,
        uint32 r,
        bool[] memory hadReceived,
        bool[] memory paid,
        bool ignoreReceived
    ) internal view returns (address best) {
        uint256 n = c.members.length;
        if (c.rotation == KittyLedger.Rotation.Fixed) {
            for (uint256 k; k < n; ++k) {
                uint256 i = (uint256(r) + k) % n;
                if ((ignoreReceived || !hadReceived[i]) && paid[i]) return c.members[i];
            }
            return address(0);
        }
        uint16 bestScore;
        for (uint256 i; i < n; ++i) {
            if (!ignoreReceived && hadReceived[i]) continue;
            if (!paid[i]) continue;
            (uint16 sc,) = ledger.creditScore(c.members[i]);
            if (best == address(0) || sc > bestScore) {
                best = c.members[i];
                bestScore = sc;
            }
        }
    }

    /// @dev Hash of everything about a circle that must be frozen once it is Completed: the circle
    ///      struct, every round's accounting (contributions, pot, recipient, attestation evidence) and
    ///      every contribution. A round's `status`/`payoutQueryId` are excluded on purpose: proving the
    ///      vault's PaidOut transaction after completion is the one legitimate late write.
    function snapshotCircle(uint256 id) public view returns (bytes32) {
        KittyLedger.Circle memory c = ledger.getCircle(id);
        bytes memory acc = abi.encode(c);
        for (uint32 r; r < c.members.length; ++r) {
            KittyLedger.Round memory rd = ledger.getRound(id, r);
            acc = abi.encodePacked(acc, abi.encode(rd.contributions, rd.pot, rd.recipient, rd.attestedCloseHeight, rd.attestedCloseHash));
            for (uint256 i; i < c.members.length; ++i) {
                acc = abi.encodePacked(acc, abi.encode(ledger.getContribution(id, r, c.members[i])), ledger.receivedPot(id, c.members[i]));
            }
        }
        return keccak256(acc);
    }
}
