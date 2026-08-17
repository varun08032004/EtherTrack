#!/bin/bash
# EtherTrack - Secret Rotation Automation Script
# Usage: ./scripts/rotate-secrets.sh [all|jwt|razorpay|pinata|alchemy|smtp|chain|all]

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
KUBECTL="kubectl"
NAMESPACE="ethertrack"
SECRET_NAME="ethertrack-secrets"
VAULT_ADDR="${VAULT_ADDR:-}"
VAULT_TOKEN="${VAULT_TOKEN:-}"

show_help() {
    cat << EOF
Usage: $0 [secret_type] [options]

Secret Types:
  all           Rotate all secrets
  jwt           Rotate JWT secrets
  razorpay      Rotate Razorpay credentials
  pinata        Rotate Pinata API keys
  alchemy       Rotate Alchemy RPC key
  smtp          Rotate SMTP credentials
  chain         Rotate blockchain signing keys
  erp           Rotate ERP credentials

Options:
  --dry-run     Simulate rotation without applying
  --force       Force rotation even if recently rotated
  --no-restart  Don't restart deployments after rotation

Examples:
  $0 all
  $0 jwt
  $0 razorpay --dry-run
  $0 chain --force

Rotation Schedule (Recommended):
  JWT:           Every 90 days
  Razorpay:      Every 90 days
  Pinata:        Every 180 days
  Alchemy:       Every 365 days
  SMTP:          Every 90 days
  Chain keys:    Every 365 days (or on compromise)
  ERP:           Every 180 days
EOF
}

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."
    
    if ! command -v kubectl &> /dev/null; then
        log_error "kubectl not found"
        exit 1
    fi
    
    if ! kubectl get namespace ethertrack &> /dev/null; then
        log_error "Namespace 'ethertrack' not found"
        exit 1
    fi
    
    if ! kubectl get secret "$SECRET_NAME" -n "$NAMESPACE" &> /dev/null; then
        log_error "Secret '$SECRET_NAME' not found in namespace '$NAMESPACE'"
        exit 1
    fi
    
    log_success "Prerequisites check passed"
}

# Generate secure random string
generate_secret() {
    local length="${1:-32}"
    openssl rand -base64 "$length" | tr -d "=+/" | cut -c1-"$length"
}

# Generate 32-byte hex key
generate_hex_key() {
    local bytes="${1:-32}"
    openssl rand -hex "$bytes"
}

# Generate TOTP encryption key (32 bytes base64)
generate_totp_key() {
    openssl rand -base64 32
}

# Rotate JWT secrets
rotate_jwt() {
    log_info "Rotating JWT secrets..."
    
    local jwt_secret=$(generate_secret 64)
    local jwt_refresh_secret=$(generate_secret 64)
    local totp_key=$(generate_totp_key)
    local cookie_secret=$(generate_secret 64)
    
    if [[ "$DRY_RUN" == "true" ]]; then
        log_warning "DRY RUN: Would rotate JWT secrets"
        return 0
    fi
    
    kubectl patch secret "$SECRET_NAME" -n "$NAMESPACE" -p "{\"data\":{\"jwt-secret\":\"$(echo -n "$jwt_secret" | base64 -w 0)\",\"jwt-refresh-secret\":\"$(echo -n "$jwt_refresh_secret" | base64 -w 0)\",\"totp-encryption-key\":\"$(echo -n "$totp_key" | base64 -w 0)\",\"cookie-secret\":\"$(echo -n "$cookie_secret" | base64 -w 0)\"}}"
    
    log_success "JWT secrets rotated"
    
    if [[ "$NO_RESTART" != "true" ]]; then
        log_info "Restarting deployments to pick up new secrets..."
        kubectl rollout restart deployment/ethertrack-backend -n ethertrack
        kubectl rollout status deployment/ethertrack-backend -n ethertrack --timeout=300s
    fi
}

