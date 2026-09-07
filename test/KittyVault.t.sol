// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {KittyVault} from "../src/source/KittyVault.sol";
import {TestUSD} from "../src/source/TestUSD.sol";

contract KittyVaultTest is Test {
    TestUSD usd;
    KittyVault vault;
    address operator = address(0x0BE7);
    address alice = address(0xA11CE);
    address bob = address(0xB0B);

    event Contributed(uint256 indexed circleId, uint32 indexed round, address indexed member, uint256 amount);
    event PaidOut(uint256 indexed circleId, uint32 indexed round, address indexed recipient, uint256 amount);

    function setUp() public {
        usd = new TestUSD();
        vault = new KittyVault(usd, operator);
        usd.mint(alice, 1_000e6);
        vm.prank(alice);
        usd.approve(address(vault), type(uint256).max);
    }

    function test_contribute_escrowsAndEmits() public {
        vm.expectEmit(true, true, true, true);
        emit Contributed(1, 0, alice, 100e6);
        vm.prank(alice);
        vault.contribute(1, 0, 100e6);
        assertEq(vault.pot(1), 100e6);
        assertEq(usd.balanceOf(address(vault)), 100e6);
    }

    function test_contribute_rejectsZero() public {
        vm.prank(alice);
        vm.expectRevert(KittyVault.ZeroAmount.selector);
        vault.contribute(1, 0, 0);
    }

    function test_payout_onlyOperatorOncePerRound() public {
        vm.prank(alice);
        vault.contribute(1, 0, 100e6);

        vm.prank(alice);
        vm.expectRevert(KittyVault.NotOperator.selector);
        vault.payout(1, 0, bob, 100e6);

        vm.prank(operator);
        vm.expectRevert(KittyVault.InsufficientPot.selector);
        vault.payout(1, 0, bob, 101e6);

        vm.expectEmit(true, true, true, true);
        emit PaidOut(1, 0, bob, 100e6);
        vm.prank(operator);
        vault.payout(1, 0, bob, 100e6);
        assertEq(usd.balanceOf(bob), 100e6);
        assertEq(vault.pot(1), 0);

        vm.prank(operator);
        vm.expectRevert(KittyVault.AlreadyPaid.selector);
        vault.payout(1, 0, bob, 1);
    }

    function test_eventSignaturesMatchLedgerConstants() public pure {
        assertEq(keccak256("Contributed(uint256,uint32,address,uint256)"), Contributed.selector);
        assertEq(keccak256("PaidOut(uint256,uint32,address,uint256)"), PaidOut.selector);
    }
}
