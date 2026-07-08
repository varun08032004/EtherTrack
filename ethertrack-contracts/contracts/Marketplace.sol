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
 * EtherTrack Marketplace v2
 * ─────────────────────────────────────────────────────────────────────────────
 * CHANGES vs v1:
 *
 * [NEW] logINRTrade()       — logs INR wallet trades on-chain after DB settlement
 * [NEW] logRazorpayTrade()  — logs direct Razorpay checkout trades on-chain
 * [NEW] batchLogINRTrades() — batch version (gas efficient, up to 20 trades/tx)
 * [NEW] verifyTrade()       — public verification for any trade (all modes)
 * [NEW] INRTradeLogged event — emitted for every off-chain settled trade
 * [NEW] signerWallet        — backend hot wallet authorized to call log functions
 * [NEW] inrTradeHashes      — mapping to prevent duplicate logs
 *
 * WHAT DIDN'T CHANGE:
 *   All ETH trade logic (buyCredit, placeBuyOrder, cancelBuyOrder, matching)
 *   Fee structure (BUYER_FEE_BPS=50, SELLER_FEE_BPS=50 → 1% total to Treasury)
 *   All view functions, structs, events
 *   Treasury, KYCRegistry, CarbonCreditToken integrations
 *
 * HOW IT WORKS:
 *   ETH trades  → buyCredit() fires CreditTraded event (already on-chain)
 *   INR trades  → backend calls logINRTrade() after DB atomic settlement
 *   Razorpay    → backend calls logRazorpayTrade() after Razorpay verify
 *   All 3 modes → verifyTrade() lets anyone confirm a trade happened
 *
 * [FIX-NATSPEC v2.1] Fixed a NatSpec doc-comment bug in verifyTrade() below:
 *   its doc comment had a return-value tag written as "payMode" but the
 *   function's actual 4th return value is named `loggedPayMode`. Solidity's
 *   compiler enforces that documented return names match real return
 *   parameter names exactly, and Hardhat failed the entire build over this
 *   mismatch (HH600). No behavior changed — only the doc comment text.
 * ─────────────────────────────────────────────────────────────────────────────
 */
