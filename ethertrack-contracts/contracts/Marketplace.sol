// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol";
import "./CarbonCreditToken.sol";
import "./KYCRegistry.sol";
import "./Treasury.sol";

contract Marketplace is Ownable, Pausable, ReentrancyGuard, IERC1155Receiver {

    CarbonCreditToken public creditToken;
    KYCRegistry       public kycRegistry;
    Treasury          public treasury;

    enum OrderSide   { BUY, SELL }
    enum OrderStatus { OPEN, FILLED, PARTIALLY_FILLED, CANCELLED, EXPIRED }

    struct Listing {
        uint256     listingId;
        address     seller;
        uint256     tokenId;
        uint256     amount;
        uint256     amountRemaining;
        uint256     pricePerUnit;     // ETH wei per credit
        uint256     pricePerUnitINR;  // ✅ NEW: INR price (scaled x100, e.g. 1200 = ₹12.00)
        uint256     listedAt;
        uint256     expiresAt;
        bool        active;
    }

    struct BuyOrder {
        uint256     orderId;
        address     buyer;
        uint256     tokenId;
        uint256     amount;
        uint256     amountFilled;
        uint256     limitPrice;
        uint256     ethEscrowed;
        OrderStatus status;
        uint256     createdAt;
        uint256     expiresAt;
    }

    struct Trade {
        uint256 tradeId;
        uint256 listingId;
        uint256 buyOrderId;
        address buyer;
        address seller;
        uint256 tokenId;
        uint256 amount;
        uint256 pricePerUnit;
        uint256 pricePerUnitINR;  // ✅ NEW
        uint256 totalPrice;
        uint256 buyerFee;         // ✅ NEW: 0.5% from buyer
        uint256 sellerFee;        // ✅ NEW: 0.5% from seller
        uint256 totalFee;         // ✅ NEW: 1% total
        uint256 tradedAt;
        bool    isAMM;
    }

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
    mapping(uint256 => uint256[]) public tokenListings;
    mapping(uint256 => uint256[]) public tokenBuyOrders;

    address public ammPool;
    uint256 public ammThreshold = 100;

    // ✅ FIXED: 0.5% each side = 1% total
    uint256 public constant BUYER_FEE_BPS    = 50;   // 0.5%
    uint256 public constant SELLER_FEE_BPS   = 50;   // 0.5%
    uint256 public constant BPS_DENOMINATOR  = 10000;
    uint256 public constant MAX_DURATION     = 90 days;
    uint256 public constant DEFAULT_DURATION = 30 days;

    // ── Events ────────────────────────────────────────────
    event CreditListed(
        uint256 indexed listingId,
        address indexed seller,
        uint256 indexed tokenId,
        uint256 amount,
        uint256 pricePerUnit,
        uint256 pricePerUnitINR  // ✅ NEW
    );
    event ListingCancelled(uint256 indexed listingId, address indexed seller);
    event ListingUpdated(uint256 indexed listingId, uint256 newPrice, uint256 newPriceINR);

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
        uint256 pricePerUnitINR,  // ✅ NEW
        uint256 totalPrice,
        uint256 buyerFee,         // ✅ NEW
        uint256 sellerFee,        // ✅ NEW
        uint256 totalFee,         // ✅ NEW
        bool    isAMM
    );

    event AMMPoolSet(address indexed ammPool);
    event AMMThresholdUpdated(uint256 newThreshold);
    event MatchExecuted(uint256 listingId, uint256 buyOrderId, uint256 amount, uint256 price);

    // ✅ FIXED: KYC check is now real
    modifier onlyKYCVerified() {
        require(
            kycRegistry.isKYCVerified(msg.sender),
            "Not authorized: wallet not KYC verified"
        );
        _;
    }

    modifier listingExists(uint256 listingId) {
        require(listings[listingId].active, "Listing not active");
        require(block.timestamp < listings[listingId].expiresAt, "Listing expired");
        _;
    }

    modifier buyOrderExists(uint256 orderId) {
        require(
            buyOrders[orderId].status == OrderStatus.OPEN ||
            buyOrders[orderId].status == OrderStatus.PARTIALLY_FILLED,
            "Buy order not open"
        );
        require(block.timestamp < buyOrders[orderId].expiresAt, "Buy order expired");
        _;
    }

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

    // ═══════════════════════════════════════════════════
    // LIST CREDITS
    // ═══════════════════════════════════════════════════

    function listCredit(
        uint256 tokenId,
        uint256 amount,
        uint256 pricePerUnit,    // ETH wei per credit
        uint256 pricePerUnitINR, // ✅ NEW: INR price (whole rupees, e.g. 1200 = ₹1200)
        uint256 duration
    ) external onlyKYCVerified whenNotPaused returns (uint256 listingId) {
        require(amount > 0,       "Amount must be > 0");
        require(pricePerUnit > 0, "ETH price must be > 0");
        require(pricePerUnitINR > 0, "INR price must be > 0");
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
            pricePerUnitINR: pricePerUnitINR,  // ✅ store INR price
            listedAt:        block.timestamp,
            expiresAt:       block.timestamp + dur,
            active:          true
        });

        sellerListings[msg.sender].push(listingId);
        tokenListings[tokenId].push(listingId);

        creditToken.safeTransferFrom(msg.sender, address(this), tokenId, amount, "");

        emit CreditListed(listingId, msg.sender, tokenId, amount, pricePerUnit, pricePerUnitINR);

        _tryMatchListing(listingId);
    }

    function updateListingPrice(
        uint256 listingId,
        uint256 newPriceEth,
        uint256 newPriceINR
    ) external listingExists(listingId) {
        require(listings[listingId].seller == msg.sender, "Not your listing");
        require(newPriceEth > 0 && newPriceINR > 0, "Price must be > 0");
        listings[listingId].pricePerUnit    = newPriceEth;
        listings[listingId].pricePerUnitINR = newPriceINR;
        emit ListingUpdated(listingId, newPriceEth, newPriceINR);
        _tryMatchListing(listingId);
    }

    function cancelListing(uint256 listingId) external listingExists(listingId) {
        Listing storage listing = listings[listingId];
        require(
            listing.seller == msg.sender || msg.sender == owner(),
            "Not your listing"
        );
        listing.active = false;
        if (listing.amountRemaining > 0) {
            creditToken.safeTransferFrom(
                address(this), listing.seller,
                listing.tokenId, listing.amountRemaining, ""
            );
        }
        emit ListingCancelled(listingId, msg.sender);
    }

    // ═══════════════════════════════════════════════════
    // BUY CREDIT — ETH payment
    // ═══════════════════════════════════════════════════

    function buyCredit(
        uint256 listingId,
        uint256 amount
    ) external payable onlyKYCVerified whenNotPaused nonReentrant listingExists(listingId) {
        Listing storage listing = listings[listingId];

        require(listing.seller != msg.sender,     "Cannot buy own listing");
        require(amount > 0,                        "Amount must be > 0");
        require(amount <= listing.amountRemaining, "Exceeds available amount");

        uint256 subtotal   = amount * listing.pricePerUnit;

        // ✅ FIXED: 0.5% from buyer + 0.5% from seller = 1% total
        uint256 buyerFee   = (subtotal * BUYER_FEE_BPS)  / BPS_DENOMINATOR;
        uint256 sellerFee  = (subtotal * SELLER_FEE_BPS) / BPS_DENOMINATOR;
        uint256 totalFee   = buyerFee + sellerFee;
        uint256 sellerGets = subtotal - sellerFee;
        uint256 buyerPays  = subtotal + buyerFee;

        require(msg.value >= buyerPays, "Insufficient ETH: send subtotal + 0.5% fee");

        listing.amountRemaining -= amount;
        if (listing.amountRemaining == 0) listing.active = false;

        uint256 tradeId = _recordTrade(
            listingId,
            type(uint256).max,
            msg.sender,
            listing.seller,
            listing.tokenId,
            amount,
            listing.pricePerUnit,
            listing.pricePerUnitINR,
            subtotal,
            buyerFee,
            sellerFee,
            totalFee,
            false
        );

        // Transfer credits to buyer
        creditToken.safeTransferFrom(
            address(this), msg.sender, listing.tokenId, amount, ""
        );

        // ✅ Pay seller: subtotal - 0.5% seller fee
        (bool paid,) = listing.seller.call{value: sellerGets}("");
        require(paid, "Seller payment failed");

        // ✅ Platform gets 1% total (buyer fee + seller fee)
        treasury.depositFee{value: totalFee}();

        // Refund excess ETH
        uint256 excess = msg.value - buyerPays;
        if (excess > 0) {
            (bool refunded,) = msg.sender.call{value: excess}("");
            require(refunded, "Refund failed");
        }
    }

    // ═══════════════════════════════════════════════════
    // PLACE BID
    // ═══════════════════════════════════════════════════

    function placeBuyOrder(
        uint256 tokenId,
        uint256 amount,
        uint256 limitPrice,
        uint256 duration
    ) external payable onlyKYCVerified whenNotPaused returns (uint256 orderId) {
        require(amount > 0, "Amount must be > 0");

        uint256 effectivePrice = limitPrice;
        if (effectivePrice == 0) {
            effectivePrice = _getBestAsk(tokenId);
            require(effectivePrice > 0, "No listings available");
        }

        uint256 totalCost = amount * effectivePrice;
        // ✅ Buyer locks subtotal + 0.5% buyer fee
        uint256 buyerFee  = (totalCost * BUYER_FEE_BPS) / BPS_DENOMINATOR;
        require(msg.value >= totalCost + buyerFee, "Insufficient ETH escrowed");

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

        _tryMatchBuyOrder(orderId);
    }

    function cancelBuyOrder(uint256 orderId) external nonReentrant {
        BuyOrder storage order = buyOrders[orderId];
        require(order.buyer == msg.sender, "Not your order");
        require(
            order.status == OrderStatus.OPEN ||
            order.status == OrderStatus.PARTIALLY_FILLED,
            "Order not cancellable"
        );

        order.status = OrderStatus.CANCELLED;

        uint256 filledCost   = order.amountFilled * order.limitPrice;
        uint256 filledFee    = (filledCost * BUYER_FEE_BPS) / BPS_DENOMINATOR;
        uint256 amountSpent  = filledCost + filledFee;
        uint256 refundAmount = order.ethEscrowed > amountSpent
            ? order.ethEscrowed - amountSpent : 0;

        if (refundAmount > 0) {
            (bool refunded,) = msg.sender.call{value: refundAmount}("");
            require(refunded, "Refund failed");
        }

        emit BuyOrderCancelled(orderId, msg.sender, refundAmount);
    }

    // ═══════════════════════════════════════════════════
    // MATCHING ENGINE
    // ═══════════════════════════════════════════════════

    function _tryMatchListing(uint256 listingId) internal {
        Listing storage listing = listings[listingId];
        if (!listing.active || listing.amountRemaining == 0) return;

        uint256[] storage orderIds = tokenBuyOrders[listing.tokenId];
        for (uint256 i = 0; i < orderIds.length; i++) {
            if (listing.amountRemaining == 0) break;
            BuyOrder storage order = buyOrders[orderIds[i]];
            if (order.status != OrderStatus.OPEN &&
                order.status != OrderStatus.PARTIALLY_FILLED) continue;
            if (block.timestamp >= order.expiresAt) continue;
            if (order.buyer == listing.seller) continue;
            if (order.limitPrice < listing.pricePerUnit) continue;
            uint256 matchAmount = _min(
                order.amount - order.amountFilled,
                listing.amountRemaining
            );
            if (matchAmount == 0) continue;
            _executeMatch(listingId, orderIds[i], matchAmount, listing.pricePerUnit);
        }
    }

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
            if (listing.seller == order.buyer) continue;
            if (listing.pricePerUnit > order.limitPrice) continue;
            uint256 matchAmount = _min(
                order.amount - order.amountFilled,
                listing.amountRemaining
            );
            if (matchAmount == 0) continue;
            _executeMatch(listingIds[i], orderId, matchAmount, listing.pricePerUnit);
        }
    }

    function _executeMatch(
        uint256 listingId,
        uint256 buyOrderId,
        uint256 amount,
        uint256 price
    ) internal {
        Listing  storage listing = listings[listingId];
        BuyOrder storage order   = buyOrders[buyOrderId];

        uint256 subtotal   = amount * price;
        uint256 buyerFee   = (subtotal * BUYER_FEE_BPS)  / BPS_DENOMINATOR;
        uint256 sellerFee  = (subtotal * SELLER_FEE_BPS) / BPS_DENOMINATOR;
        uint256 totalFee   = buyerFee + sellerFee;
        uint256 sellerGets = subtotal - sellerFee;

        listing.amountRemaining -= amount;
        if (listing.amountRemaining == 0) listing.active = false;

        order.amountFilled += amount;
        if (order.amountFilled >= order.amount) {
            order.status = OrderStatus.FILLED;
        } else {
            order.status = OrderStatus.PARTIALLY_FILLED;
        }

        _recordTrade(
            listingId, buyOrderId,
            order.buyer, listing.seller,
            listing.tokenId, amount,
            price, listing.pricePerUnitINR,
            subtotal, buyerFee, sellerFee, totalFee,
            false
        );

        // Transfer credits
        creditToken.safeTransferFrom(
            address(this), order.buyer,
            listing.tokenId, amount, ""
        );

        // Pay seller
        (bool paid,) = listing.seller.call{value: sellerGets}("");
        require(paid, "Seller payment failed");

        // Platform fee
        treasury.depositFee{value: totalFee}();

        // Refund excess to buyer if matched below limit
        uint256 budgeted   = (amount * order.limitPrice) + ((amount * order.limitPrice * BUYER_FEE_BPS) / BPS_DENOMINATOR);
        uint256 actualCost = subtotal + buyerFee;
        if (budgeted > actualCost) {
            uint256 refund = budgeted - actualCost;
            order.ethEscrowed -= refund;
            (bool refunded,) = order.buyer.call{value: refund}("");
        }

        emit MatchExecuted(listingId, buyOrderId, amount, price);
        emit BuyOrderFilled(buyOrderId, amount, order.amount - order.amountFilled);
    }

    // ═══════════════════════════════════════════════════
    // VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════

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

    function getOrderBook(uint256 tokenId) external view returns (
        Listing[]  memory asks,
        BuyOrder[] memory bids
    ) {
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

    function getSellerListings(address seller) external view returns (uint256[] memory) { return sellerListings[seller]; }
    function getBuyerOrders(address buyer)     external view returns (uint256[] memory) { return buyerOrders[buyer]; }
    function getBuyerTrades(address buyer)     external view returns (uint256[] memory) { return buyerTrades[buyer]; }
    function getSellerTrades(address seller)   external view returns (uint256[] memory) { return sellerTrades[seller]; }
    function getTrade(uint256 tradeId)         external view returns (Trade memory)     { return trades[tradeId]; }

    function calculateBuyerCost(uint256 amount, uint256 pricePerUnit) external pure returns (
        uint256 subtotal, uint256 buyerFee, uint256 totalBuyerPays
    ) {
        subtotal      = amount * pricePerUnit;
        buyerFee      = (subtotal * BUYER_FEE_BPS) / BPS_DENOMINATOR;
        totalBuyerPays = subtotal + buyerFee;
    }

    function calculateSellerReceives(uint256 amount, uint256 pricePerUnit) external pure returns (
        uint256 subtotal, uint256 sellerFee, uint256 sellerReceives
    ) {
        subtotal       = amount * pricePerUnit;
        sellerFee      = (subtotal * SELLER_FEE_BPS) / BPS_DENOMINATOR;
        sellerReceives = subtotal - sellerFee;
    }

    function totalListings()  external view returns (uint256) { return _nextListingId; }
    function totalBuyOrders() external view returns (uint256) { return _nextOrderId;   }
    function totalTrades()    external view returns (uint256) { return _nextTradeId;   }
    function shouldUseAMM(uint256 amount) public view returns (bool) {
        return ammPool != address(0) && amount <= ammThreshold;
    }

    function setAMMPool(address _ammPool) external onlyOwner {
        ammPool = _ammPool;
        emit AMMPoolSet(_ammPool);
    }

    function setAMMThreshold(uint256 threshold) external onlyOwner {
        ammThreshold = threshold;
        emit AMMThresholdUpdated(threshold);
    }

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
        uint256 priceINR,
        uint256 totalPrice,
        uint256 buyerFee,
        uint256 sellerFee,
        uint256 totalFee,
        bool    isAMM
    ) internal returns (uint256 tradeId) {
        tradeId = _nextTradeId++;
        trades[tradeId] = Trade({
            tradeId:        tradeId,
            listingId:      listingId,
            buyOrderId:     buyOrderId,
            buyer:          buyer,
            seller:         seller,
            tokenId:        tokenId,
            amount:         amount,
            pricePerUnit:   price,
            pricePerUnitINR:priceINR,
            totalPrice:     totalPrice,
            buyerFee:       buyerFee,
            sellerFee:      sellerFee,
            totalFee:       totalFee,
            tradedAt:       block.timestamp,
            isAMM:          isAMM
        });
        buyerTrades[buyer].push(tradeId);
        sellerTrades[seller].push(tradeId);

        emit CreditTraded(
            tradeId, listingId, buyOrderId,
            buyer, seller, tokenId,
            amount, price, priceINR,
            totalPrice, buyerFee, sellerFee, totalFee, isAMM
        );
    }

    function _min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }

    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external pure override returns (bytes4) {
        return this.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata) external pure override returns (bytes4) {
        return this.onERC1155BatchReceived.selector;
    }

    function supportsInterface(bytes4 interfaceId) public view override returns (bool) {
        return interfaceId == type(IERC1155Receiver).interfaceId;
    }

    function pause()   external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    receive() external payable {}
}