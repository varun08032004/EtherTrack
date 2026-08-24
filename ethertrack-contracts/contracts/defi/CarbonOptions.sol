// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/math/SafeERC20.sol";
import "./interfaces/ICarbonOptions.sol";

/**
 * @title CarbonOptions
 * @dev European/American style options for carbon credits
 * Supports physical and cash settlement
 */
contract CarbonOptions is ICarbonOptions, AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using SafeMath for uint256;

    // Role definitions
    bytes32 public constant MARKET_ADMIN_ROLE = keccak256("MARKET_ADMIN_ROLE");
    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");
    bytes32 public constant SETTLEMENT_ROLE = keccak256("SETTLEMENT_ROLE");
    bytes32 public constant EMERGENCY_GUARDIAN_ROLE = keccak256("EMERGENCY_GUARDIAN_ROLE");

    // Market configuration
    struct OptionMarket {
        uint256 marketId;
        address underlyingAsset; // ERC-1155 carbon credit
        uint256 assetId;
        address quoteAsset;
        bool optionStyle; // true = European, false = American
        bool settlementType; // true = Physical, false = Cash
        uint256 minOrderSize;
        uint256 tickSize;
        uint256 makerFeeBps;
        uint256 takerFeeBps;
        uint256 exerciseFeeBps;
        bool active;
        uint256 createdAt;
    }

    // Option series (specific strike/expiry)
    struct OptionSeries {
        uint256 seriesId;
        uint256 marketId;
        bool isCall;
        uint256 strikePrice; // 18 decimals
        uint256 expiry; // Unix timestamp
        uint256 size; // Total open interest in contracts
        uint256 premium; // Current premium per contract (18 decimals)
        uint256 impliedVolatility; // Annualized, 18 decimals (e.g., 50% = 500000000000000000)
        int256 delta; // 18 decimals
        int256 gamma; // 18 decimals
        int256 theta; // 18 decimals per day
        int256 vega; // 18 decimals per 1% vol
        int256 rho; // 18 decimals per 1% rate
        uint256 underlyingPrice; // 18 decimals
        uint8 status; // 0=ACTIVE, 1=EXPIRED, 2=EXERCISED, 3=CANCELLED
        uint256 createdAt;
    }

    // Position tracking
    struct OptionPosition {
        uint256 positionId;
        address trader;
        uint256 seriesId;
        bool isLong;
        uint256 size; // Number of contracts
        uint256 entryPremium; // 18 decimals
        uint256 currentPremium; // 18 decimals
        int256 unrealizedPnl;
        int256 deltaExposure; // 18 decimals
        int256 gammaExposure; // 18 decimals
        int256 vegaExposure; // 18 decimals
        uint256 openedAt;
        uint256 updatedAt;
    }

    // Order book
    struct OptionOrder {
        uint256 orderId;
        address trader;
        uint256 seriesId;
        bool isBuy;
        uint8 orderType; // 0=MARKET, 1=LIMIT
        uint256 size;
        uint256 price; // Premium per contract (18 decimals)
        bool reduceOnly;
        uint8 status; // 0=PENDING, 1=OPEN, 2=PARTIAL, 3=FILLED, 4=CANCELLED, 5=REJECTED
        uint256 filledSize;
        uint256 avgFillPrice;
        uint256 feePaid;
        uint256 createdAt;
        uint256 updatedAt;
    }

    // Exercise request
    struct ExerciseRequest {
        uint256 requestId;
        address holder;
        uint256 seriesId;
        uint256 size;
        uint256 timestamp;
        uint8 status; // 0=PENDING, 1=PROCESSING, 2=COMPLETED, 3=REJECTED
    }

    // State variables
    OptionMarket[] public markets;
    mapping(uint256 => OptionMarket) public marketMap;
    OptionSeries[] public series;
    mapping(uint256 => OptionSeries) public seriesMap;
    mapping(uint256 => uint256[]) public marketSeries;
    mapping(uint256 => OptionPosition) public positions;
    mapping(uint256 => OptionOrder) public orders;
    mapping(uint256 => ExerciseRequest) public exerciseRequests;
    mapping(address => uint256[]) public traderPositions;
    mapping(address => uint256[]) public traderOrders;
    uint256 public nextMarketId;
    uint256 public nextSeriesId;
    uint256 public nextPositionId;
    uint256 public nextOrderId;
    uint256 public nextExerciseId;

    // Price feed
    mapping(uint256 => uint256) public underlyingPrices;
    mapping(uint256 => uint256) public lastPriceUpdate;

    // Events
    event MarketCreated(uint256 indexed marketId, address indexed underlyingAsset, uint256 assetId);
    event SeriesCreated(uint256 indexed seriesId, uint256 marketId, bool isCall, uint256 strikePrice, uint256 expiry);
    event SeriesUpdated(uint256 indexed seriesId);
    event PositionOpened(uint256 indexed positionId, address indexed trader, uint256 seriesId, bool isLong);
    event PositionUpdated(uint256 indexed positionId);
    event PositionClosed(uint256 indexed positionId, address indexed trader, int256 realizedPnl);
    event OrderPlaced(uint256 indexed orderId, address indexed trader, uint256 seriesId, bool isBuy);
    event OrderFilled(uint256 indexed orderId, uint256 filledSize, uint256 fillPrice);
    event OrderCancelled(uint256 indexed orderId);
    event OptionExercised(uint256 indexed requestId, address indexed holder, uint256 seriesId, uint256 size);
    event OptionExpired(uint256 indexed seriesId);
    event UnderlyingPriceUpdated(uint256 indexed seriesId, uint256 price);
    event GreeksUpdated(uint256 indexed seriesId, int256 delta, int256 gamma, int256 theta, int256 vega, int256 rho);
    event EmergencyAction(string action);

    constructor() {
        _setRoleAdmin(DEFAULT_ADMIN_ROLE, DEFAULT_ADMIN_ROLE);
        _setRoleAdmin(MARKET_ADMIN_ROLE, DEFAULT_ADMIN_ROLE);
        _setRoleAdmin(ORACLE_ROLE, DEFAULT_ADMIN_ROLE);
        _setRoleAdmin(SETTLEMENT_ROLE, DEFAULT_ADMIN_ROLE);
        _setRoleAdmin(EMERGENCY_GUARDIAN_ROLE, DEFAULT_ADMIN_ROLE);
    }

    // ==================== MARKET MANAGEMENT ====================

    function createMarket(
        address underlyingAsset,
        uint256 assetId,
        address quoteAsset,
        bool optionStyle, // true = European
        bool settlementType, // true = Physical
        uint256 minOrderSize,
        uint256 tickSize,
        uint256 makerFeeBps,
        uint256 takerFeeBps,
        uint256 exerciseFeeBps
    ) external onlyRole(MARKET_ADMIN_ROLE) returns (uint256) {
        uint256 marketId = nextMarketId++;
        
        OptionMarket memory market = OptionMarket({
            marketId: marketId,
            underlyingAsset: underlyingAsset,
            assetId: assetId,
            quoteAsset: quoteAsset,
            optionStyle: optionStyle,
            settlementType: settlementType,
            minOrderSize: minOrderSize,
            tickSize: tickSize,
            makerFeeBps: makerFeeBps,
            takerFeeBps: takerFeeBps,
            exerciseFeeBps: exerciseFeeBps,
            active: true,
            createdAt: block.timestamp
        });

        markets.push(market);
        marketMap[marketId] = market;

        emit MarketCreated(marketId, underlyingAsset, assetId);
        return marketId;
    }

    function createSeries(
        uint256 marketId,
        bool isCall,
        uint256 strikePrice,
        uint256 expiry
    ) external onlyRole(MARKET_ADMIN_ROLE) returns (uint256) {
        OptionMarket storage market = marketMap[marketId];
        require(market.active, "Market not active");
        require(expiry > block.timestamp, "Expiry must be in future");
        require(strikePrice > 0, "Strike must be > 0");

        uint256 seriesId = nextSeriesId++;
        
        OptionSeries memory optionSeries = OptionSeries({
            seriesId: seriesId,
            marketId: marketId,
            isCall: isCall,
            strikePrice: strikePrice,
            expiry: expiry,
            size: 0,
            premium: 0,
            impliedVolatility: 0,
            delta: 0,
            gamma: 0,
            theta: 0,
            vega: 0,
            rho: 0,
            underlyingPrice: 0,
            status: 0, // ACTIVE
            createdAt: block.timestamp
        });

        series.push(optionSeries);
        seriesMap[seriesId] = optionSeries;
        marketSeries[marketId].push(seriesId);

        emit SeriesCreated(seriesId, marketId, isCall, strikePrice, expiry);
        return seriesId;
    }

    // ==================== POSITION MANAGEMENT ====================

    function openPosition(
        uint256 seriesId,
        bool isLong,
        uint256 size,
        uint256 premium
    ) external nonReentrant whenNotPaused returns (uint256) {
        OptionSeries storage optionSeries = seriesMap[seriesId];
        require(optionSeries.seriesId == seriesId, "Series not found");
        require(optionSeries.status == 0, "Series not active");
        require(optionSeries.expiry > block.timestamp, "Option expired");
        require(size >= optionSeries.minOrderSize, "Size below minimum");

        OptionMarket storage market = marketMap[optionSeries.marketId];
        uint256 totalCost = (size * premium) / 1e18;
        
        if (isLong) {
            // Buyer pays premium
            IERC20(market.quoteAsset).safeTransferFrom(msg.sender, address(this), totalCost);
        } else {
            // Seller needs margin (simplified: 20% of notional)
            uint256 notional = (size * optionSeries.strikePrice) / 1e18;
            uint256 margin = (notional * 2000) / 10000; // 20%
            IERC20(market.quoteAsset).safeTransferFrom(msg.sender, address(this), margin);
        }

        uint256 positionId = nextPositionId++;
        
        OptionPosition memory position = OptionPosition({
            positionId: positionId,
            trader: msg.sender,
            seriesId: seriesId,
            isLong: isLong,
            size: size,
            entryPremium: premium,
            currentPremium: premium,
            unrealizedPnl: 0,
            deltaExposure: 0,
            gammaExposure: 0,
            vegaExposure: 0,
            openedAt: block.timestamp,
            updatedAt: block.timestamp
        });

        positions[positionId] = position;
        traderPositions[msg.sender].push(positionId);

        // Update series open interest
        optionSeries.size += size;
        optionSeries.premium = premium;

        emit PositionOpened(positionId, msg.sender, seriesId, isLong);
        return positionId;
    }

    function closePosition(uint256 positionId) external nonReentrant whenNotPaused {
        OptionPosition storage position = positions[positionId];
        require(position.trader == msg.sender, "Not position owner");
        require(position.size > 0, "Position already closed");

        OptionSeries storage optionSeries = seriesMap[position.seriesId];
        OptionMarket storage market = marketMap[optionSeries.marketId];
        
        uint256 currentPremium = optionSeries.premium;
        int256 pnl = int256((currentPremium * position.size) / 1e18) - int256((position.entryPremium * position.size) / 1e18);
        
        if (position.isLong) {
            // Long position: receive current premium value
            uint256 value = (position.size * currentPremium) / 1e18;
            uint256 fee = (value * market.takerFeeBps) / 10000;
            if (value >= fee) {
                IERC20(market.quoteAsset).safeTransfer(msg.sender, value - fee);
                IERC20(market.quoteAsset).safeTransfer(market.quoteAsset, fee); // to fee collector
            }
        } else {
            // Short position: return margin minus losses
            // Simplified implementation
            IERC20(market.quoteAsset).safeTransfer(msg.sender, 0); // Would calculate properly
        }

        position.size = 0;
        position.unrealizedPnl = pnl;
        position.updatedAt = block.timestamp;

        optionSeries.size -= position.size;

        emit PositionClosed(positionId, msg.sender, pnl);
    }

    // ==================== ORDER MANAGEMENT ====================

    function placeOrder(
        uint256 seriesId,
        bool isBuy,
        uint8 orderType,
        uint256 size,
        uint256 price,
        bool reduceOnly
    ) external nonReentrant whenNotPaused returns (uint256) {
        OptionSeries storage optionSeries = seriesMap[seriesId];
        require(optionSeries.seriesId == seriesId, "Series not found");
        require(optionSeries.status == 0, "Series not active");
        require(optionSeries.expiry > block.timestamp, "Option expired");
        require(size >= optionSeries.minOrderSize, "Size below minimum");
        
        if (orderType == 1) { // LIMIT
            require(price > 0, "Price required");
            require(price % optionSeries.tickSize == 0, "Invalid tick size");
        }

        uint256 orderId = nextOrderId++;
        
        OptionOrder memory order = OptionOrder({
            orderId: orderId,
            trader: msg.sender,
            seriesId: seriesId,
            isBuy: isBuy,
            orderType: orderType,
            size: size,
            price: price,
            reduceOnly: reduceOnly,
            status: 0, // PENDING
            filledSize: 0,
            avgFillPrice: 0,
            feePaid: 0,
            createdAt: block.timestamp,
            updatedAt: block.timestamp
        });

        orders[orderId] = order;
        traderOrders[msg.sender].push(orderId);

        // Try to match
        if (orderType == 0) { // MARKET
            _matchOptionOrder(orderId);
        }

        emit OrderPlaced(orderId, msg.sender, seriesId, isBuy);
        return orderId;
    }

    function cancelOrder(uint256 orderId) external nonReentrant {
        OptionOrder storage order = orders[orderId];
        require(order.trader == msg.sender, "Not order owner");
        require(order.status == 1 || order.status == 0, "Order not cancellable");

        order.status = 4; // CANCELLED
        order.updatedAt = block.timestamp;

        emit OrderCancelled(orderId);
    }

    // ==================== EXERCISE ====================

    function exerciseOption(uint256 seriesId, uint256 size) external nonReentrant whenNotPaused returns (uint256) {
        OptionSeries storage optionSeries = seriesMap[seriesId];
        require(optionSeries.seriesId == seriesId, "Series not found");
        require(optionSeries.status == 0, "Series not active");

        OptionMarket storage market = marketMap[optionSeries.marketId];
        
        // Check exercise permissions
        if (market.optionStyle) { // European
            require(block.timestamp >= optionSeries.expiry, "European option can only be exercised at expiry");
        }
        // American can be exercised anytime before expiry
        require(block.timestamp <= optionSeries.expiry, "Option expired");

        // Check holder has long position
        uint256 longPositionSize = 0;
        for (uint256 i = 0; i < traderPositions[msg.sender].length; i++) {
            uint256 posId = traderPositions[msg.sender][i];
            OptionPosition storage pos = positions[posId];
            if (pos.seriesId == seriesId && pos.isLong && pos.size > 0) {
                longPositionSize += pos.size;
            }
        }
        require(longPositionSize >= size, "Insufficient long position");

        // Check intrinsic value > 0
        uint256 underlyingPrice = underlyingPrices[seriesId];
        require(underlyingPrice > 0, "No underlying price");
        
        bool inTheMoney = optionSeries.isCall 
            ? underlyingPrice > optionSeries.strikePrice
            : underlyingPrice < optionSeries.strikePrice;
        require(inTheMoney, "Option out of the money");

        uint256 requestId = nextExerciseId++;
        
        ExerciseRequest memory request = ExerciseRequest({
            requestId: requestId,
            holder: msg.sender,
            seriesId: seriesId,
            size: size,
            timestamp: block.timestamp,
            status: 0 // PENDING
        });

        exerciseRequests[requestId] = request;

        // Process exercise immediately for cash settlement
        if (!market.settlementType) {
            _processCashExercise(requestId);
        }
        // For physical settlement, would queue for settlement

        emit OptionExercised(requestId, msg.sender, seriesId, size);
        return requestId;
    }

    function processPhysicalExercise(uint256 requestId) external onlyRole(SETTLEMENT_ROLE) {
        ExerciseRequest storage request = exerciseRequests[requestId];
        require(request.status == 0, "Request not pending");

        OptionSeries storage optionSeries = seriesMap[request.seriesId];
        OptionMarket storage market = marketMap[optionSeries.marketId];
        
        // Holder pays strike price * size and receives underlying asset
        uint256 strikePayment = (request.size * optionSeries.strikePrice) / 1e18;
        
        IERC20(market.quoteAsset).safeTransferFrom(request.holder, address(this), strikePayment);
        IERC1155(market.underlyingAsset).safeTransferFrom(address(this), request.holder, optionSeries.assetId, request.size, "");

        request.status = 2; // COMPLETED

        emit OptionExercised(requestId, request.holder, request.seriesId, request.size);
    }

    // ==================== PRICE & GREEKS UPDATES ====================

    function updateUnderlyingPrice(uint256 seriesId, uint256 price) external onlyRole(ORACLE_ROLE) {
        OptionSeries storage optionSeries = seriesMap[seriesId];
        require(optionSeries.seriesId == seriesId, "Series not found");

        underlyingPrices[seriesId] = price;
        optionSeries.underlyingPrice = price;
        lastPriceUpdate[seriesId] = block.timestamp;

        // Recalculate Greeks
        _updateGreeks(seriesId);

        emit UnderlyingPriceUpdated(seriesId, price);
    }

    function updateSeriesPremium(uint256 seriesId, uint256 premium, uint256 impliedVol) external onlyRole(ORACLE_ROLE) {
        OptionSeries storage optionSeries = seriesMap[seriesId];
        require(optionSeries.seriesId == seriesId, "Series not found");
        require(optionSeries.status == 0, "Series not active");

        optionSeries.premium = premium;
        optionSeries.impliedVolatility = impliedVol;
        
        // Update position current premiums
        // In production, would iterate positions
        emit SeriesUpdated(seriesId);
    }

    // ==================== EXPIRY ====================

    function expireSeries(uint256 seriesId) external {
        OptionSeries storage optionSeries = seriesMap[seriesId];
        require(optionSeries.seriesId == seriesId, "Series not found");
        require(optionSeries.status == 0, "Series not active");
        require(block.timestamp >= optionSeries.expiry, "Not yet expired");

        // Auto-exercise in-the-money options for European style
        OptionMarket storage market = marketMap[optionSeries.marketId];
        if (market.optionStyle) {
            uint256 underlyingPrice = underlyingPrices[seriesId];
            bool inTheMoney = optionSeries.isCall 
                ? underlyingPrice > optionSeries.strikePrice
                : underlyingPrice < optionSeries.strikePrice;
            
            if (inTheMoney && !market.settlementType) {
                // Auto cash settle
                _autoCashSettle(seriesId, underlyingPrice);
            }
        }

        optionSeries.status = 1; // EXPIRED
        emit OptionExpired(seriesId);
    }

    // ==================== VIEW FUNCTIONS ====================

    function getMarket(uint256 marketId) external view returns (OptionMarket memory) {
        return marketMap[marketId];
    }

    function getSeries(uint256 seriesId) external view returns (OptionSeries memory) {
        return seriesMap[seriesId];
    }

    function getMarketSeries(uint256 marketId) external view returns (uint256[] memory) {
        return marketSeries[marketId];
    }

    function getPosition(uint256 positionId) external view returns (OptionPosition memory) {
        return positions[positionId];
    }

    function getTraderPositions(address trader) external view returns (uint256[] memory) {
        return traderPositions[trader];
    }

    function getOrder(uint256 orderId) external view returns (OptionOrder memory) {
        return orders[orderId];
    }

    function getTraderOrders(address trader) external view returns (uint256[] memory) {
        return traderOrders[trader];
    }

    function getUnderlyingPrice(uint256 seriesId) external view returns (uint256) {
        return underlyingPrices[seriesId];
    }

    function getExerciseRequest(uint256 requestId) external view returns (ExerciseRequest memory) {
        return exerciseRequests[requestId];
    }

    // ==================== INTERNAL FUNCTIONS ====================

    function _matchOptionOrder(uint256 orderId) internal {
        OptionOrder storage order = orders[orderId];
        OptionSeries storage optionSeries = seriesMap[order.seriesId];
        
        // Simplified: fill at current premium
        order.status = 3; // FILLED
        order.filledSize = order.size;
        order.avgFillPrice = optionSeries.premium;
        order.updatedAt = block.timestamp;
        
        // Create position
        openPosition(order.seriesId, order.isBuy, order.size, optionSeries.premium);
    }

    function _updateGreeks(uint256 seriesId) internal {
        OptionSeries storage optionSeries = seriesMap[seriesId];
        uint256 underlyingPrice = underlyingPrices[seriesId];
        uint256 strikePrice = optionSeries.strikePrice;
        uint256 timeToExpiry = (optionSeries.expiry > block.timestamp) 
            ? (optionSeries.expiry - block.timestamp) / 365 days // years
            : 0;
        
        if (timeToExpiry == 0 || underlyingPrice == 0) {
            optionSeries.delta = 0;
            optionSeries.gamma = 0;
            optionSeries.theta = 0;
            optionSeries.vega = 0;
            optionSeries.rho = 0;
            return;
        }

        // Simplified Black-Scholes Greeks calculation
        // In production, use proper math library
        uint256 sigma = optionSeries.impliedVolatility > 0 ? optionSeries.impliedVolatility : 500000000000000000; // default 50%
        
        // d1 = (ln(S/K) + (r + σ²/2)T) / (σ√T)
        // Using simplified approximations
        int256 moneyness = int256(underlyingPrice) - int256(strikePrice);
        
        if (optionSeries.isCall) {
            // Call delta ≈ N(d1) ≈ 0.5 + moneyness / (S * σ * √T)
            optionSeries.delta = int256(500000000000000000) + (moneyness * 10000) / int256(underlyingPrice * sigma * timeToExpiry / 365);
        } else {
            // Put delta ≈ N(d1) - 1
            optionSeries.delta = int256(-500000000000000000) + (moneyness * 10000) / int256(underlyingPrice * sigma * timeToExpiry / 365);
        }

        // Simplified gamma, theta, vega, rho
        optionSeries.gamma = int256(10000000000000000); // placeholder
        optionSeries.theta = int256(-1000000000000000); // placeholder per day
        optionSeries.vega = int256(underlyingPrice * timeToExpiry / 365) / 100; // per 1% vol
        optionSeries.rho = int256(strikePrice * timeToExpiry / 365) / 100; // per 1% rate

        emit GreeksUpdated(seriesId, optionSeries.delta, optionSeries.gamma, optionSeries.theta, optionSeries.vega, optionSeries.rho);
    }

    function _processCashExercise(uint256 requestId) internal {
        ExerciseRequest storage request = exerciseRequests[requestId];
        OptionSeries storage optionSeries = seriesMap[request.seriesId];
        OptionMarket storage market = marketMap[optionSeries.marketId];

        uint256 underlyingPrice = underlyingPrices[request.seriesId];
        uint256 intrinsicValue = optionSeries.isCall
            ? (underlyingPrice > optionSeries.strikePrice ? underlyingPrice - optionSeries.strikePrice : 0)
            : (underlyingPrice < optionSeries.strikePrice ? optionSeries.strikePrice - underlyingPrice : 0);

        uint256 payout = (request.size * intrinsicValue) / 1e18;
        uint256 fee = (payout * market.exerciseFeeBps) / 10000;

        if (payout > fee) {
            IERC20(market.quoteAsset).safeTransfer(request.holder, payout - fee);
        }

        request.status = 2; // COMPLETED
    }

    function _autoCashSettle(uint256 seriesId, uint256 underlyingPrice) internal {
        OptionSeries storage optionSeries = seriesMap[seriesId];
        OptionMarket storage market = marketMap[optionSeries.marketId];

        // Find all long positions and settle
        // Simplified - in production would iterate
        emit EmergencyAction("Auto cash settlement for series " + seriesId.toString());
    }

    // ==================== EMERGENCY ====================

    function pause() external onlyRole(EMERGENCY_GUARDIAN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(EMERGENCY_GUARDIAN_ROLE) {
        _unpause();
    }
}