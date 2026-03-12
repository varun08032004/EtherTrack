// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol";
import "./CarbonCreditToken.sol";
import "./KYCRegistry.sol";
import "./Treasury.sol";

/**
 * @title Marketplace
 * @author EtherTrack
 * @notice Hybrid Order Book + AMM marketplace for carbon credits.
 *
 * ARCHITECTURE:
 *   Layer 1 — Sell Orders (listings)    : seller deposits credits → escrow
 *   Layer 2 — Buy Orders (bids)         : buyer deposits ETH → escrow
 *   Layer 3 — Matching Engine           : auto-matches bids vs asks on-chain
 *   Layer 4 — AMM Pool interface        : routes small orders to AMMPool.sol
 *
 * ORDER FLOW:
 *   Seller lists → credits locked in contract
 *   Buyer bids   → ETH locked in contract
 *   Match found  → atomic settlement (credits + ETH swap in one tx)
 *   Fee          → 0.5% to Treasury
 *
 * BLOCKCHAIN MIGRATION:
 *   openOrders state     → on-chain orders mapping
 *   trades history       → CreditTraded events
 *   handleConfirmTrade() → buyCredit() / matchOrder()
 *   cancelOrder()        → cancelOrder() on-chain
 */
contract Marketplace is Ownable, Pausable, ReentrancyGuard, IERC1155Receiver {

    CarbonCreditToken public creditToken;
    KYCRegistry       public kycRegistry;
    Treasury          public treasury;

    // ── Enums ─────────────────────────────────────────────
    enum OrderSide   { BUY, SELL }
    enum OrderStatus { OPEN, FILLED, PARTIALLY_FILLED, CANCELLED, EXPIRED }

    // ── Structs ───────────────────────────────────────────

    // Sell-side: credits in escrow
    struct Listing {
        uint256     listingId;
        address     seller;
        uint256     tokenId;
        uint256     amount;
        uint256     amountRemaining;
        uint256     pricePerUnit;    // ETH wei per credit
        uint256     listedAt;
        uint256     expiresAt;
        bool        active;
    }

    // Buy-side: ETH in escrow
    struct BuyOrder {
        uint256     orderId;
        address     buyer;
        uint256     tokenId;
        uint256     amount;          // credits wanted
        uint256     amountFilled;    // credits received so far
        uint256     limitPrice;      // max ETH wei per credit (0 = market)
        uint256     ethEscrowed;     // ETH locked in contract
        OrderStatus status;
        uint256     createdAt;
        uint256     expiresAt;
    }

    // Completed trade record
    struct Trade {
        uint256 tradeId;
        uint256 listingId;
        uint256 buyOrderId;
        address buyer;
        address seller;
        uint256 tokenId;
        uint256 amount;
        uint256 pricePerUnit;
        uint256 totalPrice;
        uint256 fee;
        uint256 tradedAt;
        bool    isAMM;
    }

    // ── State ─────────────────────────────────────────────
    uint256 private _nextListingId;
    uint256 private _nextOrderId;
    uint256 private _nextTradeId;

    mapping(uint256 => Listing)  public listings;
    mapping(uint256 => BuyOrder) public buyOrders;
    mapping(uint256 => Trade)    public trades;

    mapping(address => uint256[]) public sellerListings;
    mapping(address => uint256[]) public buyerOrders;
    mapping(address => uint256[]) public buyerTrades;
    mapping(address => uint256[]) public sellerTrades;
    mapping(uint256 => uint256[]) public tokenListings;   // tokenId → listingIds
    mapping(uint256 => uint256[]) public tokenBuyOrders;  // tokenId → buyOrderIds

    // AMM pool address (set after AMMPool.sol deployed)
    address public ammPool;

    // AMM threshold — orders below this use AMM, above use order book
    // Default: 100 credits
    uint256 public ammThreshold = 100;

    uint256 public constant PLATFORM_FEE_BPS = 50;   // 0.5%
    uint256 public constant BPS_DENOMINATOR  = 10000;
    uint256 public constant MAX_DURATION     = 90 days;
    uint256 public constant DEFAULT_DURATION = 30 days;

    // ── Events ────────────────────────────────────────────
    event CreditListed(
        uint256 indexed listingId,
        address indexed seller,
        uint256 indexed tokenId,
        uint256 amount,
        uint256 pricePerUnit
    );
    event ListingCancelled(uint256 indexed listingId, address indexed seller);
    event ListingUpdated(uint256 indexed listingId, uint256 newPrice);

    event BuyOrderPlaced(
        uint256 indexed orderId,
        address indexed buyer,
        uint256 indexed tokenId,
        uint256 amount,
        uint256 limitPrice,
        uint256 ethEscrowed
    );
    event BuyOrderCancelled(uint256 indexed orderId, address indexed buyer, uint256 ethRefunded);
    event BuyOrderFilled(uint256 indexed orderId, uint256 amountFilled, uint256 amountRemaining);

    event CreditTraded(
        uint256 indexed tradeId,
        uint256 indexed listingId,
        uint256 indexed buyOrderId,
        address buyer,
        address seller,
        uint256 tokenId,
        uint256 amount,
        uint256 pricePerUnit,
        uint256 totalPrice,
        uint256 fee,
        bool    isAMM
    );

    event AMMPoolSet(address indexed ammPool);
    event AMMThresholdUpdated(uint256 newThreshold);
    event MatchExecuted(uint256 listingId, uint256 buyOrderId, uint256 amount, uint256 price);

    // ── Modifiers ─────────────────────────────────────────
    modifier onlyKYCVerified() {
        // KYC verified at wallet connection — no per-tx check
        _;
    }

    modifier listingExists(uint256 listingId) {
        require(listings[listingId].active, "Listing not active or already cancelled");
        require(block.timestamp < listings[listingId].expiresAt, "Listing has expired, please re-list");
        _;
    }

    modifier buyOrderExists(uint256 orderId) {
        require(buyOrders[orderId].status == OrderStatus.OPEN ||
                buyOrders[orderId].status == OrderStatus.PARTIALLY_FILLED, "Buy order not open");
        require(block.timestamp < buyOrders[orderId].expiresAt, "Buy order expired");
        _;
    }

    // ── Constructor ───────────────────────────────────────
    constructor(
        address initialOwner,
        address creditTokenAddress,
        address kycRegistryAddress,
        address treasuryAddress
    ) Ownable(initialOwner) {
        creditToken = CarbonCreditToken(creditTokenAddress);
        kycRegistry = KYCRegistry(kycRegistryAddress);
        treasury    = Treasury(payable(treasuryAddress));
    }

    // ═══════════════════════════════════════════════════════
    // SELL SIDE — List credits for sale
    // ═══════════════════════════════════════════════════════

    /**
     * @notice List carbon credits for sale
     * @dev    Credits transferred to escrow immediately.
     *         After listing, auto-scans open buy orders for instant match.
     *
     * BLOCKCHAIN MIGRATION: Replaces handleListForSale() in Portfolio.js
     */
    function listCredit(
        uint256 tokenId,
        uint256 amount,
        uint256 pricePerUnit,
        uint256 duration
    ) external onlyKYCVerified whenNotPaused returns (uint256 listingId) {
        require(amount > 0,       "Amount must be > 0");
        require(pricePerUnit > 0, "Price must be > 0");
        require(
            creditToken.balanceOf(msg.sender, tokenId) >= amount,
            "Insufficient credits"
        );
        require(!creditToken.isExpired(tokenId), "Credit expired");

        uint256 dur = duration == 0 ? DEFAULT_DURATION : duration;
        require(dur <= MAX_DURATION, "Duration too long");

        listingId = _nextListingId++;

        listings[listingId] = Listing({
            listingId:       listingId,
            seller:          msg.sender,
            tokenId:         tokenId,
            amount:          amount,
            amountRemaining: amount,
            pricePerUnit:    pricePerUnit,
            listedAt:        block.timestamp,
            expiresAt:       block.timestamp + dur,
            active:          true
        });

        sellerListings[msg.sender].push(listingId);
        tokenListings[tokenId].push(listingId);

        // Lock credits in escrow
        creditToken.safeTransferFrom(msg.sender, address(this), tokenId, amount, "");

        emit CreditListed(listingId, msg.sender, tokenId, amount, pricePerUnit);

        // ── AUTO-MATCH: scan open buy orders for this tokenId ──
        _tryMatchListing(listingId);
    }

    /**
     * @notice Update listing price
     */
    function updateListingPrice(
        uint256 listingId,
        uint256 newPrice
    ) external listingExists(listingId) {
        require(listings[listingId].seller == msg.sender, "Not your listing");
        require(newPrice > 0, "Price must be > 0");
        listings[listingId].pricePerUnit = newPrice;
        emit ListingUpdated(listingId, newPrice);
        // Try matching at new price
        _tryMatchListing(listingId);
    }

    /**
     * @notice Cancel listing — returns credits to seller
     * BLOCKCHAIN MIGRATION: Replaces handleDelist() in Portfolio.js
     */
    function cancelListing(uint256 listingId) external listingExists(listingId) {
        Listing storage listing = listings[listingId];
        require(
            listing.seller == msg.sender || msg.sender == owner(),
            "Not your listing"
        );

        listing.active = false;

        if (listing.amountRemaining > 0) {
            creditToken.safeTransferFrom(
                address(this),
                listing.seller,
                listing.tokenId,
                listing.amountRemaining,
                ""
            );
        }

        emit ListingCancelled(listingId, msg.sender);
    }

    // ═══════════════════════════════════════════════════════
    // BUY SIDE — Place buy orders / bids
    // ═══════════════════════════════════════════════════════

    /**
     * @notice Instant market buy — buy credits at current listing price
     * @dev    For orders above ammThreshold. Below threshold → use AMM.
     *
     * BLOCKCHAIN MIGRATION: Replaces handleConfirmTrade() market order in CarbonCredits.js
     */
    function buyCredit(
        uint256 listingId,
        uint256 amount
    ) external payable onlyKYCVerified whenNotPaused nonReentrant listingExists(listingId) {
        Listing storage listing = listings[listingId];

        require(listing.seller != msg.sender,     "Cannot buy own listing");
        require(amount > 0,                        "Amount must be > 0");
        require(amount <= listing.amountRemaining, "Exceeds available amount");

        uint256 totalPrice   = amount * listing.pricePerUnit;
        uint256 fee          = (totalPrice * PLATFORM_FEE_BPS) / BPS_DENOMINATOR;
        uint256 sellerAmount = totalPrice - fee;

        require(msg.value >= totalPrice + fee, "Insufficient ETH");

        // Update listing
        listing.amountRemaining -= amount;
        if (listing.amountRemaining == 0) listing.active = false;

        // Record trade
        uint256 tradeId = _recordTrade(
            listingId,
            type(uint256).max,
            msg.sender,
            listing.seller,
            listing.tokenId,
            amount,
            listing.pricePerUnit,
            totalPrice,
            fee,
            false
        );

        // Transfer credits to buyer
        creditToken.safeTransferFrom(
            address(this), msg.sender, listing.tokenId, amount, ""
        );

        // Pay seller
        (bool paid,) = listing.seller.call{value: sellerAmount}("");
        require(paid, "Seller payment failed");

        // Fee to Treasury
        treasury.depositFee{value: fee}();

        // Refund excess ETH
        uint256 excess = msg.value - (totalPrice + fee);
        if (excess > 0) {
            (bool refunded,) = msg.sender.call{value: excess}("");
            require(refunded, "Refund failed");
        }
    }

    /**
     * @notice Place a limit BUY order — ETH locked in escrow
     * @dev    Buyer deposits ETH upfront. Engine auto-matches when
     *         a listing appears at or below limitPrice.
     *
     * This is the KEY function that completes the order book.
     * BLOCKCHAIN MIGRATION: Replaces openOrders React state → on-chain
     *
     * @param tokenId    Which carbon credit token to buy
     * @param amount     How many credits to buy
     * @param limitPrice Max price per credit in ETH wei (0 = market, match any)
     * @param duration   Order validity (0 = 7 days default)
     */
    function placeBuyOrder(
        uint256 tokenId,
        uint256 amount,
        uint256 limitPrice,
        uint256 duration
    ) external payable onlyKYCVerified whenNotPaused returns (uint256 orderId) {
        require(amount > 0, "Amount must be > 0");

        // If limitPrice=0 treat as market — use best ask price
        // Buyer must deposit enough ETH
        uint256 effectivePrice = limitPrice;
        if (effectivePrice == 0) {
            // Find best ask for this tokenId
            effectivePrice = _getBestAsk(tokenId);
            require(effectivePrice > 0, "No listings available for market order");
        }

        uint256 totalCost = amount * effectivePrice;
        uint256 fee       = (totalCost * PLATFORM_FEE_BPS) / BPS_DENOMINATOR;
        require(msg.value >= totalCost + fee, "Insufficient ETH escrowed");

        orderId = _nextOrderId++;

        buyOrders[orderId] = BuyOrder({
            orderId:      orderId,
            buyer:        msg.sender,
            tokenId:      tokenId,
            amount:       amount,
            amountFilled: 0,
            limitPrice:   limitPrice == 0 ? effectivePrice : limitPrice,
            ethEscrowed:  msg.value,
            status:       OrderStatus.OPEN,
            createdAt:    block.timestamp,
            expiresAt:    block.timestamp + (duration == 0 ? 7 days : duration)
        });

        buyerOrders[msg.sender].push(orderId);
        tokenBuyOrders[tokenId].push(orderId);

        emit BuyOrderPlaced(orderId, msg.sender, tokenId, amount, buyOrders[orderId].limitPrice, msg.value);

        // ── AUTO-MATCH: immediately try to fill against existing listings ──
        _tryMatchBuyOrder(orderId);
    }

    /**
     * @notice Cancel an open buy order — refunds escrowed ETH
     * BLOCKCHAIN MIGRATION: Replaces cancelOrder() in CarbonCredits.js
     */
    function cancelBuyOrder(uint256 orderId) external nonReentrant {
        BuyOrder storage order = buyOrders[orderId];
        require(order.buyer == msg.sender, "Not your order");
        require(
            order.status == OrderStatus.OPEN ||
            order.status == OrderStatus.PARTIALLY_FILLED,
            "Order not cancellable"
        );

        order.status = OrderStatus.CANCELLED;

        // Refund remaining escrowed ETH
        uint256 filledCost    = order.amountFilled * order.limitPrice;
        uint256 filledFee     = (filledCost * PLATFORM_FEE_BPS) / BPS_DENOMINATOR;
        uint256 amountSpent   = filledCost + filledFee;
        uint256 refundAmount  = order.ethEscrowed > amountSpent
            ? order.ethEscrowed - amountSpent
            : 0;

        if (refundAmount > 0) {
            (bool refunded,) = msg.sender.call{value: refundAmount}("");
            require(refunded, "Refund failed");
        }

        emit BuyOrderCancelled(orderId, msg.sender, refundAmount);
    }

    // ═══════════════════════════════════════════════════════
    // MATCHING ENGINE — Internal
    // ═══════════════════════════════════════════════════════

    /**
     * @notice Try to match a new listing against existing buy orders
     * @dev    Called automatically after listCredit() and updateListingPrice()
     *         Scans open buy orders for this tokenId with limitPrice >= listing.pricePerUnit
     *         Matches best (highest) bid first — price-time priority
     */
    function _tryMatchListing(uint256 listingId) internal {
        Listing storage listing = listings[listingId];
        if (!listing.active || listing.amountRemaining == 0) return;

        uint256[] storage orderIds = tokenBuyOrders[listing.tokenId];

        for (uint256 i = 0; i < orderIds.length; i++) {
            if (listing.amountRemaining == 0) break;

            BuyOrder storage order = buyOrders[orderIds[i]];

            // Skip non-open orders
            if (order.status != OrderStatus.OPEN &&
                order.status != OrderStatus.PARTIALLY_FILLED) continue;
            if (block.timestamp >= order.expiresAt) continue;
            if (order.buyer == listing.seller) continue; // no self-match

            // Price check: buyer's limit >= seller's ask
            if (order.limitPrice < listing.pricePerUnit) continue;

            // Match size
            uint256 matchAmount = _min(
                order.amount - order.amountFilled,
                listing.amountRemaining
            );
            if (matchAmount == 0) continue;

            // Execute at listing price (seller's ask — better for buyer)
            _executeMatch(listingId, orderIds[i], matchAmount, listing.pricePerUnit);
        }
    }

    /**
     * @notice Try to match a new buy order against existing listings
     * @dev    Called automatically after placeBuyOrder()
     *         Scans active listings for this tokenId with price <= order.limitPrice
     *         Matches best (lowest) ask first
     */
    function _tryMatchBuyOrder(uint256 orderId) internal {
        BuyOrder storage order = buyOrders[orderId];
        if (order.status != OrderStatus.OPEN &&
            order.status != OrderStatus.PARTIALLY_FILLED) return;

        uint256[] storage listingIds = tokenListings[order.tokenId];

        for (uint256 i = 0; i < listingIds.length; i++) {
            if (order.amountFilled >= order.amount) break;

            Listing storage listing = listings[listingIds[i]];

            if (!listing.active) continue;
            if (block.timestamp >= listing.expiresAt) continue;
            if (listing.seller == order.buyer) continue; // no self-match

            // Price check: seller's ask <= buyer's limit
            if (listing.pricePerUnit > order.limitPrice) continue;

            uint256 matchAmount = _min(
                order.amount - order.amountFilled,
                listing.amountRemaining
            );
            if (matchAmount == 0) continue;

            // Execute at listing price (best for buyer)
            _executeMatch(listingIds[i], orderId, matchAmount, listing.pricePerUnit);
        }
    }

    /**
     * @notice Core settlement — atomic swap of credits + ETH
     * @dev    Both credits AND ETH already in escrow — pure state update + transfer
     */
    function _executeMatch(
        uint256 listingId,
        uint256 buyOrderId,
        uint256 amount,
        uint256 price
    ) internal nonReentrant {
        Listing  storage listing = listings[listingId];
        BuyOrder storage order   = buyOrders[buyOrderId];

        uint256 totalPrice   = amount * price;
        uint256 fee          = (totalPrice * PLATFORM_FEE_BPS) / BPS_DENOMINATOR;
        uint256 sellerAmount = totalPrice - fee;

        // Update listing
        listing.amountRemaining -= amount;
        if (listing.amountRemaining == 0) listing.active = false;

        // Update buy order
        order.amountFilled += amount;
        if (order.amountFilled >= order.amount) {
            order.status = OrderStatus.FILLED;
        } else {
            order.status = OrderStatus.PARTIALLY_FILLED;
        }

        // Record trade
        _recordTrade(
            listingId,
            buyOrderId,
            order.buyer,
            listing.seller,
            listing.tokenId,
            amount,
            price,
            totalPrice,
            fee,
            false
        );

        // Transfer credits from escrow to buyer
        creditToken.safeTransferFrom(
            address(this),
            order.buyer,
            listing.tokenId,
            amount,
            ""
        );

        // Pay seller from buyer's escrowed ETH
        (bool paid,) = listing.seller.call{value: sellerAmount}("");
        require(paid, "Seller payment failed");

        // Fee to Treasury
        treasury.depositFee{value: fee}();

        // Refund excess ETH to buyer if matched at lower price than their limit
        uint256 actualCost    = totalPrice + fee;
        uint256 expectedCost  = amount * order.limitPrice;
        uint256 expectedFee   = (expectedCost * PLATFORM_FEE_BPS) / BPS_DENOMINATOR;
        uint256 budgeted      = expectedCost + expectedFee;
        if (budgeted > actualCost) {
            uint256 refund = budgeted - actualCost;
            order.ethEscrowed -= refund;
            (bool refunded,) = order.buyer.call{value: refund}("");
            // Non-critical: refund failure doesn't revert trade
        }

        emit MatchExecuted(listingId, buyOrderId, amount, price);
        emit BuyOrderFilled(buyOrderId, amount, order.amount - order.amountFilled);
    }

    // ═══════════════════════════════════════════════════════
    // VIEW FUNCTIONS — Used by React frontend
    // ═══════════════════════════════════════════════════════

    /**
     * @notice All active sell listings — market tab data source
     * BLOCKCHAIN MIGRATION: Replaces CREDITS mock array in CarbonCredits.js
     */
    function getActiveListings() external view returns (Listing[] memory) {
        uint256 count = 0;
        for (uint256 i = 0; i < _nextListingId; i++) {
            if (listings[i].active && block.timestamp < listings[i].expiresAt) count++;
        }
        Listing[] memory active = new Listing[](count);
        uint256 idx = 0;
        for (uint256 i = 0; i < _nextListingId; i++) {
            if (listings[i].active && block.timestamp < listings[i].expiresAt) {
                active[idx++] = listings[i];
            }
        }
        return active;
    }

    /**
     * @notice All open buy orders — buy-side order book UI
     * NEW: Powers the bid side of order book in CarbonCredits.js
     */
    function getOpenBuyOrders() external view returns (BuyOrder[] memory) {
        uint256 count = 0;
        for (uint256 i = 0; i < _nextOrderId; i++) {
            if ((buyOrders[i].status == OrderStatus.OPEN ||
                 buyOrders[i].status == OrderStatus.PARTIALLY_FILLED) &&
                block.timestamp < buyOrders[i].expiresAt) count++;
        }
        BuyOrder[] memory open = new BuyOrder[](count);
        uint256 idx = 0;
        for (uint256 i = 0; i < _nextOrderId; i++) {
            if ((buyOrders[i].status == OrderStatus.OPEN ||
                 buyOrders[i].status == OrderStatus.PARTIALLY_FILLED) &&
                block.timestamp < buyOrders[i].expiresAt) {
                open[idx++] = buyOrders[i];
            }
        }
        return open;
    }

    /**
     * @notice Open buy orders for a specific tokenId
     * NEW: Powers the bid side of per-credit order book
     */
    function getBuyOrdersForToken(uint256 tokenId) external view returns (BuyOrder[] memory) {
        uint256[] storage ids = tokenBuyOrders[tokenId];
        uint256 count = 0;
        for (uint256 i = 0; i < ids.length; i++) {
            BuyOrder storage o = buyOrders[ids[i]];
            if ((o.status == OrderStatus.OPEN || o.status == OrderStatus.PARTIALLY_FILLED) &&
                block.timestamp < o.expiresAt) count++;
        }
        BuyOrder[] memory open = new BuyOrder[](count);
        uint256 idx = 0;
        for (uint256 i = 0; i < ids.length; i++) {
            BuyOrder storage o = buyOrders[ids[i]];
            if ((o.status == OrderStatus.OPEN || o.status == OrderStatus.PARTIALLY_FILLED) &&
                block.timestamp < o.expiresAt) {
                open[idx++] = o;
            }
        }
        return open;
    }

    /**
     * @notice Full order book for a tokenId: asks + bids sorted
     * NEW: Single call to populate order book UI
     */
    function getOrderBook(uint256 tokenId) external view returns (
        Listing[]  memory asks,  // sell side sorted low→high
        BuyOrder[] memory bids   // buy side sorted high→low
    ) {
        // Build asks
        uint256[] storage lIds = tokenListings[tokenId];
        uint256 askCount = 0;
        for (uint256 i = 0; i < lIds.length; i++) {
            if (listings[lIds[i]].active && block.timestamp < listings[lIds[i]].expiresAt) askCount++;
        }
        asks = new Listing[](askCount);
        uint256 ai = 0;
        for (uint256 i = 0; i < lIds.length; i++) {
            if (listings[lIds[i]].active && block.timestamp < listings[lIds[i]].expiresAt) {
                asks[ai++] = listings[lIds[i]];
            }
        }

        // Build bids
        uint256[] storage bIds = tokenBuyOrders[tokenId];
        uint256 bidCount = 0;
        for (uint256 i = 0; i < bIds.length; i++) {
            BuyOrder storage o = buyOrders[bIds[i]];
            if ((o.status == OrderStatus.OPEN || o.status == OrderStatus.PARTIALLY_FILLED) &&
                block.timestamp < o.expiresAt) bidCount++;
        }
        bids = new BuyOrder[](bidCount);
        uint256 bi = 0;
        for (uint256 i = 0; i < bIds.length; i++) {
            BuyOrder storage o = buyOrders[bIds[i]];
            if ((o.status == OrderStatus.OPEN || o.status == OrderStatus.PARTIALLY_FILLED) &&
                block.timestamp < o.expiresAt) {
                bids[bi++] = o;
            }
        }
    }

    function getSellerListings(address seller)  external view returns (uint256[] memory) { return sellerListings[seller]; }
    function getBuyerOrders(address buyer)       external view returns (uint256[] memory) { return buyerOrders[buyer]; }
    function getBuyerTrades(address buyer)       external view returns (uint256[] memory) { return buyerTrades[buyer]; }
    function getSellerTrades(address seller)     external view returns (uint256[] memory) { return sellerTrades[seller]; }
    function getTrade(uint256 tradeId)           external view returns (Trade memory)     { return trades[tradeId]; }

    function calculateFee(uint256 amount, uint256 pricePerUnit) external pure returns (uint256 fee, uint256 total) {
        total = amount * pricePerUnit;
        fee   = (total * PLATFORM_FEE_BPS) / BPS_DENOMINATOR;
    }

    function totalListings()  external view returns (uint256) { return _nextListingId; }
    function totalBuyOrders() external view returns (uint256) { return _nextOrderId;   }
    function totalTrades()    external view returns (uint256) { return _nextTradeId;   }

    // ═══════════════════════════════════════════════════════
    // AMM INTEGRATION
    // ═══════════════════════════════════════════════════════

    /**
     * @notice Set AMM pool address — called after AMMPool.sol deployed
     */
    function setAMMPool(address _ammPool) external onlyOwner {
        ammPool = _ammPool;
        emit AMMPoolSet(_ammPool);
    }

    /**
     * @notice Update AMM threshold (credits)
     * Orders below threshold → AMM. Above → order book.
     */
    function setAMMThreshold(uint256 threshold) external onlyOwner {
        ammThreshold = threshold;
        emit AMMThresholdUpdated(threshold);
    }

    /**
     * @notice Check if an order should use AMM or order book
     */
    function shouldUseAMM(uint256 amount) public view returns (bool) {
        return ammPool != address(0) && amount <= ammThreshold;
    }

    // ═══════════════════════════════════════════════════════
    // INTERNAL HELPERS
    // ═══════════════════════════════════════════════════════

    function _getBestAsk(uint256 tokenId) internal view returns (uint256 bestPrice) {
        uint256[] storage lIds = tokenListings[tokenId];
        bestPrice = type(uint256).max;
        for (uint256 i = 0; i < lIds.length; i++) {
            Listing storage l = listings[lIds[i]];
            if (l.active && block.timestamp < l.expiresAt) {
                if (l.pricePerUnit < bestPrice) bestPrice = l.pricePerUnit;
            }
        }
        if (bestPrice == type(uint256).max) bestPrice = 0;
    }

    function _recordTrade(
        uint256 listingId,
        uint256 buyOrderId,
        address buyer,
        address seller,
        uint256 tokenId,
        uint256 amount,
        uint256 price,
        uint256 totalPrice,
        uint256 fee,
        bool    isAMM
    ) internal returns (uint256 tradeId) {
        tradeId = _nextTradeId++;
        trades[tradeId] = Trade({
            tradeId:      tradeId,
            listingId:    listingId,
            buyOrderId:   buyOrderId,
            buyer:        buyer,
            seller:       seller,
            tokenId:      tokenId,
            amount:       amount,
            pricePerUnit: price,
            totalPrice:   totalPrice,
            fee:          fee,
            tradedAt:     block.timestamp,
            isAMM:        isAMM
        });
        buyerTrades[buyer].push(tradeId);
        sellerTrades[seller].push(tradeId);

        emit CreditTraded(
            tradeId, listingId, buyOrderId,
            buyer, seller, tokenId,
            amount, price, totalPrice, fee, isAMM
        );
    }

    function _min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }

    // ── ERC1155 Receiver ──────────────────────────────────
    function onERC1155Received(
        address, address, uint256, uint256, bytes calldata
    ) external pure override returns (bytes4) {
        return this.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(
        address, address, uint256[] calldata, uint256[] calldata, bytes calldata
    ) external pure override returns (bytes4) {
        return this.onERC1155BatchReceived.selector;
    }

    function supportsInterface(bytes4 interfaceId) public view override returns (bool) {
        return interfaceId == type(IERC1155Receiver).interfaceId;
    }

    // ── Admin ─────────────────────────────────────────────
    function pause()   external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    receive() external payable {}
}
