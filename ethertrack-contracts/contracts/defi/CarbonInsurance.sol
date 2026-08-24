// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/math/SafeERC20.sol";
import "./interfaces/ICarbonInsurance.sol";

/**
 * @title CarbonInsurance
 * @dev Insurance pool for carbon credit risks (reversal, invalidation, regulatory, etc.)
 * Parametric and indemnity-based coverage
 */
contract CarbonInsurance is ICarbonInsurance, AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using SafeMath for uint256;

    // Role definitions
    bytes32 public constant POOL_ADMIN_ROLE = keccak256("POOL_ADMIN_ROLE");
    bytes32 public constant UNDERWRITER_ROLE = keccak256("UNDERWRITER_ROLE");
    bytes32 public constant CLAIMS_ASSESSOR_ROLE = keccak256("CLAIMS_ASSESSOR_ROLE");
    bytes32 public constant REINSURER_ROLE = keccak256("REINSURER_ROLE");
    bytes32 public constant EMERGENCY_GUARDIAN_ROLE = keccak256("EMERGENCY_GUARDIAN_ROLE");

    // Risk types
    uint8 constant RISK_REVERSAL = 0;
    uint8 constant RISK_INVALIDATION = 1;
    uint8 constant RISK_REGULATORY = 2;
    uint8 constant RISK_MARKET = 3;
    uint8 constant RISK_OPERATIONAL = 4;
    uint8 constant RISK_FORCE_MAJEURE = 5;

    // Policy status
    uint8 constant POLICY_ACTIVE = 0;
    uint8 constant POLICY_EXPIRED = 1;
    uint8 constant POLICY_CLAIMED = 2;
    uint8 constant POLICY_CANCELLED = 3;
    uint8 constant POLICY_LAPSED = 4;

    // Claim status
    uint8 constant CLAIM_SUBMITTED = 0;
    uint8 constant CLAIM_UNDER_REVIEW = 1;
    uint8 constant CLAIM_APPROVED = 2;
    uint8 constant CLAIM_REJECTED = 3;
    uint8 constant CLAIM_PAID = 4;
    uint8 constant CLAIM_DISPUTED = 5;

    // Pool configuration
    struct InsurancePool {
        uint256 poolId;
        string name;
        string description;
        uint8[] coveredRisks;
        address[] coveredAssets;
        uint256[] assetIds;
        string[] registries;
        address quoteAsset;
        uint256 premiumRateBps; // annual basis points
        uint256 coverageLimit; // max coverage per policy (tCO2e)
        uint256 deductible; // tCO2e or basis points
        uint256 policyDuration; // seconds
        uint256 claimWindow; // seconds after event
        uint256 assessmentPeriod; // seconds for assessment
        address payoutCurrency;
        address governanceToken;
        uint256 capitalRequirement; // minimum capital
        bool reinsuranceEnabled;
        uint256 reinsuranceThreshold; // basis points
        uint256 totalCapital;
        uint256 availableCapital;
        uint256 reservedCapital;
        uint256 totalPremiumsCollected;
        uint256 totalClaimsPaid;
        uint256 activePolicies;
        uint256 totalCoverage; // tCO2e
        bool active;
        uint256 createdAt;
    }

    // Policy
    struct Policy {
        uint256 policyId;
        uint256 poolId;
        address policyholder;
        address coveredAsset;
        uint256 assetId;
        uint256 coverageAmount; // tCO2e
        uint256 premium; // in quote asset
        bool premiumPaid;
        uint256 startDate;
        uint256 endDate;
        uint256 deductible;
        uint8 status;
        uint256 createdAt;
        uint256 updatedAt;
    }

    // Claim
    struct Claim {
        uint256 claimId;
        uint256 policyId;
        address claimant;
        uint8 eventType;
        string eventDescription;
        uint256 eventDate;
        uint256 affectedAmount; // tCO2e
        uint256 claimedAmount; // in quote asset
        string[] evidence; // IPFS hashes
        uint8 status;
        address assessor;
        string assessmentNotes;
        uint256 payoutAmount;
        bytes32 payoutTxHash;
        uint256 submittedAt;
        uint256 assessedAt;
        uint256 paidAt;
    }

    // Reinsurance
    struct ReinsuranceContract {
        uint256 contractId;
        address reinsurer;
        uint256 poolId;
        uint256 maxCoverage; // tCO2e
        uint256 premiumShare; // basis points
        uint256 attachmentPoint; // basis points
        uint256 exhaustionPoint; // basis points
        bool active;
        uint256 createdAt;
    }

    // State variables
    InsurancePool[] public pools;
    mapping(uint256 => InsurancePool) public poolMap;
    mapping(uint256 => Policy) public policies;
    mapping(uint256 => Claim) public claims;
    mapping(uint256 => ReinsuranceContract[]> public reinsuranceContracts;
    mapping(address => uint256[]) public policyholderPolicies;
    mapping(address => uint256[]) public claimantClaims;
    uint256 public nextPoolId;
    uint256 public nextPolicyId;
    uint256 public nextClaimId;
    uint256 public nextReinsuranceId;

    // Events
    event PoolCreated(uint256 indexed poolId, string name);
    event PoolUpdated(uint256 indexed poolId);
    event PolicyCreated(uint256 indexed policyId, address indexed policyholder, uint256 poolId);
    event PolicyUpdated(uint256 indexed policyId);
    event PremiumPaid(uint256 indexed policyId, uint256 amount);
    event ClaimSubmitted(uint256 indexed claimId, address indexed claimant, uint256 policyId);
    event ClaimAssessed(uint256 indexed claimId, address indexed assessor, uint8 status);
    event ClaimPaid(uint256 indexed claimId, uint256 amount, bytes32 txHash);
    event CapitalDeposited(uint256 indexed poolId, address indexed from, uint256 amount);
    event CapitalWithdrawn(uint256 indexed poolId, address indexed to, uint256 amount);
    event ReinsuranceContractAdded(uint256 indexed contractId, address indexed reinsurer);
    event SolvencyAlert(uint256 indexed poolId, uint256 ratio);
    event EmergencyAction(string action);

    constructor() {
        _setRoleAdmin(DEFAULT_ADMIN_ROLE, DEFAULT_ADMIN_ROLE);
        _setRoleAdmin(POOL_ADMIN_ROLE, DEFAULT_ADMIN_ROLE);
        _setRoleAdmin(UNDERWRITER_ROLE, DEFAULT_ADMIN_ROLE);
        _setRoleAdmin(CLAIMS_ASSESSOR_ROLE, DEFAULT_ADMIN_ROLE);
        _setRoleAdmin(REINSURER_ROLE, DEFAULT_ADMIN_ROLE);
        _setRoleAdmin(EMERGENCY_GUARDIAN_ROLE, DEFAULT_ADMIN_ROLE);
    }

    // ==================== POOL MANAGEMENT ====================

    function createPool(
        string memory name,
        string memory description,
        uint8[] memory coveredRisks,
        address[] memory coveredAssets,
        uint256[] memory assetIds,
        string[] memory registries,
        address quoteAsset,
        uint256 premiumRateBps,
        uint256 coverageLimit,
        uint256 deductible,
        uint256 policyDuration,
        uint256 claimWindow,
        uint256 assessmentPeriod,
        address payoutCurrency,
        address governanceToken,
        uint256 capitalRequirement,
        bool reinsuranceEnabled,
        uint256 reinsuranceThreshold
    ) external onlyRole(POOL_ADMIN_ROLE) returns (uint256) {
        require(coveredAssets.length == assetIds.length, "Array length mismatch");
        require(coveredAssets.length == registries.length, "Array length mismatch");
        require(premiumRateBps <= 10000, "Premium rate > 100%");
        require(coverageLimit > 0, "Coverage limit must be > 0");
        require(policyDuration > 0, "Policy duration must be > 0");

        uint256 poolId = nextPoolId++;
        
        InsurancePool memory pool = InsurancePool({
            poolId: poolId,
            name: name,
            description: description,
            coveredRisks: coveredRisks,
            coveredAssets: coveredAssets,
            assetIds: assetIds,
            registries: registries,
            quoteAsset: quoteAsset,
            premiumRateBps: premiumRateBps,
            coverageLimit: coverageLimit,
            deductible: deductible,
            policyDuration: policyDuration,
            claimWindow: claimWindow,
            assessmentPeriod: assessmentPeriod,
            payoutCurrency: payoutCurrency,
            governanceToken: governanceToken,
            capitalRequirement: capitalRequirement,
            reinsuranceEnabled: reinsuranceEnabled,
            reinsuranceThreshold: reinsuranceThreshold,
            totalCapital: 0,
            availableCapital: 0,
            reservedCapital: 0,
            totalPremiumsCollected: 0,
            totalClaimsPaid: 0,
            activePolicies: 0,
            totalCoverage: 0,
            active: true,
            createdAt: block.timestamp
        });

        pools.push(pool);
        poolMap[poolId] = pool;

        emit PoolCreated(poolId, name);
        return poolId;
    }

    function updatePool(
        uint256 poolId,
        uint256 premiumRateBps,
        uint256 coverageLimit,
        uint256 capitalRequirement,
        bool active
    ) external onlyRole(POOL_ADMIN_ROLE) {
        InsurancePool storage pool = poolMap[poolId];
        require(pool.poolId == poolId, "Pool not found");

        if (premiumRateBps > 0) pool.premiumRateBps = premiumRateBps;
        if (coverageLimit > 0) pool.coverageLimit = coverageLimit;
        if (capitalRequirement > 0) pool.capitalRequirement = capitalRequirement;
        pool.active = active;

        emit PoolUpdated(poolId);
    }

    // ==================== CAPITAL MANAGEMENT ====================

    function depositCapital(uint256 poolId, uint256 amount) external {
        InsurancePool storage pool = poolMap[poolId];
        require(pool.poolId == poolId, "Pool not found");
        require(amount > 0, "Amount must be > 0");

        IERC20(pool.quoteAsset).safeTransferFrom(msg.sender, address(this), amount);
        pool.totalCapital += amount;
        pool.availableCapital += amount;

        emit CapitalDeposited(poolId, msg.sender, amount);
    }

    function withdrawCapital(uint256 poolId, uint256 amount) external onlyRole(POOL_ADMIN_ROLE) {
        InsurancePool storage pool = poolMap[poolId];
        require(pool.poolId == poolId, "Pool not found");
        require(amount <= pool.availableCapital, "Insufficient available capital");

        IERC20(pool.quoteAsset).safeTransfer(msg.sender, amount);
        pool.totalCapital -= amount;
        pool.availableCapital -= amount;

        emit CapitalWithdrawn(poolId, msg.sender, amount);
    }

    function getPoolSolvency(uint256 poolId) external view returns (uint256) {
        InsurancePool storage pool = poolMap[poolId];
        if (pool.totalCoverage == 0) return 10000; // 100%
        return (pool.totalCapital * 10000) / pool.totalCoverage; // basis points
    }

    // ==================== REINSURANCE ====================

    function addReinsuranceContract(
        uint256 poolId,
        address reinsurer,
        uint256 maxCoverage,
        uint256 premiumShare,
        uint256 attachmentPoint,
        uint256 exhaustionPoint
    ) external onlyRole(REINSURER_ROLE) returns (uint256) {
        InsurancePool storage pool = poolMap[poolId];
        require(pool.poolId == poolId, "Pool not found");
        require(pool.reinsuranceEnabled, "Reinsurance not enabled");

        uint256 contractId = nextReinsuranceId++;
        
        ReinsuranceContract memory contract = ReinsuranceContract({
            contractId: contractId,
            reinsurer: reinsurer,
            poolId: poolId,
            maxCoverage: maxCoverage,
            premiumShare: premiumShare,
            attachmentPoint: attachmentPoint,
            exhaustionPoint: exhaustionPoint,
            active: true,
            createdAt: block.timestamp
        });

        reinsuranceContracts[poolId].push(contract);

        emit ReinsuranceContractAdded(contractId, reinsurer);
        return contractId;
    }

    // ==================== POLICY MANAGEMENT ====================

    function createPolicy(
        uint256 poolId,
        address coveredAsset,
        uint256 assetId,
        uint256 coverageAmount,
        uint256 deductible
    ) external nonReentrant whenNotPaused returns (uint256) {
        InsurancePool storage pool = poolMap[poolId];
        require(pool.poolId == poolId, "Pool not found");
        require(pool.active, "Pool not active");
        require(coverageAmount <= pool.coverageLimit, "Coverage exceeds limit");
        require(pool.availableCapital >= coverageAmount, "Insufficient pool capital");

        // Check asset is covered
        bool assetCovered = false;
        for (uint256 i = 0; i < pool.coveredAssets.length; i++) {
            if (pool.coveredAssets[i] == coveredAsset && pool.assetIds[i] == assetId) {
                assetCovered = true;
                break;
            }
        }
        require(assetCovered, "Asset not covered by pool");

        // Calculate premium
        uint256 premium = (coverageAmount * pool.premiumRateBps * pool.policyDuration) / (10000 * 365 days);
        
        uint256 policyId = nextPolicyId++;
        uint256 startDate = block.timestamp;
        uint256 endDate = startDate + pool.policyDuration;

        Policy memory policy = Policy({
            policyId: policyId,
            poolId: poolId,
            policyholder: msg.sender,
            coveredAsset: coveredAsset,
            assetId: assetId,
            coverageAmount: coverageAmount,
            premium: premium,
            premiumPaid: false,
            startDate: startDate,
            endDate: endDate,
            deductible: deductible > 0 ? deductible : pool.deductible,
            status: 0, // ACTIVE (pending premium)
            createdAt: block.timestamp,
            updatedAt: block.timestamp
        });

        policies[policyId] = policy;
        policyholderPolicies[msg.sender].push(policyId);

        pool.activePolicies++;
        pool.totalCoverage += coverageAmount;
        pool.reservedCapital += coverageAmount;
        pool.availableCapital -= coverageAmount;

        // Check solvency
        uint256 solvency = getPoolSolvency(poolId);
        if (solvency < 15000) { // < 150%
            emit SolvencyAlert(poolId, solvency);
        }

        emit PolicyCreated(policyId, msg.sender, poolId);
        return policyId;
    }

    function payPremium(uint256 policyId) external nonReentrant {
        Policy storage policy = policies[policyId];
        require(policy.policyId == policyId, "Policy not found");
        require(policy.policyholder == msg.sender, "Not policyholder");
        require(!policy.premiumPaid, "Premium already paid");
        require(block.timestamp <= policy.endDate, "Policy expired");

        InsurancePool storage pool = poolMap[policy.poolId];
        IERC20(pool.quoteAsset).safeTransferFrom(msg.sender, address(this), policy.premium);

        policy.premiumPaid = true;
        policy.updatedAt = block.timestamp;
        pool.totalPremiumsCollected += policy.premium;
        pool.availableCapital += policy.premium;

        emit PremiumPaid(policyId, policy.premium);
    }

    function cancelPolicy(uint256 policyId) external nonReentrant {
        Policy storage policy = policies[policyId];
        require(policy.policyId == policyId, "Policy not found");
        require(policy.policyholder == msg.sender || msg.sender == address(this), "Not authorized");
        require(policy.status == 0, "Policy not active");

        InsurancePool storage pool = poolMap[policy.poolId];
        
        // Refund unearned premium (pro-rata)
        if (policy.premiumPaid) {
            uint256 elapsed = block.timestamp - policy.startDate;
            uint256 remaining = policy.endDate - block.timestamp;
            uint256 refund = (policy.premium * remaining) / pool.policyDuration;
            
            if (refund > 0) {
                IERC20(pool.quoteAsset).safeTransfer(policy.policyholder, refund);
                pool.availableCapital -= refund;
            }
        }

        policy.status = 3; // CANCELLED
        policy.updatedAt = block.timestamp;
        pool.activePolicies--;
        pool.totalCoverage -= policy.coverageAmount;
        pool.reservedCapital -= policy.coverageAmount;
        pool.availableCapital += policy.coverageAmount;

        emit PolicyUpdated(policyId);
    }

    // ==================== CLAIMS MANAGEMENT ====================

    function submitClaim(
        uint256 policyId,
        uint8 eventType,
        string memory eventDescription,
        uint256 eventDate,
        uint256 affectedAmount,
        uint256 claimedAmount,
        string[] memory evidence
    ) external nonReentrant whenNotPaused returns (uint256) {
        Policy storage policy = policies[policyId];
        require(policy.policyId == policyId, "Policy not found");
        require(policy.policyholder == msg.sender, "Not policyholder");
        require(policy.status == 0, "Policy not active");
        require(policy.premiumPaid, "Premium not paid");
        require(block.timestamp >= policy.startDate && block.timestamp <= policy.endDate, "Policy not in force");
        require(eventDate >= policy.startDate && eventDate <= policy.endDate, "Event outside policy period");
        require(block.timestamp <= eventDate + claimWindow(poolId), "Claim window expired");
        require(affectedAmount <= policy.coverageAmount, "Affected amount exceeds coverage");

        InsurancePool storage pool = poolMap[policy.poolId];
        
        // Check event type is covered
        bool riskCovered = false;
        for (uint256 i = 0; i < pool.coveredRisks.length; i++) {
            if (pool.coveredRisks[i] == eventType) {
                riskCovered = true;
                break;
            }
        }
        require(riskCovered, "Event type not covered");

        uint256 claimId = nextClaimId++;
        
        Claim memory claim = Claim({
            claimId: claimId,
            policyId: policyId,
            claimant: msg.sender,
            eventType: eventType,
            eventDescription: eventDescription,
            eventDate: eventDate,
            affectedAmount: affectedAmount,
            claimedAmount: claimedAmount,
            evidence: evidence,
            status: 0, // SUBMITTED
            assessor: address(0),
            assessmentNotes: "",
            payoutAmount: 0,
            payoutTxHash: bytes32(0),
            submittedAt: block.timestamp,
            assessedAt: 0,
            paidAt: 0
        });

        claims[claimId] = claim;
        claimantClaims[msg.sender].push(claimId);

        policy.status = 2; // CLAIMED

        emit ClaimSubmitted(claimId, msg.sender, policyId);
        return claimId;
    }

    function assessClaim(uint256 claimId, uint8 status, string memory notes, uint256 payoutAmount) external onlyRole(CLAIMS_ASSESSOR_ROLE) {
        Claim storage claim = claims[claimId];
        require(claim.claimId == claimId, "Claim not found");
        require(claim.status == 0 || claim.status == 1, "Claim not assessable");

        Policy storage policy = policies[claim.policyId];
        InsurancePool storage pool = poolMap[policy.poolId];

        require(payoutAmount <= pool.availableCapital, "Insufficient pool capital");
        require(payoutAmount <= claim.claimedAmount, "Payout exceeds claim");
        
        // Apply deductible
        if (payoutAmount > policy.deductible) {
            payoutAmount -= policy.deductible;
        } else {
            payoutAmount = 0;
        }

        claim.status = status;
        claim.assessor = msg.sender;
        claim.assessmentNotes = notes;
        claim.payoutAmount = payoutAmount;
        claim.assessedAt = block.timestamp;

        if (status == 2) { // APPROVED
            pool.reservedCapital += payoutAmount;
            pool.availableCapital -= payoutAmount;
        }

        emit ClaimAssessed(claimId, msg.sender, status);
    }

    function payClaim(uint256 claimId) external nonReentrant onlyRole(CLAIMS_ASSESSOR_ROLE) {
        Claim storage claim = claims[claimId];
        require(claim.claimId == claimId, "Claim not found");
        require(claim.status == 2, "Claim not approved");
        require(claim.payoutAmount > 0, "No payout amount");

        Policy storage policy = policies[claim.policyId];
        InsurancePool storage pool = poolMap[policy.poolId];

        IERC20(pool.payoutCurrency).safeTransfer(claim.claimant, claim.payoutAmount);

        claim.status = 4; // PAID
        claim.payoutTxHash = bytes32(0); // Would be actual tx hash
        claim.paidAt = block.timestamp;

        pool.totalClaimsPaid += claim.payoutAmount;
        pool.reservedCapital -= claim.payoutAmount;

        // Trigger reinsurance if applicable
        if (pool.reinsuranceEnabled) {
            _triggerReinsurance(policy.poolId, claim.payoutAmount);
        }

        emit ClaimPaid(claimId, claim.payoutAmount, claim.payoutTxHash);
    }

    function disputeClaim(uint256 claimId) external {
        Claim storage claim = claims[claimId];
        require(claim.claimId == claimId, "Claim not found");
        require(claim.claimant == msg.sender, "Not claimant");
        require(claim.status == 3, "Only rejected claims can be disputed");

        claim.status = 5; // DISPUTED
        // Would trigger arbitration process
    }

    // ==================== HELPER FUNCTIONS ====================

    function claimWindow(uint256 poolId) internal view returns (uint256) {
        return poolMap[poolId].claimWindow;
    }

    function _triggerReinsurance(uint256 poolId, uint256 amount) internal {
        ReinsuranceContract[] storage contracts = reinsuranceContracts[poolId];
        for (uint256 i = 0; i < contracts.length; i++) {
            ReinsuranceContract storage contract = contracts[i];
            if (contract.active && amount >= (contract.attachmentPoint * poolMap[poolId].totalCoverage) / 10000) {
                // Reinsurance triggered
                // In production, would notify reinsurer
            }
        }
    }

    // ==================== VIEW FUNCTIONS ====================

    function getPool(uint256 poolId) external view returns (InsurancePool memory) {
        return poolMap[poolId];
    }

    function getPools() external view returns (InsurancePool[] memory) {
        return pools;
    }

    function getPolicy(uint256 policyId) external view returns (Policy memory) {
        return policies[policyId];
    }

    function getPolicyholderPolicies(address policyholder) external view returns (uint256[] memory) {
        return policyholderPolicies[policyholder];
    }

    function getClaim(uint256 claimId) external view returns (Claim memory) {
        return claims[claimId];
    }

    function getClaimantClaims(address claimant) external view returns (uint256[] memory) {
        return claimantClaims[claimant];
    }

    function getReinsuranceContracts(uint256 poolId) external view returns (ReinsuranceContract[] memory) {
        return reinsuranceContracts[poolId];
    }

    function calculatePremium(uint256 poolId, uint256 coverageAmount, uint256 duration) external view returns (uint256) {
        InsurancePool storage pool = poolMap[poolId];
        return (coverageAmount * pool.premiumRateBps * duration) / (10000 * 365 days);
    }

    // ==================== EMERGENCY ====================

    function pause() external onlyRole(EMERGENCY_GUARDIAN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(EMERGENCY_GUARDIAN_ROLE) {
        _unpause();
    }
}