# Rotate Razorpay credentials
rotate_razorpay() {
    log_info "Rotating Razorpay credentials..."
    log_warning "Razorpay credentials must be rotated in Razorpay Dashboard first!"
    log_info "1. Go to Razorpay Dashboard > Settings > API Keys"
    log_info "2. Generate new key pair"
    log_info "3. Update webhook secret in Razorpay Dashboard > Webhooks"
    log_info "3. Then run this script with the new values"
    
    read -p "Enter new Razorpay Key ID: " key_id
    read -sp "Enter new Razorpay Key Secret: " key_secret
    echo
    read -sp "Enter new Razorpay Webhook Secret: " webhook_secret
    echo
    
    if [[ -z "$key_id" || -z "$key_secret" || -z "$webhook_secret" ]]; then
        log_error "All fields are required"
        return 1
    fi
    
    if [[ "$DRY_RUN" == "true" ]]; then
        log_warning "DRY RUN: Would rotate Razorpay credentials"
        return 0
    fi
    
    kubectl patch secret ethertrack-secrets -n ethertrack -p "{\"data\":{\"razorpay-key-id\":\"$(echo -n "$key_id" | base64 -w 0)\",\"razorpay-key-secret\":\"$(echo -n "$key_secret" | base64 -w 0)\",\"razorpay-webhook-secret\":\"$(echo -n "$webhook_secret" | base64 -w 0)\"}}"
    
    log_success "Razorpay credentials rotated"
    
    if [[ "$NO_RESTART" != "true" ]]; then
        log_info "Restarting backend to pick up new credentials..."
        kubectl rollout restart deployment/ethertrack-backend -n ethertrack
        kubectl rollout status deployment/ethertrack-backend -n ethertrack --timeout=300s
    fi
}

# Rotate Pinata credentials
rotate_pinata() {
    log_info "Rotating Pinata API keys..."
    log_warning "Pinata API keys must be rotated in Pinata Dashboard first!"
    log_info "1. Go to Pinata Dashboard > API Keys"
    log_info "2. Generate new API Key and Secret"
    log_info "3. Then run this script with the new values"
    
    read -p "Enter new Pinata API Key: " api_key
    read -sp "Enter new Pinata Secret Key: " secret_key
    echo
    
    if [[ -z "$api_key" || -z "$secret_key" ]]; then
        log_error "Both fields are required"
        return 1
    fi
    
    if [[ "$DRY_RUN" == "true" ]]; then
        log_warning "DRY RUN: Would rotate Pinata credentials"
        return 0
    fi
    
    kubectl patch secret ethertrack-secrets -n ethertrack -p "{\"data\":{\"pinata-api-key\":\"$(echo -n "$api_key" | base64 -w 0)\",\"pinata-secret-key\":\"$(echo -n "$secret_key" | base64 -w 0)\"}}"
    
    log_success "Pinata credentials rotated"
}

# Rotate Alchemy RPC key
rotate_alchemy() {
    log_info "Rotating Alchemy RPC key..."
    log_warning "Alchemy RPC key must be rotated in Alchemy Dashboard first!"
    log_info "1. Go to Alchemy Dashboard > Apps > View Key"
    log_info "2. Regenerate API key"
    log_info "2. Then run this script with the new value"
    
    read -p "Enter new Alchemy RPC URL: " rpc_url
    
    if [[ -z "$rpc_url" ]]; then
        log_error "Alchemy RPC URL is required"
        return 1
    fi
    
    if [[ "$DRY_RUN" == "true" ]]; then
        log_warning "DRY RUN: Would rotate Alchemy RPC key"
        return 0
    fi
    
    kubectl patch secret ethertrack-secrets -n ethertrack -p "{\"data\":{\"alchemy-rpc\":\"$(echo -n "$rpc_url" | base64 -w 0)\"}}"
    
    log_success "Alchemy RPC key rotated"
    
    if [[ "$NO_RESTART" != "true" ]]; then
        log_info "Restarting blockchain services..."
        kubectl rollout restart deployment/ethertrack-backend -n ethertrack
        kubectl rollout status deployment/ethertrack-backend -n ethertrack --timeout=300s
    fi
}

