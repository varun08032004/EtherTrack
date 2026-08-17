// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title MarketplaceUpgradeable
 * @author EtherTrack
 * @notice UUPS Upgradeable version of Marketplace contract
 *         Allows upgrading the implementation while preserving state
 *         Uses OpenZeppelin's UUPSUpgradeable for secure upgrades
 */
contract MarketplaceUpgradeable is Initializable, UUPSUpgradeable, OwnableUpgradeable, PausableUpgradeable, AccessControlUpgradeable, ReentrancyGuardUpgradeable, IERC1155ReceiverUpgradeable {
    using SafeERC20 for IERC20;
    using SafeERC20 for IERC1155;

    // Role definitions
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant KYC_ADMIN_ROLE = keccak256("KYC_ADMIN_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    // State variables
    CarbonCreditToken public creditToken;
    KYCRegistry public kycRegistry;
    Treasury public treasury;

    // State variables from original Marketplace
    address public signerWallet;
    ITimelockController public timelockController;

    // New: Version tracking
    string public version;

    // Storage layout (must match original Marketplace)
    uint256 private _nextListingId;
    uint256 private _nextOrderId;
    uint256 private _nextTradeId;

    mapping(uint256 => Listing) public listings;
    mapping(uint256 => BuyOrder) public buyOrders;
    mapping(uint256 => Trade) public trades;

    mapping(address => uint256[]) public sellerListings;
    mapping(address => uint256[]) public buyerOrders;
    mapping(address => uint256[]) public buyerTrades;
    mapping(address => uint256[]) public sellerTrades;
    mapping(uint256 => uint256[]) public tokenListings;
    mapping(uint256 => uint256[]) public tokenBuyOrders;

    // INR trade logging
    mapping(bytes32 => INRTradeLog) public inrTradeLogs;
    mapping(bytes32 => bytes32) public inrTradeHashes;

    address public ammPool;
    uint256 public ammThreshold = 100;

    // Fee constants
    uint256 public constant BUYER_FEE_BPS = 50;
    uint256 public constant SELLER_FEE_BPS = 50;
    uint256 public constant BPS_DENOMINATOR = 10000;
    uint256 public constant MAX_DURATION = 90 days;
    uint256 public constant DEFAULT_DURATION = 30 days;

    // Version tracking
    event VersionUpdated(string version, uint256 timestamp);
    event TimelockControllerInitialized(address indexed oldTimelock, address indexed newTimelock);
    event SignerWalletUpdated(address indexed oldSigner, address indexed newSigner);
    event KYCRegistryUpdated(address indexed oldRegistry, address indexed newRegistry);
    event OperatorUpdated(address indexed oldOperator, address indexed newOperator);
    event AMMPoolSet(address indexed ammPool);
    event AMMThresholdUpdated(uint256 newThreshold);
    event MatchExecuted(uint256 listingId, uint256 buyOrderId, uint256 amount, uint256 price);

    // Structs (must match original storage layout)
    struct Listing {
        uint256 listingId;
        address seller;
        uint256 tokenId;
        uint256 amount;
        uint256 amountRemaining;
        uint256 pricePerUnit;
        uint256 pricePerUnitINR;
        uint256 listedAt;
        uint256 expiresAt;
        bool active;
    }

    struct BuyOrder {
        uint256 orderId;
        address buyer;
        uint256 tokenId;
        uint256 amount;
        uint256 amountFilled;
        uint256 limitPrice;
        uint256 ethEscrowed;
        OrderStatus status;
        uint256 createdAt;
        uint256 expiresAt;
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
        bool isAMM;
    }

    struct INRTradeLog {
        bytes32 tradeId;
        uint256 tokenId;
        uint256 quantity;
        uint256 priceINR;
        uint8 payMode;
        address buyer;
        address seller;
        uint256 timestamp;
        bytes32 tradeHash;
        uint256 blockLogged;
    }

    enum OrderSide { BUY, SELL }
    enum OrderStatus { OPEN, FILLED, PARTIALLY_FILLED, CANCELLED, EXPIRED }

    uint256 public constant BUYER_FEE_BPS = 50;
    uint256 public constant SELLER_FEE_BPS = 50;
    uint256 public constant BPS_DENOMINATOR = 10000;
    uint256 public constant MAX_DURATION = 90 days;
    uint256 public constant DEFAULT_DURATION = 30 days;

    // Payment modes
    uint8 public constant MODE_INR_WALLET = 0;
    uint8 public constant MODE_RAZORPAY = 1;
    uint8 public constant MODE_ETH = 2;

    enum OrderStatus { OPEN, FILLED, PARTIALLY_FILLED, CANCELLED, EXPIRED }

    // Modifiers
    modifier onlyKYCVerified() {
        require(kycRegistry.isKYCVerified(msg.sender), "Not authorized: wallet not KYC verified");
        _;
    }

    modifier onlySigner() {
        require(msg.sender == signerWallet || hasRole(OPERATOR_ROLE, msg.sender), "Not signer wallet");
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

    // Initialize the contract (called once after deployment)
    function initialize(
        address initialOwner,
        address creditTokenAddress,
        address kycRegistryAddress,
        address treasuryAddress,
        address _signerWallet,
        string memory _version
    ) external initializer {
        __Ownable_init(initialOwner);
        __Pausable_init();
        __AccessControl_init();
        __ReentrancyGuard_init();

        _setRoleAdmin(DEFAULT_ADMIN_ROLE, DEFAULT_ADMIN_ROLE);
        _setRoleAdmin(OPERATOR_ROLE, DEFAULT_ADMIN_ROLE);
        _setRoleAdmin(KYC_ADMIN_ROLE, DEFAULT_ADMIN_ROLE);
        _setRoleAdmin(PAUSER_ROLE, DEFAULT_ADMIN_ROLE);

        grantRole(DEFAULT_ADMIN_ROLE, initialOwner);
        grantRole(OPERATOR_ROLE, initialOwner);

        creditToken = CarbonCreditToken(creditTokenAddress);
        kycRegistry = KYCRegistry(kycRegistryAddress);
        treasury = Treasury(treasuryAddress);

        require(_signerWallet != address(0), "Marketplace: zero signer");
        signerWallet = _signerWallet;

        version = _version;

        _nextListingId = 1;
        _nextOrderId = 1;
        _nextTradeId = 1;

        ammThreshold = 100;
    }

    // UUPS Upgradeability
    function _authorizeUpgrade(address newImplementation) internal override onlyRole(DEFAULT_ADMIN_ROLE) {
        // Only admin can upgrade
    }

    // Upgrade function with version tracking
    function upgradeToAndCall(
        address newImplementation,
        bytes calldata data,
        string calldata newVersion
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _authorizeUpgrade(newImplementation);
        _upgradeToAndCallUUPS(newImplementation, data, false);
        version = newVersion;
        emit VersionUpdated(newVersion, block.timestamp);
    }

    // Version getter
    function getVersion() external view returns (string memory) {
        return version;
    }

    // Signer wallet management
    function setSignerWallet(address _signer) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_signer != address(0), "Marketplace: zero address");
        emit SignerWalletUpdated(signerWallet, _signer);
        signerWallet = _signer;
    }

    function setSignerWalletViaTimelock(address _signer) external {
        require(msg.sender == address(timelockController), "Marketplace: only timelock");
        require(_signer != address(0), "Marketplace: zero address");
        emit SignerWalletUpdated(signerWallet, _signer);
        signerWallet = _signer;
    }

    // KYC Registry management
    function setKYCRegistry(address newRegistry) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newRegistry != address(0), "Invalid registry address");
        emit KYCRegistryUpdated(address(kycRegistry), newRegistry);
        kycRegistry = KYCRegistry(newRegistry);
    }

    function setKYCRegistryViaTimelock(address newRegistry) external {
        require(msg.sender == address(timelockController), "Marketplace: only timelock");
        require(newRegistry != address(0), "Invalid registry address");
        emit KYCRegistryUpdated(address(kycRegistry), newRegistry);
        kycRegistry = KYCRegistry(newRegistry);
    }

    // Timelock initialization
    function initializeTimelock(address _timelockController) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(address(timelockController) == address(0), "Already initialized");
        timelockController = ITimelockController(_timelockController);
        emit TimelockControllerInitialized(address(0), _timelockController);
    }

    // Operator role management
    function grantOperatorRole(address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        grantRole(OPERATOR_ROLE, account);
        emit OperatorUpdated(address(0), account);
    }

    function revokeOperatorRole(address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        revokeRole(OPERATOR_ROLE, account);
        emit OperatorUpdated(account, address(0));
    }

    // ... rest of original Marketplace functions (buyCredit, listCredit, etc.)
    // All original functions remain unchanged but with UUPS upgradeability
    // 
    // For brevity, only showing the upgradeability additions.
    // The full contract would include all original Marketplace functions.
}