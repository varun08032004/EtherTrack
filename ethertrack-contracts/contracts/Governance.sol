// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/governance/TimelockController.sol";
import "@openzeppelin/contracts/governance/Governor.sol";
import "@openzeppelin/contracts/governance/GovernorSettings.sol";
import "@openzeppelin/contracts/governance/GovernorCountingSimple.sol";
import "@openzeppelin/contracts/governance/GovernorVotes.sol";
import "@openzeppelin/contracts/token/ERC20Votes.sol";
import "@openzeppelin/contracts/token/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20Permit.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title GovernanceToken
 * @notice Governance token with voting power delegation for Gnosis Safe integration
 *         Used for on-chain governance of protocol parameters
 */
contract GovernanceToken is ERC20, ERC20Permit, ERC20Votes, Ownable, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant BURNER_ROLE = keccak256("BURNER_ROLE");

    constructor(
        address initialOwner,
        address initialMinter,
        string memory name,
        string memory symbol
    ) ERC20(name, symbol) ERC20Permit(name) Ownable(initialOwner) {
        _setRoleAdmin(MINTER_ROLE, DEFAULT_ADMIN_ROLE);
        _setRoleAdmin(BURNER_ROLE, DEFAULT_ADMIN_ROLE);
        grantRole(MINTER_ROLE, initialMinter);
    }

    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        _mint(to, amount);
    }

    function burn(uint256 amount) external onlyRole(BURNER_ROLE) {
        _burn(msg.sender, amount);
    }

    function mintWithPermit(
        address to,
        uint256 amount,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        require(block.timestamp <= deadline, "Permit expired");
        address signer = ECDSA.recover(
            keccak256(abi.encodePacked(
                "\x19Ethereum Signed Message:\n32",
                keccak256(abi.encodePacked(
                    name(),
                    DOMAIN_SEPARATOR(),
                    keccak256(abi.encode(
                        "MintWithPermit",
                        to,
                        amount,
                        nonce(to),
                        deadline
                    ))
                ))
            )),
            v, r, s
        );
        require(hasRole(MINTER_ROLE, signer), "Invalid permit");
        _mint(to, amount);
    }
}

/**
 * @title GnosisSafeManager
 * @notice Manages integration with Gnosis Safe for multi-sig operations
 *         Provides on-chain registry of authorized Safe addresses
 *         and utility functions for Safe interaction
 */
