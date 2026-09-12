// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {KittyVault} from "../src/source/KittyVault.sol";
import {TestUSD} from "../src/source/TestUSD.sol";

/// @notice Property tests for the source-chain escrow: only contributors can be paid, one payout per
///         (circle, round), payouts bounded by the circle's pot, and escrow always equals the sum of pots.
contract KittyVaultFuzzTest is Test {
    TestUSD usd;
    KittyVault vault;
    address operator = address(0x0BE7);

    function setUp() public {
        usd = new TestUSD();
        vault = new KittyVault(usd, operator);
    }

    function _actor(uint8 i) internal pure returns (address) {
        return address(uint160(0x2000 + uint256(i)));
    }

    function _fund(address who, uint256 amount) internal {
        usd.mint(who, amount);
        vm.prank(who);
        usd.approve(address(vault), type(uint256).max);
    }

    // ───────────── contribute ─────────────

    function testFuzz_contribute_accumulatesPotAndFlagsContributor(uint256 circleId, uint32 round, uint128[8] memory amounts, uint8 whoSeed)
        public
    {
        uint256 expected;
        for (uint256 i; i < amounts.length; ++i) {
            uint256 amt = uint256(amounts[i]);
            address who = _actor(uint8((whoSeed + i) % 4));
            if (amt == 0) {
                vm.prank(who);
                vm.expectRevert(KittyVault.ZeroAmount.selector);
                vault.contribute(circleId, round, 0);
                continue;
            }
            _fund(who, amt);
            vm.prank(who);
            vault.contribute(circleId, round, amt);
            expected += amt;
            assertTrue(vault.contributor(circleId, who));
        }
        assertEq(vault.pot(circleId), expected);
        assertEq(usd.balanceOf(address(vault)), expected, "escrow equals the pot");
    }

    function testFuzz_contribute_isolatesCircles(uint256 a, uint256 b, uint128 amtA, uint128 amtB) public {
        vm.assume(a != b);
        amtA = uint128(bound(amtA, 1, type(uint128).max));
        amtB = uint128(bound(amtB, 1, type(uint128).max));
        address alice = _actor(0);
        _fund(alice, uint256(amtA) + uint256(amtB));
        vm.startPrank(alice);
        vault.contribute(a, 0, amtA);
        vault.contribute(b, 0, amtB);
        vm.stopPrank();
        assertEq(vault.pot(a), amtA);
        assertEq(vault.pot(b), amtB);
        assertTrue(vault.contributor(a, alice));
        assertTrue(vault.contributor(b, alice));
        assertFalse(vault.contributor(a, _actor(1)));
    }

    // ───────────── payout: contributor-only ─────────────

    function testFuzz_payout_onlyToContributors(uint256 circleId, uint32 round, uint128 amount, address recipient) public {
        amount = uint128(bound(amount, 1, type(uint128).max));
        address alice = _actor(0);
        vm.assume(recipient != alice && recipient != address(vault) && recipient != address(0));
        _fund(alice, amount);
        vm.prank(alice);
        vault.contribute(circleId, round, amount);

        vm.prank(operator);
        vm.expectRevert(KittyVault.NotAContributor.selector);
        vault.payout(circleId, round, recipient, amount);
        assertEq(vault.pot(circleId), amount, "pot untouched by the refused payout");
        assertFalse(vault.paidOut(circleId, round), "refused payout must not consume the round");

        // the same call to a contributor goes through
        vm.prank(operator);
        vault.payout(circleId, round, alice, amount);
        assertEq(usd.balanceOf(alice), amount);
        assertEq(vault.pot(circleId), 0);
    }

    /// @dev Contributor status is per circle: paying into circle A never qualifies you for circle B's pot.
    function testFuzz_payout_contributorStatusIsPerCircle(uint256 a, uint256 b, uint128 amount) public {
        vm.assume(a != b);
        amount = uint128(bound(amount, 1, type(uint128).max));
        address alice = _actor(0);
        address bob = _actor(1);
        _fund(alice, amount);
        _fund(bob, amount);
        vm.prank(alice);
        vault.contribute(a, 0, amount);
        vm.prank(bob);
        vault.contribute(b, 0, amount);
        vm.prank(operator);
        vm.expectRevert(KittyVault.NotAContributor.selector);
        vault.payout(a, 0, bob, amount);
        vm.prank(operator);
        vm.expectRevert(KittyVault.NotAContributor.selector);
        vault.payout(b, 0, alice, amount);
    }

    function testFuzz_payout_onlyOperator(address caller, uint128 amount) public {
        vm.assume(caller != operator);
        amount = uint128(bound(amount, 1, type(uint128).max));
        address alice = _actor(0);
        _fund(alice, amount);
        vm.prank(alice);
        vault.contribute(1, 0, amount);
        vm.prank(caller);
        vm.expectRevert(KittyVault.NotOperator.selector);
        vault.payout(1, 0, alice, amount);
    }

    // ───────────── payout: idempotence ─────────────

    /// @dev Once a (circle, round) is paid, no second payout for it succeeds — any recipient, any
    ///      amount, however much is still escrowed for that circle.
    function testFuzz_payout_paidOutIsPermanent(uint256 circleId, uint32 round, uint128 first, uint128 second, uint8 recipientSeed) public {
        first = uint128(bound(first, 1, type(uint128).max / 2));
        second = uint128(bound(second, 1, type(uint128).max / 2));
        address alice = _actor(0);
        address bob = _actor(1);
        _fund(alice, first);
        _fund(bob, second);
        vm.prank(alice);
        vault.contribute(circleId, round, first);
        vm.prank(bob);
        vault.contribute(circleId, round, second);

        vm.prank(operator);
        vault.payout(circleId, round, alice, first);
        assertTrue(vault.paidOut(circleId, round));
        assertEq(vault.pot(circleId), second, "escrow for the rest of the circle remains");

        address again = recipientSeed % 2 == 0 ? alice : bob;
        vm.prank(operator);
        vm.expectRevert(KittyVault.AlreadyPaid.selector);
        vault.payout(circleId, round, again, 1);
        vm.prank(operator);
        vm.expectRevert(KittyVault.AlreadyPaid.selector);
        vault.payout(circleId, round, again, second);
        assertEq(vault.pot(circleId), second);

        // a different round of the same circle is a fresh slot
        unchecked {
            vm.prank(operator);
            vault.payout(circleId, round + 1, bob, second);
        }
        assertEq(vault.pot(circleId), 0);
        assertEq(usd.balanceOf(bob), second);
    }

    // ───────────── payout: amount bounds ─────────────

    /// @dev amount == 0 → ZeroAmount; amount > pot → InsufficientPot; otherwise pot decreases by exactly
    ///      amount and the recipient's balance rises by exactly amount.
    function testFuzz_payout_amountBounds(uint256 circleId, uint128 potAmount, uint256 amount) public {
        potAmount = uint128(bound(potAmount, 1, type(uint128).max));
        address alice = _actor(0);
        _fund(alice, potAmount);
        vm.prank(alice);
        vault.contribute(circleId, 0, potAmount);
        uint256 balBefore = usd.balanceOf(alice);

        vm.prank(operator);
        if (amount == 0) {
            vm.expectRevert(KittyVault.ZeroAmount.selector);
            vault.payout(circleId, 0, alice, 0);
        } else if (amount > potAmount) {
            vm.expectRevert(KittyVault.InsufficientPot.selector);
            vault.payout(circleId, 0, alice, amount);
        } else {
            vault.payout(circleId, 0, alice, amount);
            assertEq(vault.pot(circleId), uint256(potAmount) - amount);
            assertEq(usd.balanceOf(alice), balBefore + amount);
            assertTrue(vault.paidOut(circleId, 0));
        }
        if (amount == 0 || amount > potAmount) {
            assertEq(vault.pot(circleId), potAmount, "failed payout leaves the pot intact");
            assertFalse(vault.paidOut(circleId, 0));
        }
        assertEq(usd.balanceOf(address(vault)), vault.pot(circleId), "escrow always equals the pot");
    }

    /// @dev A sequence of payouts across rounds can never release more than was escrowed for the circle,
    ///      and never touches another circle's escrow.
    function testFuzz_payout_neverExceedsCircleEscrow(uint128 potA, uint128 potB, uint128[6] memory asks) public {
        potA = uint128(bound(potA, 1, type(uint128).max));
        potB = uint128(bound(potB, 1, type(uint128).max));
        address alice = _actor(0);
        address bob = _actor(1);
        _fund(alice, potA);
        _fund(bob, potB);
        vm.prank(alice);
        vault.contribute(1, 0, potA);
        vm.prank(bob);
        vault.contribute(2, 0, potB);

        uint256 released;
        for (uint32 r; r < asks.length; ++r) {
            uint256 ask = uint256(asks[r]);
            uint256 potNow = vault.pot(1);
            vm.prank(operator);
            if (ask == 0) {
                vm.expectRevert(KittyVault.ZeroAmount.selector);
                vault.payout(1, r, alice, ask);
            } else if (ask > potNow) {
                vm.expectRevert(KittyVault.InsufficientPot.selector);
                vault.payout(1, r, alice, ask);
            } else {
                vault.payout(1, r, alice, ask);
                released += ask;
            }
        }
        assertLe(released, potA);
        assertEq(vault.pot(1), uint256(potA) - released);
        assertEq(vault.pot(2), potB, "other circle untouched");
        assertEq(usd.balanceOf(address(vault)), uint256(potA) - released + potB);
    }
}
