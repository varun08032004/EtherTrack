#!/bin/bash
# Phase 0 Rollback Script
# Rolls back all Phase 0 changes: smart contracts, database migrations, backend, frontend

set -e

echo "=========================================="
echo "EtherTrack Phase 0 Rollback"
echo "=========================================="

# Configuration
NETWORK="${NETWORK:-sepolia}"
ENV_FILE=".env.${NETWORK}"
BACKEND_DIR="ethertrack-backend"
CONTRACTS_DIR="ethertrack-contracts"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Load environment
if [ ! -f "$ENV_FILE" ]; then
    log_error "Environment file $ENV_FILE not found!"
    exit 1
fi

export $(grep -v '^#' $ENV_FILE | xargs)

# Rollback smart contracts
rollback_contracts() {
    log_info "Rolling back smart contracts..."
    
    cd $CONTRACTS_DIR
    
    if [ "$NETWORK" = "sepolia" ]; then
        npx hardhat run scripts/rollback.js --network sepolia
    elif [ "$NETWORK" = "polygon" ]; then
        npx hardhat run scripts/rollback.js --network polygon
    else
        log_error "Unsupported network: $NETWORK"
        exit 1
    fi
    
    cd ..
    log_info "Smart contracts rolled back"
}

# Rollback database migrations (requires down migration files)
rollback_database() {
    log_warn "Database rollback requires manual intervention"
    log_warn "Down migration files needed for:"
    echo "  - 012_carbon_state_transition_log"
    echo "  - 011_carbon_double_entry_ledger"
    echo "  - 010_financial_double_entry_ledger"
    echo "  - 009_add_reserved_balance"
    log_warn "Create .down.sql files for each migration before running rollback"
    
    # If down files exist:
    # cd $BACKEND_DIR
    # node db/migrate.js down 008
    # cd ..
}

# Rollback backend
rollback_backend() {
    log_info "Rolling back backend..."
    
    if [ "$DEPLOY_TARGET" = "kubernetes" ]; then
        kubectl rollout undo deployment/ethertrack-backend -n ethertrack
        kubectl rollout status deployment/ethertrack-backend -n ethertrack
    elif [ "$DEPLOY_TARGET" = "docker" ]; then
        docker-compose -f docker-compose.$NETWORK.yml down
        docker-compose -f docker-compose.$NETWORK.yml up -d
    fi
    
    log_info "Backend rolled back"
}

# Rollback frontend
rollback_frontend() {
    log_info "Rolling back frontend..."
    
    if [ "$FRONTEND_DEPLOY_TARGET" = "vercel" ]; then
        npx vercel rollback --token=$VERCEL_TOKEN
    elif [ "$FRONTEND_DEPLOY_TARGET" = "s3" ]; then
        # Would need to restore previous version from S3 versioning
        log_warn "S3 rollback requires manual version restoration"
    fi
    
    log_info "Frontend rolled back"
}

# Main rollback flow
main() {
    log_warn "Starting Phase 0 rollback for $NETWORK"
    
    # Order: frontend -> backend -> database -> contracts
    rollback_frontend
    rollback_backend
    rollback_database
    rollback_contracts
    
    log_info "Phase 0 rollback completed"
}

# Trap errors
trap 'log_error "Rollback failed at step: $1"; exit 1' ERR

main "$@"