contract GnosisSafeManager is Ownable, AccessControl, ReentrancyGuard {
    bytes32 public constant SAFE_MANAGER_ROLE = keccak256("SAFE_MANAGER_ROLE");
    bytes32 public constant EMERGENCY_ROLE = keccak256("EMERGENCY_ROLE");

    struct SafeConfig {
        address safeAddress;
        uint256 threshold;
        address[] owners;
        uint256 nonce;
        bool active;
        string label;
        uint256 createdAt;
    }

    struct Transaction {
        uint256 txId;
        address safeAddress;
        address to;
        uint256 value;
        bytes data;
        uint256 timestamp;
        bool executed;
        bytes32 safeTxHash;
        uint256 confirmations;
        address[] confirmers;
    }

    mapping(address => SafeConfig) public safeConfigs;
    mapping(bytes32 => Transaction) public transactions;
    mapping(address => bytes32[]) public safeTransactions;
    address[] public safeAddresses;
    uint256 public nextTxId;

    event SafeRegistered(
        address indexed safeAddress,
        string label,
        uint256 threshold,
        address[] owners
    );
    event SafeUpdated(address indexed safeAddress, string label, bool active);
    event SafeRemoved(address indexed safeAddress);
    event TransactionQueued(
        uint256 indexed txId,
        address indexed safeAddress,
        address to,
        uint256 value
    );
    event TransactionExecuted(uint256 indexed txId, address indexed executor);
    event TransactionConfirmed(uint256 indexed txId, address indexed confirmer);
    event OwnershipTransferred(address indexed safeAddress, address newOwner);

    constructor(address initialOwner) Ownable(initialOwner) {
        _setRoleAdmin(SAFE_MANAGER_ROLE, DEFAULT_ADMIN_ROLE);
        _setRoleAdmin(EMERGENCY_ROLE, DEFAULT_ADMIN_ROLE);
        grantRole(SAFE_MANAGER_ROLE, initialOwner);
    }

    function registerSafe(
        address safeAddress,
        string calldata label,
        uint256 threshold,
        address[] calldata owners
    ) external onlyRole(SAFE_MANAGER_ROLE) nonReentrant {
        require(safeAddress != address(0), "Zero address");
        require(threshold > 0 && threshold <= owners.length, "Invalid threshold");
        require(owners.length >= threshold, "Insufficient owners");
        require(!safeConfigs[safeAddress].active, "Safe already registered");

        // Verify it's a Gnosis Safe contract
        require(ISafe(safeAddress).getThreshold() == threshold, "Threshold mismatch");
        for (uint256 i = 0; i < owners.length; i++) {
            require(ISafe(safeAddress).isOwner(owners[i]), "Owner mismatch");
        }

        safeConfigs[safeAddress] = SafeConfig({
            safeAddress: safeAddress,
            threshold: threshold,
            owners: owners,
            nonce: ISafe(safeAddress).nonce(),
            active: true,
            label: label,
            createdAt: block.timestamp
        });

        safeAddresses.push(safeAddress);
        safeConfigs[safeAddress].active = true;

        emit SafeRegistered(safeAddress, label, threshold, owners);
    }

    function updateSafeConfig(
        address safeAddress,
        string calldata label,
        bool active
    ) external onlyRole(SAFE_MANAGER_ROLE) {
        SafeConfig storage config = safeConfigs[safeAddress];
        require(config.active, "Safe not registered");
        config.label = label;
        config.active = active;
        emit SafeUpdated(safeAddress, label, active);
    }

    function removeSafe(address safeAddress) external onlyRole(SAFE_MANAGER_ROLE) {
        SafeConfig storage config = safeConfigs[safeAddress];
        require(config.active, "Safe not registered");
        config.active = false;
        emit SafeRemoved(safeAddress);
    }

    function queueTransaction(
        address safeAddress,
        address to,
        uint256 value,
        bytes calldata data
    ) external onlyRole(SAFE_MANAGER_ROLE) nonReentrant returns (uint256) {
        SafeConfig storage config = safeConfigs[safeAddress];
        require(config.active, "Safe not active");

        uint256 txId = nextTxId++;
        bytes32 safeTxHash = keccak256(abi.encodePacked(
            safeAddress, to, value, data, config.nonce, block.timestamp
        ));

        Transaction storage tx = transactions[safeTxHash];
        tx.txId = txId;
        tx.safeAddress = safeAddress;
        tx.to = to;
        tx.value = value;
        tx.data = data;
        tx.timestamp = block.timestamp;
        tx.executed = false;
        tx.safeTxHash = safeTxHash;
        tx.confirmations = 0;
        tx.confirmers = new address[](0);

        config.nonce = ISafe(safeAddress).nonce();
        safeTransactions[safeAddress].push(safeTxHash);

        emit TransactionQueued(txId, safeAddress, to, value);
        return txId;
    }

    function confirmTransaction(bytes32 safeTxHash) external onlyRole(SAFE_MANAGER_ROLE) {
        Transaction storage tx = transactions[safeTxHash];
        require(tx.txId > 0, "Transaction not found");
        require(!tx.executed, "Already executed");
        require(tx.confirmations < safeConfigs[tx.safeAddress].threshold, "Already enough confirmations");

        // Check if already confirmed by this address
        for (uint256 i = 0; i < tx.confirmers.length; i++) {
            require(tx.confirmers[i] != msg.sender, "Already confirmed");
        }

        tx.confirmers.push(msg.sender);
        tx.confirmations++;
        emit TransactionConfirmed(tx.txId, msg.sender);

        // Auto-execute if threshold reached
        if (tx.confirmations >= safeConfigs[tx.safeAddress].threshold) {
            executeTransaction(safeTxHash);
        }
    }

    function executeTransaction(bytes32 safeTxHash) external nonReentrant {
        Transaction storage tx = transactions[safeTxHash];
        require(tx.txId > 0, "Transaction not found");
        require(!tx.executed, "Already executed");
        require(tx.confirmations >= safeConfigs[tx.safeAddress].threshold, "Insufficient confirmations");

        SafeConfig storage config = safeConfigs[tx.safeAddress];
        require(config.active, "Safe not active");

        // Verify safeTxHash matches
        bytes32 expectedHash = keccak256(abi.encodePacked(
            tx.safeAddress, tx.to, tx.value, tx.data, config.nonce - 1, tx.timestamp
        ));
        require(expectedHash == tx.safeTxHash, "Hash mismatch");

        // Execute via Safe
        ISafe(tx.safeAddress).execTransaction(
            tx.to, tx.value, tx.data, Enum.Operation.Call, 0, 0, 0, 0, 0, msg.sender
        );

        tx.executed = true;
        config.nonce++;
        emit TransactionExecuted(tx.txId, msg.sender);
    }

    function emergencyPause() external onlyRole(EMERGENCY_ROLE) {
        // Emergency pause all Safe operations
        for (uint256 i = 0; i < safeAddresses.length; i++) {
            safeConfigs[safeAddresses[i]].active = false;
        }
    }

    function getSafeConfig(address safeAddress) external view returns (SafeConfig memory) {
        return safeConfigs[safeAddress];
    }

    function getTransaction(bytes32 safeTxHash) external view returns (Transaction memory) {
        return transactions[safeTxHash];
    }

    function getPendingTransactions(address safeAddress) external view returns (bytes32[] memory) {
        return safeTransactions[safeAddress];
    }
}

