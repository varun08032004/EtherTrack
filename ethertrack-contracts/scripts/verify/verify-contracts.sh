#!/usr/bin/env bash
# EtherTrack - Contract Verification Script
# Usage: ./scripts/verify/verify-contracts.sh [network] [--force]

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Configuration
NETWORK="${1:-sepolia}"
FORCE="${2:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTRACTS_DIR="$(dirname "$SCRIPT_DIR")"
ROOT_DIR="$(dirname "$CONTRACTS_DIR")"

# Contract addresses and constructor args mapping
# These would be populated from deployment outputs
declare -A CONTRACT_ADDRESSES=(
    ["CarbonCreditToken"]=""
    ["Marketplace"]=""
    ["KYCRegistry"]=""
    ["Treasury"]=""
    ["EmissionRegistry"]=""
    ["AMMPool"]=""
    ["CreditLedger"]=""
    ["AuditTrail"]=""
    ["MarketplaceUpgradeable"]=""
    ["GovernanceToken"]=""
    ["GnosisSafeManager"]=""
    ["TimelockControllerWrapper"]=""
    ["ProtocolGovernance"]=""
)

declare -A CONSTRUCTOR_ARGS=(
    ["CarbonCreditToken"]=""
    ["Marketplace"]=""
    ["KYCRegistry"]=""
    ["Treasury"]=""
    ["EmissionRegistry"]=""
    ["AMMPool"]=""
    ["CreditLedger"]=""
    ["AuditTrail"]=""
    ["MarketplaceUpgradeable"]=""
    ["GovernanceToken"]=""
    ["GnosisSafeManager"]=""
    ["TimelockControllerWrapper"]=""
    ["ProtocolGovernance"]=""
)

show_help() {
    cat << EOF
Usage: $0 [network] [options]

Arguments:
  network         Target network (sepolia, polygon, mainnet, localhost)
                  Default: sepolia

Options:
  --force         Force re-verification even if already verified
  --contract      Verify specific contract only
  --list          List all contracts to be verified
  --dry-run       Show what would be verified without executing
  -h, --help      Show this help

Examples:
  $0 sepolia
  $0 polygon --force
  $0 sepolia --contract Marketplace
  $0 mainnet --dry-run

Environment Variables Required:
  ETHERSCAN_API_KEY     - Etherscan API key for verification
  POLYGONSCAN_API_KEY   - Polygonscan API key for verification
  ALCHEMY_RPC_URL       - RPC URL for the network
  PRIVATE_KEY           - Private key for deployment account
EOF
}

# Load deployment addresses from file
load_deployment_addresses() {
    local deployment_file="$CONTRACTS_DIR/deployments/${NETWORK}.json"
    
    if [[ -f "$deployment_file" ]]; then
        log_info "Loading deployment addresses from $deployment_file"
        
        # Parse JSON deployment file
        # Expected format:
        # {
        #   "CarbonCreditToken": {"address": "0x...", "args": ["arg1", "arg2"]},
        #   "Marketplace": {"address": "0x...", "args": ["arg1", "arg2"]}
        # }
        
        # This would be implemented with jq in a real scenario
        log_warning "Deployment file parsing not fully implemented - using environment variables"
    else
        log_warning "No deployment file found at $deployment_file"
        log_info "Using environment variables for contract addresses"
    fi
}

# Load addresses from environment variables
load_env_addresses() {
    log_info "Loading contract addresses from environment variables"
    
    # Map environment variables to contract addresses
    # Format: CONTRACT_NAME_ADDRESS=0x...
    for contract in "${!CONTRACT_ADDRESSES[@]}"; do
        env_var="${contract}_ADDRESS"
        if [[ -n "${!env_var:-}" ]]; then
            CONTRACT_ADDRESSES["$contract"]="${!env_var}"
            log_info "Loaded $contract address: ${CONTRACT_ADDRESSES[$contract]}"
        fi
    done
}

# Load constructor arguments from environment
load_constructor_args() {
    log_info "Loading constructor arguments from environment variables"
    
    for contract in "${!CONSTRUCTOR_ARGS[@]}"; do
        env_var="${contract}_ARGS"
        if [[ -n "${!env_var:-}" ]]; then
            CONSTRUCTOR_ARGS["$contract"]="${!env_var}"
            log_info "Loaded $contract args: ${CONSTRUCTOR_ARGS[$contract]}"
        fi
    done
}

