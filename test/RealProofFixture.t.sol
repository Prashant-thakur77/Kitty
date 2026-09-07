// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {EvmV1Decoder} from "@gluwa/asc-contracts/contracts/common/EvmV1Decoder.sol";

/// @notice Decodes REAL prover bytes (Attestcoin Proof Builder output for a Sepolia tx, verified
///         `true` by the live 0x0FD2 precompile on CC3 Testnet) with the same EvmV1Decoder calls
///         KittyLedger makes. Guards against drift between our hand-built test fixtures and the
///         production encoding.
contract RealProofFixtureTest is Test {
    function test_realProverBytesDecodeLikeTheLedgerExpects() public view {
        string memory json = vm.readFile("test/fixtures/sepolia-11656295-tx44.json");
        bytes memory txBytes = vm.parseJsonBytes(json, ".txBytes");
        uint256 height = vm.parseJsonUint(json, ".headerNumber");
        assertEq(height, 11656295);

        uint8 txType = EvmV1Decoder.getTransactionType(txBytes);
        assertEq(txType, 2, "EIP-1559 transaction");
        assertTrue(EvmV1Decoder.isValidTransactionType(txType));

        EvmV1Decoder.CommonTxFields memory c = EvmV1Decoder.decodeCommonTxFields(txBytes);
        assertEq(c.from, 0xD793169c516c9F9A334218608fbF6E1338b3DE56, "Kitty deployer");
        assertTrue(c.toIsNull, "contract creation");

        EvmV1Decoder.ReceiptFields memory r = EvmV1Decoder.decodeReceiptFields(txBytes);
        assertEq(r.receiptStatus, 1, "succeeded");
        assertEq(r.receiptLogs.length, 0, "a plain deployment emits no logs");
        // KittyLedger would reject this tx for a Kitty round: no Contributed log → ExpectedExactlyOneLog(0)
        assertEq(EvmV1Decoder.getLogsByEventSignature(r, keccak256("Contributed(uint256,uint32,address,uint256)")).length, 0);
    }
}