# Rotate SMTP credentials
rotate_smtp() {
    log_info "Rotating SMTP credentials..."
    
    read -p "Enter SMTP Host: " smtp_host
    read -p "Enter SMTP User: " smtp_user
    read -sp "Enter SMTP Password: " smtp_pass
    echo
    read -p "Enter SMTP From: " smtp_from
    
    if [[ -z "$smtp_host" || -z "$smtp_user" || -z "$smtp_pass" || -z "$smtp_from" ]]; then
        log_error "All fields are required"
        return 1
    fi
    
    if [[ "$DRY_RUN" == "true" ]]; then
        log_warning "DRY RUN: Would rotate SMTP credentials"
        return 0
    fi
    
    kubectl patch secret ethertrack-secrets -n ethertrack -p "{\"data\":{\"smtp-host\":\"$(echo -n "$smtp_host" | base64 -w 0)\",\"smtp-user\":\"$(echo -n "$smtp_user" | base64 -w 0)\",\"smtp-pass\":\"$(echo -n "$smtp_pass" | base64 -w 0)\",\"smtp-from\":\"$(echo -n "$smtp_from" | base64 -w 0)\"}}"
    
    log_success "SMTP credentials rotated"
}

# Rotate blockchain signing keys
rotate_chain() {
    log_info "Rotating blockchain signing keys..."
    log_warning "This will INVALIDATE all pending blockchain transactions!"
    log_warning "Ensure no pending transactions before proceeding."
    
    read -p "Enter new Chain Signer Private Key (64 hex chars): " chain_key
    read -p "Enter new Signer Wallet Address (0x...): " signer_wallet
    read -p "Enter new Polygon RPC URL: " polygon_rpc
    read -p "Enter Company User ID (UUID): " company_user_id
    read -p "Enter Company Fund Account ID: " company_fund_account
    
    if [[ -z "$chain_key" || -z "$signer_wallet" || -z "$polygon_rpc" || -z "$company_user_id" || -z "$company_fund_account" ]]; then
        log_error "All fields are required"
        return 1
    fi
    
    if [[ ! "$chain_key" =~ ^[0-9a-fA-F]{64}$ ]]; then
        log_error "Chain key must be 64 hex characters"
        return 1
    fi
    
    if [[ ! "$signer_wallet" =~ ^0x[0-9a-fA-F]{40}$ ]]; then
        log_error "Signer wallet must be valid Ethereum address"
        return 1
    fi
    
    if [[ "$DRY_RUN" == "true" ]]; then
        log_warning "DRY RUN: Would rotate chain signing keys"
        return 0
    fi
    
    kubectl patch secret ethertrack-secrets -n ethertrack -p "{\"data\":{\"chain-signer-private-key\":\"$(echo -n "$chain_key" | base64 -w 0)\",\"signer-wallet\":\"$(echo -n "$signer_wallet" | base64 -w 0)\",\"polygon-rpc-url\":\"$(echo -n "$polygon_rpc" | base64 -w 0)\",\"company-user-id\":\"$(echo -n "$company_user_id" | base64 -w 0)\",\"company-fund-account-id\":\"$(echo -n "$company_fund_account" | base64 -w 0)\"}}"
    
    log_success "Chain signing keys rotated"
    
    if [[ "$NO_RESTART" != "true" ]]; then
        log_info "Restarting chain logger and fee operations..."
        kubectl rollout restart deployment/ethertrack-backend -n ethertrack
        kubectl rollout status deployment/ethertrack-backend -n ethertrack --timeout=300s
    fi
}

