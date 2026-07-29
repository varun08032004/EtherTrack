// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol";
import "./CarbonCreditToken.sol";
import "./KYCRegistry.sol";
import "./Treasury.sol";

/**
 * @title AMMPool
 * @author EtherTrack
 * @notice x*y=k AMM for carbon credit swaps.
 *         Retail orders (< threshold) route here.
 *         Large orders use Marketplace order book.
 *
 * POOLS:
 *   Each pool is a (tokenId, ETH) pair.
 *   LP deposits carbon credits + ETH.
 *   Swappers get instant price via constant product formula.
 *   LP earns 0.3% swap fee.
 *
 * FORMULA:
 *   x = credit reserves
 *   y = ETH reserves
 *   k = x * y (constant)
 *   price = y / x
 *
 * FEES:
 *   0.3% LP fee (stays in pool, accrues to LPs)
 *   0.2% platform fee → Treasury
 *   Total: 0.5% per swap
 */
contract AMMPool is Ownable, ReentrancyGuard, IERC1155Receiver {

    CarbonCreditToken public creditToken;
    KYCRegistry       public kycRegistry;
    Treasury          public treasury;

    // ── Pool state ────────────────────────────────────────
    struct Pool {
        uint256 tokenId;
        uint256 creditReserve;  // x
        uint256 ethReserve;     // y
        uint256 totalShares;    // LP shares outstanding
        bool    active;
        string  name;
    }

    struct LPPosition {
        uint256 shares;
        uint256 creditDeposited;
        uint256 ethDeposited;
        uint256 depositedAt;
    }

    // poolId → Pool
    mapping(uint256 => Pool) public pools;
    // poolId → LP address → position
    mapping(uint256 => mapping(address => LPPosition)) public lpPositions;
    // tokenId → poolId (one pool per token type)
    mapping(uint256 => uint256) public tokenPool;

    uint256 private _nextPoolId;

    uint256 public constant LP_FEE_BPS       = 30;  // 0.3%
    uint256 public constant PLATFORM_FEE_BPS = 20;  // 0.2%
    uint256 public constant BPS_DENOMINATOR  = 10000;
    uint256 public constant MINIMUM_LIQUIDITY = 1000; // prevent dust attacks

    // ── Events ────────────────────────────────────────────
    event PoolCreated(uint256 indexed poolId, uint256 indexed tokenId, string name);
    event LiquidityAdded(uint256 indexed poolId, address indexed lp, uint256 credits, uint256 eth, uint256 shares);
    event LiquidityRemoved(uint256 indexed poolId, address indexed lp, uint256 credits, uint256 eth, uint256 shares);
    event KYCRegistryUpdated(address indexed oldRegistry, address indexed newRegistry);
    event Swapped(
        uint256 indexed poolId,
        address indexed trader,
        bool    creditIn,    // true = sold credits for ETH, false = bought credits with ETH
        uint256 amountIn,
        uint256 amountOut,
        uint256 fee
    );

    // ── Modifiers ─────────────────────────────────────────
    modifier onlyKYCVerified() {
        require(kycRegistry.isKYCVerified(msg.sender), "Not KYC verified");
        _;
    }

    modifier poolActive(uint256 poolId) {
        require(pools[poolId].active, "Pool not active");
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
    // POOL MANAGEMENT
    // ═══════════════════════════════════════════════════════

    /**
     * @notice Create a new liquidity pool for a carbon credit token
     * @param tokenId  ERC-1155 token ID
     * @param name     Pool name (e.g. "India Renewable Pool")
     */
    function createPool(
        uint256 tokenId,
        string calldata name
    ) external onlyOwner returns (uint256 poolId) {
        require(tokenPool[tokenId] == 0, "Pool exists for this token");

        poolId = ++_nextPoolId;

        pools[poolId] = Pool({
            tokenId:       tokenId,
            creditReserve: 0,
            ethReserve:    0,
            totalShares:   0,
            active:        true,
            name:          name
        });

        tokenPool[tokenId] = poolId;
        emit PoolCreated(poolId, tokenId, name);
    }

    // ═══════════════════════════════════════════════════════
    // LIQUIDITY PROVISION
    // ═══════════════════════════════════════════════════════

    /**
     * @notice Add liquidity to a pool
     * @dev    LP deposits credits + ETH proportionally.
     *         First LP sets the initial price ratio.
     *         Subsequent LPs must match current ratio.
     *
     * @param poolId        Pool to add liquidity to
     * @param creditAmount  Credits to deposit
     */
    function addLiquidity(
        uint256 poolId,
        uint256 creditAmount
    ) external payable onlyKYCVerified poolActive(poolId) nonReentrant returns (uint256 shares) {
        Pool storage pool = pools[poolId];
        require(creditAmount > 0, "Credit amount must be > 0");
        require(msg.value > 0,    "ETH amount must be > 0");
        require(
            creditToken.balanceOf(msg.sender, pool.tokenId) >= creditAmount,
            "Insufficient credits"
        );

        if (pool.totalShares == 0) {
            // First LP — sets initial price
            shares = _sqrt(creditAmount * msg.value) - MINIMUM_LIQUIDITY;
            pool.totalShares = MINIMUM_LIQUIDITY; // lock minimum liquidity forever
        } else {
            // Subsequent LPs — must match ratio
            uint256 sharesByCredit = (creditAmount * pool.totalShares) / pool.creditReserve;
            uint256 sharesByEth    = (msg.value    * pool.totalShares) / pool.ethReserve;
            shares = _min(sharesByCredit, sharesByEth);
        }

        require(shares > 0, "Insufficient liquidity minted");

        pool.creditReserve += creditAmount;
        pool.ethReserve    += msg.value;
        pool.totalShares   += shares;

        lpPositions[poolId][msg.sender].shares           += shares;
        lpPositions[poolId][msg.sender].creditDeposited  += creditAmount;
        lpPositions[poolId][msg.sender].ethDeposited     += msg.value;
        lpPositions[poolId][msg.sender].depositedAt       = block.timestamp;

        // Transfer credits from LP to pool
        creditToken.safeTransferFrom(msg.sender, address(this), pool.tokenId, creditAmount, "");

        emit LiquidityAdded(poolId, msg.sender, creditAmount, msg.value, shares);
    }

    /**
     * @notice Remove liquidity from a pool
     * @param poolId Pool to remove from
     * @param shares LP shares to burn
     */
    function removeLiquidity(
        uint256 poolId,
        uint256 shares
    ) external poolActive(poolId) nonReentrant returns (uint256 creditAmount, uint256 ethAmount) {
        Pool storage pool = pools[poolId];
        LPPosition storage pos = lpPositions[poolId][msg.sender];

        require(pos.shares >= shares, "Insufficient shares");
        require(pool.totalShares > 0, "No liquidity");

        // Proportional share of reserves
        creditAmount = (shares * pool.creditReserve) / pool.totalShares;
        ethAmount    = (shares * pool.ethReserve)    / pool.totalShares;

        require(creditAmount > 0 && ethAmount > 0, "Insufficient liquidity burned");

        pos.shares           -= shares;
        pool.creditReserve   -= creditAmount;
        pool.ethReserve      -= ethAmount;
        pool.totalShares     -= shares;

        // Return credits to LP
        creditToken.safeTransferFrom(address(this), msg.sender, pool.tokenId, creditAmount, "");

        // Return ETH to LP
        (bool paid,) = msg.sender.call{value: ethAmount}("");
        require(paid, "ETH transfer failed");

        emit LiquidityRemoved(poolId, msg.sender, creditAmount, ethAmount, shares);
    }

    // ═══════════════════════════════════════════════════════
    // SWAP — x*y=k constant product
    // ═══════════════════════════════════════════════════════

    /**
     * @notice Buy credits with ETH via AMM
     * @dev    ETH in → credits out using x*y=k
     *         Best for small retail orders
     *
     * @param poolId      Pool to swap in
     * @param minCredits  Minimum credits to receive (slippage protection)
     */
    function swapETHForCredits(
        uint256 poolId,
        uint256 minCredits
    ) external payable onlyKYCVerified poolActive(poolId) nonReentrant returns (uint256 creditOut) {
        Pool storage pool = pools[poolId];
        require(msg.value > 0, "ETH amount must be > 0");
        require(pool.creditReserve > 0 && pool.ethReserve > 0, "Pool empty");

        // Deduct fees from input
        uint256 totalFee     = (msg.value * (LP_FEE_BPS + PLATFORM_FEE_BPS)) / BPS_DENOMINATOR;
        uint256 platformFee  = (msg.value * PLATFORM_FEE_BPS) / BPS_DENOMINATOR;
        uint256 ethInAfterFee = msg.value - totalFee;

        // x*y=k: creditOut = (creditReserve * ethIn) / (ethReserve + ethIn)
        creditOut = (pool.creditReserve * ethInAfterFee) / (pool.ethReserve + ethInAfterFee);

        require(creditOut >= minCredits,        "Slippage exceeded");
        require(creditOut < pool.creditReserve, "Insufficient pool liquidity");

        // Update reserves
        pool.ethReserve    += ethInAfterFee;
        pool.creditReserve -= creditOut;

        // Transfer credits to buyer
        creditToken.safeTransferFrom(address(this), msg.sender, pool.tokenId, creditOut, "");

        // Platform fee to Treasury
        treasury.depositFee{value: platformFee}();

        emit Swapped(poolId, msg.sender, false, msg.value, creditOut, totalFee);
    }

    /**
     * @notice Sell credits for ETH via AMM
     * @dev    Credits in → ETH out using x*y=k
     *
     * @param poolId    Pool to swap in
     * @param credits   Credits to sell
     * @param minEth    Minimum ETH to receive (slippage protection)
     */
    function swapCreditsForETH(
        uint256 poolId,
        uint256 credits,
        uint256 minEth
    ) external onlyKYCVerified poolActive(poolId) nonReentrant returns (uint256 ethOut) {
        Pool storage pool = pools[poolId];
        require(credits > 0, "Credit amount must be > 0");
        require(pool.creditReserve > 0 && pool.ethReserve > 0, "Pool empty");
        require(
            creditToken.balanceOf(msg.sender, pool.tokenId) >= credits,
            "Insufficient credits"
        );

        // x*y=k: ethOut = (ethReserve * credits) / (creditReserve + credits)
        uint256 ethOutGross = (pool.ethReserve * credits) / (pool.creditReserve + credits);

        // Deduct fees from output
        uint256 totalFee    = (ethOutGross * (LP_FEE_BPS + PLATFORM_FEE_BPS)) / BPS_DENOMINATOR;
        uint256 platformFee = (ethOutGross * PLATFORM_FEE_BPS) / BPS_DENOMINATOR;
        ethOut = ethOutGross - totalFee;

        require(ethOut >= minEth,         "Slippage exceeded");
        require(ethOut < pool.ethReserve, "Insufficient pool liquidity");

        // Update reserves
        pool.creditReserve += credits;
        pool.ethReserve    -= ethOut;

        // Transfer credits from seller to pool
        creditToken.safeTransferFrom(msg.sender, address(this), pool.tokenId, credits, "");

        // Send ETH to seller
        (bool paid,) = msg.sender.call{value: ethOut}("");
        require(paid, "ETH transfer failed");

        // Platform fee to Treasury
        treasury.depositFee{value: platformFee}();

        emit Swapped(poolId, msg.sender, true, credits, ethOut, totalFee);
    }

    // ═══════════════════════════════════════════════════════
    // VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════

    /**
     * @notice Get current AMM price for a pool (ETH per credit)
     */
    function getPrice(uint256 poolId) external view returns (uint256) {
        Pool storage pool = pools[poolId];
        if (pool.creditReserve == 0) return 0;
        return (pool.ethReserve * 1e18) / pool.creditReserve;
    }

    /**
     * @notice Estimate credits out for ETH in
     */
    function quoteETHForCredits(uint256 poolId, uint256 ethIn) external view returns (uint256 creditOut, uint256 fee) {
        Pool storage pool = pools[poolId];
        if (pool.creditReserve == 0 || pool.ethReserve == 0) return (0, 0);
        fee      = (ethIn * (LP_FEE_BPS + PLATFORM_FEE_BPS)) / BPS_DENOMINATOR;
        uint256 ethInAfterFee = ethIn - fee;
        creditOut = (pool.creditReserve * ethInAfterFee) / (pool.ethReserve + ethInAfterFee);
    }

    /**
     * @notice Estimate ETH out for credits in
     */
    function quoteCreditsForETH(uint256 poolId, uint256 credits) external view returns (uint256 ethOut, uint256 fee) {
        Pool storage pool = pools[poolId];
        if (pool.creditReserve == 0 || pool.ethReserve == 0) return (0, 0);
        uint256 ethOutGross = (pool.ethReserve * credits) / (pool.creditReserve + credits);
        fee    = (ethOutGross * (LP_FEE_BPS + PLATFORM_FEE_BPS)) / BPS_DENOMINATOR;
        ethOut = ethOutGross - fee;
    }

    function getPool(uint256 poolId) external view returns (Pool memory) {
        return pools[poolId];
    }

    function getLPPosition(uint256 poolId, address lp) external view returns (LPPosition memory) {
        return lpPositions[poolId][lp];
    }

    function totalPools() external view returns (uint256) { return _nextPoolId; }

    // ── Internal math ─────────────────────────────────────
    function _sqrt(uint256 x) internal pure returns (uint256 y) {
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2;
        y = x;
        while (z < y) { y = z; z = (x / z + z) / 2; }
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

    /// @notice Repoint this contract at a different KYCRegistry deployment
    ///         without redeploying AMMPool. Existing pools, liquidity, and
    ///         balances are untouched.
    function setKYCRegistry(address newRegistry) external onlyOwner {
        require(newRegistry != address(0), "Invalid registry address");
        emit KYCRegistryUpdated(address(kycRegistry), newRegistry);
        kycRegistry = KYCRegistry(newRegistry);
    }

    receive() external payable {}
}
