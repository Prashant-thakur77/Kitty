// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console2} from "forge-std/Test.sol";
import {KittyLedger} from "../src/asc/KittyLedger.sol";
import {KittyVault} from "../src/source/KittyVault.sol";
import {TestUSD} from "../src/source/TestUSD.sol";
import {INativeQueryVerifier} from "@gluwa/asc-contracts/contracts/write-ability/common/INativeQueryVerifier.sol";
import {MockVerifier} from "./mocks/MockVerifier.sol";
import {MockChainInfo} from "./mocks/MockChainInfo.sol";
import {TxFixtures} from "./TxFixtures.sol";

/// @notice Gas measurements behind docs/GAS.md.
///
///         `setUp` (its own transaction) prepares every scenario; each test body then makes exactly
///         ONE external call and prints its execution gas (`gasleft()` delta around the call: cold
///         storage, includes the CALL, excludes the 21k intrinsic cost and calldata). That mirrors a
///         real transaction far better than measuring several calls inside one test, where storage
///         written by an earlier call is warm for the next.
///
///         The precompiles are mocks, so ledger figures are the contract's own cost on top of proof
///         verification; README's "Gas, measured" holds the live-precompile figures.
///         Run: `forge test --match-contract KittyGasTest -vv`
contract KittyGasTest is Test {
    address constant VERIFIER_PRECOMPILE = 0x0000000000000000000000000000000000000FD2;
    address constant CHAIN_INFO_PRECOMPILE = 0x0000000000000000000000000000000000000fD3;
    uint64 constant CHAIN_KEY = 1;
    uint256 constant AMOUNT = 100e6;
    uint64 constant ROUND_BLOCKS = 50;
    // Two start heights: EARLY circles get their deadline attested in setUp (deadline path), LATE
    // circles stay ahead of the frontier so they can still be created / closed early.
    uint64 constant START_EARLY = 1_000;
    uint64 constant START_LATE = 10_000;

    KittyLedger ledger;
    MockChainInfo chainInfo;
    address vault = address(0xFA11);
    address operator = address(0x0BE7);
    uint256 organiserPk = 0xA11CE;
    address organiser;
    address bob = address(0xB0B);
    uint256 seedNonce = 1;

    TestUSD usd;
    KittyVault realVault;
    address alice = address(0xA11CE);

    // scenarios
    uint256 cEarlyFixed; // 3 members, all paid round 0
    uint256 cEarlyByScore; // 3 members, ByScore, all paid round 0
    uint256 cDeadline3; // 3 members, 1 paid, 2 consented → 2 misses; deadline attested
    uint256 cDeadline10; // 10 members, 1 paid, 9 consented → 9 misses; deadline attested
    uint256 cFinal; // 3 members, rounds 0-1 closed, round 2 all paid
    uint256 cBatch1; // fresh members: every record slot is zero → worst case
    uint256 cBatch3;
    uint256 cBatch10;
    uint256 cBatch1History; // members that already hold a record (steady state)
    uint256 cBatch10History;
    uint256 cPayout; // round 0 closed with recipient
    uint256[3] cPayouts; // three closed circles for the batch payout
    uint256 cOpen; // open invite circle, organiser only
    uint256 cOpenFull; // open invite circle with 2 members, ready to close
    uint256 cListed; // listed circle for acceptMembership / setRotation
    bytes inviteSig;

    function setUp() public {
        vm.etch(VERIFIER_PRECOMPILE, address(new MockVerifier()).code);
        vm.etch(CHAIN_INFO_PRECOMPILE, address(new MockChainInfo()).code);
        chainInfo = MockChainInfo(CHAIN_INFO_PRECOMPILE);
        MockVerifier(VERIFIER_PRECOMPILE).setAccept(true);
        organiser = vm.addr(organiserPk);
        ledger = new KittyLedger(CHAIN_KEY);
        ledger.setTrustedVault(vault, true);

        address[] memory three = _members(3);
        address[] memory ten = _members(10);

        cEarlyFixed = _create(3, START_LATE);
        _record(cEarlyFixed, three, 0);

        cEarlyByScore = _create(3, START_LATE);
        vm.prank(organiser);
        ledger.setRotation(cEarlyByScore, KittyLedger.Rotation.ByScore);
        _record(cEarlyByScore, three, 0);

        cDeadline3 = _create(3, START_EARLY);
        _record(cDeadline3, _slice(three, 1), 0);
        for (uint256 i = 1; i < 3; ++i) {
            vm.prank(three[i]);
            ledger.acceptMembership(cDeadline3);
        }

        cDeadline10 = _create(10, START_EARLY);
        _record(cDeadline10, _slice(ten, 1), 0);
        for (uint256 i = 1; i < 10; ++i) {
            vm.prank(ten[i]);
            ledger.acceptMembership(cDeadline10);
        }

        cFinal = _create(3, START_LATE);
        for (uint32 r; r < 2; ++r) {
            _record(cFinal, three, r);
            ledger.closeRound(cFinal);
        }
        _record(cFinal, three, 2);

        cBatch1 = _createAt(0x3000, 10, START_LATE);
        cBatch3 = _createAt(0x4000, 10, START_LATE);
        cBatch10 = _createAt(0x5000, 10, START_LATE);
        // give all of `ten` (0x1000..) a record so the history variants are truly steady-state
        uint256 warmup = _create(10, START_LATE);
        _record(warmup, ten, 0);
        cBatch1History = _create(10, START_LATE);
        cBatch10History = _create(10, START_LATE);

        cPayout = _create(3, START_LATE);
        _record(cPayout, three, 0);
        ledger.closeRound(cPayout);
        for (uint256 i; i < 3; ++i) {
            cPayouts[i] = _create(3, START_LATE);
            _record(cPayouts[i], three, 0);
            ledger.closeRound(cPayouts[i]);
        }

        vm.prank(organiser);
        cOpen = ledger.createOpenCircle("gas", AMOUNT, ROUND_BLOCKS, START_LATE, vault, 5);
        (uint8 v, bytes32 r_, bytes32 s) = vm.sign(organiserPk, ledger.inviteDigest(cOpen, bob, 1));
        inviteSig = abi.encodePacked(r_, s, v);

        vm.prank(organiser);
        cOpenFull = ledger.createOpenCircle("gas", AMOUNT, ROUND_BLOCKS, START_LATE, vault, 5);
        (v, r_, s) = vm.sign(organiserPk, ledger.inviteDigest(cOpenFull, bob, 1));
        vm.prank(bob);
        ledger.redeemInvite(cOpenFull, 1, abi.encodePacked(r_, s, v));

        cListed = _create(3, START_LATE);

        // deadline for the EARLY circles is now attested; LATE circles are untouched
        chainInfo.setAttestedHeight(CHAIN_KEY, ledger.closeHeight(cDeadline10, 0));

        // source chain
        usd = new TestUSD();
        realVault = new KittyVault(usd, operator);
        usd.mint(alice, 1_000e6);
        usd.mint(bob, 1_000e6);
        vm.prank(alice);
        usd.approve(address(realVault), type(uint256).max);
        vm.prank(bob);
        usd.approve(address(realVault), type(uint256).max);
        vm.prank(bob);
        realVault.contribute(2, 0, AMOUNT); // circle 2 pot is non-zero; alice has never paid into it
        vm.prank(alice);
        realVault.contribute(3, 0, AMOUNT); // circle 3: alice is a contributor, payout target
    }

    // ───────────── helpers ─────────────

    function _members(uint256 n) internal pure returns (address[] memory m) {
        return _membersAt(0x1000, n);
    }

    function _membersAt(uint256 base, uint256 n) internal pure returns (address[] memory m) {
        m = new address[](n);
        for (uint256 i; i < n; ++i) {
            m[i] = address(uint160(base + i));
        }
    }

    function _create(uint256 n, uint64 start) internal returns (uint256 id) {
        return _createAt(0x1000, n, start);
    }

    function _createAt(uint256 base, uint256 n, uint64 start) internal returns (uint256 id) {
        vm.prank(organiser);
        id = ledger.createCircle("gas", _membersAt(base, n), AMOUNT, ROUND_BLOCKS, start, vault);
    }

    function _batch(uint256 id, address[] memory who, uint32 round)
        internal
        returns (uint64[] memory hs, bytes[] memory txs, INativeQueryVerifier.MerkleProof[] memory ps)
    {
        uint64 start = ledger.getCircle(id).startHeight;
        hs = new uint64[](who.length);
        txs = new bytes[](who.length);
        ps = new INativeQueryVerifier.MerkleProof[](who.length);
        for (uint256 i; i < who.length; ++i) {
            hs[i] = start + uint64(round) * ROUND_BLOCKS + 1 + uint64(i);
            txs[i] = TxFixtures.contribution(vault, who[i], id, round, AMOUNT);
            ps[i] = TxFixtures.merkle(seedNonce++);
        }
    }

    function _record(uint256 id, address[] memory who, uint32 round) internal {
        (uint64[] memory hs, bytes[] memory txs, INativeQueryVerifier.MerkleProof[] memory ps) = _batch(id, who, round);
        ledger.recordContributions(CHAIN_KEY, hs, txs, ps, TxFixtures.continuity());
    }

    function _measuredRecord(uint256 id, address[] memory who, string memory label) internal {
        (uint64[] memory hs, bytes[] memory txs, INativeQueryVerifier.MerkleProof[] memory ps) = _batch(id, who, 0);
        INativeQueryVerifier.ContinuityProof memory cont = TxFixtures.continuity();
        uint256 g = gasleft();
        ledger.recordContributions(CHAIN_KEY, hs, txs, ps, cont);
        g -= gasleft();
        _log(label, g);
    }

    function _measuredClose(uint256 id, string memory label) internal {
        uint256 g = gasleft();
        ledger.closeRound(id);
        g -= gasleft();
        _log(label, g);
    }

    function _slice(address[] memory all, uint256 n) internal pure returns (address[] memory r) {
        r = new address[](n);
        for (uint256 i; i < n; ++i) {
            r[i] = all[i];
        }
    }

    function _log(string memory label, uint256 gas) internal pure {
        console2.log(string.concat("GAS ", label), gas);
    }

    // ───────────── circle lifecycle ─────────────

    function test_gas_createCircle3() public {
        address[] memory three = _members(3);
        vm.prank(organiser);
        uint256 g = gasleft();
        ledger.createCircle("gas", three, AMOUNT, ROUND_BLOCKS, START_LATE, vault);
        g -= gasleft();
        _log("createCircle(3 members)", g);
    }

    function test_gas_createCircle10() public {
        address[] memory ten = _members(10);
        vm.prank(organiser);
        uint256 g = gasleft();
        ledger.createCircle("gas", ten, AMOUNT, ROUND_BLOCKS, START_LATE, vault);
        g -= gasleft();
        _log("createCircle(10 members)", g);
    }

    function test_gas_createOpenCircle() public {
        vm.prank(organiser);
        uint256 g = gasleft();
        ledger.createOpenCircle("gas", AMOUNT, ROUND_BLOCKS, START_LATE, vault, 5);
        g -= gasleft();
        _log("createOpenCircle", g);
    }

    function test_gas_redeemInvite() public {
        bytes memory sig = inviteSig;
        vm.prank(bob);
        uint256 g = gasleft();
        ledger.redeemInvite(cOpen, 1, sig);
        g -= gasleft();
        _log("redeemInvite", g);
    }

    function test_gas_closeInvites() public {
        vm.prank(organiser);
        uint256 g = gasleft();
        ledger.closeInvites(cOpenFull);
        g -= gasleft();
        _log("closeInvites", g);
    }

    function test_gas_acceptMembership() public {
        address m = _members(3)[1];
        vm.prank(m);
        uint256 g = gasleft();
        ledger.acceptMembership(cListed);
        g -= gasleft();
        _log("acceptMembership", g);
    }

    function test_gas_setRotation() public {
        vm.prank(organiser);
        uint256 g = gasleft();
        ledger.setRotation(cListed, KittyLedger.Rotation.ByScore);
        g -= gasleft();
        _log("setRotation", g);
    }

    // ───────────── proofs ─────────────

    function test_gas_recordContributions_batch1() public {
        _measuredRecord(cBatch1, _slice(_membersAt(0x3000, 10), 1), "recordContributions(batch=1, first-ever record)");
    }

    function test_gas_recordContributions_batch3() public {
        _measuredRecord(cBatch3, _slice(_membersAt(0x4000, 10), 3), "recordContributions(batch=3, first-ever records)");
    }

    function test_gas_recordContributions_batch10() public {
        _measuredRecord(cBatch10, _membersAt(0x5000, 10), "recordContributions(batch=10, first-ever records)");
    }

    function test_gas_recordContributions_batch1_history() public {
        _measuredRecord(cBatch1History, _slice(_members(10), 1), "recordContributions(batch=1, members with history)");
    }

    function test_gas_recordContributions_batch10_history() public {
        _measuredRecord(cBatch10History, _members(10), "recordContributions(batch=10, members with history)");
    }

    function test_gas_closeRound_earlyFixed() public {
        _measuredClose(cEarlyFixed, "closeRound(early, 3 paid, Fixed)");
    }

    function test_gas_closeRound_earlyByScore() public {
        _measuredClose(cEarlyByScore, "closeRound(early, 3 paid, ByScore)");
    }

    function test_gas_closeRound_deadline3() public {
        _measuredClose(cDeadline3, "closeRound(deadline, 1 paid, 2 missed)");
    }

    function test_gas_closeRound_deadline10() public {
        _measuredClose(cDeadline10, "closeRound(deadline, 1 paid, 9 missed)");
    }

    function test_gas_closeRound_final() public {
        _measuredClose(cFinal, "closeRound(final round -> Completed)");
    }

    function test_gas_confirmPayout() public {
        KittyLedger.Round memory rd = ledger.getRound(cPayout, 0);
        bytes memory tx_ = TxFixtures.payout(vault, operator, rd.recipient, cPayout, 0, rd.pot);
        INativeQueryVerifier.MerkleProof memory p = TxFixtures.merkle(seedNonce++);
        INativeQueryVerifier.ContinuityProof memory cont = TxFixtures.continuity();
        uint256 g = gasleft();
        ledger.confirmPayout(CHAIN_KEY, START_LATE + 60, tx_, p, cont);
        g -= gasleft();
        _log("confirmPayout", g);
    }

    function test_gas_confirmPayouts_batch3() public {
        uint64[] memory hs = new uint64[](3);
        bytes[] memory txs = new bytes[](3);
        INativeQueryVerifier.MerkleProof[] memory ps = new INativeQueryVerifier.MerkleProof[](3);
        for (uint256 i; i < 3; ++i) {
            KittyLedger.Round memory r = ledger.getRound(cPayouts[i], 0);
            hs[i] = START_LATE + 60 + uint64(i);
            txs[i] = TxFixtures.payout(vault, operator, r.recipient, cPayouts[i], 0, r.pot);
            ps[i] = TxFixtures.merkle(seedNonce++);
        }
        INativeQueryVerifier.ContinuityProof memory cont = TxFixtures.continuity();
        uint256 g = gasleft();
        ledger.confirmPayouts(CHAIN_KEY, hs, txs, ps, cont);
        g -= gasleft();
        _log("confirmPayouts(batch=3)", g);
    }

    // ───────────── KittyVault (source chain) ─────────────

    function test_gas_vault_contribute_first() public {
        vm.prank(alice);
        uint256 g = gasleft();
        realVault.contribute(1, 0, AMOUNT);
        g -= gasleft();
        _log("KittyVault.contribute(first into circle)", g);
    }

    function test_gas_vault_contribute_existingPot() public {
        vm.prank(alice);
        uint256 g = gasleft();
        realVault.contribute(2, 0, AMOUNT);
        g -= gasleft();
        _log("KittyVault.contribute(pot non-zero, new contributor)", g);
    }

    function test_gas_vault_contribute_repeat() public {
        vm.prank(alice);
        uint256 g = gasleft();
        realVault.contribute(3, 1, AMOUNT);
        g -= gasleft();
        _log("KittyVault.contribute(repeat contributor)", g);
    }

    function test_gas_vault_payout() public {
        vm.prank(operator);
        uint256 g = gasleft();
        realVault.payout(3, 0, alice, AMOUNT);
        g -= gasleft();
        _log("KittyVault.payout", g);
    }
}
