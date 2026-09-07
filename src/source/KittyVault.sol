// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title KittyVault (source chain: Ethereum Sepolia)
/// @notice Deliberately minimal source-chain contract, following the Attestcoin design pattern:
///         hold stablecoin escrow and emit unambiguous events. ALL circle logic (membership,
///         deadlines, rotation, missed-payment records, credit history) lives on Creditcoin in
///         KittyLedger, which consumes these events through the Attestcoin block-prover precompile.
///
///         Events are intentionally specific (`Contributed` / `PaidOut`, never a bare ERC20
///         `Transfer`) so the Creditcoin side can bind on emitter + signature + fields.
contract KittyVault is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable TOKEN;

    /// @notice Operator that executes payouts decided on Creditcoin (KittyLedger.RoundClosed).
    address public operator;

    /// @notice Escrowed balance per circle.
    mapping(uint256 => uint256) public pot;

    /// @notice One payout per (circle, round). Guards the operator against double release.
    mapping(uint256 => mapping(uint32 => bool)) public paidOut;

    /// @dev keccak256("Contributed(uint256,uint32,address,uint256)")
    event Contributed(uint256 indexed circleId, uint32 indexed round, address indexed member, uint256 amount);
    /// @dev keccak256("PaidOut(uint256,uint32,address,uint256)")
    event PaidOut(uint256 indexed circleId, uint32 indexed round, address indexed recipient, uint256 amount);
    event OperatorChanged(address indexed operator);

    error NotOperator();
    error ZeroAmount();
    error AlreadyPaid();
    error InsufficientPot();

    constructor(IERC20 token, address operator_) Ownable(msg.sender) {
        TOKEN = token;
        operator = operator_;
        emit OperatorChanged(operator_);
    }

    function setOperator(address operator_) external onlyOwner {
        operator = operator_;
        emit OperatorChanged(operator_);
    }

    /// @notice Pay this round's installment into the circle escrow.
    /// @dev No membership check here on purpose: the ledger on Creditcoin decides whether a proven
    ///      contribution counts (member of circle, right amount, before deadline). Keeping the source
    ///      side dumb keeps the trust surface on Creditcoin where it is verifiable.
    function contribute(uint256 circleId, uint32 round, uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        TOKEN.safeTransferFrom(msg.sender, address(this), amount);
        pot[circleId] += amount;
        emit Contributed(circleId, round, msg.sender, amount);
    }

    /// @notice Release a round's pot to the member Creditcoin selected. Emits `PaidOut`, which the
    ///         operator proves back to KittyLedger to close the loop (`PayoutConfirmed`).
    function payout(uint256 circleId, uint32 round, address recipient, uint256 amount) external nonReentrant {
        if (msg.sender != operator) revert NotOperator();
        if (paidOut[circleId][round]) revert AlreadyPaid();
        if (amount == 0) revert ZeroAmount();
        if (pot[circleId] < amount) revert InsufficientPot();
        paidOut[circleId][round] = true;
        pot[circleId] -= amount;
        TOKEN.safeTransfer(recipient, amount);
        emit PaidOut(circleId, round, recipient, amount);
    }
}
