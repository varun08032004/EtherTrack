// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "./KYCRegistry.sol";

/**
 * @title EmissionRegistry
 * @author EtherTrack
 * @notice Records company/user emission data on-chain.
 *         Immutable audit trail for carbon accounting.
 *
 * BLOCKCHAIN MIGRATION: Replaces EmissionTracking.js local state
 */
contract EmissionRegistry is Ownable, Pausable {

    KYCRegistry public kycRegistry;

    // ── Emission Categories ───────────────────────────────
    enum Scope { SCOPE_1, SCOPE_2, SCOPE_3 } // GHG Protocol scopes

    // ── Structs ───────────────────────────────────────────
    struct EmissionLog {
        address  wallet;
        uint256  loggedAt;       // Unix timestamp
        uint256  period;         // Unix timestamp of emission period (month/year)
        uint256  energyKWh;      // Monthly energy consumption (kWh)
        uint256  transportKm;    // Monthly transport (km)
        uint256  wasteKg;        // Monthly waste (kg)
        uint256  totalCO2e;      // Total CO2 equivalent (in kg, multiply by 1e3 for precision)
        uint256  creditsNeeded;  // Tonnes CO2 to offset
        Scope    scope;
        string   notes;          // Optional additional info
    }

    struct OffsetRecord {
        address  wallet;
        uint256  tokenId;        // CarbonCreditToken tokenId used for offset
        uint256  amount;         // Credits used
        uint256  co2Offset;      // kg CO2 offset
        uint256  offsetAt;
        uint256  emissionLogId;  // Reference to the emission log
    }

    // ── State ─────────────────────────────────────────────
    EmissionLog[]  private _emissionLogs;
    OffsetRecord[] private _offsetRecords;

    // wallet => emission log IDs
    mapping(address => uint256[]) public userEmissionLogs;
    // wallet => total CO2e emitted (kg)
    mapping(address => uint256)   public totalEmitted;
    // wallet => total CO2 offset (kg)
    mapping(address => uint256)   public totalOffset;

    // Emission factors (India, multiplied by 1e6 for precision)
    // Source: CEA 2023, MoRTH, CPCB
    uint256 public constant ENERGY_FACTOR    = 820000; // 0.82 kg CO2/kWh × 1e6
    uint256 public constant TRANSPORT_FACTOR = 210000; // 0.21 kg CO2/km  × 1e6
    uint256 public constant WASTE_FACTOR     = 50000;  // 0.05 kg CO2/kg  × 1e6
    uint256 public constant PRECISION        = 1e6;

    // ── Events ────────────────────────────────────────────
    event EmissionLogged(
        uint256 indexed logId,
        address indexed wallet,
        uint256 totalCO2e,
        uint256 creditsNeeded,
        uint256 period
    );
    event EmissionOffset(
        uint256 indexed logId,
        address indexed wallet,
        uint256 tokenId,
        uint256 amount,
        uint256 co2Offset
    );

    // ── Modifiers ─────────────────────────────────────────
    modifier onlyKYCVerified() {
        require(kycRegistry.isKYCVerified(msg.sender), "Wallet not KYC verified");
        _;
    }

    // ── Constructor ───────────────────────────────────────
    constructor(address initialOwner, address kycRegistryAddress) Ownable(initialOwner) {
        kycRegistry = KYCRegistry(kycRegistryAddress);
    }

    // ── Core Functions ────────────────────────────────────

    /**
     * @notice Log monthly emission data on-chain
     * @param period      Unix timestamp of the emission month
     * @param energyKWh   Energy consumption in kWh
     * @param transportKm Transport distance in km
     * @param wasteKg     Waste generated in kg
     * @param scope       GHG Protocol scope
     * @param notes       Optional notes
     *
     * BLOCKCHAIN MIGRATION: Replaces EmissionTracking.js calcEmissions()
     */
    function logEmission(
        uint256 period,
        uint256 energyKWh,
        uint256 transportKm,
        uint256 wasteKg,
        Scope   scope,
        string  calldata notes
    ) external onlyKYCVerified whenNotPaused returns (uint256 logId) {
        require(period <= block.timestamp, "Period cannot be in future");

        // Calculate total CO2e (in kg, using precision factor)
        uint256 energyCO2   = (energyKWh   * ENERGY_FACTOR)    / PRECISION;
        uint256 transportCO2= (transportKm * TRANSPORT_FACTOR)  / PRECISION;
        uint256 wasteCO2    = (wasteKg     * WASTE_FACTOR)      / PRECISION;
        uint256 totalCO2e   = energyCO2 + transportCO2 + wasteCO2;

        // Credits needed = ceil(totalCO2e / 1000) — 1 credit = 1 tonne = 1000 kg
        uint256 creditsNeeded = (totalCO2e + 999) / 1000;

        logId = _emissionLogs.length;

        _emissionLogs.push(EmissionLog({
            wallet:       msg.sender,
            loggedAt:     block.timestamp,
            period:       period,
            energyKWh:    energyKWh,
            transportKm:  transportKm,
            wasteKg:      wasteKg,
            totalCO2e:    totalCO2e,
            creditsNeeded:creditsNeeded,
            scope:        scope,
            notes:        notes
        }));

        userEmissionLogs[msg.sender].push(logId);
        totalEmitted[msg.sender] += totalCO2e;

        emit EmissionLogged(logId, msg.sender, totalCO2e, creditsNeeded, period);
        return logId;
    }

    /**
     * @notice Record that a user offset their emissions using credits
     *         Called by Marketplace after retire transaction
     */
    function recordOffset(
        address wallet,
        uint256 tokenId,
        uint256 amount,
        uint256 co2Offset,
        uint256 emissionLogId
    ) external whenNotPaused {
        // Only callable by authorized contracts (Marketplace) or owner
        require(msg.sender == owner(), "Not authorized");

        uint256 recordId = _offsetRecords.length;

        _offsetRecords.push(OffsetRecord({
            wallet:        wallet,
            tokenId:       tokenId,
            amount:        amount,
            co2Offset:     co2Offset,
            offsetAt:      block.timestamp,
            emissionLogId: emissionLogId
        }));

        totalOffset[wallet] += co2Offset;

        emit EmissionOffset(recordId, wallet, tokenId, amount, co2Offset);
    }

    // ── View Functions ────────────────────────────────────

    function getEmissionLog(uint256 logId) external view returns (EmissionLog memory) {
        return _emissionLogs[logId];
    }

    function getUserEmissionLogs(address wallet) external view returns (uint256[] memory) {
        return userEmissionLogs[wallet];
    }

    function getTotalEmitted(address wallet) external view returns (uint256) {
        return totalEmitted[wallet];
    }

    function getNetEmissions(address wallet) external view returns (int256) {
        return int256(totalEmitted[wallet]) - int256(totalOffset[wallet]);
    }

    function calculateEmissions(
        uint256 energyKWh,
        uint256 transportKm,
        uint256 wasteKg
    ) external pure returns (uint256 totalCO2e, uint256 creditsNeeded) {
        uint256 energyCO2    = (energyKWh   * ENERGY_FACTOR)   / PRECISION;
        uint256 transportCO2 = (transportKm * TRANSPORT_FACTOR) / PRECISION;
        uint256 wasteCO2     = (wasteKg     * WASTE_FACTOR)     / PRECISION;
        totalCO2e     = energyCO2 + transportCO2 + wasteCO2;
        creditsNeeded = (totalCO2e + 999) / 1000;
    }

    function totalEmissionLogs() external view returns (uint256) {
        return _emissionLogs.length;
    }

    // ── Admin ─────────────────────────────────────────────
    function pause()   external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }
}
