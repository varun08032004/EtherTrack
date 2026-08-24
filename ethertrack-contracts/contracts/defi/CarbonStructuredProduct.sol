// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import "@openzeppelin/contracts/token/ERC4626/ERC4626.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol"
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/math/SafeERC20.sol";
import "./interfaces/IStructuredProduct.sol";

/**
 * @title CarbonStructuredProduct
 * @dev Structured products for carbon credits (principal protected, yield enhanced, barrier, autocallable)
 * Implements ERC-4626 for share accounting
 */
contract CarbonStructuredProduct is ERC4626, IStructuredProduct, AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using SafeMath for uint256;

    // Role definitions
    bytes32 public constant PRODUCT_MANAGER_ROLE = keccak256("PRODUCT_MANAGER_ROLE");
    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");
    bytes32 public constant SETTLEMENT_ROLE = keccak256("SETTLEMENT_ROLE");
    bytes32 public constant EMERGENCY_GUARDIAN_ROLE = keccak256("EMERGENCY_GUARDIAN_ROLE");

    // Product types
    uint8 constant PRODUCT_PRINCIPAL_PROTECTED = 0;
    uint8 constant PRODUCT_YIELD_ENHANCED = 1;
    uint8 constant PRODUCT_LEVERAGED = 2;
    uint8 constant PRODUCT_BARRIER = 3;
    uint8 constant PRODUCT_AUTOCALLABLE = 4;
    uint8 constant PRODUCT_BASKET = 5;
    uint8 constant PRODUCT_CUSTOM = 6;

    // Product status
    uint8 constant STATUS_DRAFT = 0;
    uint8 constant STATUS_OPEN = 1;
    uint8 constant STATUS_CLOSED = 2;
    uint8 constant STATUS_MATURED = 3;
    uint8 constant STATUS_TERMINATED = 4;

    // Barrier types
    uint8 constant BARRIER_UP_IN = 0;
    uint8 constant BARRIER_UP_OUT = 1;
    uint8 constant BARRIER_DOWN_IN = 2;
    uint8 constant BARRIER_DOWN_OUT = 3;

    // Product configuration
    struct Product {
        uint256 productId;
        string name;
        string description;
        uint8 productType;
        address[] underlyingAssets;
        uint256[] assetIds;
        uint256[] weights; // basis points, sum = 10000
        address quoteAsset;
        uint256 maturity; // Unix timestamp
        uint256 capitalProtection; // basis points (e.g., 10000 = 100%)
        uint256 participationRate; // basis points
        uint256 couponRate; // annual basis points
        uint256 barrierLevel; // basis points
        uint8 barrierType;
        uint256 autocallTrigger; // basis points
        uint256 autocallFrequency; // days
        bool earlyRedemptionEnabled;
        uint256 managementFeeBps;
        uint256 performanceFeeBps;
        uint256 minInvestment;
        uint256 maxInvestment;
        uint256 subscriptionStart;
        uint256 subscriptionEnd;
        uint8 status;
        uint256 initialNav; // 18 decimals
        uint256 totalSubscriptions;
        address feeRecipient;
        uint256 createdAt;
    }

    // Subscription/Position
    struct Subscription {
        uint256 subscriptionId;
        address investor;
        uint256 productId;
        uint256 investmentAmount; // in quote asset
        uint256 units; // shares
        uint256 entryNav; // 18 decimals
        uint256 currentNav; // 18 decimals
        int256 unrealizedPnl;
        uint256 accruedCoupon;
        uint8 status; // 0=SUBSCRIBED, 1=ACTIVE, 2=REDEEMED, 3=MATURED, 4=EARLY_REDEEMED
        uint256 subscribedAt;
        uint256 updatedAt;
    }

    // NAV history
    struct NAVRecord {
        uint256 productId;
        uint256 timestamp;
        uint256 nav; // 18 decimals
        uint256[] underlyingPrices; // 18 decimals each
        uint256 totalAssets;
        uint256 totalLiabilities;
        uint256 sharesOutstanding;
    }

    // Underlying asset config
    struct UnderlyingConfig {
        address asset;
        uint256 assetId;
        uint256 weight; // basis points
        uint256 initialPrice; // 18 decimals
        uint256 currentPrice; // 18 decimals
        bool barrierHit;
    }

    // State variables
    Product[] public products;
    mapping(uint256 => Product) public productMap;
    mapping(uint256 => Subscription) public subscriptions;
    mapping(address => uint256[]) public investorSubscriptions;
    mapping(uint256 => NAVRecord[]) public navHistory;
    mapping(uint256 => UnderlyingConfig[]) public productUnderlyings;
    uint256 public nextProductId;
    uint256 public nextSubscriptionId;
    uint256 public nextNavRecordId;

    // Price feeds
    mapping(address => mapping(uint256 => uint256)) public assetPrices;
    mapping(address => mapping(uint256 => uint256)) public lastPriceUpdate;

    // Events
    event ProductCreated(uint256 indexed productId, string name, uint8 productType);
    event ProductStatusUpdated(uint256 indexed productId, uint8 status);
    event SubscriptionCreated(uint256 indexed subscriptionId, address indexed investor, uint256 productId, uint256 amount);
    event SubscriptionUpdated(uint256 indexed subscriptionId);
    event SubscriptionRedeemed(uint256 indexed subscriptionId, address indexed investor, uint256 amount);
    event NAVUpdated(uint256 indexed productId, uint256 nav, uint256 timestamp);
    event CouponAccrued(uint256 indexed productId, address indexed investor, uint256 amount);
    event EarlyRedemptionTriggered(uint256 indexed productId, uint256 triggerLevel);
    event ProductMatured(uint256 indexed productId);
    event UnderlyingPriceUpdated(address indexed asset, uint256 assetId, uint256 price);
    event EmergencyAction(string action);

    constructor(
        string memory _name,
        string memory _symbol
    ) ERC4626(IERC20(address(0))) ERC20(_name, _symbol) {
        _setRoleAdmin(DEFAULT_ADMIN_ROLE, DEFAULT_ADMIN_ROLE);
        _setRoleAdmin(PRODUCT_MANAGER_ROLE, DEFAULT_ADMIN_ROLE);
        _setRoleAdmin(ORACLE_ROLE, DEFAULT_ADMIN_ROLE);
        _setRoleAdmin(SETTLEMENT_ROLE, DEFAULT_ADMIN_ROLE);
        _setRoleAdmin(EMERGENCY_GUARDIAN_ROLE, DEFAULT_ADMIN_ROLE);
    }

    // ==================== ERC4626 IMPLEMENTATION ====================

    function asset() public view override returns (address) {
        // Return first product's quote asset or address(0) if none
        if (products.length > 0) {
            return products[0].quoteAsset;
        }
        return address(0);
    }

    function totalAssets() public view override returns (uint256) {
        // Sum of all product assets
        uint256 total = 0;
        for (uint256 i = 0; i < products.length; i++) {
            Product storage p = products[i];
            if (p.status == 1 || p.status == 2) { // OPEN or CLOSED
                // Would calculate actual assets under management
            }
        }
        return total;
    }

    function convertToShares(uint256 assets) public view override returns (uint256) {
        // Not used directly - each product has its own NAV
        return assets;
    }

    function convertToAssets(uint256 shares) public view override returns (uint256) {
        return shares;
    }

    function maxDeposit(address receiver) public view override returns (uint256) {
        return type(uint256).max;
    }

    function previewDeposit(uint256 assets) public view override returns (uint256) {
        return assets;
    }

    function deposit(uint256 assets, address receiver) public override returns (uint256 shares) {
        // Not used directly - use subscribe instead
        return 0;
    }

    function mint(uint256 shares, address receiver) public override returns (uint256 assets) {
        return 0;
    }

    function maxWithdraw(address receiver) public view override returns (uint256) {
        return balanceOf(receiver);
    }

    function previewWithdraw(uint256 assets) public view override returns (uint256) {
        return assets;
    }

    function withdraw(uint256 assets, address receiver, address owner) public override returns (uint256 shares) {
        // Use redeemSubscription instead
        return 0;
    }

    function redeem(uint256 shares, address receiver, address owner) public override returns (uint256 assets) {
        return 0;
    }

    // ==================== PRODUCT MANAGEMENT ====================

    function createProduct(
        string memory name,
        string memory description,
        uint8 productType,
        address[] memory underlyingAssets,
        uint256[] memory assetIds,
        uint256[] memory weights,
        address quoteAsset,
        uint256 maturity,
        uint256 capitalProtection,
        uint256 participationRate,
        uint256 couponRate,
        uint256 barrierLevel,
        uint8 barrierType,
        uint256 autocallTrigger,
        uint256 autocallFrequency,
        bool earlyRedemptionEnabled,
        uint256 managementFeeBps,
        uint256 performanceFeeBps,
        uint256 minInvestment,
        uint256 maxInvestment,
        uint256 subscriptionStart,
        uint256 subscriptionEnd,
        address feeRecipient
    ) external onlyRole(PRODUCT_MANAGER_ROLE) returns (uint256) {
        require(underlyingAssets.length == assetIds.length, "Array length mismatch");
        require(underlyingAssets.length == weights.length, "Array length mismatch");
        
        uint256 totalWeight = 0;
        for (uint256 i = 0; i < weights.length; i++) {
            totalWeight += weights[i];
        }
        require(totalWeight == 10000, "Weights must sum to 10000");

        require(maturity > block.timestamp, "Maturity must be in future");
        require(subscriptionEnd <= maturity, "Subscription end after maturity");
        require(capitalProtection <= 10000, "Capital protection > 100%");
        require(managementFeeBps <= 500, "Management fee > 5%");
        require(performanceFeeBps <= 10000, "Performance fee > 100%");

        uint256 productId = nextProductId++;
        
        Product memory product = Product({
            productId: productId,
            name: name,
            description: description,
            productType: productType,
            underlyingAssets: underlyingAssets,
            assetIds: assetIds,
            weights: weights,
            quoteAsset: quoteAsset,
            maturity: maturity,
            capitalProtection: capitalProtection,
            participationRate: participationRate,
            couponRate: couponRate,
            barrierLevel: barrierLevel,
            barrierType: barrierType,
            autocallTrigger: autocallTrigger,
            autocallFrequency: autocallFrequency,
            earlyRedemptionEnabled: earlyRedemptionEnabled,
            managementFeeBps: managementFeeBps,
            performanceFeeBps: performanceFeeBps,
            minInvestment: minInvestment,
            maxInvestment: maxInvestment,
            subscriptionStart: subscriptionStart,
            subscriptionEnd: subscriptionEnd,
            status: 0, // DRAFT
            initialNav: 1e18, // 1.0
            totalSubscriptions: 0,
            feeRecipient: feeRecipient,
            createdAt: block.timestamp
        });

        products.push(product);
        productMap[productId] = product;

        // Initialize underlying configs
        UnderlyingConfig[] memory configs = new UnderlyingConfig[](underlyingAssets.length);
        for (uint256 i = 0; i < underlyingAssets.length; i++) {
            configs[i] = UnderlyingConfig({
                asset: underlyingAssets[i],
                assetId: assetIds[i],
                weight: weights[i],
                initialPrice: 0,
                currentPrice: 0,
                barrierHit: false
            });
        }
        productUnderlyings[productId] = configs;

        emit ProductCreated(productId, name, productType);
        return productId;
    }

    function openProduct(uint256 productId) external onlyRole(PRODUCT_MANAGER_ROLE) {
        Product storage product = productMap[productId];
        require(product.productId == productId, "Product not found");
        require(product.status == 0, "Product not in draft");
        require(block.timestamp >= product.subscriptionStart, "Subscription not started");

        product.status = 1; // OPEN
        emit ProductStatusUpdated(productId, 1);
    }

    function closeProduct(uint256 productId) external onlyRole(PRODUCT_MANAGER_ROLE) {
        Product storage product = productMap[productId];
        require(product.productId == productId, "Product not found");
        require(product.status == 1, "Product not open");

        product.status = 2; // CLOSED
        emit ProductStatusUpdated(productId, 2);
    }

    // ==================== SUBSCRIPTION ====================

    function subscribe(uint256 productId, uint256 amount) external nonReentrant whenNotPaused returns (uint256) {
        Product storage product = productMap[productId];
        require(product.productId == productId, "Product not found");
        require(product.status == 1, "Product not open for subscription");
        require(block.timestamp >= product.subscriptionStart, "Subscription not started");
        require(block.timestamp <= product.subscriptionEnd, "Subscription ended");
        require(amount >= product.minInvestment, "Below minimum investment");
        require(amount <= product.maxInvestment, "Above maximum investment");
        require(product.totalSubscriptions + amount <= product.maxInvestment, "Max investment reached");

        IERC20(product.quoteAsset).safeTransferFrom(msg.sender, address(this), amount);

        uint256 subscriptionId = nextSubscriptionId++;
        uint256 units = (amount * 1e18) / product.initialNav; // shares = amount / NAV

        Subscription memory subscription = Subscription({
            subscriptionId: subscriptionId,
            investor: msg.sender,
            productId: productId,
            investmentAmount: amount,
            units: units,
            entryNav: product.initialNav,
            currentNav: product.initialNav,
            unrealizedPnl: 0,
            accruedCoupon: 0,
            status: 0, // SUBSCRIBED
            subscribedAt: block.timestamp,
            updatedAt: block.timestamp
        });

        subscriptions[subscriptionId] = subscription;
        investorSubscriptions[msg.sender].push(subscriptionId);

        product.totalSubscriptions += amount;
        _mint(msg.sender, units);

        emit SubscriptionCreated(subscriptionId, msg.sender, productId, amount);
        return subscriptionId;
    }

    function redeem(uint256 subscriptionId) external nonReentrant whenNotPaused {
        Subscription storage subscription = subscriptions[subscriptionId];
        require(subscription.investor == msg.sender, "Not subscription owner");
        require(subscription.status == 1 || subscription.status == 0, "Not redeemable");

        Product storage product = productMap[subscription.productId];
        uint256 currentNav = _calculateNAV(subscription.productId);
        
        uint256 redemptionValue = (subscription.units * currentNav) / 1e18;
        
        // Apply performance fee if NAV > entry NAV
        if (currentNav > subscription.entryNav) {
            uint256 profit = redemptionValue - subscription.investmentAmount;
            uint256 fee = (profit * product.performanceFeeBps) / 10000;
            if (redemptionValue >= fee) {
                redemptionValue -= fee;
                IERC20(product.quoteAsset).safeTransfer(product.feeRecipient, fee);
            }
        }

        // Apply management fee
        uint256 daysHeld = (block.timestamp - subscription.subscribedAt) / 86400;
        uint256 mgmtFee = (redemptionValue * product.managementFeeBps * daysHeld) / (10000 * 365);
        if (redemptionValue >= mgmtFee) {
            redemptionValue -= mgmtFee;
            IERC20(product.quoteAsset).safeTransfer(product.feeRecipient, mgmtFee);
        }

        _burn(msg.sender, subscription.units);
        IERC20(product.quoteAsset).safeTransfer(msg.sender, redemptionValue);

        subscription.status = 2; // REDEEMED
        subscription.currentNav = currentNav;
        subscription.unrealizedPnl = int256(redemptionValue) - int256(subscription.investmentAmount);
        subscription.updatedAt = block.timestamp;

        emit SubscriptionRedeemed(subscriptionId, msg.sender, redemptionValue);
    }

    // ==================== NAV CALCULATION ====================

    function updateNAV(uint256 productId) external onlyRole(ORACLE_ROLE) {
        Product storage product = productMap[productId];
        require(product.productId == productId, "Product not found");
        require(product.status == 1 || product.status == 2, "Product not active");

        uint256 nav = _calculateNAV(productId);
        
        // Record NAV
        NAVRecord memory record = NAVRecord({
            productId: productId,
            timestamp: block.timestamp,
            nav: nav,
            underlyingPrices: _getCurrentPrices(productId),
            totalAssets: product.totalSubscriptions,
            totalLiabilities: 0,
            sharesOutstanding: totalSupply()
        });

        navHistory[productId].push(record);

        // Update subscription current NAV
        for (uint256 i = 0; i < investorSubscriptions[address(this)].length; i++) {
            // Would update all subscriptions
        }

        emit NAVUpdated(productId, nav, block.timestamp);
    }

    function _calculateNAV(uint256 productId) internal view returns (uint256) {
        Product storage product = productMap[productId];
        UnderlyingConfig[] storage underlyings = productUnderlyings[productId];

        // Calculate basket performance
        int256 basketPerformance = 0;
        uint256 totalWeight = 0;

        for (uint256 i = 0; i < underlyings.length; i++) {
            UnderlyingConfig storage uc = underlyings[i];
            if (uc.initialPrice > 0 && uc.currentPrice > 0) {
                int256 performance = int256(uc.currentPrice) - int256(uc.initialPrice);
                performance = (performance * 10000) / int256(uc.initialPrice); // basis points
                basketPerformance += performance * int256(uc.weight);
                totalWeight += uc.weight;
            }
        }

        if (totalWeight == 0) return product.initialNav;

        basketPerformance = basketPerformance / int256(totalWeight); // basis points

        uint256 nav = product.initialNav;

        // Apply product-specific logic
        if (product.productType == PRODUCT_PRINCIPAL_PROTECTED) {
            // Principal protected with participation
            int256 participation = (basketPerformance * int256(product.participationRate)) / 10000;
            if (participation > 0) {
                nav = nav + ((nav * uint256(participation)) / 10000);
            }
            // Floor at capital protection
            uint256 floor = (product.initialNav * product.capitalProtection) / 10000;
            if (nav < floor) nav = floor;
        } else if (product.productType == PRODUCT_YIELD_ENHANCED) {
            // Yield enhanced
            int256 participation = (basketPerformance * int256(product.participationRate)) / 10000;
            nav = nav + ((nav * uint256(participation > 0 ? participation : 0)) / 10000);
            
            // Add coupon
            if (product.couponRate > 0) {
                uint256 daysElapsed = (block.timestamp - product.subscriptionStart) / 86400;
                uint256 coupon = (nav * product.couponRate * daysElapsed) / (10000 * 365);
                nav += coupon;
            }
        } else if (product.productType == PRODUCT_BARRIER) {
            // Check barrier
            bool barrierHit = false;
            for (uint256 i = 0; i < underlyings.length; i++) {
                UnderlyingConfig storage uc = underlyings[i];
                if (uc.initialPrice > 0 && uc.currentPrice > 0) {
                    int256 perf = (int256(uc.currentPrice) - int256(uc.initialPrice)) * 10000 / int256(uc.initialPrice);
                    if (product.barrierType == BARRIER_UP_IN || product.barrierType == BARRIER_UP_OUT) {
                        if (perf >= int256(product.barrierLevel)) barrierHit = true;
                    } else {
                        if (perf <= -int256(product.barrierLevel)) barrierHit = true;
                    }
                }
                uc.barrierHit = barrierHit;
            }

            if ((product.barrierType == BARRIER_UP_IN || product.barrierType == BARRIER_DOWN_IN) && !barrierHit) {
                // Barrier not hit - return capital protection
                nav = (product.initialNav * product.capitalProtection) / 10000;
            } else if ((product.barrierType == BARRIER_UP_OUT || product.barrierType == BARRIER_DOWN_OUT) && barrierHit) {
                // Barrier hit - return capital protection
                nav = (product.initialNav * product.capitalProtection) / 10000;
            } else {
                // Normal participation
                int256 participation = (basketPerformance * int256(product.participationRate)) / 10000;
                if (participation > 0) {
                    nav = nav + ((nav * uint256(participation)) / 10000);
                }
            }
        } else if (product.productType == PRODUCT_AUTOCALLABLE) {
            // Check autocall trigger
            bool autoCalled = false;
            for (uint256 i = 0; i < underlyings.length; i++) {
                UnderlyingConfig storage uc = underlyings[i];
                if (uc.initialPrice > 0 && uc.currentPrice > 0) {
                    int256 perf = (int256(uc.currentPrice) - int256(uc.initialPrice)) * 10000 / int256(uc.initialPrice);
                    if (perf >= int256(product.autocallTrigger)) {
                        autoCalled = true;
                        break;
                    }
                }
            }

            if (autoCalled && product.earlyRedemptionEnabled) {
                // Early redemption at par + coupon
                nav = product.initialNav;
                if (product.couponRate > 0) {
                    uint256 daysElapsed = (block.timestamp - product.subscriptionStart) / 86400;
                    uint256 coupon = (nav * product.couponRate * daysElapsed) / (10000 * 365);
                    nav += coupon;
                }
                product.status = 4; // EARLY_REDEEMED
                emit EarlyRedemptionTriggered(productId, product.autocallTrigger);
            } else {
                int256 participation = (basketPerformance * int256(product.participationRate)) / 10000;
                if (participation > 0) {
                    nav = nav + ((nav * uint256(participation)) / 10000);
                }
            }
        } else {
            // Default: linear participation
            int256 participation = (basketPerformance * int256(product.participationRate)) / 10000;
            if (participation > 0) {
                nav = nav + ((nav * uint256(participation)) / 10000);
            }
        }

        // Deduct management fee accrual
        uint256 daysSinceStart = (block.timestamp - product.createdAt) / 86400;
        if (daysSinceStart > 0) {
            uint256 fee = (nav * product.managementFeeBps * daysSinceStart) / (10000 * 365);
            if (nav >= fee) nav -= fee;
        }

        return nav;
    }

    function _getCurrentPrices(uint256 productId) internal view returns (uint256[] memory) {
        UnderlyingConfig[] storage underlyings = productUnderlyings[productId];
        uint256[] memory prices = new uint256[](underlyings.length);
        for (uint256 i = 0; i < underlyings.length; i++) {
            prices[i] = underlyings[i].currentPrice;
        }
        return prices;
    }

    // ==================== PRICE UPDATES ====================

    function updateUnderlyingPrice(address asset, uint256 assetId, uint256 price) external onlyRole(ORACLE_ROLE) {
        assetPrices[asset][assetId] = price;
        lastPriceUpdate[asset][assetId] = block.timestamp;

        // Update product underlyings
        for (uint256 i = 0; i < products.length; i++) {
            Product storage p = products[i];
            for (uint256 j = 0; j < p.underlyingAssets.length; j++) {
                if (p.underlyingAssets[j] == asset && p.assetIds[j] == assetId) {
                    productUnderlyings[p.productId][j].currentPrice = price;
                    if (productUnderlyings[p.productId][j].initialPrice == 0) {
                        productUnderlyings[p.productId][j].initialPrice = price;
                    }
                }
            }
        }

        emit UnderlyingPriceUpdated(asset, assetId, price);
    }

    // ==================== MATURITY ====================

    function matureProduct(uint256 productId) external onlyRole(SETTLEMENT_ROLE) {
        Product storage product = productMap[productId];
        require(product.productId == productId, "Product not found");
        require(product.status == 1 || product.status == 2, "Product not active");
        require(block.timestamp >= product.maturity, "Not yet matured");

        product.status = 3; // MATURED
        
        // All subscriptions can now be redeemed at final NAV
        emit ProductMatured(productId);
    }

    // ==================== VIEW FUNCTIONS ====================

    function getProduct(uint256 productId) external view returns (Product memory) {
        return productMap[productId];
    }

    function getProducts() external view returns (Product[] memory) {
        return products;
    }

    function getSubscription(uint256 subscriptionId) external view returns (Subscription memory) {
        return subscriptions[subscriptionId];
    }

    function getInvestorSubscriptions(address investor) external view returns (uint256[] memory) {
        return investorSubscriptions[investor];
    }

    function getNAVHistory(uint256 productId, uint256 limit) external view returns (NAVRecord[] memory) {
        NAVRecord[] storage history = navHistory[productId];
        uint256 start = history.length > limit ? history.length - limit : 0;
        NAVRecord[] memory result = new NAVRecord[](history.length - start);
        for (uint256 i = 0; i < result.length; i++) {
            result[i] = history[start + i];
        }
        return result;
    }

    function getCurrentNAV(uint256 productId) external view returns (uint256) {
        return _calculateNAV(productId);
    }

    function getProductUnderlyings(uint256 productId) external view returns (UnderlyingConfig[] memory) {
        return productUnderlyings[productId];
    }

    // ==================== EMERGENCY ====================

    function pause() external onlyRole(EMERGENCY_GUARDIAN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(EMERGENCY_GUARDIAN_ROLE) {
        _unpause();
    }
}