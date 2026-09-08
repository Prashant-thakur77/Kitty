// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {KittyLedger} from "../src/asc/KittyLedger.sol";
import {IChainInfo} from "../src/interfaces/IChainInfo.sol";
import {INativeQueryVerifier} from "@gluwa/asc-contracts/contracts/write-ability/common/INativeQueryVerifier.sol";
import {MockVerifier} from "./mocks/MockVerifier.sol";
import {MockChainInfo} from "./mocks/MockChainInfo.sol";
import {TxFixtures} from "./TxFixtures.sol";

/// @dev One ledger, two source chains. A circle carries its own `chainKey`, validated at creation
///      against the ChainInfo registry, and every proof is bound to *that* chain: trust, deadlines and
///      the batch chain key are all per circle, not per deployment.
contract KittyMultiChainTest is Test {
    address constant VERIFIER_PRECOMPILE = 0x0000000000000000000000000000000000000FD2;
    address constant CHAIN_INFO_PRECOMPILE = 0x0000000000000000000000000000000000000fD3;
    uint64 constant SEPOLIA = 1;
    uint64 constant MAINNET = 3;
    uint64 constant UNKNOWN = 7;

    KittyLedger ledger;
    MockVerifier verifier;
    MockChainInfo chainInfo;

    address vaultBoth = address(0xFA11); // trusted on both chains
    address vaultSepolia = address(0xFA12); // trusted on Sepolia only
    address vaultMainnet = address(0xFA13); // trusted on mainnet only
    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    address carol = address(0xCA201);
    address dave = address(0xDA7E);

    uint256 constant AMOUNT = 100e6;
    uint64 constant START = 1_000;
    uint64 constant ROUND_BLOCKS = 50;

    uint256 mainnetCircle; // chainKey 3, vault trusted on both chains
    uint256 sepoliaCircle; // chainKey 1, vault trusted on both chains
    uint256 mainnetOnlyCircle; // chainKey 3, vault trusted on mainnet only

    function setUp() public {
        vm.etch(VERIFIER_PRECOMPILE, address(new MockVerifier()).code);
        vm.etch(CHAIN_INFO_PRECOMPILE, address(new MockChainInfo()).code);
        verifier = MockVerifier(VERIFIER_PRECOMPILE);
        chainInfo = MockChainInfo(CHAIN_INFO_PRECOMPILE);
        verifier.setAccept(true);
        chainInfo.initDefaultChains(); // chainKey 1 = Sepolia, chainKey 3 = Ethereum mainnet

        ledger = new KittyLedger(SEPOLIA);
        ledger.setTrustedVault(SEPOLIA, vaultBoth, true);
        ledger.setTrustedVault(MAINNET, vaultBoth, true);
        ledger.setTrustedVault(SEPOLIA, vaultSepolia, true);
        ledger.setTrustedVault(MAINNET, vaultMainnet, true);

        mainnetCircle = ledger.createCircle("Mainnet Susu", _pair(alice, bob), AMOUNT, ROUND_BLOCKS, START, vaultBoth, MAINNET);
        sepoliaCircle = ledger.createCircle("Sepolia Susu", _pair(carol, dave), AMOUNT, ROUND_BLOCKS, START, vaultBoth, SEPOLIA);
        mainnetOnlyCircle =
            ledger.createCircle("Mainnet Only", _pair(alice, carol), AMOUNT, ROUND_BLOCKS, START, vaultMainnet, MAINNET);
    }

    // ───────────── helpers ─────────────

    function _pair(address a, address b) internal pure returns (address[] memory r) {
        r = new address[](2);
        r[0] = a;
        r[1] = b;
    }

    function _h(uint64 a) internal pure returns (uint64[] memory r) {
        r = new uint64[](1);
        r[0] = a;
    }

    function _txs(bytes memory t) internal pure returns (bytes[] memory r) {
        r = new bytes[](1);
        r[0] = t;
    }

    function _proofs(uint256 seed) internal pure returns (INativeQueryVerifier.MerkleProof[] memory r) {
        r = new INativeQueryVerifier.MerkleProof[](1);
        r[0] = TxFixtures.merkle(seed);
    }

    // ───────────── per-circle chain key ─────────────

    function test_circleStoresItsOwnChainKey() public view {
        assertEq(ledger.getCircle(mainnetCircle).chainKey, MAINNET);
        assertEq(ledger.getCircle(sepoliaCircle).chainKey, SEPOLIA);
        assertEq(ledger.SOURCE_CHAIN_KEY(), SEPOLIA, "immutable stays the default, not the law");
    }

    function test_defaultOverloadUsesSourceChainKey() public {
        uint256 id = ledger.createCircle("Default", _pair(bob, carol), AMOUNT, ROUND_BLOCKS, START, vaultBoth);
        assertEq(ledger.getCircle(id).chainKey, ledger.SOURCE_CHAIN_KEY());

        uint256 openId = ledger.createOpenCircle("Default open", AMOUNT, ROUND_BLOCKS, START, vaultBoth, 3);
        assertEq(ledger.getCircle(openId).chainKey, ledger.SOURCE_CHAIN_KEY());
        uint256 openMainnet = ledger.createOpenCircle("Open mainnet", AMOUNT, ROUND_BLOCKS, START, vaultBoth, 3, MAINNET);
        assertEq(ledger.getCircle(openMainnet).chainKey, MAINNET);
    }

    function test_unknownChainKeyIsRejectedAtCreation() public {
        vm.expectRevert(abi.encodeWithSelector(KittyLedger.UnsupportedSourceChain.selector, UNKNOWN));
        ledger.createCircle("Nowhere", _pair(alice, bob), AMOUNT, ROUND_BLOCKS, START, vaultBoth, UNKNOWN);

        vm.expectRevert(abi.encodeWithSelector(KittyLedger.UnsupportedSourceChain.selector, UNKNOWN));
        ledger.createOpenCircle("Nowhere", AMOUNT, ROUND_BLOCKS, START, vaultBoth, 3, UNKNOWN);

        // De-registering a chain closes it for new circles without touching existing ones.
        chainInfo.setChain(MAINNET, 1, "Ethereum Mainnet", false);
        vm.expectRevert(abi.encodeWithSelector(KittyLedger.UnsupportedSourceChain.selector, MAINNET));
        ledger.createCircle("Gone", _pair(alice, bob), AMOUNT, ROUND_BLOCKS, START, vaultBoth, MAINNET);
        assertEq(ledger.getCircle(mainnetCircle).chainKey, MAINNET);
    }

    function test_vaultTrustIsPerChain() public {
        assertTrue(ledger.trustedVault(SEPOLIA, vaultSepolia));
        assertFalse(ledger.trustedVault(MAINNET, vaultSepolia), "Sepolia trust must not carry to mainnet");

        // A vault trusted only on Sepolia cannot back a mainnet circle at creation either.
        vm.expectRevert(abi.encodeWithSelector(KittyLedger.VaultNotTrusted.selector, vaultSepolia));
        ledger.createCircle("Wrong vault", _pair(alice, bob), AMOUNT, ROUND_BLOCKS, START, vaultSepolia, MAINNET);
    }

    function test_singleArgSetTrustedVaultTargetsTheDefaultChain() public {
        address v = address(0xFEED);
        ledger.setTrustedVault(v, true);
        assertTrue(ledger.trustedVault(ledger.SOURCE_CHAIN_KEY(), v));
        assertFalse(ledger.trustedVault(MAINNET, v));

        vm.prank(alice);
        vm.expectRevert(); // OwnableUnauthorizedAccount — the convenience form is still owner-gated
        ledger.setTrustedVault(v, false);
    }

    // ───────────── proofs are bound to the circle's chain ─────────────

    function test_sepoliaBatchCannotFeedAMainnetCircle() public {
        bytes memory t = TxFixtures.contribution(vaultBoth, alice, mainnetCircle, 0, AMOUNT);
        // The emitter is trusted on Sepolia too, so this is a genuine chain mismatch, not a spoof.
        vm.expectRevert(abi.encodeWithSelector(KittyLedger.WrongChain.selector, SEPOLIA, MAINNET));
        ledger.recordContributions(SEPOLIA, _h(1_010), _txs(t), _proofs(1), TxFixtures.continuity());
    }

    function test_mainnetBatchCannotFeedASepoliaCircle() public {
        bytes memory t = TxFixtures.contribution(vaultBoth, carol, sepoliaCircle, 0, AMOUNT);
        vm.expectRevert(abi.encodeWithSelector(KittyLedger.WrongChain.selector, MAINNET, SEPOLIA));
        ledger.recordContributions(MAINNET, _h(1_010), _txs(t), _proofs(2), TxFixtures.continuity());
    }

    function test_mainnetCircleProvesFromItsOwnChain() public {
        bytes memory t = TxFixtures.contribution(vaultBoth, alice, mainnetCircle, 0, AMOUNT);
        ledger.recordContributions(MAINNET, _h(1_010), _txs(t), _proofs(3), TxFixtures.continuity());

        KittyLedger.Contribution memory cb = ledger.getContribution(mainnetCircle, 0, alice);
        assertTrue(cb.onTime);
        assertEq(cb.height, 1_010);
        assertEq(ledger.getRound(mainnetCircle, 0).pot, AMOUNT);
    }

    function test_vaultTrustedOnAnotherChainIsNotAValidEmitter() public {
        // vaultSepolia is a real, owner-trusted vault — but only on Sepolia. Its log must not feed a
        // mainnet circle, even under the mainnet chain key.
        bytes memory t = TxFixtures.contribution(vaultSepolia, alice, mainnetOnlyCircle, 0, AMOUNT);
        vm.expectRevert(abi.encodeWithSelector(KittyLedger.WrongEmitter.selector, vaultSepolia, address(0)));
        ledger.recordContributions(MAINNET, _h(1_010), _txs(t), _proofs(4), TxFixtures.continuity());
    }

    // ───────────── the deadline clock follows the circle's chain ─────────────

    function test_closeRoundUsesTheCirclesOwnChainForAttestation() public {
        uint64 closeAt = ledger.closeHeight(mainnetCircle, 0);
        // Sepolia is attested far past the deadline; the mainnet circle must not care.
        chainInfo.setAttestedHeight(SEPOLIA, closeAt + 10_000);
        vm.expectRevert(abi.encodeWithSelector(KittyLedger.RoundStillOpenOnSource.selector, closeAt));
        ledger.closeRound(mainnetCircle);

        chainInfo.setAttestedHeight(MAINNET, closeAt);
        ledger.closeRound(mainnetCircle);
        assertEq(uint8(ledger.getRound(mainnetCircle, 0).status), uint8(KittyLedger.RoundStatus.Closed));
    }

    // ───────────── A1's on-chain half: one proof for two circles ─────────────

    function test_crossCircleBatchSharesOnePrecompileCall() public {
        uint256 other = ledger.createCircle("Mainnet Two", _pair(carol, dave), AMOUNT, ROUND_BLOCKS, START, vaultBoth, MAINNET);

        uint64[] memory heights = new uint64[](2);
        heights[0] = 1_010;
        heights[1] = 1_020;
        bytes[] memory txs = new bytes[](2);
        txs[0] = TxFixtures.contribution(vaultBoth, alice, mainnetCircle, 0, AMOUNT);
        txs[1] = TxFixtures.contribution(vaultBoth, carol, other, 0, AMOUNT);
        INativeQueryVerifier.MerkleProof[] memory proofs = new INativeQueryVerifier.MerkleProof[](2);
        proofs[0] = TxFixtures.merkle(11);
        proofs[1] = TxFixtures.merkle(12);

        ledger.recordContributions(MAINNET, heights, txs, proofs, TxFixtures.continuity());

        assertEq(verifier.batchCalls(), 1, "two circles, one continuity proof, one precompile call");
        assertEq(verifier.lastBatchSize(), 2);
        assertEq(verifier.singleCalls(), 0);
        assertTrue(ledger.getContribution(mainnetCircle, 0, alice).queryId != bytes32(0));
        assertTrue(ledger.getContribution(other, 0, carol).queryId != bytes32(0));
    }

    function test_crossChainBatchIsRejectedWholesale() public {
        // One batch, two circles on different chains: the whole call reverts, nothing is recorded.
        uint64[] memory heights = new uint64[](2);
        heights[0] = 1_010;
        heights[1] = 1_020;
        bytes[] memory txs = new bytes[](2);
        txs[0] = TxFixtures.contribution(vaultBoth, alice, mainnetCircle, 0, AMOUNT);
        txs[1] = TxFixtures.contribution(vaultBoth, carol, sepoliaCircle, 0, AMOUNT);
        INativeQueryVerifier.MerkleProof[] memory proofs = new INativeQueryVerifier.MerkleProof[](2);
        proofs[0] = TxFixtures.merkle(21);
        proofs[1] = TxFixtures.merkle(22);

        vm.expectRevert(abi.encodeWithSelector(KittyLedger.WrongChain.selector, MAINNET, SEPOLIA));
        ledger.recordContributions(MAINNET, heights, txs, proofs, TxFixtures.continuity());
        assertEq(ledger.getContribution(mainnetCircle, 0, alice).queryId, bytes32(0));
    }

    // ───────────── A3: the widened ChainInfo surface ─────────────

    function test_chainInfoRegistryIsReadableThroughTheInterface() public view {
        IChainInfo ci = IChainInfo(CHAIN_INFO_PRECOMPILE);

        IChainInfo.ChainInfoResult memory sep = ci.get_chain_by_key(SEPOLIA);
        assertTrue(sep.exists);
        assertEq(sep.info.chainId, 11155111);
        assertEq(string(sep.info.chainName), "Ethereum Sepolia");
        assertFalse(ci.get_chain_by_key(UNKNOWN).exists);

        IChainInfo.ChainInfoData[] memory chains = ci.get_supported_chains();
        assertEq(chains.length, 2);
        assertEq(chains[0].chainKey, SEPOLIA);
        assertEq(chains[1].chainKey, MAINNET);
    }

    function test_attestationBoundsAnswerWhenAPaymentBecomesProvable() public {
        IChainInfo ci = IChainInfo(CHAIN_INFO_PRECOMPILE);
        uint64 deadline = ledger.deadlineHeight(sepoliaCircle, 0);

        chainInfo.setAttestedHeight(SEPOLIA, deadline - 10);
        IChainInfo.BoundsCheck memory b = ci.get_attestation_bounds(SEPOLIA, deadline);
        assertFalse(b.isAttested, "deadline not covered yet");
        assertEq(b.parentHeight, deadline - 10, "last attested block below the deadline");
        assertEq(b.childHeight, deadline);
        assertFalse(ci.find_lowest_attested_after(SEPOLIA, deadline).exists);
        assertEq(ci.find_highest_attested_before(SEPOLIA, deadline).height, deadline - 10);

        chainInfo.setAttestedHeight(SEPOLIA, deadline + 5);
        b = ci.get_attestation_bounds(SEPOLIA, deadline);
        assertTrue(b.isAttested);
        IChainInfo.HeightHash memory lowest = ci.find_lowest_attested_after(SEPOLIA, deadline);
        assertTrue(lowest.exists);
        assertEq(lowest.height, deadline);

        chainInfo.setGenesisHeight(SEPOLIA, 900);
        assertEq(ci.get_attestation_genesis_height(SEPOLIA), 900);
        assertEq(ci.get_latest_attestation_height_and_hash(SEPOLIA).height, deadline + 5);
    }
}