/**
 * @title TimelockControllerWrapper
 * @notice Wrapper around OpenZeppelin TimelockController for easier integration
 *         with Gnosis Safe and protocol admin operations
 */
contract TimelockControllerWrapper is Ownable, AccessControl {
    TimelockController public timelock;

    bytes32 public constant PROPOSER_ROLE = keccak256("PROPOSER_ROLE");
    bytes32 public constant EXECUTOR_ROLE = keccak256("EXECUTOR_ROLE");
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    constructor(
        address initialOwner,
        uint256 minDelay,
        address[] calldata proposers,
        address[] calldata executors,
        address admin
    ) Ownable(initialOwner) {
        _setRoleAdmin(PROPOSER_ROLE, DEFAULT_ADMIN_ROLE);
        _setRoleAdmin(EXECUTOR_ROLE, DEFAULT_ADMIN_ROLE);
        _setRoleAdmin(ADMIN_ROLE, DEFAULT_ADMIN_ROLE);

        timelock = new TimelockController(minDelay, proposers, executors, admin);

        grantRole(DEFAULT_ADMIN_ROLE, initialOwner);
        grantRole(PROPOSER_ROLE, initialOwner);
        grantRole(EXECUTOR_ROLE, initialOwner);
    }

    function propose(
        address[] calldata targets,
        uint256[] calldata values,
        bytes[] calldata calldatas,
        string calldata description
    ) external onlyRole(PROPOSER_ROLE) returns (uint256) {
        return timelock.schedule(targets, values, calldatas, keccak256(bytes(description)));
    }

    function execute(
        address[] calldata targets,
        uint256[] calldata values,
        bytes[] calldata calldatas,
        bytes32 predecessor,
        bytes32 salt
    ) external onlyRole(EXECUTOR_ROLE) {
        timelock.execute(targets, values, calldatas, predecessor, salt);
    }

    function cancel(
        address[] calldata targets,
        uint256[] calldata values,
        bytes[] calldata calldatas,
        bytes32 predecessor,
        bytes32 salt
    ) external onlyRole(PROPOSER_ROLE) {
        timelock.cancel(targets, values, calldatas, predecessor, salt);
    }

    function getMinDelay() external view returns (uint256) {
        return timelock.getMinDelay();
    }

    function getPendingOperations() external view returns (uint256[] memory) {
        // Would need to query timelock for pending operations
        return new uint256[](0);
    }
}

/**
 * @title ProtocolGovernance
 * @notice Main governance contract integrating Gnosis Safe, Timelock, and Protocol
 *         Provides unified interface for protocol governance operations
 */
