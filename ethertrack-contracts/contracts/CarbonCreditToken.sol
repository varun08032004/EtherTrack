// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155Supply.sol";
import "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155Burnable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./KYCRegistry.sol";

/**
 * @title CarbonCreditToken
 * @author EtherTrack
 * @notice ERC-1155 token where each tokenId = one carbon credit project.
 *         Each unit of a tokenId = 1 tonne CO2 equivalent.
 *         ANY KYC-verified wallet can mint, list, and trade credits.
 */
contract CarbonCreditToken is ERC1155, ERC1155Supply, ERC1155Burnable, Ownable, Pausable, ReentrancyGuard {

    KYCRegistry public kycRegistry;

    // ── [NEW] Operator role — a backend-controlled wallet (or the Marketplace
    // contract itself) authorized to execute actions on behalf of users who
    // pay via INR/Razorpay, so those users never need to sign a MetaMask
    // transaction for routine listing/buying/retiring. The operator can only
    // ever move tokens that a wallet ALREADY legitimately holds/escrowed —
    // it cannot mint into existence or bypass KYC checks. ──────────────────
    address public operator;

    event OperatorUpdated(address indexed oldOperator, address indexed newOperator);
    event KYCRegistryUpdated(address indexed oldRegistry, address indexed newRegistry);

    modifier onlyOperator() {
        require(
            msg.sender == operator || msg.sender == owner(),
            "CarbonCreditToken: not operator"
        );
        _;
    }

    // ── Credit Standards ──────────────────────────────────
    enum Standard { VCS, GS, CDM, ACR }

    // ── MintParams Struct (fixes stack too deep) ──────────
    struct MintParams {
        address  to;
        uint256  amount;
        string   projectName;
        string   location;
        Standard standard;
        string   projectType;
        string   developer;
        uint256  vintageYear;
        uint256  expiryDate;
        string   serialNumber;
        string   metadataURI;
    }

    // ── Credit Metadata ───────────────────────────────────
    struct CreditMetadata {
        string   projectName;
        string   location;
        Standard standard;
        string   projectType;
        string   developer;
        uint256  vintageYear;
        uint256  expiryDate;
        string   serialNumber;
        string   metadataURI;
        bool     active;
        address  registeredBy;
        uint256  registeredAt;
    }

    // ── State ─────────────────────────────────────────────
    uint256 private _nextTokenId;

    mapping(uint256 => CreditMetadata)              public creditMetadata;
    mapping(uint256 => uint256)                     public totalRetired;
    mapping(address => mapping(uint256 => uint256)) public retiredBy;
    mapping(string  => uint256)                     public serialToTokenId;
    mapping(string  => bool)                        public serialRegistered;

    // ── Events ────────────────────────────────────────────
    event CreditMinted(
        uint256 indexed tokenId,
        address indexed to,
        uint256 amount,
        string  projectName,
        Standard standard,
        string  serialNumber
    );
    event CreditRetired(
        uint256 indexed tokenId,
        address indexed retiredBy,
        uint256 amount,
        string  projectName
    );

    // ── Modifiers ─────────────────────────────────────────
    modifier onlyKYCVerified(address wallet) {
        require(kycRegistry.isKYCVerified(wallet), "Wallet not KYC verified");
        _;
    }

    // ANY KYC verified wallet can mint — no whitelist needed
    modifier onlyAuthorizedMinter() {
        require(
            kycRegistry.isKYCVerified(msg.sender) || msg.sender == owner(),
            "Must be KYC verified to mint"
        );
        _;
    }

    // ── Constructor ───────────────────────────────────────
    constructor(
        address initialOwner,
        address kycRegistryAddress
    ) ERC1155("") Ownable(initialOwner) {
        kycRegistry = KYCRegistry(kycRegistryAddress);
    }

    // ── Mint ──────────────────────────────────────────────

    /**
     * @notice Register a new carbon credit project and mint tokens.
     *         ANY KYC verified wallet can call this.
     *
     * BLOCKCHAIN MIGRATION: Replaces handleRegister() in Portfolio.js
     */
    function mintCredit(MintParams calldata p)
        external
        onlyAuthorizedMinter
        whenNotPaused
        onlyKYCVerified(p.to)
        returns (uint256)
    {
        require(p.amount > 0,                      "Amount must be > 0");
        require(bytes(p.serialNumber).length > 0,  "Serial number required");
        require(!serialRegistered[p.serialNumber], "Serial already registered");
        require(p.expiryDate > block.timestamp,    "Expiry must be in future");

        uint256 tokenId = _nextTokenId++;

        creditMetadata[tokenId] = CreditMetadata({
            projectName:  p.projectName,
            location:     p.location,
            standard:     p.standard,
            projectType:  p.projectType,
            developer:    p.developer,
            vintageYear:  p.vintageYear,
            expiryDate:   p.expiryDate,
            serialNumber: p.serialNumber,
            metadataURI:  p.metadataURI,
            active:       true,
            registeredBy: msg.sender,
            registeredAt: block.timestamp
        });

        serialToTokenId[p.serialNumber]  = tokenId;
        serialRegistered[p.serialNumber] = true;

        _mint(p.to, tokenId, p.amount, "");

        emit CreditMinted(tokenId, p.to, p.amount, p.projectName, p.standard, p.serialNumber);
        return tokenId;
    }

    /**
     * @notice Mint additional credits for an existing tokenId
     */
    function mintAdditional(
        address to,
        uint256 tokenId,
        uint256 amount
    ) external onlyAuthorizedMinter whenNotPaused onlyKYCVerified(to) {
        require(creditMetadata[tokenId].active, "Credit project not active");
        _mint(to, tokenId, amount, "");
    }

    // ── Retire ────────────────────────────────────────────

    /**
     * @notice Permanently retire credits — burns tokens, offsets carbon.
     */
    function retireCredit(
        uint256 tokenId,
        uint256 amount
    ) external whenNotPaused nonReentrant onlyKYCVerified(msg.sender) {
        require(amount > 0,                               "Amount must be > 0");
        require(balanceOf(msg.sender, tokenId) >= amount, "Insufficient credits");

        totalRetired[tokenId]          += amount;
        retiredBy[msg.sender][tokenId] += amount;

        if (totalSupply(tokenId) - amount == 0) {
            creditMetadata[tokenId].active = false;
        }

        _burn(msg.sender, tokenId, amount);

        emit CreditRetired(tokenId, msg.sender, amount, creditMetadata[tokenId].projectName);
    }

    /**
     * @notice [NEW] Operator-executed retirement — lets the backend retire
     *         credits on a user's behalf (e.g. a user who paid via INR/UPI
     *         and never personally holds a MetaMask session open) WITHOUT
     *         requiring their signature. This does NOT let the operator
     *         retire credits arbitrarily — `beneficiary` must already
     *         genuinely hold `amount` of `tokenId` on-chain (checked below,
     *         same as the self-service retireCredit above), and the burn is
     *         attributed to `beneficiary`, not the operator, so GHG
     *         Protocol / BRSR retirement records remain correctly credited
     *         to whoever actually retired the credit.
     */
    function retireCreditFor(
        address beneficiary,
        uint256 tokenId,
        uint256 amount
    ) external onlyOperator whenNotPaused nonReentrant onlyKYCVerified(beneficiary) {
        require(amount > 0,                                  "Amount must be > 0");
        require(balanceOf(beneficiary, tokenId) >= amount,   "Insufficient credits");

        totalRetired[tokenId]              += amount;
        retiredBy[beneficiary][tokenId]    += amount;

        if (totalSupply(tokenId) - amount == 0) {
            creditMetadata[tokenId].active = false;
        }

        _burn(beneficiary, tokenId, amount);

        emit CreditRetired(tokenId, beneficiary, amount, creditMetadata[tokenId].projectName);
    }

    // ── Transfer Override (KYC check) ─────────────────────
    function safeTransferFrom(
        address from,
        address to,
        uint256 id,
        uint256 amount,
        bytes memory data
    ) public override whenNotPaused {
        // Allow marketplace contract transfers without KYC check
        // (marketplace is already KYC-gated at entry)
        if (from != address(0) && !kycRegistry.isKYCVerified(from)) {
            // Allow if it's a contract (marketplace escrow transfers)
            uint256 size;
            assembly { size := extcodesize(from) }
            if (size == 0) revert("Sender not KYC verified");
        }
        if (to != address(0) && !kycRegistry.isKYCVerified(to)) {
            uint256 size;
            assembly { size := extcodesize(to) }
            if (size == 0) revert("Receiver not KYC verified");
        }
        super.safeTransferFrom(from, to, id, amount, data);
    }

    // ── View Functions ────────────────────────────────────
    function uri(uint256 tokenId) public view override returns (string memory) {
        return creditMetadata[tokenId].metadataURI;
    }

    function getCreditMetadata(uint256 tokenId) external view returns (CreditMetadata memory) {
        return creditMetadata[tokenId];
    }

    function getTotalRetired(uint256 tokenId) external view returns (uint256) {
        return totalRetired[tokenId];
    }

    function getRetiredBy(address wallet, uint256 tokenId) external view returns (uint256) {
        return retiredBy[wallet][tokenId];
    }

    function isExpired(uint256 tokenId) public view returns (bool) {
        return block.timestamp > creditMetadata[tokenId].expiryDate;
    }

    function getNextTokenId() external view returns (uint256) {
        return _nextTokenId;
    }

    // ── Admin ─────────────────────────────────────────────
    function pause()   external onlyOwner { _pause();   }
    function unpause() external onlyOwner { _unpause(); }

    /// @notice Repoint this contract at a different KYCRegistry deployment
    ///         without redeploying CarbonCreditToken. Existing balances,
    ///         mints, and burns are untouched.
    function setKYCRegistry(address newRegistry) external onlyOwner {
        require(newRegistry != address(0), "Invalid registry address");
        emit KYCRegistryUpdated(address(kycRegistry), newRegistry);
        kycRegistry = KYCRegistry(newRegistry);
    }

    // [NEW] Set the backend operator wallet authorized to call
    // retireCreditFor() on behalf of beneficiaries.
    function setOperator(address _operator) external onlyOwner {
        require(_operator != address(0), "Zero address");
        emit OperatorUpdated(operator, _operator);
        operator = _operator;
    }

    // ── Required overrides ────────────────────────────────
    function _update(
        address from,
        address to,
        uint256[] memory ids,
        uint256[] memory values
    ) internal override(ERC1155, ERC1155Supply) {
        super._update(from, to, ids, values);
    }
}
