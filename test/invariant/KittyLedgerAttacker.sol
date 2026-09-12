// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {CommonBase} from "forge-std/Base.sol";
import {StdCheats} from "forge-std/StdCheats.sol";
import {StdUtils} from "forge-std/StdUtils.sol";
import {KittyLedger} from "../../src/asc/KittyLedger.sol";
import {INativeQueryVerifier} from "@gluwa/asc-contracts/contracts/write-ability/common/INativeQueryVerifier.sol";
import {TxFixtures} from "../TxFixtures.sol";
import {KittyLedgerHandler} from "./KittyLedgerHandler.sol";

/// @dev Second invariant target: a catalogue of calls the ledger must reject, fired at whatever
///      state the handler has built. Each attack is wrapped in try/catch; if the ledger ever lets
///      one through, `attackSucceeded` is set and `invariant_attacksAlwaysRevert` fails with the
///      label. Kept separate from the handler so neither contract approaches the EIP-170 limit.
contract KittyLedgerAttacker is CommonBase, StdCheats, StdUtils {
    uint64 public constant CHAIN_KEY = 1;
    uint256 internal constant N_ACTORS = 10;

    KittyLedger public ledger;
    KittyLedgerHandler public handler;
    address public vault;
    address public operator;
    address public mallory;
    uint256 internal malloryPk = 0xBAD;

    bool public attackSucceeded;
    string public attackLabel;
    uint256 public calls;
    uint256 internal seedNonce = 1 << 128; // disjoint from the handler's proof seeds

    constructor(KittyLedgerHandler handler_) {
        handler = handler_;
        ledger = handler_.ledger();
        vault = handler_.vault();
        operator = handler_.operator();
        mallory = handler_.mallory();
    }

    function attack(uint8 kind, uint256 seed) external {
        kind = uint8(bound(kind, 0, 9));
        calls++;
        if (kind == 0) _attackReplay(seed);
        else if (kind == 1) _attackSpoofedEmitter(seed);
        else if (kind == 2) _attackWrongAmount(seed);
        else if (kind == 3) _attackNonMember(seed);
        else if (kind == 4) _attackDoubleContribution(seed);
        else if (kind == 5) _attackCloseNotReady(seed);
        else if (kind == 6) _attackRotationNotOrganiser(seed);
        else if (kind == 7) _attackForgedInvite(seed);
        else if (kind == 8) _attackPayoutWrongAmount(seed);
        else _attackWrongRound(seed);
    }

    function _attackReplay(uint256 seed) internal {
        uint256 n = handler.usedFixturesLength();
        if (n == 0) return;
        KittyLedgerHandler.Fixture memory f = handler.usedFixture(seed % n);
        uint64[] memory hs = new uint64[](1);
        hs[0] = f.height;
        bytes[] memory txs = new bytes[](1);
        txs[0] = f.encodedTx;
        INativeQueryVerifier.MerkleProof[] memory ps = new INativeQueryVerifier.MerkleProof[](1);
        ps[0] = f.proof;
        try ledger.recordContributions(CHAIN_KEY, hs, txs, ps, TxFixtures.continuity()) {
            _flagAttack("replayed proof accepted");
        } catch {}
    }

    function _attackSpoofedEmitter(uint256 seed) internal {
        (uint256 id, bool ok) = handler.pickActiveClosedInvites(seed);
        if (!ok) return;
        KittyLedger.Circle memory c = ledger.getCircle(id);
        address m = c.members[seed % c.members.length];
        bytes memory tx_ = TxFixtures.contribution(mallory, m, id, c.currentRound, c.contribution);
        _mustRevertRecord(c.startHeight + 1, tx_, "spoofed emitter accepted");
    }

    function _attackWrongAmount(uint256 seed) internal {
        (uint256 id, bool ok) = handler.pickActiveClosedInvites(seed);
        if (!ok) return;
        KittyLedger.Circle memory c = ledger.getCircle(id);
        address m = c.members[seed % c.members.length];
        uint256 amt = c.contribution == 1 ? 2 : c.contribution - 1;
        bytes memory tx_ = TxFixtures.contribution(vault, m, id, c.currentRound, amt);
        _mustRevertRecord(c.startHeight + 1, tx_, "wrong amount accepted");
    }

    function _attackNonMember(uint256 seed) internal {
        (uint256 id, bool ok) = handler.pickActiveClosedInvites(seed);
        if (!ok) return;
        KittyLedger.Circle memory c = ledger.getCircle(id);
        address outsider = mallory;
        for (uint256 i; i < N_ACTORS; ++i) {
            if (!ledger.isMember(id, handler.actors(i))) {
                outsider = handler.actors(i);
                break;
            }
        }
        bytes memory tx_ = TxFixtures.contribution(vault, outsider, id, c.currentRound, c.contribution);
        _mustRevertRecord(c.startHeight + 1, tx_, "non-member contribution accepted");
    }

    function _attackDoubleContribution(uint256 seed) internal {
        (uint256 id, bool ok) = handler.pickActiveClosedInvites(seed);
        if (!ok) return;
        KittyLedger.Circle memory c = ledger.getCircle(id);
        uint32 r = c.currentRound;
        for (uint256 i; i < c.members.length; ++i) {
            address m = c.members[i];
            if (ledger.getContribution(id, r, m).queryId != bytes32(0)) {
                bytes memory tx_ = TxFixtures.contribution(vault, m, id, r, c.contribution);
                _mustRevertRecord(c.startHeight + 2, tx_, "second contribution by the same member accepted");
                return;
            }
        }
    }

    function _attackCloseNotReady(uint256 seed) internal {
        (uint256 id, bool ok) = handler.pickCircle(seed, false);
        if (!ok) return;
        KittyLedger.Circle memory c = ledger.getCircle(id);
        if (c.status == KittyLedger.CircleStatus.Completed) {
            try ledger.closeRound(id) {
                _flagAttack("closeRound on a Completed circle succeeded");
            } catch {}
            return;
        }
        if (c.open) {
            try ledger.closeRound(id) {
                _flagAttack("closeRound on an open-invite circle succeeded");
            } catch {}
            return;
        }
        uint32 r = c.currentRound;
        KittyLedger.Round memory rd = ledger.getRound(id, r);
        if (rd.contributions < c.members.length && handler.frontier() < ledger.closeHeight(id, r)) {
            try ledger.closeRound(id) {
                _flagAttack("closeRound before the deadline was attested succeeded");
            } catch {}
        }
    }

    function _attackRotationNotOrganiser(uint256 seed) internal {
        (uint256 id, bool ok) = handler.pickCircle(seed, false);
        if (!ok) return;
        KittyLedger.Circle memory c = ledger.getCircle(id);
        address who = c.organiser == mallory ? handler.actors(0) : mallory;
        vm.prank(who);
        try ledger.setRotation(id, KittyLedger.Rotation.ByScore) {
            _flagAttack("non-organiser changed the rotation");
        } catch {}
        // organiser after the first proof
        if (ledger.getRound(id, 0).contributions != 0 || c.currentRound != 0) {
            vm.prank(c.organiser);
            try ledger.setRotation(id, KittyLedger.Rotation.ByScore) {
                _flagAttack("rotation changed after the first proof");
            } catch {}
        }
    }

    function _attackForgedInvite(uint256 seed) internal {
        (uint256 id, bool ok) = handler.pickCircle(seed, true);
        if (!ok) return;
        address invitee = address(uint160(0xF00D + (seed % 1000)));
        uint256 nonce = 1_000_000 + (seed % 1000);
        bytes memory sig = _sign(malloryPk, ledger.inviteDigest(id, invitee, nonce));
        vm.prank(invitee);
        try ledger.redeemInvite(id, nonce, sig) {
            _flagAttack("invite signed by a non-organiser accepted");
        } catch {}
    }

    function _attackPayoutWrongAmount(uint256 seed) internal {
        (uint256 id, bool ok) = handler.pickCircle(seed, false);
        if (!ok) return;
        KittyLedger.Circle memory c = ledger.getCircle(id);
        uint32 last = c.status == KittyLedger.CircleStatus.Completed ? uint32(c.members.length - 1) : c.currentRound;
        for (uint32 r; r <= last; ++r) {
            KittyLedger.Round memory rd = ledger.getRound(id, r);
            if (rd.status != KittyLedger.RoundStatus.Closed) continue;
            address to = rd.recipient == address(0) ? mallory : rd.recipient;
            uint64 h = uint64(seed % (uint256(type(uint64).max) - 1));
            bytes memory tx_ = TxFixtures.payout(vault, operator, to, id, r, rd.pot + 1);
            (INativeQueryVerifier.MerkleProof memory p,) = _freshProof(h);
            try ledger.confirmPayout(CHAIN_KEY, h, tx_, p, TxFixtures.continuity()) {
                _flagAttack("payout with the wrong amount confirmed");
            } catch {}
            if (rd.recipient != address(0)) {
                tx_ = TxFixtures.payout(vault, operator, mallory, id, r, rd.pot);
                (p,) = _freshProof(h + 1);
                try ledger.confirmPayout(CHAIN_KEY, h + 1, tx_, p, TxFixtures.continuity()) {
                    _flagAttack("payout to the wrong recipient confirmed");
                } catch {}
            }
            return;
        }
    }

    function _attackWrongRound(uint256 seed) internal {
        (uint256 id, bool ok) = handler.pickActiveClosedInvites(seed);
        if (!ok) return;
        KittyLedger.Circle memory c = ledger.getCircle(id);
        address m = c.members[seed % c.members.length];
        bytes memory tx_ = TxFixtures.contribution(vault, m, id, c.currentRound + 1, c.contribution);
        _mustRevertRecord(c.startHeight + 1, tx_, "contribution for a future round accepted");
        if (c.startHeight > 0) {
            tx_ = TxFixtures.contribution(vault, m, id, c.currentRound, c.contribution);
            _mustRevertRecord(c.startHeight - 1, tx_, "contribution mined before startHeight accepted");
        }
    }

    // ───────────── helpers ─────────────

    function _mustRevertRecord(uint64 height, bytes memory tx_, string memory label) internal {
        uint64[] memory hs = new uint64[](1);
        hs[0] = height;
        bytes[] memory txs = new bytes[](1);
        txs[0] = tx_;
        INativeQueryVerifier.MerkleProof[] memory ps = new INativeQueryVerifier.MerkleProof[](1);
        (ps[0],) = _freshProof(height);
        try ledger.recordContributions(CHAIN_KEY, hs, txs, ps, TxFixtures.continuity()) {
            _flagAttack(label);
        } catch {}
    }

    function _flagAttack(string memory label) internal {
        attackSucceeded = true;
        attackLabel = label;
    }

    /// @dev Any never-processed proof will do: an attack must revert before its query id is stored.
    function _freshProof(uint64) internal returns (INativeQueryVerifier.MerkleProof memory p, bytes32) {
        p = TxFixtures.merkle(seedNonce++);
        return (p, bytes32(0));
    }

    function _sign(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }
}