contract ProtocolGovernance is Ownable, AccessControl, ReentrancyGuard {
    GnosisSafeManager public gnosisSafeManager;
    TimelockControllerWrapper public timelock;

    bytes32 public constant GOVERNANCE_ADMIN_ROLE = keccak256("GOVERNANCE_ADMIN_ROLE");
    bytes32 public constant PROPOSAL_CREATOR_ROLE = keccak256("PROPOSAL_CREATOR_ROLE");
    bytes32 public constant PROPOSAL_EXECUTOR_ROLE = keccak256("PROPOSAL_EXECUTOR_ROLE");

    constructor(
        address initialOwner,
        uint256 timelockDelay
    ) Ownable(initialOwner) {
        _setRoleAdmin(GOVERNANCE_ADMIN_ROLE, DEFAULT_ADMIN_ROLE);
        _setRoleAdmin(PROPOSAL_CREATOR_ROLE, GOVERNANCE_ADMIN_ROLE);
        _setRoleAdmin(PROPOSAL_EXECUTOR_ROLE, GOVERNANCE_ADMIN_ROLE);

        gnosisSafeManager = new GnosisSafeManager(initialOwner);
        timelock = new TimelockControllerWrapper(
            initialOwner,
            timelockDelay,
            [initialOwner],
            [initialOwner],
            initialOwner
        );

        grantRole(GOVERNANCE_ADMIN_ROLE, initialOwner);
        grantRole(PROPOSAL_CREATOR_ROLE, initialOwner);
        grantRole(PROPOSAL_EXECUTOR_ROLE, initialOwner);
    }

    // Gnosis Safe integration
    function registerProtocolSafe(
        address safeAddress,
        string calldata label,
        uint256 threshold,
        address[] calldata owners
    ) external onlyRole(GOVERNANCE_ADMIN_ROLE) {
        gnosisSafeManager.registerSafe(safeAddress, label, threshold, owners);
    }

    function queueSafeTransaction(
        address safeAddress,
        address to,
        uint256 value,
        bytes calldata data
    ) external onlyRole(PROPOSAL_CREATOR_ROLE) returns (uint256) {
        return gnosisSafeManager.queueTransaction(safeAddress, to, value, data);
    }

    function confirmSafeTransaction(bytes32 safeTxHash) external onlyRole(PROPOSAL_EXECUTOR_ROLE) {
        gnosisSafeManager.confirmTransaction(safeTxHash);
    }

    // Timelock operations
    function scheduleProposal(
        address[] calldata targets,
        uint256[] calldata values,
        bytes[] calldata calldatas,
        string calldata description
    ) external onlyRole(PROPOSAL_CREATOR_ROLE) returns (uint256) {
        return timelock.propose(targets, values, calldatas, description);
    }

    function executeProposal(
        address[] calldata targets,
        uint256[] calldata values,
        bytes[] calldata calldatas,
        bytes32 predecessor,
        bytes32 salt
    ) external onlyRole(PROPOSAL_EXECUTOR_ROLE) {
        timelock.execute(targets, values, calldatas, predecessor, salt);
    }

    function cancelProposal(
        address[] calldata targets,
        uint256[] calldata values,
        bytes[] calldata calldatas,
        bytes32 predecessor,
        bytes32 salt
    ) external onlyRole(PROPOSAL_CREATOR_ROLE) {
        timelock.cancel(targets, values, calldatas, predecessor, salt);
    }

    // Emergency functions
    function emergencyPauseAll() external onlyRole(DEFAULT_ADMIN_ROLE) {
        gnosisSafeManager.emergencyPause();
        // Could also pause protocol contracts if needed
    }

    // View functions
    function getSafeConfig(address safeAddress) external view returns (GnosisSafeManager.SafeConfig memory) {
        return gnosisSafeManager.getSafeConfig(safeAddress);
    }

    function getPendingSafeTransactions(address safeAddress) external view returns (bytes32[] memory) {
        return gnosisSafeManager.getPendingTransactions(safeAddress);
    }

    function getTimelockMinDelay() external view returns (uint256) {
        return timelock.getMinDelay();
    }

    // Emergency ownership transfer (with timelock delay)
    function transferOwnershipWithDelay(address newOwner) external onlyRole(GOVERNANCE_ADMIN_ROLE) {
        timelock.transferOwnershipWithDelay(newOwner);
    }
}