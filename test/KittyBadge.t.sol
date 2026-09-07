// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC721Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {INativeQueryVerifier} from "@gluwa/asc-contracts/contracts/write-ability/common/INativeQueryVerifier.sol";
import {KittyLedger} from "../src/asc/KittyLedger.sol";
import {KittyBadge, IERC5192} from "../src/asc/KittyBadge.sol";
import {MockVerifier} from "./mocks/MockVerifier.sol";
import {MockChainInfo} from "./mocks/MockChainInfo.sol";
import {TxFixtures} from "./TxFixtures.sol";

contract KittyBadgeTest is Test {
    address constant VERIFIER_PRECOMPILE = 0x0000000000000000000000000000000000000FD2;
    address constant CHAIN_INFO_PRECOMPILE = 0x0000000000000000000000000000000000000fD3;
    uint64 constant CHAIN_KEY = 1;
    uint64 constant START = 1_000;
    uint64 constant ROUND_BLOCKS = 50;
    uint256 constant AMOUNT = 100e6;

    KittyLedger ledger;
    KittyBadge badge;
    address vault = address(0xFA11);
    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    uint256 circleId;

    function setUp() public {
        vm.etch(VERIFIER_PRECOMPILE, address(new MockVerifier()).code);
        vm.etch(CHAIN_INFO_PRECOMPILE, address(new MockChainInfo()).code);
        MockVerifier(VERIFIER_PRECOMPILE).setAccept(true);
        ledger = new KittyLedger(CHAIN_KEY);
        badge = new KittyBadge(ledger);
        address[] memory members = new address[](2);
        members[0] = alice;
        members[1] = bob;
        circleId = ledger.createCircle("pair", members, AMOUNT, ROUND_BLOCKS, START, vault);
    }

    function _pay(address who, uint32 round) internal {
        uint64[] memory hs = new uint64[](1);
        hs[0] = START + round * ROUND_BLOCKS + 1;
        bytes[] memory txs = new bytes[](1);
        txs[0] = TxFixtures.contribution(vault, who, circleId, round, AMOUNT);
        INativeQueryVerifier.MerkleProof[] memory proofs = new INativeQueryVerifier.MerkleProof[](1);
        proofs[0] = TxFixtures.merkle(uint256(keccak256(abi.encode(who, round))));
        ledger.recordContributions(CHAIN_KEY, hs, txs, proofs, TxFixtures.continuity());
    }

    function _payRound(uint32 round) internal {
        _pay(alice, round);
        _pay(bob, round);
        ledger.closeRound(circleId);
    }

    // ───────────── claim ─────────────

    function test_claimRequiresProvenHistory() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(KittyBadge.NoProvenHistory.selector, alice));
        badge.claim();
        assertFalse(badge.hasClaimed(alice));
    }

    function test_claimMintsOneSoulboundBadge() public {
        _pay(alice, 0);
        uint256 expectedId = uint256(uint160(alice));
        assertEq(badge.tokenIdOf(alice), expectedId);

        vm.prank(alice);
        vm.expectEmit(false, false, false, true);
        emit IERC5192.Locked(expectedId);
        uint256 id = badge.claim();

        assertEq(id, expectedId);
        assertEq(badge.ownerOf(id), alice);
        assertEq(badge.balanceOf(alice), 1);
        assertTrue(badge.locked(id));
        assertTrue(badge.hasClaimed(alice));
        assertTrue(badge.supportsInterface(type(IERC5192).interfaceId));
        assertTrue(badge.supportsInterface(0xb45a3c0e), "ERC-5192 interface id");
        assertTrue(badge.supportsInterface(0x80ac58cd), "ERC-721");

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(KittyBadge.AlreadyClaimed.selector, alice));
        badge.claim();
        assertEq(badge.balanceOf(alice), 1);
    }

    function test_lockedRevertsForUnknownToken() public {
        vm.expectRevert(abi.encodeWithSelector(IERC721Errors.ERC721NonexistentToken.selector, uint256(uint160(bob))));
        badge.locked(uint256(uint160(bob)));
    }

    // ───────────── soulbound ─────────────

    function test_transfersAndApprovalsRevert() public {
        _pay(alice, 0);
        vm.prank(alice);
        uint256 id = badge.claim();

        vm.startPrank(alice);
        vm.expectRevert(KittyBadge.Soulbound.selector);
        badge.transferFrom(alice, bob, id);
        vm.expectRevert(KittyBadge.Soulbound.selector);
        badge.safeTransferFrom(alice, bob, id);
        vm.expectRevert(KittyBadge.Soulbound.selector);
        badge.approve(bob, id);
        vm.expectRevert(KittyBadge.Soulbound.selector);
        badge.setApprovalForAll(bob, true);
        vm.stopPrank();
        assertEq(badge.ownerOf(id), alice);
    }

    // ───────────── live metadata ─────────────

    function test_tokenURIReflectsLiveScore() public {
        _pay(alice, 0); // 515
        vm.prank(alice);
        uint256 id = badge.claim();

        string memory uri = badge.tokenURI(id);
        string memory prefix = "data:application/json;base64,";
        assertEq(vm.indexOf(uri, prefix), 0, "data URI prefix");
        string memory json = string(_b64decode(_after(uri, bytes(prefix).length)));
        assertEq(json, badge.metadata(id), "URI decodes to the on-chain JSON");
        assertTrue(vm.contains(json, '"name":"Kitty Score 515 (C)"'));
        assertTrue(vm.contains(json, '{"trait_type":"score","value":515}'));
        assertTrue(vm.contains(json, '{"trait_type":"on_time","value":1}'));
        assertTrue(vm.contains(json, '{"trait_type":"missed","value":0}'));
        assertTrue(vm.contains(json, '"image":"data:image/svg+xml;base64,'));

        string memory svg = badge.image(id);
        assertEq(vm.indexOf(svg, '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="240"'), 0);
        assertTrue(vm.contains(svg, "#0E1512"));
        assertTrue(vm.contains(svg, "#4FD1A3"));
        assertTrue(vm.contains(svg, ">515</text>"));
        assertTrue(vm.contains(svg, "TIER C"));
        assertTrue(vm.contains(svg, "on-time 1  /  late 0  /  missed 0"));
        assertTrue(vm.contains(svg, "proven on Creditcoin via Attestcoin"));
        // The JSON embeds the same SVG, base64-encoded.
        assertTrue(vm.contains(json, vm.toBase64(bytes(svg))));

        // Another proven contribution lands; the badge changes without any re-mint.
        _pay(bob, 0);
        ledger.closeRound(circleId);
        _pay(alice, 1); // 530
        string memory uri2 = badge.tokenURI(id);
        assertTrue(keccak256(bytes(uri2)) != keccak256(bytes(uri)), "URI changes with history");
        string memory json2 = string(_b64decode(_after(uri2, bytes(prefix).length)));
        assertTrue(vm.contains(json2, '{"trait_type":"score","value":530}'));
        assertTrue(vm.contains(json2, '{"trait_type":"on_time","value":2}'));
        assertTrue(vm.contains(json2, '{"trait_type":"proven_volume_usd","value":200}'));
        assertTrue(vm.contains(badge.image(id), ">530</text>"));

        // And bob, who has now paid, can claim his own.
        vm.prank(bob);
        badge.claim();
        assertTrue(vm.contains(badge.metadata(uint256(uint160(bob))), '"score","value":515'));
    }

    function test_tokenURIRevertsForUnminted() public {
        vm.expectRevert(abi.encodeWithSelector(IERC721Errors.ERC721NonexistentToken.selector, uint256(uint160(alice))));
        badge.tokenURI(uint256(uint160(alice)));
    }

    // ───────────── base64 helpers (foundry only encodes) ─────────────

    function _after(string memory s, uint256 from) internal pure returns (bytes memory out) {
        bytes memory b = bytes(s);
        out = new bytes(b.length - from);
        for (uint256 i; i < out.length; ++i) {
            out[i] = b[from + i];
        }
    }

    function _b64decode(bytes memory data) internal pure returns (bytes memory out) {
        uint256 len = data.length;
        require(len % 4 == 0, "bad base64 length");
        uint256 pad;
        if (len > 0 && data[len - 1] == "=") pad++;
        if (len > 1 && data[len - 2] == "=") pad++;
        out = new bytes((len / 4) * 3 - pad);
        uint256 o;
        for (uint256 i; i < len; i += 4) {
            uint256 n = (_val(data[i]) << 18) | (_val(data[i + 1]) << 12) | (_val(data[i + 2]) << 6) | _val(data[i + 3]);
            if (o < out.length) out[o++] = bytes1(uint8(n >> 16));
            if (o < out.length) out[o++] = bytes1(uint8(n >> 8));
            if (o < out.length) out[o++] = bytes1(uint8(n));
        }
    }

    function _val(bytes1 c) internal pure returns (uint256) {
        uint8 u = uint8(c);
        if (u >= 65 && u <= 90) return u - 65; // A-Z
        if (u >= 97 && u <= 122) return u - 71; // a-z
        if (u >= 48 && u <= 57) return u + 4; // 0-9
        if (c == "+") return 62;
        if (c == "/") return 63;
        return 0; // '='
    }
}