# Verify a single contract
verify_contract() {
    local contract_name="$1"
    local address="${CONTRACT_ADDRESSES[$contract_name]}"
    local args="${CONSTRUCTOR_ARGS[$contract_name]}"
    
    if [[ -z "$address" ]]; then
        log_warning "No address for $contract_name, skipping"
        return 1
    fi
    
    log_info "Verifying $contract_name at $address on $NETWORK"
    
    # Check if already verified
    if [[ "$FORCE" != "--force" ]] && [[ "$FORCE" != "-f" ]]; then
        if check_verified "$address"; then
            log_success "$contract_name already verified at $address"
            return 0
        fi
    fi
    
    # Determine API key and explorer URL based on network
    local api_key=""
    local explorer_url=""
    
    case "$NETWORK" in
        mainnet|ethereum)
            api_key="${ETHERSCAN_API_KEY:-}"
            explorer_url="https://api.etherscan.io/api"
            ;;
        sepolia)
            api_key="${ETHERSCAN_API_KEY:-}"
            explorer_url="https://api-sepolia.etherscan.io/api"
            ;;
        polygon|matic)
            api_key="${POLYGONSCAN_API_KEY:-}"
            explorer_url="https://api.polygonscan.com/api"
            ;;
        amoy)
            api_key="${POLYGONSCAN_API_KEY:-}"
            explorer_url="https://api-amoy.polygonscan.com/api"
            ;;
        localhost|hardhat)
            log_warning "Skipping verification for local network"
            return 0
            ;;
        *)
            log_error "Unsupported network: $NETWORK"
            return 1
            ;;
    esac
    
    if [[ -z "$api_key" ]]; then
        log_error "API key not set for $NETWORK (need ETHERSCAN_API_KEY or POLYGONSCAN_API_KEY)"
        return 1
    fi
    
    # Build constructor arguments
    local constructor_args=""
    if [[ -n "$args" ]]; then
        constructor_args="--constructor-args $args"
    fi
    
    # Run verification
    log_info "Submitting verification for $contract_name..."
    
    if npx hardhat verify --network "$NETWORK" "$address" $constructor_args; then
        log_success "$contract_name verified successfully at $address"
        return 0
    else
        log_error "Verification failed for $contract_name"
        return 1
    fi
}

# Check if contract is already verified
check_verified() {
    local address="$1"
    # This would query the explorer API
    # For now, return false to force verification
    return 1
}

# Verify all contracts
verify_all() {
    log_info "Starting verification of all contracts on $NETWORK"
    
    local failed=0
    local success=0
    local skipped=0
    
    for contract in "${!CONTRACT_ADDRESSES[@]}"; do
        if verify_contract "$contract"; then
            ((success++))
        else
            ((failed++))
        fi
    done
    
    log_info "Verification complete: $success succeeded, $failed failed, $skipped skipped"
    
    if [[ $failed -gt 0 ]]; then
        return 1
    fi
    return 0
}

# Main function
main() {
    # Parse arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            --force|-f)
                FORCE="--force"
                shift
                ;;
            --contract)
                SINGLE_CONTRACT="$2"
                shift 2
                ;;
            --list)
                LIST_ONLY=true
                shift
                ;;
            --dry-run)
                DRY_RUN=true
                shift
                ;;
            -h|--help)
                show_help
                exit 0
                ;;
            *)
                if [[ -z "${NETWORK_SET:-}" ]]; then
                    NETWORK="$1"
                    NETWORK_SET=true
                else
                    log_error "Unknown option: $1"
                    show_help
                    exit 1
                fi
                shift
                ;;
        esac
    done
    
    # Default network
    NETWORK="${NETWORK:-sepolia}"
    
    # Validate network
    case "$NETWORK" in
        mainnet|sepolia|polygon|matic|amoy|localhost|hardhat)
            ;;
        *)
            log_error "Unsupported network: $NETWORK"
            show_help
            exit 1
            ;;
    esac
    
    log_info "Starting contract verification for network: $NETWORK"
    
    # Check prerequisites
    if ! command -v npx &> /dev/null; then
        log_error "npx not found. Please install Node.js"
        exit 1
    fi
    
    if [[ ! -f "$CONTRACTS_DIR/hardhat.config.js" ]] && [[ ! -f "$CONTRACTS_DIR/hardhat.config.ts" ]]; then
        log_error "Hardhat config not found in $CONTRACTS_DIR"
        exit 1
    fi
    
    # Load addresses and args
    load_deployment_addresses
    load_env_addresses
    load_constructor_args
    
    # List contracts if requested
    if [[ "${LIST_ONLY:-false}" == "true" ]]; then
        log_info "Contracts to be verified on $NETWORK:"
        for contract in "${!CONTRACT_ADDRESSES[@]}"; do
            local addr="${CONTRACT_ADDRESSES[$contract]:-NOT SET}"
            local args="${CONSTRUCTOR_ARGS[$contract]:-NONE}"
            echo "  $contract: $addr (args: $args)"
        done
        exit 0
    fi
    
    # Dry run
    if [[ "${DRY_RUN:-false}" == "true" ]]; then
        log_info "DRY RUN: Would verify contracts but not submitting"
        exit 0
    fi
    
    # Verify contracts
    if [[ -n "${SINGLE_CONTRACT:-}" ]]; then
        if [[ -n "${CONTRACT_ADDRESSES[$SINGLE_CONTRACT]:-}" ]]; then
            verify_contract "$SINGLE_CONTRACT"
        else
            log_error "Contract $SINGLE_CONTRACT not found or no address"
            exit 1
        fi
    else
        verify_all
    fi
}

main "$@"