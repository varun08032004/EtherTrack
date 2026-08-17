#!/usr/bin/env bash
# EtherTrack - Contract Verification Helper
# Generates verification commands and handles deployment outputs

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTRACTS_DIR="$(dirname "$SCRIPT_DIR")"
ROOT_DIR="$(dirname "$CONTRACTS_DIR")"

# Extract constructor arguments from deployment script or Ignition module
extract_constructor_args() {
    local contract_name="$1"
    local deployment_file="$CONTRACTS_DIR/ignition/modules/${contract_name}.ts"
    
    if [[ ! -f "$deployment_file" ]]; then
        echo ""
        return
    fi
    
    # This would parse TypeScript ignition module to extract constructor args
    # For now, return empty - would need TypeScript parser
    echo ""
}

# Generate verification command
generate_verify_command() {
    local contract_name="$1"
    local address="$2"
    local network="$3"
    local args="${4:-}"
    
    echo "npx hardhat verify --network $network $address $args"
}

# Generate all verification commands
generate_all_commands() {
    local network="${1:-sepolia}"
    local output_file="${2:-verify-commands.sh}"
    
    cat > "$output_file" << 'EOF'
#!/usr/bin/env bash
# Auto-generated verification commands
# Run with: bash verify-commands.sh

set -euo pipefail

NETWORK="${1:-sepolia}"

echo "Verifying contracts on $NETWORK..."

EOF

    # This would be populated with actual contract addresses and args
    cat >> "$output_file" << 'EOF'

# Example verification commands (replace with actual addresses):
# npx hardhat verify --network $NETWORK 0x1234... "constructor_arg1" "constructor_arg2"

echo "Verification commands generated. Replace placeholder addresses and run."
EOF

    chmod +x "$output_file"
    echo "Generated $output_file"
}

# Verify using Hardhat's built-in verify task
verify_with_hardhat() {
    local contract_name="$1"
    local address="$2"
    local network="${3:-sepolia}"
    local args="${4:-}"
    
    cd "$CONTRACTS_DIR"
    
    if [[ -n "$args" ]]; then
        npx hardhat verify --network "$network" "$address" $args
    else
        npx hardhat verify --network "$network" "$address"
    fi
}

# Verify using Sourcify (alternative to Etherscan)
verify_with_sourcify() {
    local contract_name="$1"
    local address="$2"
    local network="${3:-sepolia}"
    
    cd "$CONTRACTS_DIR"
    
    # Sourcify verification
    npx hardhat sourcify --network "$network" "$address"
}

# Check verification status on Etherscan/Polygonscan
check_verification_status() {
    local address="$1"
    local network="${2:-sepolia}"
    
    local api_url=""
    local api_key=""
    
    case "$network" in
        mainnet|sepolia)
            api_url="https://api${network:+-}${network}.etherscan.io/api"
            api_key="${ETHERSCAN_API_KEY:-}"
            ;;
        polygon|amoy)
            api_url="https://api${network:+-}${network}.polygonscan.com/api"
            api_key="${POLYGONSCAN_API_KEY:-}"
            ;;
        *)
            echo "Unsupported network: $network"
            return 1
            ;;
    esac
    
    if [[ -z "$api_key" ]]; then
        echo "API key not set for $network"
        return 1
    fi
    
    # Query contract source code
    response=$(curl -s "${api_url}?module=contract&action=getsourcecode&address=${address}&apikey=${api_key}")
    
    if echo "$response" | grep -q '"status":"1"'; then
        if echo "$response" | grep -q '"SourceCode":""'; then
            echo "NOT_VERIFIED"
        else
            echo "VERIFIED"
        fi
    else
        echo "ERROR"
    fi
}

# Batch verify multiple contracts
batch_verify() {
    local network="${1:-sepolia}"
    local contracts_file="${2:-deployed-contracts.json}"
    
    if [[ ! -f "$contracts_file" ]]; then
        echo "Contracts file not found: $contracts_file"
        return 1
    fi
    
    echo "Batch verification not fully implemented - use verify-contracts.sh instead"
}

# Main
main() {
    local command="${1:-help}"
    
    case "$command" in
        verify)
            verify_with_hardhat "$2" "$3" "$4" "$5"
            ;;
        sourcify)
            verify_with_sourcify "$2" "$3"
            ;;
        status)
            check_verification_status "$2" "$3"
            ;;
        generate)
            generate_all_commands "$2" "$3"
            ;;
        batch)
            batch_verify "$2" "$3"
            ;;
        *)
            echo "Usage: $0 {verify|sourcify|status|generate|batch} [args...]"
            echo ""
            echo "Commands:"
            echo "  verify <contract> <address> [network] [args...]  - Verify single contract"
            echo "  sourcify <contract> <address> [network]         - Verify via Sourcify"
            echo "  status <address> [network]                       - Check verification status"
            echo "  generate [network] [output_file]                 - Generate verification commands"
            echo "  batch [network] [contracts_file]                 - Batch verify contracts"
            exit 1
            ;;
    esac
}

main "$@"