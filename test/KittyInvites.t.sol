// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {KittyLedger} from "../src/asc/KittyLedger.sol";
import {INativeQueryVerifier} from "@gluwa/asc-contracts/contracts/write-ability/common/INativeQueryVerifier.sol";
import {MockVerifier} from "./mocks/MockVerifier.sol";
import {MockChainInfo} from "./mocks/MockChainInfo.sol";
import {TxFixtures} from "./TxFixtures.sol";

contract KittyInvitesTest is Test {
    address constant VERIFIER_PRECOMPILE = 0x0000000000000000000000000000000000000FD2;
    address constant CHAIN_INFO_PRECOMPILE = 0x0000000000000000000000000000000000000fD3;
    uint64 constant CHAIN_KEY = 1;

    KittyLedger ledger;
    MockVerifier verifier;
    MockChainInfo chainInfo;

    address vault = address(0xFA11);
    uint256 organiserPk = 0xA11CE;
    uint256 malloryPk = 0xBAD;
    address organiser;
    address mallory;
    address bob = address(0xB0B);
    address carol = address(0xCA201);
    address dave = address(0xDA7E);

    uint256 constant AMOUNT = 100e6;
    uint64 constant START = 1_000;
    uint64 constant ROUND_BLOCKS = 50;
    uint32 constant MAX = 3;
    uint256 circleId;

    function setUp() public {
        vm.etch(VERIFIER_PRECOMPILE, address(new MockVerifier()).code);
        vm.etch(CHAIN_INFO_PRECOMPILE, address(new MockChainInfo()).code);
        verifier = MockVerifier(VERIFIER_PRECOMPILE);
        chainInfo = MockChainInfo(CHAIN_INFO_PRECOMPILE);
        verifier.setAccept(true);
        organiser = vm.addr(organiserPk);
        mallory = vm.addr(malloryPk);

        ledger = new KittyLedger(CHAIN_KEY);
        ledger.setTrustedVault(vault, true);
        vm.prank(organiser);
        circleId = ledger.createOpenCircle("Open Susu", AMOUNT, ROUND_BLOCKS, START, vault, MAX);
    }

    // ───────────── helpers ─────────────

    function _invite(uint256 pk, address invitee, uint256 nonce) internal view returns (bytes memory sig) {
        bytes32 digest = ledger.inviteDigest(circleId, invitee, nonce);
        // Digest must be EIP-191 over (ledger, chainid, circleId, invitee, nonce).
        bytes32 raw = keccak256(abi.encodePacked(address(ledger), block.chainid, circleId, invitee, nonce));
        assertEq(digest, keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", raw)));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        sig = abi.encodePacked(r, s, v);
    }

    function _join(address who, uint256 nonce) internal {
        bytes memory sig = _invite(organiserPk, who, nonce);
        vm.prank(who);
        ledger.redeemInvite(circleId, nonce, sig);
    }

    function _recordOne(address who, uint64 height) internal {
        bytes[] memory txs = new bytes[](1);
        txs[0] = TxFixtures.contribution(vault, who, circleId, 0, AMOUNT);
        INativeQueryVerifier.MerkleProof[] memory proofs = new INativeQueryVerifier.MerkleProof[](1);
        proofs[0] = TxFixtures.merkle(uint256(keccak256(abi.encode(who, height))));
        uint64[] memory hs = new uint64[](1);
        hs[0] = height;
        ledger.recordContributions(CHAIN_KEY, hs, txs, proofs, TxFixtures.continuity());
    }

    // ───────────── creation ─────────────

    function test_createOpenCircle_onlyOrganiserIsMember() public view {
        KittyLedger.Circle memory c = ledger.getCircle(circleId);
        assertEq(c.members.length, 1);
        assertEq(c.members[0], organiser);
        assertEq(c.organiser, organiser);
        assertTrue(c.open);
        assertEq(c.maxMembers, MAX);
        assertTrue(ledger.isMember(circleId, organiser));
        uint256[] memory mine = ledger.getMemberCircles(organiser);
        assertEq(mine.length, 1);
        assertEq(mine[0], circleId);
    }

    function test_createCircle_recordsOrganiserAndIndex() public {
        address[] memory members = new address[](2);
        members[0] = bob;
        members[1] = carol;
        vm.prank(mallory);
        uint256 id = ledger.createCircle("Closed", members, AMOUNT, ROUND_BLOCKS, START, vault);
        KittyLedger.Circle memory c = ledger.getCircle(id);
        assertEq(c.organiser, mallory);
        assertFalse(c.open);
        assertEq(c.maxMembers, 2);
        assertTrue(ledger.isMember(id, bob));
        assertEq(ledger.getMemberCircles(bob).length, 0, "listed, not yet consented: not on bob's dashboard");
        vm.prank(bob);
        ledger.acceptMembership(id);
        assertEq(ledger.getMemberCircles(bob).length, 1);
        assertEq(ledger.getMemberCircles(bob)[0], id);
        assertEq(ledger.getMemberCircles(mallory).length, 0, "organiser is not auto-member of a closed circle");
    }

    // ───────────── redeemInvite ─────────────

    function test_redeemInvite_validSignatureJoins() public {
        bytes memory sig = _invite(organiserPk, bob, 1);
        vm.expectEmit(true, true, false, true);
        emit KittyLedger.InviteRedeemed(circleId, bob, 1);
        vm.prank(bob);
        ledger.redeemInvite(circleId, 1, sig);

        assertTrue(ledger.isMember(circleId, bob));
        assertTrue(ledger.usedInviteNonces(circleId, 1));
        KittyLedger.Circle memory c = ledger.getCircle(circleId);
        assertEq(c.members.length, 2);
        assertEq(c.members[1], bob, "join order = rotation order");
        assertEq(ledger.getMemberCircles(bob)[0], circleId);
    }

    /// @dev Consent griefing: an organiser must not be able to open an invite circle whose round 0 is
    ///      already over on the source chain, collect consent via invites, and close the round on every
    ///      invitee as `missed`. The frontier bound at creation is what closes the hole.
    function test_redeemInvite_cannotBeGriefedByPastStart() public {
        uint64 frontier = START + ROUND_BLOCKS + 64; // round 0 of a START circle is closable right now
        chainInfo.setAttestedHeight(CHAIN_KEY, frontier);
        vm.prank(organiser);
        vm.expectRevert(abi.encodeWithSelector(KittyLedger.InvalidCircle.selector, "round 0 already attested"));
        ledger.createOpenCircle("Trap", AMOUNT, ROUND_BLOCKS, START, vault, MAX);

        // The organiser can only open a circle whose first deadline lies beyond the frontier ...
        vm.prank(organiser);
        circleId = ledger.createOpenCircle("Fair", AMOUNT, ROUND_BLOCKS, frontier, vault, MAX);
        _join(bob, 1);
        assertTrue(ledger.accepted(circleId, bob));
        vm.prank(organiser);
        ledger.closeInvites(circleId);

        // ... so bob cannot be marked missed before that deadline (plus grace) is actually attested.
        uint64 closeAt = ledger.closeHeight(circleId, 0);
        assertGt(closeAt, frontier);
        vm.expectRevert(abi.encodeWithSelector(KittyLedger.RoundStillOpenOnSource.selector, closeAt));
        ledger.closeRound(circleId);
        assertEq(ledger.getRecord(bob).missed, 0);
    }

    function test_redeemInvite_rejectsWrongSigner() public {
        bytes memory sig = _invite(malloryPk, bob, 1);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(KittyLedger.InvalidInviteSigner.selector, mallory, organiser));
        ledger.redeemInvite(circleId, 1, sig);
    }

    function test_redeemInvite_rejectsInviteForSomeoneElse() public {
        bytes memory sigForBob = _invite(organiserPk, bob, 1);
        vm.prank(carol); // carol steals bob's invite → recovers to a random address
        vm.expectRevert();
        ledger.redeemInvite(circleId, 1, sigForBob);
        assertFalse(ledger.isMember(circleId, carol));
    }

    function test_redeemInvite_rejectsNonceReplay() public {
        _join(bob, 7);
        bytes memory sig = _invite(organiserPk, carol, 7); // fresh sig, reused nonce
        vm.prank(carol);
        vm.expectRevert(abi.encodeWithSelector(KittyLedger.InviteAlreadyUsed.selector, circleId, 7));
        ledger.redeemInvite(circleId, 7, sig);

        // and the same member cannot redeem twice under a fresh nonce
        bytes memory sig2 = _invite(organiserPk, bob, 8);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(KittyLedger.AlreadyMember.selector, circleId, bob));
        ledger.redeemInvite(circleId, 8, sig2);
    }

    function test_redeemInvite_rejectsAfterCloseInvites() public {
        _join(bob, 1);
        vm.prank(organiser);
        ledger.closeInvites(circleId);
        assertFalse(ledger.getCircle(circleId).open);
        assertEq(ledger.getCircle(circleId).maxMembers, 2, "cap snaps to actual size");

        bytes memory sig = _invite(organiserPk, carol, 2);
        vm.prank(carol);
        vm.expectRevert(abi.encodeWithSelector(KittyLedger.CircleNotOpen.selector, circleId));
        ledger.redeemInvite(circleId, 2, sig);
    }

    function test_redeemInvite_rejectsAfterFirstContribution() public {
        _join(bob, 1);
        vm.prank(organiser);
        ledger.closeInvites(circleId);
        _recordOne(bob, 1_010);
        assertEq(ledger.getRound(circleId, 0).contributions, 1);

        // Circle is closed, so CircleNotOpen fires first — the contribution guard is defense in depth.
        bytes memory sig = _invite(organiserPk, carol, 2);
        vm.prank(carol);
        vm.expectRevert(abi.encodeWithSelector(KittyLedger.CircleNotOpen.selector, circleId));
        ledger.redeemInvite(circleId, 2, sig);
    }

    function test_redeemInvite_enforcesMaxMembers() public {
        _join(bob, 1);
        _join(carol, 2);
        bytes memory sig = _invite(organiserPk, dave, 3);
        vm.prank(dave);
        vm.expectRevert(abi.encodeWithSelector(KittyLedger.CircleFull.selector, circleId, MAX));
        ledger.redeemInvite(circleId, 3, sig);
    }

    function test_redeemInvite_unknownCircle() public {
        bytes memory sig = _invite(organiserPk, bob, 1);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(KittyLedger.UnknownCircle.selector, 99));
        ledger.redeemInvite(99, 1, sig);
    }

    // ───────────── closeInvites ─────────────

    function test_closeInvites_onlyOrganiser() public {
        _join(bob, 1);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(KittyLedger.NotOrganiser.selector, circleId));
        ledger.closeInvites(circleId);
    }

    function test_closeInvites_requiresTwoMembers() public {
        vm.prank(organiser);
        vm.expectRevert(abi.encodeWithSelector(KittyLedger.InvalidCircle.selector, "2..10 members"));
        ledger.closeInvites(circleId);
    }

    function test_closeInvites_twiceReverts() public {
        _join(bob, 1);
        vm.startPrank(organiser);
        ledger.closeInvites(circleId);
        vm.expectRevert(abi.encodeWithSelector(KittyLedger.InvitesAlreadyClosed.selector, circleId));
        ledger.closeInvites(circleId);
        vm.stopPrank();
    }

    // ───────────── open circles cannot settle ─────────────

    function test_recordContributions_revertsWhileOpen() public {
        _join(bob, 1);
        bytes[] memory txs = new bytes[](1);
        txs[0] = TxFixtures.contribution(vault, bob, circleId, 0, AMOUNT);
        INativeQueryVerifier.MerkleProof[] memory proofs = new INativeQueryVerifier.MerkleProof[](1);
        proofs[0] = TxFixtures.merkle(1);
        uint64[] memory hs = new uint64[](1);
        hs[0] = 1_010;
        vm.expectRevert(abi.encodeWithSelector(KittyLedger.CircleStillOpen.selector, circleId));
        ledger.recordContributions(CHAIN_KEY, hs, txs, proofs, TxFixtures.continuity());

        vm.expectRevert(abi.encodeWithSelector(KittyLedger.CircleStillOpen.selector, circleId));
        ledger.closeRound(circleId);
    }

    function test_openCircle_fullLifecycleAfterClose() public {
        _join(bob, 1);
        _join(carol, 2);
        vm.prank(organiser);
        ledger.closeInvites(circleId);

        _recordOne(organiser, 1_010);
        _recordOne(bob, 1_011);
        _recordOne(carol, 1_012);
        ledger.closeRound(circleId);
        KittyLedger.Round memory rd = ledger.getRound(circleId, 0);
        assertEq(rd.recipient, organiser, "organiser joined first receives round 0");
        assertEq(rd.pot, 3 * AMOUNT);
        assertEq(ledger.getCircle(circleId).currentRound, 1);
    }
}
