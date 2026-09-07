// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {FakeVault} from "../src/source/FakeVault.sol";
import {KittyVault} from "../src/source/KittyVault.sol";
import {KittyLedger} from "../src/asc/KittyLedger.sol";

contract FakeVaultTest is Test {
    /// @dev The spoof must be shape-identical to the real event so the only thing that saves the
    ///      ledger is emitter binding (WrongEmitter / TxNotToVault), not a signature mismatch.
    function test_emitsExactContributedShape() public {
        FakeVault fake = new FakeVault();
        assertEq(FakeVault.Contributed.selector, KittyVault.Contributed.selector);
        assertEq(FakeVault.Contributed.selector, keccak256("Contributed(uint256,uint32,address,uint256)"));
        vm.expectEmit(true, true, true, true, address(fake));
        emit KittyVault.Contributed(7, 2, address(0xB0B), 100e6);
        fake.emitContributed(7, 2, address(0xB0B), 100e6);
    }
}
