// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {KittyLedger} from "./KittyLedger.sol";

/// @title KittyCreditLine — a demo lender that underwrites purely from proof-backed history
/// @notice The Kitty Score is only worth something if a contract *uses* it. This pool lends kUSD on
///         Creditcoin against nothing but the ledger's `MemberRecord`: every input to the credit
///         decision is a proven Sepolia transaction or an attested deadline. No admin, no oracle,
///         no KYC — and no history means no credit.
///
///         Underwriting table (from `KittyLedger.creditScore` tiers):
///           tier A (≥700)  → 100% of proven volume
///           tier B (≥600)  →  50%
///           tier C (≥500)  →  20%
///           tier D (<500)  →   0%
///         capped at `CAP` (5,000 kUSD). A member with zero proven installments gets 0.
///
/// @dev Deliberately minimal: a flat 5% fee is added to the debt at borrow time, no time accrual.
///      Fees repaid by borrowers stay in the pool and raise every LP's entitlement; `deposits` and
///      `totalDeposits` are share units, not kUSD. Not a production lender.
contract KittyCreditLine is ReentrancyGuard {
    using SafeERC20 for IERC20;

    KittyLedger public immutable LEDGER;
    IERC20 public immutable ASSET;

    /// @notice Hard ceiling per member, in asset units (6 decimals).
    uint256 public constant CAP = 5_000e6;
    /// @notice Flat fee added to every borrow, in basis points.
    uint256 public constant FEE_BPS = 500;

    uint256 public totalDeposits;
    uint256 public totalOutstanding;
    mapping(address => uint256) public deposits;
    mapping(address => uint256) internal _debt;

    event Deposited(address indexed lp, uint256 amount);
    event Withdrawn(address indexed lp, uint256 amount);
    event Borrowed(address indexed member, uint256 amount, uint256 fee, uint256 outstanding);
    event Repaid(address indexed member, uint256 amount, uint256 outstanding);

    error ZeroAmount();
    error InsufficientDeposit(uint256 requested, uint256 deposited);
    error InsufficientLiquidity(uint256 requested, uint256 available);
    error ExceedsCreditLimit(uint256 requested, uint256 available);
    error NothingToRepay();

    constructor(KittyLedger ledger, IERC20 asset) {
        LEDGER = ledger;
        ASSET = asset;
    }

    // ───────────────────────────── Liquidity providers ─────────────────────────────

    /// @notice Deposit `amount` kUSD and receive share units at the current pool price, so a late LP
    ///         cannot capture fees earned before they joined. Units round down (the safe direction).
    function deposit(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        uint256 value = poolValue();
        uint256 units = (totalDeposits == 0 || value == 0) ? amount : amount * totalDeposits / value;
        if (units == 0) revert ZeroAmount();
        deposits[msg.sender] += units;
        totalDeposits += units;
        ASSET.safeTransferFrom(msg.sender, address(this), amount);
        emit Deposited(msg.sender, amount);
    }

    /// @notice Withdraw up to your pro-rata share of the pool (deposits plus collected fees).
    ///         Fees repaid by borrowers raise every LP's entitlement instead of being locked in the pool.
    function withdraw(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        uint256 ent = entitlement(msg.sender);
        if (amount > ent) revert InsufficientDeposit(amount, ent);
        uint256 liq = liquidity();
        if (amount > liq) revert InsufficientLiquidity(amount, liq);
        // burn deposit units proportionally (round up so the pool never over-pays)
        uint256 value = poolValue();
        uint256 units = (amount * totalDeposits + value - 1) / value;
        if (units > deposits[msg.sender]) units = deposits[msg.sender];
        deposits[msg.sender] -= units;
        totalDeposits -= units;
        ASSET.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    /// @notice Total value backing deposit units: idle liquidity plus everything borrowers still owe.
    function poolValue() public view returns (uint256) {
        return liquidity() + totalOutstanding;
    }

    /// @notice What `lp` may withdraw once liquidity allows: their share of poolValue.
    function entitlement(address lp) public view returns (uint256) {
        if (totalDeposits == 0) return 0;
        return deposits[lp] * poolValue() / totalDeposits;
    }

    // ───────────────────────────── Borrowers ─────────────────────────────

    /// @notice Draw `amount` against the caller's proof-backed credit limit. A flat 5% fee is added
    ///         to the debt; the whole debt counts against the limit until repaid.
    function borrow(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        uint256 avail = availableCredit(msg.sender);
        if (amount > avail) revert ExceedsCreditLimit(amount, avail);
        uint256 liq = liquidity();
        if (amount > liq) revert InsufficientLiquidity(amount, liq);

        uint256 fee = (amount * FEE_BPS) / 10_000;
        uint256 owed = _debt[msg.sender] + amount + fee;
        _debt[msg.sender] = owed;
        totalOutstanding += amount + fee;
        ASSET.safeTransfer(msg.sender, amount);
        emit Borrowed(msg.sender, amount, fee, owed);
    }

    /// @notice Repay up to the caller's outstanding debt (overpayment is clamped).
    function repay(uint256 amount) external nonReentrant {
        uint256 owed = _debt[msg.sender];
        if (owed == 0) revert NothingToRepay();
        if (amount == 0) revert ZeroAmount();
        if (amount > owed) amount = owed;
        _debt[msg.sender] = owed - amount;
        totalOutstanding -= amount;
        ASSET.safeTransferFrom(msg.sender, address(this), amount);
        emit Repaid(msg.sender, amount, owed - amount);
    }

    // ───────────────────────────── Views ─────────────────────────────

    /// @notice Principal + fee still owed by `member`.
    function outstanding(address member) public view returns (uint256) {
        return _debt[member];
    }

    /// @notice kUSD currently sitting in the pool (deposits − lent out + collected fees).
    function liquidity() public view returns (uint256) {
        return ASSET.balanceOf(address(this));
    }

    /// @notice Credit limit derived from the ledger. 0 without proven history; otherwise
    ///         min(CAP, factor(tier) × proven volume). Tier D — which any missed payment quickly
    ///         forces — always maps to 0.
    function creditLimit(address member) public view returns (uint256) {
        (, uint256 limit,,,) = _underwrite(member);
        return limit;
    }

    /// @notice Limit minus outstanding debt (never negative).
    function availableCredit(address member) public view returns (uint256) {
        uint256 limit = creditLimit(member);
        uint256 owed = _debt[member];
        return owed >= limit ? 0 : limit - owed;
    }

    /// @notice One call for the UI: score, tier, limit, and a human-readable reason.
    function underwrite(address member)
        external
        view
        returns (uint16 score, string memory tier, uint256 limit, string memory reason)
    {
        uint256 factor;
        KittyLedger.MemberRecord memory rec;
        (score, limit, tier, factor, rec) = _underwrite(member);

        uint256 proven = uint256(rec.onTime) + rec.late + rec.missed;
        if (proven == 0) {
            reason = "no proven history yet: contribute to a circle on Ethereum and let the proof land";
        } else if (factor == 0) {
            reason = string.concat(
                "tier D: no credit (", Strings.toString(rec.missed), " missed, ", Strings.toString(rec.late), " late)"
            );
        } else {
            reason = string.concat(
                "tier ",
                tier,
                ": ",
                Strings.toString(factor),
                "% of ",
                Strings.toString(rec.volume / 1e6),
                " tUSD proven volume",
                limit == CAP ? ", capped at 5000 kUSD" : ""
            );
        }
    }

    // ───────────────────────────── Internals ─────────────────────────────

    function _underwrite(address member)
        internal
        view
        returns (uint16 score, uint256 limit, string memory tier, uint256 factor, KittyLedger.MemberRecord memory rec)
    {
        rec = LEDGER.getRecord(member);
        (score, tier) = LEDGER.creditScore(member);
        if (uint256(rec.onTime) + rec.late + rec.missed == 0) return (score, 0, tier, 0, rec);

        bytes1 t = bytes(tier)[0];
        if (t == "A") factor = 100;
        else if (t == "B") factor = 50;
        else if (t == "C") factor = 20;
        else factor = 0; // tier D: a missed payment lands here fast (−120), and D never lends
        if (factor == 0 && rec.missed > 0) return (score, 0, tier, 0, rec);

        limit = (rec.volume * factor) / 100;
        if (limit > CAP) limit = CAP;
    }
}