contract Marketplace is Ownable, Pausable, ReentrancyGuard, IERC1155Receiver {

    CarbonCreditToken public creditToken;
    KYCRegistry       public kycRegistry;
    Treasury          public treasury;

    // ── NEW: Backend signer wallet ────────────────────────────────────────────
    address public signerWallet;

    enum OrderSide   { BUY, SELL }
    enum OrderStatus { OPEN, FILLED, PARTIALLY_FILLED, CANCELLED, EXPIRED }

    // ── Payment mode (matches backend paymentMode column) ─────────────────────
    uint8 public constant MODE_INR_WALLET   = 0;
    uint8 public constant MODE_RAZORPAY     = 1;
    uint8 public constant MODE_ETH          = 2;

    struct Listing {
        uint256 listingId;
        address seller;
        uint256 tokenId;
        uint256 amount;
        uint256 amountRemaining;
        uint256 pricePerUnit;      // ETH wei per credit
        uint256 pricePerUnitINR;   // INR price (whole rupees, e.g. 1200 = ₹1200)
        uint256 listedAt;
        uint256 expiresAt;
        bool    active;
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
        uint256 pricePerUnitINR;
        uint256 totalPrice;
        uint256 buyerFee;
        uint256 sellerFee;
        uint256 totalFee;
        uint256 tradedAt;
        bool    isAMM;
    }

    // ── NEW: INR/Razorpay trade log entry ─────────────────────────────────────
    struct INRTradeLog {
        bytes32 tradeId;      // keccak256 of DB UUID
        uint256 tokenId;
        uint256 quantity;
        uint256 priceINR;     // price per credit in paise (₹ × 100)
        uint8   payMode;      // MODE_INR_WALLET or MODE_RAZORPAY
        address buyer;        // may be zero if no wallet bound
        address seller;
        uint256 timestamp;
        bytes32 tradeHash;    // keccak256 of all fields — tamper-evident
        uint256 blockLogged;
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

    // ── NEW: INR trade log storage ────────────────────────────────────────────
    // bytes32 tradeId (DB UUID as keccak256) → log entry
    mapping(bytes32 => INRTradeLog) public inrTradeLogs;
    // bytes32 tradeId → stored hash (for fast verification)
    mapping(bytes32 => bytes32)     public inrTradeHashes;

    address public ammPool;
    uint256 public ammThreshold = 100;

    uint256 public constant BUYER_FEE_BPS   = 50;    // 0.5%
    uint256 public constant SELLER_FEE_BPS  = 50;    // 0.5%
    uint256 public constant BPS_DENOMINATOR = 10000;
    uint256 public constant MAX_DURATION     = 90 days;
    uint256 public constant DEFAULT_DURATION = 30 days;

    // ── Events ────────────────────────────────────────────────────────────────

    // Existing ETH trade event — unchanged
    event CreditListed(
        uint256 indexed listingId,
        address indexed seller,
        uint256 indexed tokenId,
        uint256 amount,
        uint256 pricePerUnit,
        uint256 pricePerUnitINR
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
        uint256 pricePerUnitINR,
        uint256 totalPrice,
        uint256 buyerFee,
        uint256 sellerFee,
        uint256 totalFee,
        bool    isAMM
    );

    // ── NEW EVENTS ────────────────────────────────────────────────────────────

    /**
     * @dev Emitted for every INR wallet or Razorpay trade logged on-chain.
     *      Indexed on tradeId and tokenId for fast off-chain querying.
     *      Anyone can verify by calling verifyTrade().
     */
    event INRTradeLogged(
        bytes32 indexed tradeId,    // keccak256 of DB UUID
        uint256 indexed tokenId,
        uint256         quantity,
        uint256         priceINR,   // paise (₹ × 100)
        uint8           payMode,    // 0=INR_WALLET, 1=RAZORPAY
        address indexed buyer,      // zero if no wallet bound
        address         seller,
        bytes32         tradeHash,  // tamper-evident proof
        uint256         timestamp
    );

    event SignerWalletUpdated(address indexed oldSigner, address indexed newSigner);

    event AMMPoolSet(address indexed ammPool);
    event AMMThresholdUpdated(uint256 newThreshold);
    event MatchExecuted(uint256 listingId, uint256 buyOrderId, uint256 amount, uint256 price);

    // ── Modifiers ─────────────────────────────────────────────────────────────

    modifier onlyKYCVerified() {
        require(
            kycRegistry.isKYCVerified(msg.sender),
            "Not authorized: wallet not KYC verified"
        );
        _;
    }

    modifier onlySigner() {
        require(msg.sender == signerWallet, "Marketplace: not signer wallet");
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

    // ── Constructor ───────────────────────────────────────────────────────────

    constructor(
        address initialOwner,
        address creditTokenAddress,
        address kycRegistryAddress,
        address treasuryAddress,
        address _signerWallet          // NEW: backend hot wallet
    ) Ownable(initialOwner) {
        require(_signerWallet != address(0), "Marketplace: zero signer");
        creditToken  = CarbonCreditToken(creditTokenAddress);
        kycRegistry  = KYCRegistry(kycRegistryAddress);
        treasury     = Treasury(payable(treasuryAddress));
        signerWallet = _signerWallet;
    }

    // ═════════════════════════════════════════════════════════════════════════
    // NEW: INR / RAZORPAY ON-CHAIN LOGGING
    // Called by EtherTrack backend AFTER DB settlement confirms successfully.
    // Gas is paid by the platform (signer wallet has MATIC).
    // ═════════════════════════════════════════════════════════════════════════

    /**
     * @notice Log a single INR wallet or Razorpay trade on-chain.
     *         Called by the backend signer wallet after atomic DB settlement.
     *
     * @param tradeId    keccak256(abi.encodePacked(dbTradeUUID)) — unique per trade
     * @param tokenId    carbon credit token ID
     * @param quantity   credits purchased
     * @param priceINR   price per credit in PAISE (₹1000 = 100000 paise)
     * @param payMode    0 = INR_WALLET, 1 = RAZORPAY
     * @param buyer      buyer's bound wallet (address(0) if none)
     * @param seller     seller's bound wallet
     * @param timestamp  unix timestamp of DB settlement
     */
    function logINRTrade(
        bytes32 tradeId,
        uint256 tokenId,
        uint256 quantity,
        uint256 priceINR,
        uint8   payMode,
        address buyer,
        address seller,
        uint256 timestamp
    ) external onlySigner whenNotPaused {
        require(
            payMode == MODE_INR_WALLET || payMode == MODE_RAZORPAY,
            "Marketplace: use buyCredit for ETH trades"
        );
        require(inrTradeHashes[tradeId] == bytes32(0), "Marketplace: trade already logged");
        require(quantity > 0,   "Marketplace: zero quantity");
        require(priceINR > 0,   "Marketplace: zero price");
        require(seller != address(0), "Marketplace: zero seller");

        bytes32 hash = keccak256(abi.encodePacked(
            tradeId, tokenId, quantity, priceINR,
            payMode, buyer, seller, timestamp
        ));

        inrTradeHashes[tradeId] = hash;
        inrTradeLogs[tradeId]   = INRTradeLog({
            tradeId:     tradeId,
            tokenId:     tokenId,
            quantity:    quantity,
            priceINR:    priceINR,
            payMode:     payMode,
            buyer:       buyer,
            seller:      seller,
            timestamp:   timestamp,
            tradeHash:   hash,
            blockLogged: block.number
        });

        emit INRTradeLogged(
            tradeId, tokenId, quantity, priceINR,
            payMode, buyer, seller, hash, timestamp
        );
    }

    /**
     * @notice Batch log up to 20 INR/Razorpay trades in one transaction.
     *         Used by the hourly cron for gas efficiency.
     *         Skips duplicates silently (idempotent).
     */
    function batchLogINRTrades(
        bytes32[] calldata tradeIds,
        uint256[] calldata tokenIds,
        uint256[] calldata quantities,
        uint256[] calldata pricesINR,
        uint8[]   calldata payModes,
        address[] calldata buyers,
        address[] calldata sellers,
        uint256[] calldata timestamps
    ) external onlySigner whenNotPaused {
        uint256 len = tradeIds.length;
        require(len <= 20,  "Marketplace: max 20 per batch");
        require(
            len == tokenIds.length &&
            len == quantities.length &&
            len == pricesINR.length &&
            len == payModes.length &&
            len == buyers.length &&
            len == sellers.length &&
            len == timestamps.length,
            "Marketplace: array length mismatch"
        );

        for (uint256 i = 0; i < len; i++) {
            // Skip duplicates — safe to retry
            if (inrTradeHashes[tradeIds[i]] != bytes32(0)) continue;
            // Skip invalid modes
            if (payModes[i] != MODE_INR_WALLET && payModes[i] != MODE_RAZORPAY) continue;

            bytes32 hash = keccak256(abi.encodePacked(
                tradeIds[i], tokenIds[i], quantities[i], pricesINR[i],
                payModes[i], buyers[i], sellers[i], timestamps[i]
            ));

            inrTradeHashes[tradeIds[i]] = hash;
            inrTradeLogs[tradeIds[i]] = INRTradeLog({
                tradeId:     tradeIds[i],
                tokenId:     tokenIds[i],
                quantity:    quantities[i],
                priceINR:    pricesINR[i],
                payMode:     payModes[i],
                buyer:       buyers[i],
                seller:      sellers[i],
                timestamp:   timestamps[i],
                tradeHash:   hash,
                blockLogged: block.number
            });

            emit INRTradeLogged(
                tradeIds[i], tokenIds[i], quantities[i], pricesINR[i],
                payModes[i], buyers[i], sellers[i], hash, timestamps[i]
            );
        }
    }

    /**
     * @notice Public on-chain verification — anyone can call this.
     *         Regulators, auditors, counterparties can verify any trade
     *         without trusting EtherTrack's database.
     *
     * @return valid         true if supplied params match what was logged
     * @return storedHash    the hash stored on-chain
     * @return blockLogged   block number when trade was logged (0 = not found)
     * @return loggedPayMode 0=INR_WALLET, 1=RAZORPAY, 2=ETH (ETH → use trades mapping)
     */
    function verifyTrade(
        bytes32 tradeId,
        uint256 tokenId,
        uint256 quantity,
        uint256 priceINR,
        uint8   payMode,
        address buyer,
        address seller,
        uint256 timestamp
    ) external view returns (
        bool    valid,
        bytes32 storedHash,
        uint256 blockLogged,
        uint8   loggedPayMode
    ) {
        storedHash   = inrTradeHashes[tradeId];
        blockLogged  = inrTradeLogs[tradeId].blockLogged;
        loggedPayMode = inrTradeLogs[tradeId].payMode;

        if (storedHash == bytes32(0)) {
            return (false, storedHash, blockLogged, loggedPayMode);
        }

        bytes32 recomputed = keccak256(abi.encodePacked(
            tradeId, tokenId, quantity, priceINR,
            payMode, buyer, seller, timestamp
        ));
        valid = (recomputed == storedHash);
    }

    /**
     * @notice Retrieve full INR trade log by DB trade ID.
     */
    function getINRTradeLog(bytes32 tradeId)
        external view returns (INRTradeLog memory)
    {
        require(inrTradeHashes[tradeId] != bytes32(0), "Marketplace: trade not logged");
        return inrTradeLogs[tradeId];
    }

    // ── Signer management ─────────────────────────────────────────────────────
    function setSignerWallet(address _signer) external onlyOwner {
        require(_signer != address(0), "Marketplace: zero address");
        emit SignerWalletUpdated(signerWallet, _signer);
        signerWallet = _signer;
    }

    // ═════════════════════════════════════════════════════════════════════════
    // EXISTING: LIST CREDITS — unchanged
    // ═════════════════════════════════════════════════════════════════════════

    function listCredit(
        uint256 tokenId,
        uint256 amount,
        uint256 pricePerUnit,
        uint256 pricePerUnitINR,
        uint256 duration
    ) external onlyKYCVerified whenNotPaused returns (uint256 listingId) {
        require(amount > 0,          "Amount must be > 0");
        require(pricePerUnit > 0,    "ETH price must be > 0");
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
            pricePerUnitINR: pricePerUnitINR,
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

    // ═════════════════════════════════════════════════════════════════════════
    // EXISTING: BUY WITH ETH — unchanged
    // ═════════════════════════════════════════════════════════════════════════

    function buyCredit(
        uint256 listingId,
        uint256 amount
    ) external payable onlyKYCVerified whenNotPaused nonReentrant listingExists(listingId) {
        Listing storage listing = listings[listingId];

        require(listing.seller != msg.sender,     "Cannot buy own listing");
        require(amount > 0,                        "Amount must be > 0");
        require(amount <= listing.amountRemaining, "Exceeds available amount");

        uint256 subtotal  = amount * listing.pricePerUnit;
        uint256 buyerFee  = (subtotal * BUYER_FEE_BPS)  / BPS_DENOMINATOR;
        uint256 sellerFee = (subtotal * SELLER_FEE_BPS) / BPS_DENOMINATOR;
        uint256 totalFee  = buyerFee + sellerFee;
        uint256 sellerGets = subtotal - sellerFee;
        uint256 buyerPays  = subtotal + buyerFee;

        require(msg.value >= buyerPays, "Insufficient ETH: send subtotal + 0.5% fee");

        listing.amountRemaining -= amount;
        if (listing.amountRemaining == 0) listing.active = false;

        _recordTrade(
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

        creditToken.safeTransferFrom(
            address(this), msg.sender, listing.tokenId, amount, ""
        );

        (bool paid,) = listing.seller.call{value: sellerGets}("");
        require(paid, "Seller payment failed");

        treasury.depositFee{value: totalFee}();

        uint256 excess = msg.value - buyerPays;
        if (excess > 0) {
            (bool refunded,) = msg.sender.call{value: excess}("");
            require(refunded, "Refund failed");
        }
    }

    // ═════════════════════════════════════════════════════════════════════════
    // EXISTING: BID / ORDER BOOK — unchanged
    // ═════════════════════════════════════════════════════════════════════════

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

    // ═════════════════════════════════════════════════════════════════════════
    // EXISTING: MATCHING ENGINE — unchanged
    // ═════════════════════════════════════════════════════════════════════════

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
        order.status = order.amountFilled >= order.amount
            ? OrderStatus.FILLED
            : OrderStatus.PARTIALLY_FILLED;

        _recordTrade(
            listingId, buyOrderId,
            order.buyer, listing.seller,
            listing.tokenId, amount,
            price, listing.pricePerUnitINR,
            subtotal, buyerFee, sellerFee, totalFee,
            false
        );

        creditToken.safeTransferFrom(
            address(this), order.buyer, listing.tokenId, amount, ""
        );

        (bool paid,) = listing.seller.call{value: sellerGets}("");
        require(paid, "Seller payment failed");

        treasury.depositFee{value: totalFee}();

        uint256 budgeted   = (amount * order.limitPrice) +
            ((amount * order.limitPrice * BUYER_FEE_BPS) / BPS_DENOMINATOR);
        uint256 actualCost = subtotal + buyerFee;
        if (budgeted > actualCost) {
            uint256 refund = budgeted - actualCost;
            order.ethEscrowed -= refund;
            (bool refunded,) = order.buyer.call{value: refund}("");
            require(refunded, "Refund failed");
        }

        emit MatchExecuted(listingId, buyOrderId, amount, price);
        emit BuyOrderFilled(buyOrderId, amount, order.amount - order.amountFilled);
    }

    // ═════════════════════════════════════════════════════════════════════════
    // EXISTING: VIEW FUNCTIONS — unchanged
    // ═════════════════════════════════════════════════════════════════════════

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
        subtotal       = amount * pricePerUnit;
        buyerFee       = (subtotal * BUYER_FEE_BPS) / BPS_DENOMINATOR;
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
            tradeId:         tradeId,
            listingId:       listingId,
            buyOrderId:      buyOrderId,
            buyer:           buyer,
            seller:          seller,
            tokenId:         tokenId,
            amount:          amount,
            pricePerUnit:    price,
            pricePerUnitINR: priceINR,
            totalPrice:      totalPrice,
            buyerFee:        buyerFee,
            sellerFee:       sellerFee,
            totalFee:        totalFee,
            tradedAt:        block.timestamp,
            isAMM:           isAMM
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

    // ── ERC1155 receiver ──────────────────────────────────────────────────────
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

    function pause()   external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    receive() external payable {}
}