# Rotate ERP credentials
rotate_erp() {
    log_info "Rotating ERP credentials..."
    
    read -sp "Enter new ERP Credentials Key (32 bytes base64): " erp_key
    echo
    read -sp "Enter Corporate Write Token: " corporate_token
    echo
    read -sp "Enter Coupon Write Token: " coupon_token
    echo
    read -sp "Enter Pricing Write Token: " pricing_token
    echo
    
    if [[ -z "$erp_key" || -z "$corporate_token" || -z "$coupon_token" || -z "$pricing_token" ]]; then
        log_error "All fields are required"
        return 1
    fi
    
    if [[ "$DRY_RUN" == "true" ]]; then
        log_warning "DRY RUN: Would rotate ERP credentials"
        return 0
    fi
    
    kubectl patch secret ethertrack-secrets -n ethertrack -p "{\"data\":{\"erp-creds-key\":\"$(echo -n "$erp_key" | base64 -w 0)\",\"platform-sync-corporate-write-token\":\"$(echo -n "$corporate_token" | base64 -w 0)\",\"platform-sync-coupon-write-token\":\"$(echo -n "$coupon_token" | base64 -w 0)\",\"platform-sync-pricing-write-token\":\"$(echo -n "$pricing_token" | base64 -w 0)\"}}"
    
    log_success "ERP credentials rotated"
    
    if [[ "$NO_RESTART" != "true" ]]; then
        log_info "Restarting ERP sync cron..."
        kubectl rollout restart deployment/ethertrack-backend -n ethertrack
        kubectl rollout status deployment/ethertrack-backend -n ethertrack --timeout=300s
    fi
}

# Rotate all secrets
rotate_all() {
    log_info "Rotating ALL secrets..."
    
    if [[ "$DRY_RUN" == "true" ]]; then
        log_warning "DRY RUN: Would rotate all secrets"
        return 0
    fi
    
    # JWT secrets (auto-generated)
    rotate_jwt
    
    # Manual rotation for external services
    log_warning "The following require manual action in provider dashboards:"
    echo "  1. Razorpay - Dashboard > Settings > API Keys"
    echo "  2. Pinata - Dashboard > API Keys"
    echo "  3. Alchemy - Dashboard > Apps > View Key"
    echo "  4. SMTP - Email provider settings"
    echo "  6. Chain keys - Generate new keypair"
    echo "  7. ERP - Provider dashboard"
    echo ""
    read -p "Have you rotated the above in provider dashboards? (y/N): " confirm
    if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
        log_error "Please rotate external secrets first"
        exit 1
    fi
    
    # Prompt for each external secret
    rotate_razorpay
    rotate_pinata
    rotate_alchemy
    rotate_smtp
    rotate_chain
    rotate_erp
    
    log_success "All secrets rotated"
}

# Main
main() {
    local secret_type="${1:-all}"
    DRY_RUN="${DRY_RUN:-false}"
    FORCE="${FORCE:-false}"
    NO_RESTART="${NO_RESTART:-false}"
    
    if [[ "$1" == "-h" || "$1" == "--help" ]]; then
        show_help
        exit 0
    fi
    
    if [[ "$1" == "--dry-run" ]]; then
        DRY_RUN="true"
        secret_type="${2:-all}"
    fi
    
    if [[ "$1" == "--force" ]]; then
        FORCE="true"
        secret_type="${2:-all}"
    fi
    
    if [[ "$1" == "--no-restart" ]]; then
        NO_RESTART="true"
        secret_type="${2:-all}"
    fi
    
    check_prerequisites
    
    case "$secret_type" in
        all)
            rotate_all
            ;;
        jwt)
            rotate_jwt
            ;;
        razorpay)
            rotate_razorpay
            ;;
        pinata)
            rotate_pinata
            ;;
        alchemy)
            rotate_alchemy
            ;;
        smtp)
            rotate_smtp
            ;;
        chain)
            rotate_chain
            ;;
        erp)
            rotate_erp
            ;;
        *)
            log_error "Unknown secret type: $secret_type"
            show_help
            exit 1
            ;;
    esac
    
    log_success "Secret rotation completed for: $secret_type"
    
    if [[ "$NO_RESTART" != "true" ]]; then
        log_info "Waiting for rollouts to complete..."
        sleep 10
        log_success "All deployments restarted"
    fi
}

main "$@"