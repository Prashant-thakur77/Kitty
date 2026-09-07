// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {KittyLedger} from "./KittyLedger.sol";

/// @title KittyViewer — one-call read models for the Kitty dashboard
/// @notice Read-only aggregation over KittyLedger so the web app and worker can hydrate a whole
///         circle (or a member's dashboard) in a single eth_call instead of dozens.
/// @dev Shape ported from BreadchainCoop `SavingCirclesViewer` (MIT). Never writes to the ledger.
contract KittyViewer {
    KittyLedger public immutable LEDGER;

    /// @dev Member status within the current round of a circle.
    uint8 public constant STATUS_PENDING = 0;
    uint8 public constant STATUS_PROVEN = 1;
    uint8 public constant STATUS_LATE = 2;
    uint8 public constant STATUS_MISSED = 3;

    struct CircleFull {
        KittyLedger.Circle circle;
        KittyLedger.Round[] rounds; // 0..currentRound inclusive (all rounds once Completed)
        KittyLedger.Contribution[] current; // per member (circle.members order), current round
        uint16[] scores; // per member
        string[] tiers; // per member
        KittyLedger.MemberRecord[] records; // per member
        uint64 deadline; // source-chain deadline height of the current round
    }

    struct MemberDashboard {
        uint256[] circleIds;
        string[] names;
        uint32[] currentRounds;
        uint8[] myStatus; // STATUS_* per circle, for the current round
        uint16 score;
        string tier;
        KittyLedger.MemberRecord record;
    }

    constructor(KittyLedger ledger) {
        LEDGER = ledger;
    }

    function getCircleFull(uint256 circleId) external view returns (CircleFull memory f) {
        f.circle = LEDGER.getCircle(circleId);
        uint32 cur = f.circle.currentRound;
        uint256 n = f.circle.members.length;

        f.rounds = new KittyLedger.Round[](uint256(cur) + 1);
        for (uint32 r; r <= cur; ++r) {
            f.rounds[r] = LEDGER.getRound(circleId, r);
        }

        f.current = new KittyLedger.Contribution[](n);
        f.scores = new uint16[](n);
        f.tiers = new string[](n);
        f.records = new KittyLedger.MemberRecord[](n);
        for (uint256 i; i < n; ++i) {
            address m = f.circle.members[i];
            f.current[i] = LEDGER.getContribution(circleId, cur, m);
            (f.scores[i], f.tiers[i]) = LEDGER.creditScore(m);
            f.records[i] = LEDGER.getRecord(m);
        }
        f.deadline = LEDGER.deadlineHeight(circleId, cur);
    }

    function getMemberDashboard(address member) external view returns (MemberDashboard memory d) {
        d.circleIds = LEDGER.getMemberCircles(member);
        uint256 n = d.circleIds.length;
        d.names = new string[](n);
        d.currentRounds = new uint32[](n);
        d.myStatus = new uint8[](n);
        for (uint256 i; i < n; ++i) {
            uint256 id = d.circleIds[i];
            KittyLedger.Circle memory c = LEDGER.getCircle(id);
            d.names[i] = c.name;
            d.currentRounds[i] = c.currentRound;
            d.myStatus[i] = memberStatus(id, c.currentRound, member);
        }
        (d.score, d.tier) = LEDGER.creditScore(member);
        d.record = LEDGER.getRecord(member);
    }

    /// @notice 0 Pending (round open, nothing proven yet), 1 Proven on time, 2 Late, 3 Missed (round closed
    ///         without a proven contribution).
    function memberStatus(uint256 circleId, uint32 round, address member) public view returns (uint8) {
        KittyLedger.Contribution memory cb = LEDGER.getContribution(circleId, round, member);
        if (cb.queryId != bytes32(0)) return cb.onTime ? STATUS_PROVEN : STATUS_LATE;
        KittyLedger.Round memory rd = LEDGER.getRound(circleId, round);
        return rd.status == KittyLedger.RoundStatus.Open ? STATUS_PENDING : STATUS_MISSED;
    }
}
