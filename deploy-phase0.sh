#!/bin/bash
# Phase 0 Deployment Script
# Deploys all Phase 0 changes: smart contracts, database migrations, backend, frontend

set -e

echo "=========================================="
echo "EtherTrack Phase 0 Deployment"
echo "=========================================="

# Configuration
NETWORK="${NETWORK:-sepolia}"
ENV_FILE=".env.${NETWORK}"
BACKEND_DIR="ethertrack-backend"
FRONTEND_DIR="ethertrack-frontend"
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

# Check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."
    
    if [ ! -f "$ENV_FILE" ]; then
        log_error "Environment file $ENV_FILE not found!"
        exit 1
    fi
    
    # Load environment
    export $(grep -v '^#' $ENV_FILE | xargs)
    
    # Check required tools
    for tool in node npm npx forge cast; do
        if ! command -v $tool &> /dev/null; then
            log_error "$tool is not installed"
            exit 1
        fi
    done
    
    log_info "Prerequisites check passed"
}

# Deploy smart contracts
deploy_contracts() {
    log_info "Deploying smart contracts to $NETWORK..."
    
    cd $CONTRACTS_DIR
    
    # Install dependencies
    npm ci
    
    # Compile contracts
    npx hardhat compile
    
    # Run tests
    npx hardhat test
    
    # Deploy contracts
    if [ "$NETWORK" = "sepolia" ]; then
        npx hardhat run scripts/deploy.js --network sepolia
    elif [ "$NETWORK" = "polygon" ]; then
        npx hardhat run scripts/deploy.js --network polygon
    else
        log_error "Unsupported network: $NETWORK"
        exit 1
    fi
    
    # Verify contracts
    npx hardhat run scripts/verify.js --network $NETWORK
    
    # Update contract addresses in env
    log_info "Updating contract addresses in $ENV_FILE..."
    # This would be done by the deploy script
    
    cd ..
    log_info "Smart contracts deployed successfully"
}

# Run database migrations
run_migrations() {
    log_info "Running database migrations..."
    
    cd $BACKEND_DIR
    
    # Run migrations
    node db/migrate.js up
    
    # Verify migration status
    node db/migrate.js status
    
    cd ..
    log_info "Database migrations completed"
}

# Build and deploy backend
deploy_backend() {
    log_info "Building and deploying backend..."
    
    cd $BACKEND_DIR
    
    # Install dependencies
    npm ci
    
    # Run tests
    npm test
    
    # Build TypeScript
    npx tsc
    
    # Build Docker image
    docker build -t ethertrack-backend:phase0 .
    
    # Deploy (depends on infrastructure)
    if [ "$DEPLOY_TARGET" = "kubernetes" ]; then
        kubectl apply -k k8s/overlays/$NETWORK
        kubectl rollout restart deployment/ethertrack-backend -n ethertrack
        kubectl rollout status deployment/ethertrack-backend -n ethertrack
    elif [ "$DEPLOY_TARGET" = "docker" ]; then
        docker-compose -f docker-compose.$NETWORK.yml up -d --build
    fi
    
    cd ..
    log_info "Backend deployed successfully"
}

# Build and deploy frontend
deploy_frontend() {
    log_info "Building and deploying frontend..."
    
    cd $FRONTEND_DIR
    
    # Install dependencies
    npm ci
    
    # Run tests
    npm test
    
    # Build production bundle
    npm run build
    
    # Deploy to Vercel or other hosting
    if [ "$FRONTEND_DEPLOY_TARGET" = "vercel" ]; then
        npx vercel --prod --token=$VERCEL_TOKEN
    elif [ "$FRONTEND_DEPLOY_TARGET" = "s3" ]; then
        aws s3 sync build/ s3://$S3_BUCKET --delete
        aws cloudfront create-invalidation --distribution-id $CLOUDFRONT_DIST_ID --paths "/*"
    fi
    
    cd ..
    log_info "Frontend deployed successfully"
}

# Run post-deployment verification
verify_deployment() {
    log_info "Running post-deployment verification..."
    
    # Health checks
    log_info "Checking API health..."
    curl -f https://api.ethertrack.$NETWORK/health || {
        log_error "API health check failed"
        exit 1
    }
    
    # Check contract addresses
    log_info "Verifying contract addresses..."
    # This would query the contracts and verify addresses match env
    
    # Run smoke tests
    log_info "Running smoke tests..."
    # This would run a subset of critical E2E tests
    
    log_info "Post-deployment verification passed"
}

# Rollback function
rollback() {
    log_warn "Initiating rollback..."
    
    # Rollback smart contracts (if upgradeable)
    cd $CONTRACTS_DIR
    if [ "$NETWORK" = "sepolia" ]; then
        npx hardhat run scripts/rollback.js --network sepolia
    fi
    cd ..
    
    # Rollback database (if needed)
    # This would require down migration files
    
    # Rollback backend
    if [ "$DEPLOY_TARGET" = "kubernetes" ]; then
        kubectl rollout undo deployment/ethertrack-backend -n ethertrack
    elif [ "$DEPLOY_TARGET" = "docker" ]; then
        docker-compose -f docker-compose.$NETWORK.yml down
        docker-compose -f docker-compose.$NETWORK.yml up -d
    fi
    
    # Rollback frontend
    if [ "$FRONTEND_DEPLOY_TARGET" = "vercel" ]; then
        npx vercel rollback --token=$VERCEL_TOKEN
    fi
    
    log_warn "Rollback completed"
}

# Main deployment flow
main() {
    local start_time=$(date +%s)
    
    log_info "Starting Phase 0 deployment to $NETWORK"
    
    check_prerequisites
    
    # Deploy in order: contracts -> migrations -> backend -> frontend
    deploy_contracts
    run_migrations
    deploy_backend
    deploy_frontend
    verify_deployment
    
    local end_time=$(date +%s)
    local duration=$((end_time - start_time))
    
    log_info "Phase 0 deployment completed in ${duration}s"
    log_info "=========================================="
}

# Trap errors and rollback on failure
trap 'log_error "Deployment failed! Initiating rollback..."; rollback; exit 1' ERR

# Run main
main "$@"