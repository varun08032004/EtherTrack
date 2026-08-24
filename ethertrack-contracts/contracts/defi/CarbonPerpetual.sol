// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/math/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "./interfaces/ICarbonPerpetual.sol";

/**
 * @title CarbonPerpetual
 * @dev Perpetual futures contract for carbon credits
 * Supports up to 10x leverage, funding rates, auto-deleveraging
 */
contract CarbonPerpetual is ICarbonPerpetual, AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using SafeMath for uint256;

    // Role definitions
    bytes32 public constant MARKET_ADMIN_ROLE = keccak256("MARKET_ADMIN_ROLE");
    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");
    bytes32 public constant LIQUIDATOR_ROLE = keccak256("LIQUIDATOR_ROLE");
    bytes32 public constant INSURANCE_FUND_ROLE = keccak256("INSURANCE_FUND_ROLE");
    bytes32 public constant EMERGENCY_GUARDIAN_ROLE = keccak256("EMERGENCY_GUARDIAN_ROLE");

    // Market configuration
    struct Market {
        uint256 marketId;
        address underlyingAsset; // ERC-1155 carbon credit
        uint256 assetId; // Batch ID
        address quoteAsset; // USDC/USDT/DAI
        uint256 fundingRateCap; // basis points
        uint256 fundingInterval; // seconds
        uint256 markPriceSource; // 0=ORACLE, 1=TWAP, 2=MARKET
        address oracle;
        uint256 twapWindow;
        uint256 maintenanceMarginRatio; // basis points
        uint256 initialMarginRatio; // basis points
        uint256 maxLeverage;
        uint256 tickSize;
        uint256 lotSize;
        uint256 makerFeeBps;
        uint256 takerFeeBps;
        address insuranceFund;
        bool autoDeleveragingEnabled;
        bool active;
        uint256 createdAt;
    }

    // Position tracking
    struct Position {
        uint256 positionId;
        address trader;
        uint256 marketId;
        bool isLong;
        uint256 size; // in quote asset (USDC)
        uint256 entryPrice; // 18 decimals
        uint256 markPrice; // 18 decimals
        int256 unrealizedPnl;
        int256 realizedPnl;
        uint256 margin;
        uint256 leverage;
        uint256 liquidationPrice; // 18 decimals
        int256 fundingPaid;
        uint256 lastFundingTime;
        uint256 openedAt;
        uint256 updatedAt;
        uint8 status; // 0=OPEN, 1=CLOSED, 2=LIQUIDATED, 3=ADL
    }

    // Order book
    struct Order {
        uint256 orderId;
        address trader;
        uint256 marketId;
        bool isBuy;
        uint8 orderType; // 0=MARKET, 1=LIMIT, 2=STOP_MARKET, 3=STOP_LIMIT, 4=POST_ONLY, 5=IOC, 6=FOK
        uint256 size;
        uint256 price;
        uint256 stopPrice;
        bool reduceOnly;
        bool postOnly;
        uint8 timeInForce; // 0=GTC, 1=IOC, 2=FOK
        uint8 status; // 0=PENDING, 1=OPEN, 2=PARTIAL, 3=FILLED, 4=CANCELLED, 5=REJECTED
        uint256 filledSize;
        uint256 avgFillPrice;
        uint256 feePaid;
        uint256 createdAt;
        uint256 updatedAt;
    }

    // Funding rate history
    struct FundingRate {
        uint256 marketId;
        uint256 timestamp;
        int256 fundingRate; // basis points, can be negative
        uint256 markPrice;
        uint256 indexPrice;
        int256 premiumIndex;
        uint256 nextFundingTime;
    }

    // State variables
    Market[] public markets;
    mapping(uint256 => Market) public marketMap;
    mapping(uint256 => Position) public positions;
    mapping(uint256 => Order) public orders;
    mapping(uint256 => FundingRate[]) public fundingHistory;
    mapping(address => uint256[]) public traderPositions;
    mapping(address => uint256[]) public traderOrders;
    uint256 public nextMarketId;
    uint256 public nextPositionId;
    uint256 public nextOrderId;
    uint256 public nextFundingRateId;

    // Price feeds
    mapping(uint256 => uint256) public markPrices;
    mapping(uint256 => uint256) public indexPrices;
    mapping(uint256 => uint256) public lastPriceUpdate;

    // Events
    event MarketCreated(uint256 indexed marketId, address indexed underlyingAsset, uint256 assetId);
    event MarketUpdated(uint256 indexed marketId);
    event PositionOpened(uint256 indexed positionId, address indexed trader, uint256 marketId, bool isLong);
    event PositionUpdated(uint256 indexed positionId);
    event PositionClosed(uint256 indexed positionId, address indexed trader, int256 realizedPnl);
    event PositionLiquidated(uint256 indexed positionId, address indexed trader, address indexed liquidator);
    event OrderPlaced(uint256 indexed orderId, address indexed trader, uint256 marketId, bool isBuy);
    event OrderFilled(uint256 indexed orderId, uint256 filledSize, uint256 fillPrice);
    event OrderCancelled(uint256 indexed orderId);
    event FundingRateUpdated(uint256 indexed marketId, int256 fundingRate, uint256 nextFundingTime);
    event MarkPriceUpdated(uint256 indexed marketId, uint256 markPrice, uint256 indexPrice);
    event InsuranceFundDeposit(address indexed from, uint256 amount);
    event InsuranceFundWithdrawal(address indexed to, uint256 amount);
    event EmergencyAction(string action);

    // Constructor
    constructor() {
        _setRoleAdmin(DEFAULT_ADMIN_ROLE, DEFAULT_ADMIN_ROLE);
        _setRoleAdmin(MARKET_ADMIN_ROLE, DEFAULT_ADMIN_ROLE);
        _setRoleAdmin(ORACLE_ROLE, DEFAULT_ADMIN_ROLE);
        _setRoleAdmin(LIQUIDATOR_ROLE, DEFAULT_ADMIN_ROLE);
        _setRoleAdmin(INSURANCE_FUND_ROLE, DEFAULT_ADMIN_ROLE);
        _setRoleAdmin(EMERGENCY_GUARDIAN_ROLE, DEFAULT_ADMIN_ROLE);
    }

    // ==================== MARKET MANAGEMENT ====================

    function createMarket(
        address underlyingAsset,
        uint256 assetId,
        address quoteAsset,
        uint256 fundingRateCap,
        uint256 fundingInterval,
        uint256 markPriceSource,
        address oracle,
        uint256 twapWindow,
        uint256 maintenanceMarginRatio,
        uint256 initialMarginRatio,
        uint256 maxLeverage,
        uint256 tickSize,
        uint256 lotSize,
        uint256 makerFeeBps,
        uint256 takerFeeBps,
        address insuranceFund,
        bool autoDeleveragingEnabled
    ) external onlyRole(MARKET_ADMIN_ROLE) returns (uint256) {
        require(fundingRateCap <= 7500, "Funding rate cap too high"); // max 75%
        require(maintenanceMarginRatio < initialMarginRatio, "Maintenance >= Initial");
        require(initialMarginRatio <= 10000, "Initial margin too high"); // max 100%
        require(maxLeverage <= 50, "Max leverage too high"); // max 50x

        uint256 marketId = nextMarketId++;
        
        Market memory market = Market({
            marketId: marketId,
            underlyingAsset: underlyingAsset,
            assetId: assetId,
            quoteAsset: quoteAsset,
            fundingRateCap: fundingRateCap,
            fundingInterval: fundingInterval,
            markPriceSource: markPriceSource,
            oracle: oracle,
            twapWindow: twapWindow,
            maintenanceMarginRatio: maintenanceMarginRatio,
            initialMarginRatio: initialMarginRatio,
            maxLeverage: maxLeverage,
            tickSize: tickSize,
            lotSize: lotSize,
            makerFeeBps: makerFeeBps,
            takerFeeBps: takerFeeBps,
            insuranceFund: insuranceFund,
            autoDeleveragingEnabled: autoDeleveragingEnabled,
            active: true,
            createdAt: block.timestamp
        });

        markets.push(market);
        marketMap[marketId] = market;

        emit MarketCreated(marketId, underlyingAsset, assetId);
        return marketId;
    }

    function updateMarket(uint256 marketId, uint256 fundingRateCap, uint256 maintenanceMarginRatio, uint256 initialMarginRatio, uint256 maxLeverage, bool active) external onlyRole(MARKET_ADMIN_ROLE) {
        Market storage market = marketMap[marketId];
        require(market.marketId == marketId, "Market not found");
        
        if (fundingRateCap > 0) market.fundingRateCap = fundingRateCap;
        if (maintenanceMarginRatio > 0) market.maintenanceMarginRatio = maintenanceMarginRatio;
        if (initialMarginRatio > 0) market.initialMarginRatio = initialMarginRatio;
        if (maxLeverage > 0) market.maxLeverage = maxLeverage;
        market.active = active;

        emit MarketUpdated(marketId);
    }

    // ==================== POSITION MANAGEMENT ====================

    function openPosition(
        uint256 marketId,
        bool isLong,
        uint256 size,
        uint256 margin,
        uint256 leverage
    ) external nonReentrant whenNotPaused returns (uint256) {
        Market storage market = marketMap[marketId];
        require(market.active, "Market not active");
        require(size >= market.lotSize, "Size below lot size");
        require(leverage <= market.maxLeverage, "Leverage too high");
        require(margin >= (size * market.initialMarginRatio) / 10000, "Insufficient margin");

        uint256 markPrice = markPrices[marketId];
        require(markPrice > 0, "No mark price available");

        // Transfer margin from trader
        IERC20(market.quoteAsset).safeTransferFrom(msg.sender, address(this), margin);

        uint256 positionId = nextPositionId++;
        uint256 liquidationPrice = _calculateLiquidationPrice(isLong, markPrice, leverage, market.maintenanceMarginRatio);

        Position memory position = Position({
            positionId: positionId,
            trader: msg.sender,
            marketId: marketId,
            isLong: isLong,
            size: size,
            entryPrice: markPrice,
            markPrice: markPrice,
            unrealizedPnl: 0,
            realizedPnl: 0,
            margin: margin,
            leverage: leverage,
            liquidationPrice: liquidationPrice,
            fundingPaid: 0,
            lastFundingTime: block.timestamp,
            openedAt: block.timestamp,
            updatedAt: block.timestamp,
            status: 0 // OPEN
        });

        positions[positionId] = position;
        traderPositions[msg.sender].push(positionId);

        emit PositionOpened(positionId, msg.sender, marketId, isLong);
        return positionId;
    }

    function closePosition(uint256 positionId) external nonReentrant whenNotPaused {
        Position storage position = positions[positionId];
        require(position.trader == msg.sender, "Not position owner");
        require(position.status == 0, "Position not open");

        Market storage market = marketMap[position.marketId];
        uint256 markPrice = markPrices[position.marketId];
        require(markPrice > 0, "No mark price");

        // Calculate PnL
        int256 pnl = _calculatePnl(position, markPrice);
        position.realizedPnl += pnl;
        position.unrealizedPnl = 0;

        // Calculate return amount
        uint256 returnAmount = position.margin;
        if (pnl > 0) {
            returnAmount += uint256(pnl);
        } else {
            require(returnAmount >= uint256(-pnl), "Insufficient margin for loss");
            returnAmount -= uint256(-pnl);
        }

        // Pay fees
        uint256 fee = (position.size * market.takerFeeBps) / 10000;
        if (returnAmount >= fee) {
            returnAmount -= fee;
        } else {
            fee = returnAmount;
            returnAmount = 0;
        }

        // Transfer back to trader
        if (returnAmount > 0) {
            IERC20(market.quoteAsset).safeTransfer(msg.sender, returnAmount);
        }
        if (fee > 0) {
            IERC20(market.quoteAsset).safeTransfer(market.insuranceFund, fee);
        }

        position.status = 1; // CLOSED
        position.updatedAt = block.timestamp;

        emit PositionClosed(positionId, msg.sender, pnl);
    }

    function addMargin(uint256 positionId, uint256 amount) external nonReentrant whenNotPaused {
        Position storage position = positions[positionId];
        require(position.trader == msg.sender, "Not position owner");
        require(position.status == 0, "Position not open");
        require(amount > 0, "Amount must be > 0");

        Market storage market = marketMap[position.marketId];
        IERC20(market.quoteAsset).safeTransferFrom(msg.sender, address(this), amount);
        position.margin += amount;
        position.updatedAt = block.timestamp;

        // Recalculate liquidation price
        position.liquidationPrice = _calculateLiquidationPrice(position.isLong, position.markPrice, position.leverage, market.maintenanceMarginRatio);

        emit PositionUpdated(positionId);
    }

    // ==================== ORDER MANAGEMENT ====================

    function placeOrder(
        uint256 marketId,
        bool isBuy,
        uint8 orderType,
        uint256 size,
        uint256 price,
        uint256 stopPrice,
        bool reduceOnly,
        bool postOnly,
        uint8 timeInForce
    ) external nonReentrant whenNotPaused returns (uint256) {
        Market storage market = marketMap[marketId];
        require(market.active, "Market not active");
        require(size >= market.lotSize, "Size below lot size");
        
        if (orderType == 1 || orderType == 3 || orderType == 4) { // LIMIT, STOP_LIMIT, POST_ONLY
            require(price > 0, "Price required for limit orders");
            require(price % market.tickSize == 0, "Invalid tick size");
        }

        uint256 orderId = nextOrderId++;
        uint256 markPrice = markPrices[marketId];

        Order memory order = Order({
            orderId: orderId,
            trader: msg.sender,
            marketId: marketId,
            isBuy: isBuy,
            orderType: orderType,
            size: size,
            price: price,
            stopPrice: stopPrice,
            reduceOnly: reduceOnly,
            postOnly: postOnly,
            timeInForce: timeInForce,
            status: 0, // PENDING
            filledSize: 0,
            avgFillPrice: 0,
            feePaid: 0,
            createdAt: block.timestamp,
            updatedAt: block.timestamp
        });

        orders[orderId] = order;
        traderOrders[msg.sender].push(orderId);

        // Try to match immediately for market orders
        if (orderType == 0) { // MARKET
            _matchOrder(orderId);
        }

        emit OrderPlaced(orderId, msg.sender, marketId, isBuy);
        return orderId;
    }

    function cancelOrder(uint256 orderId) external nonReentrant {
        Order storage order = orders[orderId];
        require(order.trader == msg.sender, "Not order owner");
        require(order.status == 1 || order.status == 0, "Order not cancellable");

        order.status = 4; // CANCELLED
        order.updatedAt = block.timestamp;

        emit OrderCancelled(orderId);
    }

    // ==================== FUNDING RATES ====================

    function updateFundingRate(uint256 marketId) external onlyRole(ORACLE_ROLE) {
        Market storage market = marketMap[marketId];
        require(market.active, "Market not active");

        uint256 markPrice = markPrices[marketId];
        uint256 indexPrice = indexPrices[marketId];
        require(markPrice > 0 && indexPrice > 0, "Prices not available");

        // Calculate funding rate
        // fundingRate = (markPrice - indexPrice) / indexPrice * (8 hours / fundingInterval)
        int256 premium = int256(int256(markPrice) - int256(indexPrice));
        int256 fundingRate = (premium * int256(10000)) / int256(indexPrice); // basis points
        fundingRate = fundingRate * int256(8 * 3600) / int256(market.fundingInterval);
        
        // Cap funding rate
        if (fundingRate > int256(market.fundingRateCap)) fundingRate = int256(market.fundingRateCap);
        if (fundingRate < int256(-market.fundingRateCap)) fundingRate = int256(-market.fundingRateCap);

        uint256 nextFundingTime = block.timestamp + market.fundingInterval;

        FundingRate memory fr = FundingRate({
            marketId: marketId,
            timestamp: block.timestamp,
            fundingRate: fundingRate,
            markPrice: markPrice,
            indexPrice: indexPrice,
            premiumIndex: premium * int256(10000) / int256(indexPrice),
            nextFundingTime: nextFundingTime
        });

        fundingHistory[marketId].push(fr);

        emit FundingRateUpdated(marketId, fundingRate, nextFundingTime);
    }

    function settleFunding(uint256 positionId) external nonReentrant {
        Position storage position = positions[positionId];
        require(position.status == 0, "Position not open");

        Market storage market = marketMap[position.marketId];
        FundingRate[] storage history = fundingHistory[position.marketId];
        
        // Find funding rates since last settlement
        for (uint256 i = 0; i < history.length; i++) {
            if (history[i].timestamp > position.lastFundingTime) {
                // funding = positionSize * fundingRate / 10000
                int256 funding = (int256(position.size) * history[i].fundingRate) / 10000;
                
                // Long pays funding when rate positive, short pays when negative
                if (position.isLong) {
                    position.fundingPaid -= funding;
                } else {
                    position.fundingPaid += funding;
                }
            }
        }

        position.lastFundingTime = block.timestamp;
        position.updatedAt = block.timestamp;

        emit PositionUpdated(positionId);
    }

    // ==================== LIQUIDATION ====================

    function liquidate(uint256 positionId) external nonReentrant onlyRole(LIQUIDATOR_ROLE) {
        Position storage position = positions[positionId];
        require(position.status == 0, "Position not open");
        require(position.trader != msg.sender, "Cannot self-liquidate");

        uint256 markPrice = markPrices[position.marketId];
        require(markPrice > 0, "No mark price");

        // Check if liquidatable
        bool shouldLiquidate = position.isLong 
            ? markPrice <= position.liquidationPrice
            : markPrice >= position.liquidationPrice;
        
        require(shouldLiquidate, "Position not liquidatable");

        Market storage market = marketMap[position.marketId];

        // Calculate liquidation penalty (e.g., 5% of position size)
        uint256 penalty = (position.size * 500) / 10000; // 5%
        
        // Transfer remaining margin to liquidator (minus penalty)
        uint256 liquidatorReward = position.margin > penalty ? position.margin - penalty : 0;
        
        if (liquidatorReward > 0) {
            IERC20(market.quoteAsset).safeTransfer(msg.sender, liquidatorReward);
        }
        if (penalty > 0) {
            IERC20(market.quoteAsset).safeTransfer(market.insuranceFund, penalty);
        }

        position.status = 2; // LIQUIDATED
        position.updatedAt = block.timestamp;

        emit PositionLiquidated(positionId, position.trader, msg.sender);
    }

    function autoDeleverage(uint256 marketId) external nonReentrant onlyRole(LIQUIDATOR_ROLE) {
        Market storage market = marketMap[marketId];
        require(market.autoDeleveragingEnabled, "ADL not enabled");

        // Find positions with highest leverage/profit for deleveraging
        // Simplified: just emit event, real implementation would sort positions
        emit EmergencyAction("Auto-deleveraging triggered for market " + marketId.toString());
    }

    // ==================== PRICE UPDATES ====================

    function updateMarkPrice(uint256 marketId, uint256 markPrice, uint256 indexPrice) external onlyRole(ORACLE_ROLE) {
        Market storage market = marketMap[marketId];
        require(market.active, "Market not active");
        
        markPrices[marketId] = markPrice;
        indexPrices[marketId] = indexPrice;
        lastPriceUpdate[marketId] = block.timestamp;

        // Update position mark prices and check liquidations
        // In production, would iterate through positions
        // For gas efficiency, this is done off-chain or via liquidator bots

        emit MarkPriceUpdated(marketId, markPrice, indexPrice);
    }

    // ==================== INSURANCE FUND ====================

    function depositToInsuranceFund(uint256 marketId, uint256 amount) external {
        Market storage market = marketMap[marketId];
        IERC20(market.quoteAsset).safeTransferFrom(msg.sender, address(this), amount);
        emit InsuranceFundDeposit(msg.sender, amount);
    }

    function withdrawFromInsuranceFund(uint256 marketId, uint256 amount) external onlyRole(INSURANCE_FUND_ROLE) {
        Market storage market = marketMap[marketId];
        IERC20(market.quoteAsset).safeTransfer(msg.sender, amount);
        emit InsuranceFundWithdrawal(msg.sender, amount);
    }

    // ==================== VIEW FUNCTIONS ====================

    function getMarket(uint256 marketId) external view returns (Market memory) {
        return marketMap[marketId];
    }

    function getMarkets() external view returns (Market[] memory) {
        return markets;
    }

    function getPosition(uint256 positionId) external view returns (Position memory) {
        return positions[positionId];
    }

    function getTraderPositions(address trader) external view returns (uint256[] memory) {
        return traderPositions[trader];
    }

    function getOrder(uint256 orderId) external view returns (Order memory) {
        return orders[orderId];
    }

    function getTraderOrders(address trader) external view returns (uint256[] memory) {
        return traderOrders[trader];
    }

    function getFundingHistory(uint256 marketId, uint256 limit) external view returns (FundingRate[] memory) {
        FundingRate[] storage history = fundingHistory[marketId];
        uint256 start = history.length > limit ? history.length - limit : 0;
        FundingRate[] memory result = new FundingRate[](history.length - start);
        for (uint256 i = 0; i < result.length; i++) {
            result[i] = history[start + i];
        }
        return result;
    }

    function getMarkPrice(uint256 marketId) external view returns (uint256) {
        return markPrices[marketId];
    }

    function getIndexPrice(uint256 marketId) external view returns (uint256) {
        return indexPrices[marketId];
    }

    // ==================== INTERNAL FUNCTIONS ====================

    function _calculatePnl(Position storage position, uint256 markPrice) internal pure returns (int256) {
        if (position.isLong) {
            return int256((markPrice * position.size) / position.entryPrice) - int256(position.size);
        } else {
            return int256(position.size) - int256((markPrice * position.size) / position.entryPrice);
        }
    }

    function _calculateLiquidationPrice(bool isLong, uint256 markPrice, uint256 leverage, uint256 maintenanceMarginRatio) internal pure returns (uint256) {
        uint256 maintenanceMargin = maintenanceMarginRatio / 10000; // Convert from basis points
        uint256 initialMargin = 10000 / leverage; // 1/leverage
        
        if (isLong) {
            // Long: liquidation when markPrice <= entryPrice * (1 - initialMargin + maintenanceMargin)
            // Assuming entryPrice == markPrice for calculation
            if (markPrice <= (initialMargin - maintenanceMargin) * markPrice / 10000) {
                return 0;
            }
            return (markPrice * (10000 - initialMargin + maintenanceMargin)) / 10000;
        } else {
            // Short: liquidation when markPrice >= entryPrice * (1 + initialMargin - maintenanceMargin)
            return (markPrice * (10000 + initialMargin - maintenanceMargin)) / 10000;
        }
    }

    function _matchOrder(uint256 orderId) internal {
        // Simplified order matching - in production would use order book
        Order storage order = orders[orderId];
        order.status = 3; // FILLED
        order.filledSize = order.size;
        order.avgFillPrice = markPrices[order.marketId];
        order.updatedAt = block.timestamp;
        
        // Create position
        openPosition(order.marketId, order.isBuy, order.size, 
            (order.size * marketMap[order.marketId].initialMarginRatio) / 10000,
            marketMap[order.marketId].maxLeverage);
    }

    // ==================== EMERGENCY ====================

    function pause() external onlyRole(EMERGENCY_GUARDIAN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(EMERGENCY_GUARDIAN_ROLE) {
        _unpause();
    }
}