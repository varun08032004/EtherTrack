// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title Treasury
 * @author EtherTrack
 * @notice Collects and manages platform fees from all trades.
 *         0.5% fee on every trade — collected in MATIC.
 *
 * BLOCKCHAIN MIGRATION: Replaces display-only fee in CarbonCredits.js
 */
contract Treasury is Ownable, Pausable, ReentrancyGuard {

    // ── State ─────────────────────────────────────────────
    uint256 public constant FEE_BASIS_POINTS = 50;  // 0.5% = 50/10000
    uint256 public constant BASIS_POINTS_DENOMINATOR = 10000;

    uint256 public totalFeesCollected;
    uint256 public totalFeesWithdrawn;

    // Authorized contracts that can deposit fees (Marketplace)
    mapping(address => bool) public authorizedDepositors;

    // ── Events ────────────────────────────────────────────
    event FeeDeposited(address indexed from, uint256 amount, uint256 totalCollected);
    event FeeWithdrawn(address indexed to, uint256 amount);
    event DepositorAuthorized(address indexed depositor);
    event DepositorRevoked(address indexed depositor);

    // ── Modifiers ─────────────────────────────────────────
    modifier onlyAuthorized() {
        require(authorizedDepositors[msg.sender] || msg.sender == owner(), "Not authorized");
        _;
    }

    // ── Constructor ───────────────────────────────────────
    constructor(address initialOwner) Ownable(initialOwner) {}

    // ── Fee Management ────────────────────────────────────

    /**
     * @notice Calculate platform fee for a given trade amount
     * BLOCKCHAIN MIGRATION: Replaces tradeFee = tradeTotal * PLATFORM_FEE in CarbonCredits.js
     */
    function calculateFee(uint256 amount) public pure returns (uint256) {
        return (amount * FEE_BASIS_POINTS) / BASIS_POINTS_DENOMINATOR;
    }

    /**
     * @notice Deposit fee — called by Marketplace on every trade
     */
    function depositFee() external payable onlyAuthorized whenNotPaused {
        require(msg.value > 0, "Fee must be > 0");
        totalFeesCollected += msg.value;
        emit FeeDeposited(msg.sender, msg.value, totalFeesCollected);
    }

    /**
     * @notice Withdraw collected fees to owner (EtherTrack company wallet)
     */
    function withdrawFees(uint256 amount) external onlyOwner nonReentrant {
        require(amount <= address(this).balance, "Insufficient balance");
        totalFeesWithdrawn += amount;
        (bool success, ) = owner().call{value: amount}("");
        require(success, "Withdrawal failed");
        emit FeeWithdrawn(owner(), amount);
    }

    function withdrawAllFees() external onlyOwner nonReentrant {
        uint256 balance = address(this).balance;
        require(balance > 0, "No fees to withdraw");
        totalFeesWithdrawn += balance;
        (bool success, ) = owner().call{value: balance}("");
        require(success, "Withdrawal failed");
        emit FeeWithdrawn(owner(), balance);
    }

    // ── Depositor Management ──────────────────────────────
    function authorizeDepositor(address depositor) external onlyOwner {
        authorizedDepositors[depositor] = true;
        emit DepositorAuthorized(depositor);
    }

    function revokeDepositor(address depositor) external onlyOwner {
        authorizedDepositors[depositor] = false;
        emit DepositorRevoked(depositor);
    }

    // ── View Functions ────────────────────────────────────
    function getBalance() external view returns (uint256) {
        return address(this).balance;
    }

    function getPendingWithdrawal() external view returns (uint256) {
        return address(this).balance;
    }

    // ── Admin ─────────────────────────────────────────────
    function pause()   external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    receive() external payable {
        totalFeesCollected += msg.value;
        emit FeeDeposited(msg.sender, msg.value, totalFeesCollected);
    }
}
