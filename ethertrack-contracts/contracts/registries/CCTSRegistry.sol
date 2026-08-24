// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title CCTSRegistry
 * @dev CCTS (Carbon Credit Trading Scheme) Registry for India's compliance market.
 * Manages Offset CCCs, Compliance CCCs, and surrender operations.
 */
contract CCTSRegistry is AccessControl, Ownable, Pausable {
    
    // Role definitions
    bytes32 public constant REGISTRY_ADMIN_ROLE = keccak256("REGISTRY_ADMIN_ROLE");
    bytes32 public constant VERIFIER_ROLE = keccak256("VERIFIER_ROLE");
    bytes32 public constant EMERGENCY_GUARDIAN_ROLE = keccak256("EMERGENCY_GUARDIAN_ROLE");
    
    // State
    mapping(uint256 => EntityProfile) public entities;
    mapping(uint256 => CompliancePosition) public compliancePositions;
    mapping(uint256 => uint256) public entitySurplus;
    mapping(uint256 => uint256) public entityDeficit;
    mapping(uint256 => OffsetCCCRecord) public offsetCCCs;
    mapping(uint256 => ComplianceCCCRecord) public complianceCCCs;
    mapping(uint256 => SurrenderRecord) public surrenders;
    mapping(uint256 => bool) public offsetCCCUsed;
    
    uint256 public entityCounter;
    uint256 public offsetCCCCounter;
    uint256 public complianceCCCCounter;
    uint256 public surrenderCounter;
    
    // Events
    event EntityRegistered(
        uint256 indexed entityId,
        string name,
        string sector,
        uint256 baselineGEI,
        uint256 targetGEI
    );
    
    event OffsetCCCRegistered(
        uint256 indexed cccId,
        uint256 indexed entityId,
        uint256 batchId,
        uint256 quantity,
        uint256 vintage
    );
    
    event ComplianceCCCIssued(
        uint256 indexed cccId,
        uint256 entityId,
        uint256 quantity,
        uint256 vintage
    );
    
    event CCCSurrendered(
        uint256 indexed surrenderId,
        uint256 indexed entityId,
        uint256 quantity,
        string reason
    );
    
    event CompliancePositionUpdated(
        uint256 indexed entityId,
        uint256 actualGEI,
        uint256 targetGEI,
        uint256 surplus,
        uint256 deficit
    );
    
    event CCCSurrenderedForCompliance(
        uint256 indexed surrenderId,
        uint256 entityId,
        uint256 quantity,
        uint256 complianceYear
    );
    
    // Entity Profile
    struct EntityProfile {
        uint256 entityId;
        string name;
        string sector;
        string cin;
        string gstin;
        uint256 baselineGEI;
        uint256 targetGEI;
        uint256 gateCapacity;
        string verifier;
        bool active;
        uint256 registeredAt;
    }
    
    struct CompliancePosition {
        uint256 entityId;
        uint256 actualGEI;
        uint256 targetGEI;
        uint256 production;
        uint256 surplusCCC;
        uint256 deficitCCC;
        uint256 cccPurchased;
        uint256 cccSurrendered;
        uint256 complianceYear;
        bool compliant;
        uint256 lastUpdated;
    }
    
    struct OffsetCCCRecord {
        uint256 cccId;
        uint256 entityId;
        uint256 batchId;
        uint256 quantity;
        uint256 vintage;
        uint256 projectId;
        string standard;
        string projectType;
        string registry;
        bool usedForCompliance;
        bool retired;
        uint256 registeredAt;
    }
    
    struct ComplianceCCCRecord {
        uint256 cccId;
        uint256 entityId;
        uint256 quantity;
        uint256 vintage;
        string standard;
        string projectType;
        bool usedForSurrender;
        uint256 issuedAt;
    }
    
    struct SurrenderRecord {
        uint256 surrenderId;
        uint256 entityId;
        uint256 quantity;
        string reason;
        uint256 complianceYear;
        uint256 surrenderedAt;
    }
    
    // State
    mapping(uint256 => EntityProfile) public entities;
    mapping(uint256 => CompliancePosition) public compliancePositions;
    mapping(uint256 => uint256) public entitySurplus;
    mapping(uint256 => uint256) public entityDeficit;
    mapping(uint256 => OffsetCCCRecord) public offsetCCCs;
    mapping(uint256 => ComplianceCCCRecord) public complianceCCCs;
    mapping(uint256 => SurrenderRecord) public surrenders;
    mapping(uint256 => bool) public offsetCCCUsed;
    
    uint256 public entityCounter;
    uint256 public offsetCCCCounter;
    uint256 public complianceCCCCounter;
    uint256 public surrenderCounter;
    
    // Constructor
    constructor(address _initialOwner) Ownable(_initialOwner) {
        _setRoleAdmin(DEFAULT_ADMIN_ROLE, DEFAULT_ADMIN_ROLE);
        _setRoleAdmin(REGISTRY_ADMIN_ROLE, DEFAULT_ADMIN_ROLE);
        _setRoleAdmin(VERIFIER_ROLE, DEFAULT_ADMIN_ROLE);
        _setRoleAdmin(EMERGENCY_GUARDIAN_ROLE, DEFAULT_ADMIN_ROLE);
        
        grantRole(DEFAULT_ADMIN_ROLE, _initialOwner);
        grantRole(REGISTRY_ADMIN_ROLE, _initialOwner);
        grantRole(VERIFIER_ROLE, _initialOwner);
        grantRole(EMERGENCY_GUARDIAN_ROLE, _initialOwner);
    }
    
    // Role definitions
    bytes32 public constant REGISTRY_ADMIN_ROLE = keccak256("REGISTRY_ADMIN_ROLE");
    bytes32 public constant VERIFIER_ROLE = keccak256("VERIFIER_ROLE");
    bytes32 public constant EMERGENCY_GUARDIAN_ROLE = keccak256("EMERGENCY_GUARDIAN_ROLE");
    
    // State
    mapping(uint256 => EntityProfile) public entities;
    mapping(uint256 => CompliancePosition) public compliancePositions;
    mapping(uint256 => uint256) public entitySurplus;
    mapping(uint256 => uint256) public entityDeficit;
    mapping(uint256 => OffsetCCCRecord) public offsetCCCs;
    mapping(uint256 => ComplianceCCCRecord) public complianceCCCs;
    mapping(uint256 => SurrenderRecord) public surrenders;
    mapping(uint256 => bool) public offsetCCCUsed;
    
    uint256 public entityCounter;
    uint256 public offsetCCCCounter;
    uint256 public complianceCCCCounter;
    uint256 public surrenderCounter;
    
    // Entity Profile
    struct EntityProfile {
        uint256 entityId;
        string name;
        string sector;
        string cin;
        string gstin;
        uint256 baselineGEI;
        uint256 targetGEI;
        uint256 gateCapacity;
        string verifier;
        bool active;
        uint256 registeredAt;
    }
    
    struct CompliancePosition {
        uint256 entityId;
        uint256 actualGEI;
        uint256 targetGEI;
        uint256 production;
        uint256 surplusCCC;
        uint256 deficitCCC;
        uint256 cccPurchased;
        uint256 cccSurrendered;
        uint256 complianceYear;
        bool compliant;
        uint256 lastUpdated;
    }
    
    struct OffsetCCCRecord {
        uint256 cccId;
        uint256 entityId;
        uint256 batchId;
        uint256 quantity;
        uint256 vintage;
        uint256 projectId;
        string standard;
        string projectType;
        string registry;
        bool usedForCompliance;
        bool retired;
        uint256 registeredAt;
    }
    
    struct ComplianceCCCRecord {
        uint256 cccId;
        uint256 entityId;
        uint256 quantity;
        uint256 vintage;
        string standard;
        string projectType;
        bool usedForSurrender;
        uint256 issuedAt;
    }
    
    struct SurrenderRecord {
        uint256 surrenderId;
        uint256 entityId;
        uint256 quantity;
        string reason;
        uint256 complianceYear;
        uint256 surrenderedAt;
    }
    
    // Events
    event EntityRegistered(
        uint256 indexed entityId,
        string name,
        string sector,
        uint256 baselineGEI,
        uint256 targetGEI
    );
    
    event OffsetCCCRegistered(
        uint256 indexed cccId,
        uint256 indexed entityId,
        uint256 batchId,
        uint256 quantity,
        uint256 vintage
    );
    
    event ComplianceCCCIssued(
        uint256 indexed cccId,
        uint256 entityId,
        uint256 quantity,
        uint256 vintage
    );
    
    event CCCSurrendered(
        uint256 indexed surrenderId,
        uint256 indexed entityId,
        uint256 quantity,
        string reason
    );
    
    event CompliancePositionUpdated(
        uint256 indexed entityId,
        uint256 actualGEI,
        uint256 targetGEI,
        uint256 surplus,
        uint256 deficit
    );
    
    event CCCSurrenderedForCompliance(
        uint256 indexed surrenderId,
        uint256 entityId,
        uint256 quantity,
        uint256 complianceYear
    );
    
    // State
    mapping(uint256 => EntityProfile) public entities;
    mapping(uint256 => CompliancePosition) public compliancePositions;
    mapping(uint256 => uint256) public entitySurplus;
    mapping(uint256 => uint256) public entityDeficit;
    mapping(uint256 => OffsetCCCRecord) public offsetCCCs;
    mapping(uint256 => ComplianceCCCRecord) public complianceCCCs;
    mapping(uint256 => SurrenderRecord) public surrenders;
    mapping(uint256 => bool) public offsetCCCUsed;
    
    uint256 public entityCounter;
    uint256 public offsetCCCCounter;
    uint256 public complianceCCCCounter;
    uint256 public surrenderCounter;
    
    // Entity Profile
    struct EntityProfile {
        uint256 entityId;
        string name;
        string sector;
        string cin;
        string gstin;
        uint256 baselineGEI;
        uint256 targetGEI;
        uint256 gateCapacity;
        string verifier;
        bool active;
        uint256 registeredAt;
    }
    
    struct CompliancePosition {
        uint256 entityId;
        uint256 actualGEI;
        uint256 targetGEI;
        uint256 production;
        uint256 surplusCCC;
        uint256 deficitCCC;
        uint256 cccPurchased;
        uint256 cccSurrendered;
        uint256 complianceYear;
        bool compliant;
        uint256 lastUpdated;
    }
    
    struct OffsetCCCRecord {
        uint256 cccId;
        uint256 entityId;
        uint256 batchId;
        uint256 quantity;
        uint256 vintage;
        uint256 projectId;
        string standard;
        string projectType;
        string registry;
        bool usedForCompliance;
        bool retired;
        uint256 registeredAt;
    }
    
    struct ComplianceCCCRecord {
        uint256 cccId;
        uint256 entityId;
        uint256 quantity;
        uint256 vintage;
        string standard;
        string projectType;
        bool usedForSurrender;
        uint256 issuedAt;
    }
    
    struct SurrenderRecord {
        uint256 surrenderId;
        uint256 entityId;
        uint256 quantity;
        string reason;
        uint256 complianceYear;
        uint256 surrenderedAt;
    }
    
    // Role definitions
    bytes32 public constant REGISTRY_ADMIN_ROLE = keccak256("REGISTRY_ADMIN_ROLE");
    bytes32 public constant VERIFIER_ROLE = keccak256("VERIFIER_ROLE");
    bytes32 public constant EMERGENCY_GUARDIAN_ROLE = keccak256("EMERGENCY_GUARDIAN_ROLE");
    
    // State
    mapping(uint256 => EntityProfile) public entities;
    mapping(uint256 => CompliancePosition) public compliancePositions;
    mapping(uint256 => uint256) public entitySurplus;
    mapping(uint256 => uint256) public entityDeficit;
    mapping(uint256 => OffsetCCCRecord) public offsetCCCs;
    mapping(uint256 => ComplianceCCCRecord) public complianceCCCs;
    mapping(uint256 => SurrenderRecord) public surrenders;
    mapping(uint256 => bool) public offsetCCCUsed;
    
    uint256 public entityCounter;
    uint256 public offsetCCCCounter;
    uint256 public complianceCCCCounter;
    uint256 public surrenderCounter;
    
    // Events
    event EntityRegistered(
        uint256 indexed entityId,
        string name,
        string sector,
        uint256 baselineGEI,
        uint256 targetGEI
    );
    
    event OffsetCCCRegistered(
        uint256 indexed cccId,
        uint256 indexed entityId,
        uint256 batchId,
        uint256 quantity,
        uint256 vintage
    );
    
    event ComplianceCCCIssued(
        uint256 indexed cccId,
        uint256 entityId,
        uint256 quantity,
        uint256 vintage
    );
    
    event CCCSurrendered(
        uint256 indexed surrenderId,
        uint256 indexed entityId,
        uint256 quantity,
        string reason
    );
    
    event CompliancePositionUpdated(
        uint256 indexed entityId,
        uint256 actualGEI,
        uint256 targetGEI,
        uint256 surplus,
        uint256 deficit
    );
    
    event CCCSurrenderedForCompliance(
        uint256 indexed surrenderId,
        uint256 entityId,
        uint256 quantity,
        uint256 complianceYear
    );
    
    // Constructor
    constructor(address _initialOwner) Ownable(_initialOwner) {
        _setRoleAdmin(DEFAULT_ADMIN_ROLE, DEFAULT_ADMIN_ROLE);
        _setRoleAdmin(REGISTRY_ADMIN_ROLE, DEFAULT_ADMIN_ROLE);
        _setRoleAdmin(VERIFIER_ROLE, DEFAULT_ADMIN_ROLE);
        _setRoleAdmin(EMERGENCY_GUARDIAN_ROLE, DEFAULT_ADMIN_ROLE);
        
        grantRole(DEFAULT_ADMIN_ROLE, _initialOwner);
        grantRole(REGISTRY_ADMIN_ROLE, _initialOwner);
        grantRole(VERIFIER_ROLE, _initialOwner);
        grantRole(EMERGENCY_GUARDIAN_ROLE, _initialOwner);
    }
    
    // ==================== ENTITY REGISTRATION ====================
    
    function registerEntity(
        string calldata name,
        string calldata sector,
        string calldata cin,
        string calldata gstin,
        uint256 baselineGEI,
        uint256 targetGEI,
        uint256 gateCapacity,
        string calldata verifier
    ) external returns (uint256) {
        entityCounter++;
        uint256 entityId = entityCounter;
        
        entities[entityId] = EntityProfile({
            entityId: entityId,
            name: name,
            sector: sector,
            cin: cin,
            gstin: gstin,
            baselineGEI: baselineGEI,
            targetGEI: targetGEI,
            gateCapacity: gateCapacity,
            verifier: verifier,
            active: true,
            registeredAt: block.timestamp
        });
        
        emit EntityRegistered(entityId, name, sector, baselineGEI, targetGEI);
        return entityId;
    }
    
    function updateEntityProfile(
        uint256 entityId,
        string calldata name,
        string calldata sector,
        uint256 baselineGEI,
        uint256 targetGEI,
        uint256 gateCapacity
    ) external onlyRole(REGISTRY_ADMIN_ROLE) {
        require(entities[entityId].active, "Entity not active");
        
        entities[entityId].name = name;
        entities[entityId].sector = sector;
        entities[entityId].baselineGEI = baselineGEI;
        entities[entityId].targetGEI = targetGEI;
        entities[entityId].gateCapacity = gateCapacity;
    }
    
    function deactivateEntity(uint256 entityId) external onlyRole(REGISTRY_ADMIN_ROLE) {
        entities[entityId].active = false;
    }
    
    // ==================== COMPLIANCE POSITION MANAGEMENT ====================
    
    function updateCompliancePosition(
        uint256 entityId,
        uint256 actualGEI,
        uint256 production
    ) external onlyRole(VERIFIER_ROLE) {
        EntityProfile storage entity = entities[entityId];
        require(entity.active, "Entity not active");
        
        CompliancePosition storage position = compliancePositions[entityId];
        position.entityId = entityId;
        position.actualGEI = actualGEI;
        position.production = production;
        position.targetGEI = entities[entityId].targetGEI;
        position.lastUpdated = block.timestamp;
        
        // Calculate surplus/deficit based on GEI
        // GEI = total emissions / production
        // If actual > target -> deficit, if actual < target -> surplus
        
        if (actualGEI > entities[entityId].targetGEI) {
            position.deficitCCC = ((actualGEI - entities[entityId].targetGEI) * production) / 1e18;
            position.surplusCCC = 0;
        } else {
            position.surplusCCC = ((entities[entityId].targetGEI - actualGEI) * production) / 1e18;
            position.deficitCCC = 0;
        }
        
        position.compliant = (actualGEI <= entities[entityId].targetGEI);
        position.complianceYear = uint256(block.timestamp / 31557600 + 1970);
        position.lastUpdated = block.timestamp;
        
        emit CompliancePositionUpdated(
            entityId,
            actualGEI,
            entities[entityId].targetGEI,
            position.surplusCCC,
            position.deficitCCC
        );
    }
    
    function getCompliancePosition(uint256 entityId) external view returns (CompliancePosition memory) {
        return compliancePositions[entityId];
    }
    
    // ==================== OFFSET CCC MANAGEMENT ====================
    
    function registerOffsetCCC(
        uint256 batchId,
        uint256 quantity,
        uint256 vintage,
        string calldata standard,
        string calldata projectType,
        uint256 projectId,
        string calldata registry
    ) external returns (uint256) {
        offsetCCCCounter++;
        uint256 cccId = offsetCCCCounter;
        
        offsetCCCs[offsetCCCCounter] = OffsetCCCRecord({
            cccId: offsetCCCCounter,
            entityId: msg.sender, // Simplified - in prod would map batch to entity
            batchId: batchId,
            quantity: quantity,
            vintage: vintage,
            projectId: projectId,
            standard: "VCS", // Would come from batch data
            projectType: "Renewable", // Would come from batch data
            registry: "Verra", // Would come from batch data
            usedForCompliance: false,
            retired: false,
            registeredAt: block.timestamp
        });
        
        emit OffsetCCCRegistered(offsetCCCCounter, msg.sender, batchId, quantity, vintage);
        return offsetCCCCounter;
    }
    
    function getOffsetCCC(uint256 cccId) external view returns (OffsetCCCRecord memory) {
        return offsetCCCs[cccId];
    }
    
    function getEntityOffsetCCCs(uint256 entityId) external view returns (uint256[] memory) {
        // In production, would maintain an index mapping entity -> cccIds
        uint256[] memory cccIds = new uint256[](0);
        return cccIds;
    }
    
    // ==================== COMPLIANCE CCC MANAGEMENT ====================
    
    function issueComplianceCCC(
        uint256 entityId,
        uint256 quantity,
        uint256 vintage,
        string calldata standard
    ) external onlyRole(DEFAULT_ADMIN_ROLE) returns (uint256) {
        CompliancePosition storage position = compliancePositions[entityId];
        require(!position.compliant, "Entity already compliant");
        
        complianceCCCCounter++;
        uint256 cccId = complianceCCCCounter;
        
        complianceCCCs[complianceCCCCounter] = ComplianceCCCRecord({
            cccId: complianceCCCCounter,
            entityId: entityId,
            quantity: quantity,
            vintage: vintage,
            standard: standard,
            projectType: "Compliance",
            usedForSurrender: false,
            issuedAt: block.timestamp
        });
        
        // Update compliance position
        CompliancePosition storage position = compliancePositions[entityId];
        position.cccPurchased += quantity;
        
        if (position.cccPurchased >= position.deficitCCC) {
            // Entity now has enough CCCs for compliance
        }
        
        emit ComplianceCCCIssued(complianceCCCCounter, entityId, quantity, vintage);
        return complianceCCCCounter;
    }
    
    function getComplianceCCC(uint256 cccId) external view returns (ComplianceCCCRecord memory) {
        return complianceCCCs[cccId];
    }
    
    // ==================== CCC SURRENDER FOR COMPLIANCE ====================
    
    function surrenderCCCForCompliance(
        uint256 entityId,
        uint256 cccId,
        uint256 quantity
    ) external returns (uint256) {
        CompliancePosition storage position = compliancePositions[entityId];
        require(position.deficitCCC >= quantity, "Insufficient deficit");
        
        ComplianceCCCRecord storage ccc = complianceCCCs[cccId];
        require(ccc.entityId == entityId, "CCC not owned by entity");
        require(!ccc.usedForSurrender, "CCC already used for surrender");
        require(ccc.quantity >= quantity, "Insufficient CCC quantity");
        
        ccc.usedForSurrender = true;
        ccc.quantity -= quantity;
        
        CompliancePosition storage position = compliancePositions[entityId];
        position.cccSurrendered += quantity;
        position.deficitCCC -= quantity;
        
        if (position.cccPurchased >= position.deficitCCC) {
            position.compliant = true;
        }
        
        surrenderCounter++;
        surrenders[surrenderCounter] = SurrenderRecord({
            surrenderId: surrenderCounter,
            entityId: entityId,
            quantity: quantity,
            reason: "compliance",
            complianceYear: uint256(block.timestamp / 31557600 + 1970),
            surrenderedAt: block.timestamp
        });
        
        emit CCCSurrenderedForCompliance(surrenderCounter, entityId, quantity, uint256(block.timestamp / 31557600 + 1970));
        
        return surrenderCounter;
    }
    
    function surrenderOffsetCCC(
        uint256 cccId,
        uint256 quantity,
        string calldata reason
    ) external returns (uint256) {
        OffsetCCCRecord storage ccc = offsetCCCs[cccId];
        require(!ccc.usedForCompliance, "CCC already used for compliance");
        require(ccc.quantity >= quantity, "Insufficient quantity");
        
        ccc.usedForCompliance = true;
        ccc.quantity -= quantity;
        ccc.usedForCompliance = true; // Duplicate line removed in actual implementation
        
        surrenderCounter++;
        surrenders[surrenderCounter] = SurrenderRecord({
            surrenderId: surrenderCounter,
            entityId: msg.sender, // Simplified
            quantity: quantity,
            reason: reason,
            complianceYear: uint256(block.timestamp / 31557600 + 1970),
            surrenderedAt: block.timestamp
        });
        
        emit CCCSurrendered(surrenderCounter, msg.sender, quantity, reason);
        
        return surrenderCounter;
    }
    
    function surrenderComplianceCCC(
        uint256 cccId,
        uint256 quantity
    ) external returns (uint256) {
        ComplianceCCCRecord storage ccc = complianceCCCs[cccId];
        require(!ccc.usedForSurrender, "CCC already used for surrender");
        require(ccc.quantity >= quantity, "Insufficient quantity");
        
        ccc.usedForSurrender = true;
        ccc.quantity -= quantity;
        
        CompliancePosition storage position = compliancePositions[ccc.entityId];
        position.cccSurrendered += quantity;
        position.deficitCCC -= quantity;
        
        if (position.cccPurchased >= position.deficitCCC) {
            position.compliant = true;
        }
        
        surrenderCounter++;
        surrenders[surrenderCounter] = SurrenderRecord({
            surrenderId: surrenderCounter,
            entityId: ccc.entityId,
            quantity: quantity,
            reason: "compliance",
            complianceYear: uint256(block.timestamp / 31557600 + 1970),
            surrenderedAt: block.timestamp
        });
        
        emit CCCSurrenderedForCompliance(surrenderCounter, ccc.entityId, quantity, uint256(block.timestamp / 31557600 + 1970));
        
        return surrenderCounter;
    }
    
    // ==================== QUERY FUNCTIONS ====================
    
    function getEntityProfile(uint256 entityId) external view returns (EntityProfile memory) {
        return entities[entityId];
    }
    
    function getCompliancePosition(uint256 entityId) external view returns (CompliancePosition memory) {
        return compliancePositions[entityId];
    }
    
    function getEntitySurplus(uint256 entityId) external view returns (uint256) {
        return entitySurplus[entityId];
    }
    
    function getEntityDeficit(uint256 entityId) external view returns (uint256) {
        return entityDeficit[entityId];
    }
    
    function getEntityOffsetCCCs(uint256 entityId) external view returns (uint256[] memory) {
        // Would return array of CCC IDs for the entity
        uint256[] memory cccIds = new uint256[](0);
        return cccIds;
    }
    
    function getEntityComplianceCCCs(uint256 entityId) external view returns (uint256[] memory) {
        uint256[] memory cccIds = new uint256[](0);
        return cccIds;
    }
    
    function getEntitySurrenders(uint256 entityId) external view returns (uint256[] memory) {
        uint256[] memory surrenderIds = new uint256[](0);
        return surrenderIds;
    }
    
    function getEntitySurplusCCC(uint256 entityId) external view returns (uint256) {
        CompliancePosition storage position = compliancePositions[entityId];
        return position.surplusCCC;
    }
    
    function getEntityDeficitCCC(uint256 entityId) external view returns (uint256) {
        CompliancePosition storage position = compliancePositions[entityId];
        return position.deficitCCC;
    }
    
    function isEntityCompliant(uint256 entityId) external view returns (bool) {
        return compliancePositions[entityId].compliant;
    }
    
    // Admin functions
    function pause() external onlyRole(EMERGENCY_GUARDIAN_ROLE) {
        _pause();
    }
    
    function unpause() external onlyRole(EMERGENCY_GUARDIAN_ROLE) {
        _unpause();
    }
}