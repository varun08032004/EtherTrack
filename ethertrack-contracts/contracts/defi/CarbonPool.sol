// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/math/SafeERC20.sol";
import "./interfaces/ICarbonPool.sol";

/**
 * @title CarbonPool
 * @dev ERC-4626 vault for carbon credits. Accepts ERC-1155 carbon credits as assets,
 * mints ERC-20 share tokens representing proportional ownership.
 * Yield sources: trading fees, retirement rewards, lending interest.
 */
contract CarbonPool is ERC4626, ERC20, AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using SafeERC20 for IERC1155;

    // Role definitions
    bytes32 public constant ASSET_MANAGER_ROLE = keccak256("ASSET_MANAGER_ROLE");
    bytes32 public constant STRATEGIST_ROLE = keccak256("STRATEGIST_ROLE");
    bytes32 public constant LIQUIDITY_PROVIDER_ROLE = keccak256("LIQUIDITY_PROVIDER_ROLE");
    bytes32 public constant EMERGENCY_GUARDIAN_ROLE = keccak256("EMERGENCY_GUARDIAN_ROLE");

    // Strategy configuration
    struct Strategy {
        address asset;           // Underlying ERC-1155 carbon credit contract
        uint256 assetId;         // Batch ID in the carbon credit contract
        uint256 allocationBps;   // Allocation in basis points (sum = 10000)
        bool active;
        address strategyContract; // Optional strategy contract for yield generation
    }

    Strategy[] public strategies;
    uint256 public totalAllocationBps;

    // Asset configuration
    IERC1155 public immutable carbonCreditToken;
    mapping(uint256 => uint256) public assetBalances; // assetId => total deposited

    // Strategy management
    struct StrategyConfig {
        address strategyContract;
        uint256 allocationBps;
        bool active;
        uint256 lastRebalance;
    }
    mapping(address => StrategyConfig) public strategyConfigs;
    address[] public activeStrategies;
    uint256 public totalAllocationBps;

    // Fee configuration
    uint256 public managementFeeBps = 50; // 0.5% annually
    uint256 public performanceFeeBps = 2000; // 20% of profits
    address public feeRecipient;
    uint256 public lastFeeCollection;

    // Withdrawal queue for orderly exits
    struct WithdrawalRequest {
        address user;
        uint256 shares;
        uint256 requestTime;
        uint256 epoch;
    }
    uint256 public withdrawalEpoch;
    uint256 public withdrawalWindow = 7 days;
    mapping(address => WithdrawalRequest) public pendingWithdrawals;
    uint256[] public withdrawalQueue;

    // Performance tracking
    uint256 public lastReportTime;
    uint256 public lastPricePerShare;
    uint256 public peakPricePerShare;

    // Events
    event StrategyAdded(address indexed strategy, uint256 allocationBps);
    event StrategyRemoved(address indexed strategy);
    event AllocationUpdated(address indexed strategy, uint256 oldBps, uint256 newBps);
    event RebalanceExecuted(uint256 epoch);
    event FeesCollected(uint256 managementFee, uint256 performanceFee);
    event WithdrawalRequested(address indexed user, uint256 shares, uint256 epoch);
    event WithdrawalFulfilled(address indexed user, uint256 assets, uint256 shares);
    event EmergencyWithdrawal(address indexed user, uint256 assets);
    event FeesCollected(uint256 managementFee, uint256 performanceFee);

    // Constructor
    constructor(
        IERC1155 _carbonCreditToken,
        string memory _name,
        string memory _symbol,
        address _feeRecipient
    ) ERC4626(IERC20(address(0))) ERC20(_name, _symbol) {
        carbonCreditToken = IERC1155(_carbonCreditToken);
        feeRecipient = _feeRecipient;

        _setRoleAdmin(DEFAULT_ADMIN_ROLE, DEFAULT_ADMIN_ROLE);
        _setRoleAdmin(ASSET_MANAGER_ROLE, DEFAULT_ADMIN_ROLE);
        _setRoleAdmin(STRATEGIST_ROLE, DEFAULT_ADMIN_ROLE);
        _setRoleAdmin(LIQUIDITY_PROVIDER_ROLE, DEFAULT_ADMIN_ROLE);
        _setRoleAdmin(EMERGENCY_GUARDIAN_ROLE, DEFAULT_ADMIN_ROLE);

        grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        grantRole(ASSET_MANAGER_ROLE, msg.sender);
        grantRole(STRATEGIST_ROLE, msg.sender);
        grantRole(LIQUIDITY_PROVIDER_ROLE, msg.sender);

        feeRecipient = _feeRecipient;
        lastReportTime = block.timestamp;
        peakPricePerShare = 1e18; // 1:1 initial price
    }

    // ==================== CORE ERC4626 FUNCTIONS ====================

    function asset() public view override returns (address) {
        return address(carbonCreditToken);
    }

    function totalAssets() public view override returns (uint256) {
        uint256 total = 0;
        for (uint256 i = 0; i < activeStrategies.length; i++) {
            address strat = activeStrategies[i];
            uint256 balance = IERC1155(carbonCreditToken).balanceOf(address(this), strategies[strat].assetId);
            total += balance;
        }
        return total;
    }

    function convertToShares(uint256 assets) public view override returns (uint256) {
        uint256 supply = totalSupply();
        if (supply == 0) return assets;
        return (assets * 10**18) / (totalAssets() / 10**18);
    }

    function convertToAssets(uint256 shares) public view override returns (uint256) {
        uint256 supply = totalSupply();
        if (shares == 0) return 0;
        return (shares * totalAssets()) / supply;
    }

    function maxDeposit(address receiver) public view override returns (uint256) {
        return type(uint256).max;
    }

    function previewDeposit(uint256 assets) public view override returns (uint256) {
        return convertToShares(assets);
    }

    function deposit(uint256 assets, address receiver) public override returns (uint256 shares) {
        return _deposit(assets, receiver, msg.sender);
    }

    function mint(uint256 shares, address receiver) public override returns (uint256 assets) {
        uint256 assets = previewMint(shares);
        _deposit(assets, receiver, msg.sender);
        return assets;
    }

    function previewMint(uint256 shares) public view override returns (uint256) {
        return convertToAssets(shares);
    }

    function maxWithdraw(address receiver) public view override returns (uint256) {
        uint256 shares = balanceOf(receiver);
        return previewWithdraw(shares);
    }

    function previewWithdraw(uint256 assets) public view override returns (uint256) {
        return convertToShares(assets);
    }

    function withdraw(uint256 assets, address receiver, address owner) public override returns (uint256 shares) {
        return _withdraw(assets, receiver, owner);
    }

    function redeem(uint256 shares, address receiver, address owner) public override returns (uint256 assets) {
        uint256 assets = previewRedeem(shares);
        _withdraw(assets, receiver, owner);
        return assets;
    }

    function previewRedeem(uint256 shares) public view override returns (uint256) {
        return convertToAssets(shares);
    }

    // ==================== DEPOSIT / WITHDRAW LOGIC ====================

    function _deposit(
        uint256 assets,
        address receiver,
        address depositor
    ) internal returns (uint256 shares) {
        // In production, would route assets to strategies based on allocation
        // For now, deposit directly to vault
        IERC1155(carbonCreditToken).safeBatchTransferFrom(
            msg.sender, address(this), assetIds, amounts, ""
        );

        uint256 shares = previewDeposit(assets);
        _mint(receiver, shares);

        emit Deposit(msg.sender, receiver, assets, shares);
        return shares;
    }

    function _withdraw(
        uint256 assets,
        address receiver,
        address owner
    ) internal returns (uint256 shares) {
        // In production, would withdraw from strategies
        uint256 shares = previewRedeem(assets);

        // Burn shares
        _burn(owner, shares);

        // Transfer underlying assets to receiver
        // In production, would withdraw from strategies

        emit Withdrawal(owner, receiver, assets, shares);
        return shares;
    }

    // ==================== STRATEGY MANAGEMENT ====================

    function addStrategy(
        address strategyContract,
        uint256 allocationBps
    ) external onlyRole(ASSET_MANAGER_ROLE) {
        require(allocationBps > 0, "Allocation must be > 0");
        require(totalAllocationBps + allocationBps <= 10000, "Allocation exceeds 100%");

        StrategyConfig memory config = StrategyConfig({
            strategyContract: strategyContract,
            allocationBps: allocationBps,
            active: true,
            lastRebalance: block.timestamp
        });

        strategyConfigs[strategyContract] = config;
        activeStrategies.push(strategyContract);
        totalAllocationBps += allocationBps;

        emit StrategyAdded(strategyContract, allocationBps);
    }

    function removeStrategy(address strategyContract) external onlyRole(ASSET_MANAGER_ROLE) {
        StrategyConfig storage config = strategyConfigs[strategyContract];
        require(config.active, "Strategy not active");

        totalAllocationBps -= config.allocationBps;
        config.active = false;

        // Remove from active strategies array
        for (uint256 i = 0; i < activeStrategies.length; i++) {
            if (activeStrategies[i] == strategyContract) {
                activeStrategies[i] = activeStrategies[activeStrategies.length - 1];
                activeStrategies.pop();
                break;
            }
        }

        emit StrategyRemoved(strategyContract);
    }

    function updateAllocation(address strategyContract, uint256 newAllocationBps) external onlyRole(ASSET_MANAGER_ROLE) {
        StrategyConfig storage config = strategyConfigs[strategyContract];
        require(config.active, "Strategy not active");
        require(totalAllocationBps - config.allocationBps + newAllocationBps <= 10000, "Exceeds 100%");

        uint256 oldBps = config.allocationBps;
        config.allocationBps = newAllocationBps;
        totalAllocationBps = totalAllocationBps - oldBps + newAllocationBps;

        emit AllocationUpdated(strategyContract, oldBps, newAllocationBps);
    }

    function rebalance() external onlyRole(STRATEGIST_ROLE) {
        // Rebalance assets across strategies according to allocations
        // This would move assets between strategies
        withdrawalEpoch++;
        emit RebalanceExecuted(withdrawalEpoch);
    }

    // ==================== FEE MANAGEMENT ====================

    function collectFees() external onlyRole(ASSET_MANAGER_ROLE) {
        uint256 currentPrice = pricePerShare();
        uint256 peakPrice = peakPricePerShare;

        // Management fee
        uint256 totalAssets = totalAssets();
        uint256 managementFee = (totalAssets * managementFeeBps * (block.timestamp - lastReportTime)) / (10000 * 365 days);

        // Performance fee
        uint256 performanceFee = 0;
        if (currentPrice > peakPrice) {
            uint256 profit = (currentPrice - peakPrice) * totalSupply();
            performanceFee = (profit * performanceFeeBps) / 10000;
        }

        if (managementFee > 0) {
            _mint(feeRecipient, managementFee);
        }
        if (performanceFee > 0) {
            _mint(feeRecipient, performanceFee);
        }

        peakPricePerShare = max(peakPrice, currentPrice);
        lastReportTime = block.timestamp;

        emit FeesCollected(managementFee, performanceFee);
    }

    function setManagementFee(uint256 bps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(bps <= 200, "Max 2% management fee");
        managementFeeBps = bps;
    }

    function setPerformanceFee(uint256 bps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(bps <= 5000, "Max 50% performance fee");
        performanceFeeBps = bps;
    }

    function setFeeRecipient(address recipient) external onlyRole(DEFAULT_ADMIN_ROLE) {
        feeRecipient = recipient;
    }

    // ==================== WITHDRAWAL QUEUE ====================

    function requestWithdrawal(uint256 shares) external {
        uint256 balance = balanceOf(msg.sender);
        require(shares <= balance, "Insufficient shares");

        withdrawalEpoch++;
        pendingWithdrawals[msg.sender] = WithdrawalRequest({
            user: msg.sender,
            shares: shares,
            requestTime: block.timestamp,
            epoch: withdrawalEpoch
        });
        withdrawalQueue.push(msg.sender);

        emit WithdrawalRequested(msg.sender, shares, withdrawalEpoch);
    }

    function fulfillWithdrawal(address user) external onlyRole(LIQUIDITY_PROVIDER_ROLE) {
        WithdrawalRequest storage req = pendingWithdrawals[user];
        require(req.shares > 0, "No pending withdrawal");
        require(req.epoch == withdrawalEpoch, "Wrong epoch");

        uint256 assets = previewRedeem(req.shares);
        _withdraw(req.shares, user, user);

        delete pendingWithdrawals[user];
        // Remove from queue
        for (uint256 i = 0; i < withdrawalQueue.length; i++) {
            if (withdrawalQueue[i] == user) {
                withdrawalQueue[i] = withdrawalQueue[withdrawalQueue.length - 1];
                withdrawalQueue.pop();
                break;
            }
        }

        emit WithdrawalFulfilled(user, assets, req.shares);
    }

    function emergencyWithdraw() external {
        // Emergency withdrawal bypasses queue (with penalty)
        uint256 shares = balanceOf(msg.sender);
        require(shares > 0, "No shares to withdraw");

        uint256 assets = previewRedeem(shares);
        // Apply emergency penalty (e.g., 5% penalty)
        uint256 penalty = assets / 20;
        uint256 netAssets = assets - penalty;

        _withdraw(assets, msg.sender, msg.sender);
        // Send penalty to fee recipient
        _mint(feeRecipient, penalty);

        emit EmergencyWithdrawal(msg.sender, netAssets);
    }

    // ==================== VIEW FUNCTIONS ====================

    function getStrategies() external view returns (address[] memory) {
        return activeStrategies;
    }

    function getStrategyConfig(address strategy) external view returns (StrategyConfig memory) {
        return strategyConfigs[strategy];
    }

    function getWithdrawalRequest(address user) external view returns (WithdrawalRequest memory) {
        return pendingWithdrawals[user];
    }

    function getWithdrawalQueue() external view returns (address[] memory) {
        return withdrawalQueue;
    }

    function currentEpoch() external view returns (uint256) {
        return withdrawalEpoch;
    }

    function getFees() external view returns (uint256 mgmtFee, uint256 perfFee) {
        return (managementFeeBps, performanceFeeBps);
    }

    function pricePerShare() public view returns (uint256) {
        uint256 total = totalAssets();
        uint256 supply = totalSupply();
        if (supply == 0) return 1e18;
        return (totalAssets() * 10**18) / supply;
    }

    // ==================== EMERGENCY ====================

    function pause() external onlyRole(EMERGENCY_GUARDIAN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(EMERGENCY_GUARDIAN_ROLE) {
        _unpause();
    }

    // IERC1155 for internal use
    IERC1155 public immutable carbonCreditToken;

    // Helper
    function _calculateAssetsFromShares(uint256 shares) internal view returns (uint256) {
        uint256 supply = totalSupply();
        if (supply == 0) return 0;
        return (shares * totalAssets()) / supply;
    }
}