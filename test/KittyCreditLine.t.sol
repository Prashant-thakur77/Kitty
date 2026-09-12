// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {INativeQueryVerifier} from "@gluwa/asc-contracts/contracts/write-ability/common/INativeQueryVerifier.sol";
import {KittyLedger} from "../src/asc/KittyLedger.sol";
import {KittyCreditLine} from "../src/asc/KittyCreditLine.sol";
import {KittyUSD} from "../src/asc/KittyUSD.sol";
import {MockVerifier} from "./mocks/MockVerifier.sol";
import {MockChainInfo} from "./mocks/MockChainInfo.sol";
import {TxFixtures} from "./TxFixtures.sol";

/// @dev History is produced through the real ledger path (mock precompiles + prover-format txBytes),
///      never by poking storage: the credit line must only ever see what a proof produced.
contract KittyCreditLineTest is Test {
    address constant VERIFIER_PRECOMPILE = 0x0000000000000000000000000000000000000FD2;
    address constant CHAIN_INFO_PRECOMPILE = 0x0000000000000000000000000000000000000fD3;
    uint64 constant CHAIN_KEY = 1;
    uint64 constant ROUND_BLOCKS = 50;
    uint256 constant AMOUNT = 100e6;

    KittyLedger ledger;
    KittyUSD usd;
    KittyCreditLine credit;
    MockChainInfo chainInfo;

    address vault = address(0xFA11);
    address alice = address(0xA11CE);
    address lp = address(0x1);
    address lp2 = address(0x2);
    uint256 circles;

    function setUp() public {
        vm.etch(VERIFIER_PRECOMPILE, address(new MockVerifier()).code);
        vm.etch(CHAIN_INFO_PRECOMPILE, address(new MockChainInfo()).code);
        MockVerifier(VERIFIER_PRECOMPILE).setAccept(true);
        chainInfo = MockChainInfo(CHAIN_INFO_PRECOMPILE);

        ledger = new KittyLedger(CHAIN_KEY);
        ledger.setTrustedVault(vault, true);
        usd = new KittyUSD();
        credit = new KittyCreditLine(ledger, IERC20(address(usd)));
        assertEq(usd.decimals(), 6);
    }

    // ───────────── helpers ─────────────

    /// @dev A 10-member circle (alice + 9 fillers). Each circle gets its own START so source heights,
    ///      and therefore query ids, never collide across circles.
    function _newCircle(uint256 amount) internal returns (uint256 id, uint64 start) {
        start = uint64(1_000 + circles * 100_000);
        ++circles;
        address[] memory members = new address[](10);
        members[0] = alice;
        for (uint256 i = 1; i < 10; ++i) {
            members[i] = address(uint160(0x1000 + i));
        }
        id = ledger.createCircle("circle", members, amount, ROUND_BLOCKS, start, vault);
    }

    /// @dev Everyone pays on time for `rounds` rounds; each round closes early (all paid).
    function _provenOnTime(uint256 amount, uint32 rounds) internal {
        (uint256 id, uint64 start) = _newCircle(amount);
        for (uint32 r; r < rounds; ++r) {
            _payRound(id, r, start, amount, 10);
            ledger.closeRound(id);
        }
    }

    function _payRound(uint256 id, uint32 r, uint64 start, uint256 amount, uint256 payers) internal {
        KittyLedger.Circle memory c = ledger.getCircle(id);
        uint64[] memory hs = new uint64[](payers);
        bytes[] memory txs = new bytes[](payers);
        INativeQueryVerifier.MerkleProof[] memory proofs = new INativeQueryVerifier.MerkleProof[](payers);
        for (uint256 i; i < payers; ++i) {
            hs[i] = start + r * ROUND_BLOCKS + uint64(i) + 1; // before the deadline
            txs[i] = TxFixtures.contribution(vault, c.members[i], id, r, amount);
            proofs[i] = TxFixtures.merkle(uint256(keccak256(abi.encode(id, r, i))));
        }
        ledger.recordContributions(CHAIN_KEY, hs, txs, proofs, TxFixtures.continuity());
    }

    function _fundPool(uint256 amount) internal {
        usd.mint(lp, amount);
        vm.startPrank(lp);
        usd.approve(address(credit), amount);
        credit.deposit(amount);
        vm.stopPrank();
    }

    // ───────────── underwriting ─────────────

    function test_noHistory_limitZeroAndBorrowReverts() public {
        _fundPool(1_000e6);
        assertEq(credit.creditLimit(alice), 0);
        (uint16 score, string memory tier, uint256 limit, string memory reason) = credit.underwrite(alice);
        assertEq(score, 500);
        assertEq(tier, "C"); // base score is C, but with no proof there is no credit
        assertEq(limit, 0);
        assertTrue(vm.contains(reason, "no proven history"));

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(KittyCreditLine.ExceedsCreditLimit.selector, 1, 0));
        credit.borrow(1);
    }

    function test_tierC_oneOnTime_is20pct() public {
        _provenOnTime(AMOUNT, 1); // 515 → C
        assertEq(credit.creditLimit(alice), 20e6);
        (uint16 score, string memory tier, uint256 limit, string memory reason) = credit.underwrite(alice);
        assertEq(score, 515);
        assertEq(tier, "C");
        assertEq(limit, 20e6);
        assertEq(reason, "tier C: 20% of 100 tUSD proven volume");
    }

    function test_tierB_sevenOnTime_is50pct() public {
        _provenOnTime(AMOUNT, 7); // 605 → B
        (uint16 score, string memory tier, uint256 limit, string memory reason) = credit.underwrite(alice);
        assertEq(score, 605);
        assertEq(tier, "B");
        assertEq(limit, 350e6);
        assertEq(reason, "tier B: 50% of 700 tUSD proven volume");
    }

    function test_tierA_fourteenOnTime_is100pct() public {
        _provenOnTime(AMOUNT, 10);
        _provenOnTime(AMOUNT, 4); // 710 → A
        (uint16 score, string memory tier, uint256 limit, string memory reason) = credit.underwrite(alice);
        assertEq(score, 710);
        assertEq(tier, "A");
        assertEq(limit, 1_400e6);
        assertEq(reason, "tier A: 100% of 1400 tUSD proven volume");
    }

    function test_capAt5000() public {
        _provenOnTime(1_000e6, 10);
        _provenOnTime(1_000e6, 4); // A, 14,000 tUSD proven
        (,, uint256 limit, string memory reason) = credit.underwrite(alice);
        assertEq(limit, credit.CAP());
        assertEq(limit, 5_000e6);
        assertEq(reason, "tier A: 100% of 14000 tUSD proven volume, capped at 5000 kUSD");
    }

    function test_tierD_withMissed_isZero() public {
        (uint256 id, uint64 start) = _newCircle(AMOUNT);
        _payRound(id, 0, start, AMOUNT, 10);
        ledger.closeRound(id);
        // Round 1: nobody pays; the deadline gets attested on the source chain → 10 missed.
        chainInfo.setAttestedHeight(CHAIN_KEY, ledger.closeHeight(id, 1));
        ledger.closeRound(id);

        KittyLedger.MemberRecord memory r = ledger.getRecord(alice);
        assertEq(r.onTime, 1);
        assertEq(r.missed, 1);
        (uint16 score, string memory tier, uint256 limit, string memory reason) = credit.underwrite(alice);
        assertEq(score, 395);
        assertEq(tier, "D");
        assertEq(limit, 0);
        assertEq(reason, "tier D: no credit (1 missed, 0 late)");

        _fundPool(1_000e6);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(KittyCreditLine.ExceedsCreditLimit.selector, 1, 0));
        credit.borrow(1);
    }

    // ───────────── borrow / repay ─────────────

    function test_borrowRepayFlow() public {
        _provenOnTime(AMOUNT, 1); // limit 20 kUSD
        _fundPool(1_000e6);

        vm.startPrank(alice);
        vm.expectEmit(true, false, false, true);
        emit KittyCreditLine.Borrowed(alice, 20e6, 1e6, 21e6);
        credit.borrow(20e6);
        assertEq(usd.balanceOf(alice), 20e6);
        assertEq(credit.outstanding(alice), 21e6, "5% flat fee added");
        assertEq(credit.availableCredit(alice), 0);
        assertEq(credit.totalOutstanding(), 21e6);
        assertEq(credit.liquidity(), 980e6);

        vm.expectRevert(abi.encodeWithSelector(KittyCreditLine.ExceedsCreditLimit.selector, 1, 0));
        credit.borrow(1);

        // Partial repay, then the rest (overpayment is clamped to the debt).
        usd.approve(address(credit), type(uint256).max);
        credit.repay(1e6);
        assertEq(credit.outstanding(alice), 20e6);
        vm.stopPrank();
        usd.mint(alice, 5e6);
        vm.startPrank(alice);
        vm.expectEmit(true, false, false, true);
        emit KittyCreditLine.Repaid(alice, 20e6, 0);
        credit.repay(100e6);
        assertEq(credit.outstanding(alice), 0);
        assertEq(usd.balanceOf(alice), 4e6);
        assertEq(credit.totalOutstanding(), 0);
        assertEq(credit.liquidity(), 1_001e6, "fee stays in the pool");

        vm.expectRevert(KittyCreditLine.NothingToRepay.selector);
        credit.repay(1);

        // Limit is available again after repayment.
        credit.borrow(10e6);
        assertEq(credit.outstanding(alice), 10.5e6);
        vm.stopPrank();
    }

    function test_borrowZeroReverts() public {
        _provenOnTime(AMOUNT, 1);
        _fundPool(100e6);
        vm.prank(alice);
        vm.expectRevert(KittyCreditLine.ZeroAmount.selector);
        credit.borrow(0);
    }

    // ───────────── liquidity ─────────────

    function test_liquidityConstraints() public {
        _provenOnTime(AMOUNT, 1); // limit 20 kUSD
        _fundPool(10e6);
        assertEq(credit.totalDeposits(), 10e6);
        assertEq(credit.deposits(lp), 10e6);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(KittyCreditLine.InsufficientLiquidity.selector, 20e6, 10e6));
        credit.borrow(20e6);

        vm.prank(alice);
        credit.borrow(6e6);
        assertEq(credit.liquidity(), 4e6);

        // LP cannot pull more than is in the pool, nor more than they put in.
        vm.startPrank(lp);
        vm.expectRevert(abi.encodeWithSelector(KittyCreditLine.InsufficientLiquidity.selector, 10e6, 4e6));
        credit.withdraw(10e6);
        // entitlement = share of pool value (idle 4 + owed 6.3 incl. fee) → 10.3, so 11 is too much
        uint256 ent = credit.entitlement(lp);
        assertEq(ent, 10.3e6);
        vm.expectRevert(abi.encodeWithSelector(KittyCreditLine.InsufficientDeposit.selector, 11e6, ent));
        credit.withdraw(11e6);
        uint256 value = credit.poolValue();
        uint256 units = (4e6 * credit.totalDeposits() + value - 1) / value; // deposit units burned, rounded up
        vm.expectEmit(true, false, false, true);
        emit KittyCreditLine.Withdrawn(lp, 4e6);
        credit.withdraw(4e6);
        assertEq(credit.deposits(lp), 10e6 - units);
        assertEq(credit.totalDeposits(), 10e6 - units);
        assertEq(usd.balanceOf(lp), 4e6);
        vm.stopPrank();

        vm.prank(address(0xDEAD));
        vm.expectRevert(abi.encodeWithSelector(KittyCreditLine.InsufficientDeposit.selector, 1, 0));
        credit.withdraw(1);
    }

    function test_depositEmitsAndTracks() public {
        usd.mint(lp, 5e6);
        vm.startPrank(lp);
        usd.approve(address(credit), 5e6);
        vm.expectEmit(true, false, false, true);
        emit KittyCreditLine.Deposited(lp, 5e6);
        credit.deposit(5e6);
        vm.expectRevert(KittyCreditLine.ZeroAmount.selector);
        credit.deposit(0);
        vm.stopPrank();
        assertEq(credit.totalDeposits(), 5e6);
    }

    /// @dev alice borrows the whole 20 kUSD limit and repays 21 (5% fee) so the pool holds 101 kUSD
    ///      against lp's 100 units before anyone else joins.
    function _poolWithFee() internal {
        _provenOnTime(AMOUNT, 1); // limit 20 kUSD
        _fundPool(100e6);
        vm.startPrank(alice);
        credit.borrow(20e6);
        usd.mint(alice, 1e6);
        usd.approve(address(credit), 21e6);
        credit.repay(21e6);
        vm.stopPrank();
        assertApproxEqAbs(credit.entitlement(lp), 101e6, 1);
    }

    function test_secondLpDoesNotCaptureEarlierFees() public {
        _poolWithFee();

        usd.mint(lp2, 100e6);
        vm.startPrank(lp2);
        usd.approve(address(credit), 100e6);
        credit.deposit(100e6);
        vm.stopPrank();

        assertApproxEqAbs(credit.entitlement(lp), 101e6, 1);
        assertApproxEqAbs(credit.entitlement(lp2), 100e6, 1);
    }

    function test_fullExitAfterFees() public {
        _poolWithFee();

        uint256 ent = credit.entitlement(lp);
        vm.prank(lp);
        credit.withdraw(ent);
        assertEq(credit.deposits(lp), 0);
        assertEq(credit.totalDeposits(), 0);
        assertEq(usd.balanceOf(lp), 101e6);
    }
}
