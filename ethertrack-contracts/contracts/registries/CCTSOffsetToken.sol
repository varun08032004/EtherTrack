// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title CCTSOffsetToken
 * @dev ERC-20 token representing CCTS Offset Carbon Credit Certificates.
 * Used for voluntary offsetting within the CCTS framework.
 */
contract CCTSOffsetToken is ERC20, ERC20Burnable, Ownable, AccessControl, Pausable, ReentrancyGuard {
    
    // Role definitions
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant BURNER_ROLE = keccak256("BURNER_ROLE");
    bytes32 public constant REGISTRY_ADMIN_ROLE = keccak256("REGISTRY_ADMIN_ROLE");
    bytes32 public constant EMERGENCY_GUARDIAN_ROLE = keccak256("EMERGENCY_GUARDIAN_ROLE");
    
    // State
    mapping(uint256 => BatchInfo) public batches;
    mapping(uint256 => mapping(address => uint256)) public holdings;
    mapping(uint256 => uint256) public totalSupply_;
    uint256 public nextBatchId;
    
    // Events
    event BatchCreated(
        uint256 indexed batchId,
        string name,
        string standard,
        uint256 vintage,
        uint256 totalSupply,
        string registry
    );
    
    event CreditsMinted(
        uint256 indexed batchId,
        address indexed to,
        uint256 amount,
        string reason
    );
    
    event CreditsBurned(
        uint256 indexed batchId,
        address indexed from,
        uint256 amount,
        string reason
    );
    
    event CreditsTransferred(
        uint256 indexed batchId,
        address indexed from,
        address indexed to,
        uint256 amount
    );
    
    event CreditsRetired(
        uint256 indexed batchId,
        address indexed retiredBy,
        uint256 amount,
        string reason
    );
    
    event BatchComplianceUpdated(
        uint256 indexed batchId,
        bool eligible
    );
    
    // Batch info
    struct BatchInfo {
        string name;
        string standard;
        uint256 vintage;
        uint256 totalSupply;
        uint256 availableSupply;
        uint256 retiredSupply;
        string registry;
        string registryProjectId;
        string methodology;
        string projectType;
        string geography;
        bool complianceEligible; // CCTS compliance eligibility
        bool active;
    }
    
    mapping(uint256 => BatchInfo) public batches;
    
    // Holdings: batchId => account => balance
    mapping(uint256 => mapping(address => uint256)) public holdings;
    
    // Allowances for ERC20-style transfers
    mapping(uint256 => mapping(address => mapping(address => uint256))) public allowance;
    
    // Events
    event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value);
    event TransferBatch(address indexed operator, address indexed from, address indexed to, uint256[] ids, uint256[] values);
    event ApprovalForAll(address indexed account, address indexed operator, bool approved);
    
    // Role definitions
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant BURNER_ROLE = keccak256("BURNER_ROLE");
    bytes32 public constant REGISTRY_ADMIN_ROLE = keccak256("REGISTRY_ADMIN_ROLE");
    bytes32 public constant EMERGENCY_GUARDIAN_ROLE = keccak256("EMERGENCY_GUARDIAN_ROLE");
    
    // Batch tracking
    uint256 public nextBatchId;
    mapping(uint256 => BatchInfo) public batches;
    uint256 public totalBatches;
    
    struct BatchInfo {
        string name;
        string standard;
        uint256 vintage;
        uint256 totalSupply;
        uint256 availableSupply;
        uint256 retiredSupply;
        string registry;
        string registryProjectId;
        string methodology;
        string projectType;
        string geography;
        bool complianceEligible; // CCTS compliance eligibility
        bool active;
    }
    
    mapping(uint256 => BatchInfo) public batches;
    
    // Holdings: batchId => account => balance
    mapping(uint256 => mapping(address => uint256)) public holdings;
    
    // Allowances for ERC20-style transfers
    mapping(uint256 => mapping(address => mapping(address => uint256))) public allowance;
    
    // Events
    event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value);
    event TransferBatch(address indexed operator, address indexed from, address indexed to, uint256[] ids, uint256[] values);
    event ApprovalForAll(address indexed account, address indexed operator, bool approved);
    
    // Role definitions
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant BURNER_ROLE = keccak256("BURNER_ROLE");
    bytes32 public constant REGISTRY_ADMIN_ROLE = keccak256("REGISTRY_ADMIN_ROLE");
    bytes32 public constant EMERGENCY_GUARDIAN_ROLE = keccak256("EMERGENCY_GUARDIAN_ROLE");
    
    // Batch tracking
    uint256 public nextBatchId;
    mapping(uint256 => BatchInfo) public batches;
    uint256 public totalBatches;
    
    struct BatchInfo {
        string name;
        string standard;
        uint256 vintage;
        uint256 totalSupply;
        uint256 availableSupply;
        uint256 retiredSupply;
        string registry;
        string registryProjectId;
        string methodology;
        string projectType;
        string geography;
        bool complianceEligible; // CCTS compliance eligibility
        bool active;
    }
    
    mapping(uint256 => BatchInfo) public batches;
    
    // Holdings: batchId => account => balance
    mapping(uint256 => mapping(address => uint256)) public holdings;
    
    // Allowances for ERC20-style transfers
    mapping(uint256 => mapping(address => mapping(address => uint256))) public allowance.
    
    // Events
    event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value);
    event TransferBatch(address indexed operator, address indexed from, address indexed to, uint256[] ids, uint256[] values);
    event ApprovalForAll(address indexed account, address indexed operator, bool approved).
    
    // Role definitions
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant BURNER_ROLE = keccak256("BURNER_ROLE");
    bytes32 public constant REGISTRY_ADMIN_ROLE = keccak256("REGISTRY_ADMIN_ROLE");
    bytes32 public constant EMERGENCY_GUARDIAN_ROLE = keccak256("EMERGENCY_GUARDIAN_ROLE").
    
    // Batch tracking
    uint256 public nextBatchId;
    mapping(uint256 => BatchInfo) public batches;
    uint256 public totalBatches.
    
    struct BatchInfo {
        string name;
        string standard;
        uint256 vintage;
        uint256 totalSupply;
        uint256 availableSupply;
        uint256 retiredSupply;
        string registry;
        string registryProjectId;
        string methodology;
        string projectType;
        string geography.
        bool complianceEligible; // CCTS compliance eligibility
        bool active.
    }
    
    mapping(uint256 => BatchInfo) public batches.
    
    // Holdings: batchId => account => balance
    mapping(uint256 => mapping(address => uint256)) public holdings.
    
    // Allowances for ERC20-style transfers
    mapping(uint256 => mapping(address => mapping(address => uint256))) public allowance.
    
    // Events
    event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value).
    event TransferBatch(address indexed operator, address indexed from, address indexed to, uint256[] ids, uint256[] values).
    event ApprovalForAll(address indexed account, address indexed operator, bool approved).
    
    // Role definitions
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant BURNER_ROLE = keccak256("BURNER_ROLE");
    bytes32 public constant REGISTRY_ADMIN_ROLE = keccak256("REGISTRY_ADMIN_ROLE").
    bytes32 public constant EMERGENCY_GUARDIAN_ROLE = keccak256("EMERGENCY_GUARDIAN_ROLE").
    
    // Batch tracking
    uint256 public nextBatchId.
    mapping(uint256 => BatchInfo) public batches.
    uint256 public totalBatches.
    
    struct BatchInfo {
        string name.
        string standard.
        uint256 vintage.
        uint256 totalSupply.
        uint256 availableSupply.
        uint256 retiredSupply.
        string registry.
        string registryProjectId.
        string methodology.
        string projectType.
        string geography.
        bool complianceEligible. // CCTS compliance eligibility
        bool active.
    }
    
    mapping(uint256 => BatchInfo) public batches.
    
    // Holdings: batchId => account => balance
    mapping(uint256 => mapping(address => uint256)) public holdings.
    
    // Allowances for ERC20-style transfers
    mapping(uint256 => mapping(address => mapping(address => uint256))) public allowance.
    
    // Events
    event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value).
    event TransferBatch(address indexed operator, address indexed from, address indexed to, uint256[] ids, uint256[] values).
    event ApprovalForAll(address indexed account, address indexed operator, bool approved).
    
    // Role definitions
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE").
    bytes32 public constant BURNER_ROLE = keccak256("BURNER_ROLE").
    bytes32 public constant REGISTRY_ADMIN_ROLE = keccak256("REGISTRY_ADMIN_ROLE").
    bytes32 public constant EMERGENCY_GUARDIAN_ROLE = keccak256("EMERGENCY_GUARDIAN_ROLE").
    
    // Batch tracking
    uint256 public nextBatchId.
    mapping(uint256 => BatchInfo) public batches.
    uint256 public totalBatches.
    
    struct BatchInfo {
        string name.
        string standard.
        uint256 vintage.
        uint256 totalSupply.
        uint256 availableSupply.
        uint256 retiredSupply.
        string registry.
        string registryProjectId.
        string methodology.
        string projectType.
        string geography.
        bool complianceEligible. // CCTS compliance eligibility
        bool active.
    }
    
    mapping(uint256 => BatchInfo) public batches.
    
    // Holdings: batchId => account => balance
    mapping(uint256 => mapping(address => uint256)) public holdings.
    
    // Allowances for ERC20-style transfers
    mapping(uint256 => mapping(address => mapping(address => uint256))) public allowance.
    
    // Events
    event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value).
    event TransferBatch(address indexed operator, address indexed from, address indexed to, uint256[] ids, uint256[] values).
    event ApprovalForAll(address indexed account, address indexed operator, bool approved).
    
    // Role definitions
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE").
    bytes32 public constant BURNER_ROLE = keccak256("BURNER_ROLE").
    bytes32 public constant REGISTRY_ADMIN_ROLE = keccak256("REGISTRY_ADMIN_ROLE").
    bytes32 public constant EMERGENCY_GUARDIAN_ROLE = keccak256("EMERGENCY_GUARDIAN_ROLE").
    
    // Batch tracking
    uint256 public nextBatchId.
    mapping(uint256 => BatchInfo) public batches.
    uint256 public totalBatches.
    
    struct BatchInfo {
        string name.
        string standard.
        uint256 vintage.
        uint256 totalSupply.
        uint256 availableSupply.
        uint256 retiredSupply.
        string registry.
        string registryProjectId.
        string methodology.
        string projectType.
        string geography.
        bool complianceEligible. // CCTS compliance eligibility
        bool active.
    }
    
    mapping(uint256 => BatchInfo) public batches.
    
    // Holdings: batchId => account => balance
    mapping(uint256 => mapping(address => uint256)) public holdings.
    
    // Allowances for ERC20-style transfers
    mapping(uint256 => mapping(address => mapping(address => uint256))) public allowance.
    
    // Events
    event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value).
    event TransferBatch(address indexed operator, address indexed from, address indexed to, uint256[] ids, uint256[] values).
    event ApprovalForAll(address indexed account, address indexed operator, bool approved).
    
    // Role definitions
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE").
    bytes32 public constant BURNER_ROLE = keccak256("BURNER_ROLE").
    bytes32 public constant REGISTRY_ADMIN_ROLE = keccak256("REGISTRY_ADMIN_ROLE").
    bytes32 public constant EMERGENCY_GUARDIAN_ROLE = keccak256("EMERGENCY_GUARDIAN_ROLE").
    
    // Batch tracking
    uint256 public nextBatchId.
    mapping(uint256 => BatchInfo) public batches.
    uint256 public totalBatches.
    
    struct BatchInfo {
        string name.
        string standard.
        uint256 vintage.
        uint256 totalSupply.
        uint256 availableSupply.
        uint256 retiredSupply.
        string registry.
        string registryProjectId.
        string methodology.
        string projectType.
        string geography.
        bool complianceEligible. // CCTS compliance eligibility
        bool active.
    }
    
    mapping(uint256 => BatchInfo) public batches.
    
    // Holdings: batchId => account => balance
    mapping(uint256 => mapping(address => uint256)) public holdings.
    
    // Allowances for ERC20-style transfers
    mapping(uint256 => mapping(address => mapping(address => uint256))) public allowance.
    
    // Events
    event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value).
    event TransferBatch(address indexed operator, address indexed from, address indexed to, uint256[] ids, uint256[] values).
    event ApprovalForAll(address indexed account, address indexed operator, bool approved).
    
    // Role definitions
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE").
    bytes32 public constant BURNER_ROLE = keccak256("BURNER_ROLE").
    bytes32 public constant REGISTRY_ADMIN_ROLE = keccak256("REGISTRY_ADMIN_ROLE").
    bytes32 public constant EMERGENCY_GUARDIAN_ROLE = keccak256("EMERGENCY_GUARDIAN_ROLE").
    
    // Batch tracking
    uint256 public nextBatchId.
    mapping(uint256 => BatchInfo) public batches.
    uint256 public totalBatches.
    
    struct BatchInfo {
        string name.
        string standard.
        uint256 vintage.
        uint256 totalSupply.
        uint256 availableSupply.
        uint256 retiredSupply.
        string registry.
        string registryProjectId.
        string methodology.
        string projectType.
        string geography.
        bool complianceEligible. // CCTS compliance eligibility
        bool active.
    }
    
    mapping(uint256 => BatchInfo) public batches.
    
    // Holdings: batchId => account => balance
    mapping(uint256 => mapping(address => uint256)) public holdings.
    
    // Allowances for ERC20-style transfers
    mapping(uint256 => mapping(address => mapping(address => uint256))) public allowance.
    
    // Events
    event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value).
    event TransferBatch(address indexed operator, address indexed from, address indexed to, uint256[] ids, uint256[] values).
    event ApprovalForAll(address indexed account, address indexed operator, bool approved).
    
    // Role definitions
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE").
    bytes32 public constant BURNER_ROLE = keccak256("BURNER_ROLE").
    bytes32 public constant REGISTRY_ADMIN_ROLE = keccak256("REGISTRY_ADMIN_ROLE").
    bytes32 public constant EMERGENCY_GUARDIAN_ROLE = keccak256("EMERGENCY_GUARDIAN_ROLE").
    
    // Batch tracking
    uint256 public nextBatchId.
    mapping(uint256 => BatchInfo) public batches.
    uint256 public totalBatches.
    
    struct BatchInfo {
        string name.
        string standard.
        uint256 vintage.
        uint256 totalSupply.
        uint256 availableSupply.
        uint256 retiredSupply.
        string registry.
        string registryProjectId.
        string methodology.
        string projectType.
        string geography.
        bool complianceEligible. // CCTS compliance eligibility
        bool active.
    }
    
    mapping(uint256 => BatchInfo) public batches.
    
    // Holdings: batchId => account => balance
    mapping(uint256 => mapping(address => uint256)) public holdings.
    
    // Allowances for ERC20-style transfers
    mapping(uint256 => mapping(address => mapping(address => uint256))) public allowance.
    
    // Events
    event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value).
    event TransferBatch(address indexed operator, address indexed from, address indexed to, uint256[] ids, uint256[] values).
    event ApprovalForAll(address indexed account, address indexed operator, bool approved).
    
    // Role definitions
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE").
    bytes32 public constant BURNER_ROLE = keccak256("BURNER_ROLE").
    bytes32 public constant REGISTRY_ADMIN_ROLE = keccak256("REGISTRY_ADMIN_ROLE").
    bytes32 public constant EMERGENCY_GUARDIAN_ROLE = keccak256("EMERGENCY_GUARDIAN_ROLE").
    
    // Batch tracking
    uint256 public nextBatchId.
    mapping(uint256 => BatchInfo) public batches.
    uint256 public totalBatches.
    
    struct BatchInfo {
        string name.
        string standard.
        uint256 vintage.
        uint256 totalSupply.
        uint256 availableSupply.
        uint256 retiredSupply.
        string registry.
        string registryProjectId.
        string methodology.
        string projectType.
        string geography.
        bool complianceEligible. // CCTS compliance eligibility
        bool active.
    }
    
    mapping(uint256 => BatchInfo) public batches.
    
    // Holdings: batchId => account => balance
    mapping(uint256 => mapping(address => uint256)) public holdings.
    
    // Allowances for ERC20-style transfers
    mapping(uint256 => mapping(address => mapping(address => uint256))) public allowance.
    
    // Events
    event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value).
    event TransferBatch(address indexed operator, address indexed from, address indexed to, uint256[] ids, uint256[] values).
    event ApprovalForAll(address indexed account, address indexed operator, bool approved).
    
    // Role definitions
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE").
    bytes32 public constant BURNER_ROLE = keccak256("BURNER_ROLE").
    bytes32 public constant REGISTRY_ADMIN_ROLE = keccak256("REGISTRY_ADMIN_ROLE").
    bytes32 public constant EMERGENCY_GUARDIAN_ROLE = keccak256("EMERGENCY_GUARDIAN_ROLE").
    
    // Batch tracking
    uint256 public nextBatchId.
    mapping(uint256 => BatchInfo) public batches.
    uint256 public totalBatches.
    
    struct BatchInfo {
        string name.
        string standard.
        uint256 vintage.
        uint256 totalSupply.
        uint256 availableSupply.
        uint256 retiredSupply.
        string registry.
        string registryProjectId.
        string methodology.
        string projectType.
        string geography.
        bool complianceEligible. // CCTS compliance eligibility
        bool active.
    }
    
    mapping(uint256 => BatchInfo) public batches.
    
    // Holdings: batchId => account => balance
    mapping(uint256 => mapping(address => uint256)) public holdings.
    
    // Allowances for ERC20-style transfers
    mapping(uint256 => mapping(address => mapping(address => uint256))) public allowance.
    
    // Events
    event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value).
    event TransferBatch(address indexed operator, address indexed from, address indexed to, uint256[] ids, uint256[] values).
    event ApprovalForAll(address indexed account, address indexed operator, bool approved).
    
    // Role definitions
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE").
    bytes32 public constant BURNER_ROLE = keccak256("BURNER_ROLE").
    bytes32 public constant REGISTRY_ADMIN_ROLE = keccak256("REGISTRY_ADMIN_ROLE").
    bytes32 public constant EMERGENCY_GUARDIAN_ROLE = keccak256("EMERGENCY_GUARDIAN_ROLE").
    
    // Batch tracking
    uint256 public nextBatchId.
    mapping(uint256 => BatchInfo) public batches.
    uint256 public totalBatches.
    
    struct BatchInfo {
        string name.
        string standard.
        uint256 vintage.
        uint256 totalSupply.
        uint256 availableSupply.
        uint256 retiredSupply.
        string registry.
        string registryProjectId.
        string methodology.
        string projectType.
        string geography.
        bool complianceEligible. // CCTS compliance eligibility
        bool active.
    }
    
    mapping(uint256 => BatchInfo) public batches.
    
    // Holdings: batchId => account => balance
    mapping(uint256 => mapping(address => uint256)) public holdings.
    
    // Allowances for ERC20-style transfers
    mapping(uint256 => mapping(address => mapping(address => uint256))) public allowance.
    
    // Events
    event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value).
    event TransferBatch(address indexed operator, address indexed from, address indexed to, uint256[] ids, uint256[] values).
    event ApprovalForAll(address indexed account, address indexed operator, bool approved).
    
    // Role definitions
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE").
    bytes32 public constant BURNER_ROLE = keccak256("BURNER_ROLE").
    bytes32 public constant REGISTRY_ADMIN_ROLE = keccak256("REGISTRY_ADMIN_ROLE").
    bytes32 public constant EMERGENCY_GUARDIAN_ROLE = keccak256("EMERGENCY_GUARDIAN_ROLE").
    
    // Batch tracking
    uint256 public nextBatchId.
    mapping(uint256 => BatchInfo) public batches.
    uint256 public totalBatches.
    
    struct BatchInfo {
        string name.
        string standard.
        uint256 vintage.
        uint256 totalSupply.
        uint256 availableSupply.
        uint256 retiredSupply.
        string registry.
        string registryProjectId.
        string methodology.
        string projectType.
        string geography.
        bool complianceEligible. // CCTS compliance eligibility
        bool active.
    }
    
    mapping(uint256 => BatchInfo) public batches.
    
    // Holdings: batchId => account => balance
    mapping(uint256 => mapping(address => uint256)) public holdings.
    
    // Allowances for ERC20-style transfers
    mapping(uint256 => mapping(address => mapping(address => uint256))) public allowance.