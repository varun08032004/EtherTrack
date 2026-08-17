// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title CircuitBreaker
 * @notice Emergency circuit breaker system for EtherTrack protocol
 *         Provides multi-level circuit breakers with automatic and manual triggers
 */
contract CircuitBreaker is Ownable, AccessControl, Pausable, ReentrancyGuard {
    // ─────────────────────────────────────────────────────────────
    // Roles
    // ─────────────────────────────────────────────────────────────
    bytes32 public constant CIRCUIT_BREAKER_ADMIN_ROLE = keccak256("CIRCUIT_BREAKER_ADMIN_ROLE");
    bytes32 public constant EMERGENCY_RESPONDER_ROLE = keccak256("EMERGENCY_RESPONDER_ROLE");
    bytes32 public constant MONITORING_ROLE = keccak256("MONITORING_ROLE");

    // ─────────────────────────────────────────────────────────────
    // Circuit Breaker Levels
    // ─────────────────────────────────────────────────────────────

    enum CircuitLevel {
        NORMAL,      // Level 0: Normal operation
        WARNING,     // Level 1: Elevated risk, enhanced monitoring
        DEGRADED,    // Level 2: Reduced functionality, read-only mode
        CRITICAL,    // Level 3: Emergency pause, only withdrawals allowed
        LOCKDOWN     // Level 4: Complete lockdown, no operations
    }

    // ─────────────────────────────────────────────────────────────
    // Circuit Breaker State
    // ─────────────────────────────────────────────────────────────

    struct CircuitBreakerState {
        CircuitLevel level;
        uint256 triggeredAt;
        address triggeredBy;
        string reason;
        bool autoRecoveryEnabled;
        uint256 autoRecoveryAt;
        uint256 triggerCount;
        uint256 lastTriggerAt;
    }

    CircuitLevel public currentLevel;
    CircuitBreakerState public state;

    // Per-contract circuit breakers
    struct ContractCircuitBreaker {
        CircuitLevel level;
        bool enabled;
        uint256 errorRateThreshold;    // Basis points (e.g., 500 = 5%)
        uint256 latencyThreshold;      // Milliseconds
        uint256 errorCount;
        uint256 totalRequests;
        uint256 lastErrorAt;
        uint256 lastResetAt;
    }

    mapping(address => ContractCircuitBreaker) public contractBreakers;
    address[] public monitoredContracts;

    // ─────────────────────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────────────────────

    event CircuitBreakerTriggered(
        CircuitLevel indexed newLevel,
        CircuitLevel indexed oldLevel,
        address indexed triggeredBy,
        string reason
    );

    event CircuitBreakerReset(
        address indexed resetBy,
        string reason
    );

    event ContractBreakerTriggered(
        address indexed contract,
        CircuitLevel indexed newLevel,
        string reason
    );

    event ContractBreakerReset(
        address indexed contract,
        address indexed resetBy
    );

    event AutoRecoveryScheduled(
        uint256 recoveryAt,
        CircuitLevel fromLevel
    );

    event AutoRecoveryExecuted(
        CircuitLevel fromLevel,
        CircuitLevel toLevel
    );

    event EmergencyAction(
        string action,
        address indexed actor,
        string reason
    );

    // ─────────────────────────────────────────────────────────────
    // Modifiers
    // ─────────────────────────────────────────────────────────────

    modifier onlyCircuitAdmin() {
        require(hasRole(CIRCUIT_BREAKER_ADMIN_ROLE, msg.sender), "CircuitBreaker: not admin");
        _;
    }

    modifier onlyEmergencyResponder() {
        require(hasRole(EMERGENCY_RESPONDER_ROLE, msg.sender), "CircuitBreaker: not emergency responder");
        _;
    }

    modifier onlyMonitoring() {
        require(hasRole(MONITORING_ROLE, msg.sender), "CircuitBreaker: not monitoring");
        _;
    }

    // ─────────────────────────────────────────────────────────────
    // Constructor
    // ─────────────────────────────────────────────────────────────

    constructor(address initialOwner) Ownable(initialOwner) {
        _setRoleAdmin(CIRCUIT_BREAKER_ADMIN_ROLE, DEFAULT_ADMIN_ROLE);
        _setRoleAdmin(EMERGENCY_RESPONDER_ROLE, DEFAULT_ADMIN_ROLE);
        _setRoleAdmin(MONITORING_ROLE, DEFAULT_ADMIN_ROLE);

        grantRole(DEFAULT_ADMIN_ROLE, initialOwner);
        grantRole(CIRCUIT_BREAKER_ADMIN_ROLE, initialOwner);
        grantRole(EMERGENCY_RESPONDER_ROLE, initialOwner);
        grantRole(MONITORING_ROLE, initialOwner);

        currentLevel = CircuitLevel.NORMAL;
        state = CircuitBreakerState({
            level: CircuitLevel.NORMAL,
            triggeredAt: 0,
            triggeredBy: address(0),
            reason: "",
            autoRecoveryEnabled: true,
            autoRecoveryAt: 0,
            triggerCount: 0,
            lastTriggerAt: 0
        };
    }

    // ─────────────────────────────────────────────────────────────
    // Global Circuit Breaker Controls
    // ─────────────────────────────────────────────────────────────

    /**
     * @notice Trigger global circuit breaker
     */
    function triggerCircuitBreaker(
        CircuitLevel newLevel,
        string calldata reason
    ) external onlyRole(CIRCUIT_BREAKER_ADMIN_ROLE) {
        require(newLevel > currentLevel, "CircuitBreaker: cannot lower level directly");
        require(newLevel <= CircuitLevel.LOCKDOWN, "CircuitBreaker: invalid level");

        CircuitLevel oldLevel = currentLevel;
        currentLevel = newLevel;

        state.level = newLevel;
        state.triggeredAt = block.timestamp;
        state.triggeredBy = msg.sender;
        state.reason = reason;
        state.triggerCount++;
        state.lastTriggerAt = block.timestamp;

        // Auto-recovery scheduling
        if (newLevel >= CircuitLevel.WARNING && newLevel < CircuitLevel.LOCKDOWN) {
            state.autoRecoveryEnabled = true;
            uint256 delay = _getAutoRecoveryDelay(newLevel);
            state.autoRecoveryAt = block.timestamp + delay;
            emit AutoRecoveryScheduled(state.autoRecoveryAt, newLevel);
        } else {
            state.autoRecoveryEnabled = false;
            state.autoRecoveryAt = 0;
        }

        // Pause protocol if critical or lockdown
        if (newLevel >= CircuitLevel.CRITICAL) {
            _pause();
        }

        emit CircuitBreakerTriggered(newLevel, oldLevel, msg.sender, reason);
    }

    /**
     * @notice Reset global circuit breaker
     */
    function resetCircuitBreaker(string calldata reason) external onlyRole(CIRCUIT_BREAKER_ADMIN_ROLE) {
        CircuitLevel oldLevel = currentLevel;
        currentLevel = CircuitLevel.NORMAL;

        state = CircuitBreakerState({
            level: CircuitLevel.NORMAL,
            triggeredAt: 0,
            triggeredBy: address(0),
            reason: "",
            autoRecoveryEnabled: true,
            autoRecoveryAt: 0,
            triggerCount: 0,
            lastTriggerAt: 0
        });

        _unpause();

        emit CircuitBreakerReset(msg.sender, reason);
    }

    /**
     * @notice Emergency lockdown (highest level)
     */
    function emergencyLockdown(string calldata reason) external onlyRole(EMERGENCY_RESPONDER_ROLE) {
        currentLevel = CircuitLevel.LOCKDOWN;
        state.level = CircuitLevel.LOCKDOWN;
        state.triggeredAt = block.timestamp;
        state.triggeredBy = msg.sender;
        state.reason = reason;
        state.autoRecoveryEnabled = false;
        state.autoRecoveryAt = 0;

        _pause();

        emit CircuitBreakerTriggered(CircuitLevel.LOCKDOWN, currentLevel, msg.sender, reason);
        emit EmergencyAction("LOCKDOWN", msg.sender, reason);
    }

    /**
     * @notice Auto-recovery check (call periodically)
     */
    function checkAutoRecovery() external onlyRole(MONITORING_ROLE) {
        if (!state.autoRecoveryEnabled || state.autoRecoveryAt == 0) return;
        if (block.timestamp < state.autoRecoveryAt) return;

        // Check if conditions allow recovery
        if (_canAutoRecover()) {
            _executeAutoRecovery();
        } else {
            // Extend auto-recovery
            uint256 additionalDelay = _getAutoRecoveryDelay(currentLevel);
            state.autoRecoveryAt = block.timestamp + additionalDelay;
            emit AutoRecoveryScheduled(state.autoRecoveryAt, currentLevel);
        }
    }

    function _canAutoRecover() internal view returns (bool) {
        // Check if error rates have normalized
        // Check if external dependencies are healthy
        // Check if manual override not in place
        return true; // Simplified - would check actual metrics
    }

    function _executeAutoRecovery() internal {
        CircuitLevel oldLevel = currentLevel;
        uint256 newLevelValue = uint256(currentLevel) > 0 ? uint256(currentLevel) - 1 : 0;
        CircuitLevel newLevel = CircuitLevel(newLevelValue);

        currentLevel = newLevel;
        state.level = newLevel;

        if (newLevel < CircuitLevel.CRITICAL) {
            _unpause();
        }

        if (newLevel == CircuitLevel.NORMAL) {
            state.autoRecoveryEnabled = false;
            state.autoRecoveryAt = 0;
        } else {
            // Schedule next recovery step
            uint256 delay = _getAutoRecoveryDelay(newLevel);
            state.autoRecoveryAt = block.timestamp + delay;
            state.autoRecoveryEnabled = true;
            emit AutoRecoveryScheduled(state.autoRecoveryAt, newLevel);
        }

        emit AutoRecoveryExecuted(oldLevel, newLevel);
    }

    function _getAutoRecoveryDelay(CircuitLevel level) internal pure returns (uint256) {
        // Increasing delays for higher levels
        if (level == CircuitLevel.WARNING) return 15 minutes;
        if (level == CircuitLevel.DEGRADED) return 30 minutes;
        if (level == CircuitLevel.CRITICAL) return 1 hour;
        return 2 hours;
    }

    // ─────────────────────────────────────────────────────────────
    // Per-Contract Circuit Breakers
    // ─────────────────────────────────────────────────────────────

    /**
     * @notice Register a contract for circuit breaker monitoring
     */
    function registerContract(
        address contract,
        uint256 errorRateThresholdBps,
        uint256 latencyThresholdMs
    ) external onlyRole(CIRCUIT_BREAKER_ADMIN_ROLE) {
        require(!contractBreakers[contract].enabled, "CircuitBreaker: contract already registered");

        contractBreakers[contract] = ContractCircuitBreaker({
            level: CircuitLevel.NORMAL,
            enabled: true,
            errorRateThreshold: errorRateThresholdBps,
            latencyThreshold: latencyThresholdMs,
            errorCount: 0,
            totalRequests: 0,
            lastErrorAt: 0,
            lastResetAt: block.timestamp
        });

        monitoredContracts.push(contract);
    }

    /**
     * @notice Record a request result (success/error) for a monitored contract
     */
    function recordRequest(
        address contract,
        bool success,
        uint256 latencyMs
    ) external {
        ContractCircuitBreaker storage cb = contractBreakers[contract];
        require(cb.enabled, "CircuitBreaker: contract not monitored");

        cb.totalRequests++;
        
        if (!success) {
            cb.errorCount++;
            cb.lastErrorAt = block.timestamp;
        }

        // Check latency threshold
        if (latencyMs > cb.latencyThreshold && cb.latencyThreshold > 0) {
            // Could increment latency violation counter
        }

        // Check if thresholds exceeded
        if (cb.totalRequests >= 100) { // Minimum sample size
            uint256 errorRateBps = (cb.errorCount * 10000) / cb.totalRequests;
            if (errorRateBps >= cb.errorRateThreshold && cb.errorRateThreshold > 0) {
                _triggerContractBreaker(contract, CircuitLevel.WARNING, 
                    "Error rate threshold exceeded");
            }
        }

        // Check latency
        if (latencyMs > cb.latencyThreshold * 2 && cb.latencyThreshold > 0) {
            _triggerContractBreaker(contract, CircuitLevel.WARNING,
                "Latency threshold significantly exceeded");
        }
    }

    function _triggerContractBreaker(
        address contract,
        CircuitLevel newLevel,
        string memory reason
    ) internal {
        ContractCircuitBreaker storage cb = contractBreakers[contract];
        
        if (newLevel > cb.level) {
            cb.level = newLevel;
            cb.lastErrorAt = block.timestamp;
            emit ContractBreakerTriggered(contract, newLevel, reason);
        }
    }

    /**
     * @notice Reset contract circuit breaker
     */
    function resetContractBreaker(address contract, string calldata reason) external onlyRole(CIRCUIT_BREAKER_ADMIN_ROLE) {
        ContractCircuitBreaker storage cb = contractBreakers[contract];
        require(cb.enabled, "CircuitBreaker: contract not monitored");

        cb.level = CircuitLevel.NORMAL;
        cb.errorCount = 0;
        cb.totalRequests = 0;
        cb.lastResetAt = block.timestamp;

        emit ContractBreakerReset(contract, msg.sender, reason);
    }

    /**
     * @notice Enable/disable contract monitoring
     */
    function setContractMonitoring(address contract, bool enabled) external onlyRole(CIRCUIT_BREAKER_ADMIN_ROLE) {
        contractBreakers[contract].enabled = enabled;
    }

    // ─────────────────────────────────────────────────────────────
    // Integration with Protocol
    // ─────────────────────────────────────────────────────────────

    /**
     * @notice Check if operation should be allowed
     */
    function checkOperationAllowed(
        address contract,
        bytes4 selector
    ) external view returns (bool) {
        // Global check
        if (currentLevel == CircuitLevel.LOCKDOWN) {
            return false;
        }

        if (currentLevel == CircuitLevel.CRITICAL) {
            // Only allow withdrawal/emergency operations
            // This would check the selector against allowed list
            return _isEmergencyOperation(selector);
        }

        // Contract-level check
        ContractCircuitBreaker storage cb = contractBreakers[contract];
        if (cb.enabled && cb.level >= CircuitLevel.DEGRADED) {
            return _isAllowedInDegraded(selector);
        }

        return true;
    }

    function _isEmergencyOperation(bytes4 selector) internal pure returns (bool) {
        // Allow: withdraw, emergencyWithdraw, claimRefund, emergencyExit
        bytes4[] memory emergencySelectors = new bytes4[](4);
        emergencySelectors[0] = bytes4(keccak256("withdraw(uint256)"));
        emergencySelectors[1] = bytes4(keccak256("emergencyWithdraw()"));
        emergencySelectors[2] = bytes4(keccak256("claimRefund(uint256)"));
        emergencySelectors[3] = bytes4(keccak256("emergencyExit()"));

        for (uint256 i = 0; i < emergencySelectors.length; i++) {
            if (selector == emergencySelectors[i]) return true;
        }
        return false;
    }

    function _isAllowedInDegraded(bytes4 selector) internal pure returns (bool) {
        // In degraded mode, allow read operations and withdrawals
        bytes4[] memory allowedSelectors = new bytes4[](6);
        allowedSelectors[0] = bytes4(keccak256("withdraw(uint256)"));
        allowedSelectors[1] = bytes4(keccak256("emergencyWithdraw()"));
        allowedSelectors[2] = bytes4(keccak256("claimRefund(uint256)"));
        allowedSelectors[3] = bytes4(keccak256("balanceOf(address,uint256)"));
        allowedSelectors[4] = bytes4(keccak256("getUserBalance(bytes32,uint256)"));
        allowedSelectors[5] = bytes4(keccak256("getTrade(uint256)"));

        for (uint256 i = 0; i < allowedSelectors.length; i++) {
            if (selector == allowedSelectors[i]) return true;
        }
        return false;
    }

    // ─────────────────────────────────────────────────────────────
    // Monitoring & Status
    // ─────────────────────────────────────────────────────────────

    function getGlobalStatus() external view returns (
        CircuitLevel level,
        uint256 triggeredAt,
        address triggeredBy,
        string memory reason,
        bool autoRecoveryEnabled,
        uint256 autoRecoveryAt,
        uint256 triggerCount
    ) {
        return (
            currentLevel,
            state.triggeredAt,
            state.triggeredBy,
            state.reason,
            state.autoRecoveryEnabled,
            state.autoRecoveryAt,
            state.triggerCount
        );
    }

    function getContractStatus(address contract) external view returns (
        CircuitLevel level,
        bool enabled,
        uint256 errorRateBps,
        uint256 totalRequests,
        uint256 errorCount,
        uint256 lastErrorAt
    ) {
        ContractCircuitBreaker storage cb = contractBreakers[contract];
        uint256 errorRateBps = cb.totalRequests > 0 
            ? (cb.errorCount * 10000) / cb.totalRequests 
            : 0;
        return (cb.level, cb.enabled, errorRateBps, cb.totalRequests, cb.errorCount, cb.lastErrorAt);
    }

    function getAllContractStatuses() external view returns (
        address[] memory contracts,
        CircuitLevel[] memory levels,
        bool[] memory enabled
    ) {
        contracts = monitoredContracts;
        levels = new CircuitLevel[](monitoredContracts.length);
        enabled = new bool[](monitoredContracts.length);

        for (uint256 i = 0; i < monitoredContracts.length; i++) {
            ContractCircuitBreaker storage cb = contractBreakers[monitoredContracts[i]];
            levels[i] = cb.level;
            enabled[i] = cb.enabled;
        }

        return (contracts, levels, enabled);
    }

    // ─────────────────────────────────────────────────────────────
    // Emergency Controls
    // ─────────────────────────────────────────────────────────────

    /**
     * @notice Emergency pause all monitored contracts
     */
    function emergencyPauseAll(string calldata reason) external onlyRole(EMERGENCY_RESPONDER_ROLE) {
        for (uint256 i = 0; i < monitoredContracts.length; i++) {
            address contract = monitoredContracts[i];
            contractBreakers[contract].level = CircuitLevel.CRITICAL;
        }
        
        triggerCircuitBreaker(CircuitLevel.LOCKDOWN, reason);
        emit EmergencyAction("PAUSE_ALL", msg.sender, reason);
    }

    /**
     * @notice Emergency resume all contracts
     */
    function emergencyResumeAll(string calldata reason) external onlyRole(EMERGENCY_RESPONDER_ROLE) {
        for (uint256 i = 0; i < monitoredContracts.length; i++) {
            address contract = monitoredContracts[i];
            contractBreakers[contract].level = CircuitLevel.NORMAL;
            contractBreakers[contract].errorCount = 0;
            contractBreakers[contract].totalRequests = 0;
            contractBreakers[contract].lastResetAt = block.timestamp;
        }
        
        resetCircuitBreaker(reason);
        emit EmergencyAction("RESUME_ALL", msg.sender, reason);
    }

    /**
     * @notice Force contract upgrade (bypass circuit breaker)
     */
    function forceUpgrade(
        address contract,
        address newImplementation,
        string calldata reason
    ) external onlyRole(EMERGENCY_RESPONDER_ROLE) {
        // This would call the UUPS upgrade function on the contract
        // Implementation depends on the specific proxy pattern used
        emit EmergencyAction("FORCE_UPGRADE", msg.sender, reason);
    }

    // ─────────────────────────────────────────────────────────────
    // View Functions
    // ─────────────────────────────────────────────────────────────

    function getCurrentLevel() external view returns (CircuitLevel) {
        return currentLevel;
    }

    function getState() external view returns (CircuitBreakerState memory) {
        return state;
    }

    function isPaused() external view returns (bool) {
        return paused();
    }

    function isOperationAllowed(address contract, bytes4 selector) external view returns (bool) {
        return checkOperationAllowed(contract, selector);
    }
}