#!/bin/bash
# EtherTrack - Blue-Green Deployment Script
# Usage: ./scripts/blue-green-deploy.sh [blue|green] [version]

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
NAMESPACE="ethertrack"
KUBECTL="kubectl"
HELM="helm"

# Default values
TARGET_COLOR="${1:-blue}"
VERSION="${2:-latest}"
DRY_RUN="${DRY_RUN:-false}"
SKIP_SMOKE_TESTS="${SKIP_SMOKE_TESTS:-false}"
MONITOR_DURATION="${MONITOR_DURATION:-300}" # 5 minutes

# Service names
BACKEND_SERVICE="ethertrack-backend"
FRONTEND_SERVICE="ethertrack-frontend"
NAMESPACE="ethertrack"

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Help function
show_help() {
    cat << EOF
Usage: $0 [blue|green] [version] [options]

Arguments:
  blue|green      Target color to deploy (default: blue)
  version         Docker image version/tag (default: latest)

Environment Variables:
  DRY_RUN=true              - Simulate deployment without applying changes
  SKIP_SMOKE_TESTS=true     - Skip smoke tests after deployment
  MONITOR_DURATION=300      - Monitoring duration in seconds (default: 300)

Examples:
  $0 blue v1.2.3
  $0 green latest
  DRY_RUN=true $0 blue v1.2.3
  SKIP_SMOKE_TESTS=true $0 green v1.2.3
EOF
}

# Validate arguments
if [[ "$1" == "-h" || "$1" == "--help" ]]; then
    show_help
    exit 0
fi

if [[ "$TARGET_COLOR" != "blue" && "$TARGET_COLOR" != "green" ]]; then
    log_error "Invalid color: $TARGET_COLOR. Must be 'blue' or 'green'"
    show_help
    exit 1
fi

# Determine inactive color
if [[ "$TARGET_COLOR" == "blue" ]]; then
    INACTIVE_COLOR="green"
else
    INACTIVE_COLOR="blue"
fi

log_info "Starting Blue-Green deployment"
log_info "Target color: $TARGET_COLOR"
log_info "Inactive color: $INACTIVE_COLOR"
log_info "Version: $VERSION"
log_info "Namespace: $NAMESPACE"

# Check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."
    
    if ! command -v kubectl &> /dev/null; then
        log_error "kubectl not found in PATH"
        exit 1
    fi
    
    if ! kubectl cluster-info &> /dev/null; then
        log_error "Cannot connect to Kubernetes cluster"
        exit 1
    fi
    
    # Check if namespace exists
    if ! kubectl get namespace "$NAMESPACE" &> /dev/null; then
        log_error "Namespace $NAMESPACE does not exist"
        exit 1
    fi
    
    log_success "Prerequisites check passed"
}

# Deploy inactive environment
deploy_inactive() {
    log_info "Deploying to $INACTIVE_COLOR environment..."
    
    local backend_deployment="ethertrack-backend-${INACTIVE_COLOR}"
    local frontend_deployment="ethertrack-frontend-${INACTIVE_COLOR}"
    local backend_image="ghcr.io/ethertrack/ethertrack-backend:${VERSION}"
    local frontend_image="ghcr.io/ethertrack/ethertrack-frontend:${VERSION}"
    
    if [[ "$DRY_RUN" == "true" ]]; then
        log_warning "DRY RUN: Would deploy $INACTIVE_COLOR with version $VERSION"
        return 0
    fi
    
    # Update backend deployment
    log_info "Updating backend deployment: $backend_deployment"
    kubectl set image deployment/"$backend_deployment" \
        backend="ghcr.io/ethertrack/ethertrack-backend:${VERSION}" \
        -n "$NAMESPACE" --record
    
    # Update frontend deployment
    log_info "Updating frontend deployment: $frontend_deployment"
    kubectl set image deployment/"$frontend_deployment" \
        frontend="ghcr.io/ethertrack/ethertrack-frontend:${VERSION}" \
        -n "$NAMESPACE" --record
    
    # Wait for rollout
    log_info "Waiting for backend rollout..."
    kubectl rollout status deployment/"$backend_deployment" -n "$NAMESPACE" --timeout=300s
    
    log_info "Waiting for frontend rollout..."
    kubectl rollout status deployment/"$frontend_deployment" -n "$NAMESPACE" --timeout=300s
    
    log_success "$INACTIVE_COLOR environment deployed successfully"
}

# Run smoke tests
run_smoke_tests() {
    if [[ "$SKIP_SMOKE_TESTS" == "true" ]]; then
        log_warning "Skipping smoke tests (SKIP_SMOKE_TESTS=true)"
        return 0
    fi
    
    log_info "Running smoke tests on $INACTIVE_COLOR environment..."
    
    # Get the service endpoint for the inactive color
    local backend_service="ethertrack-backend-${INACTIVE_COLOR}"
    local frontend_service="ethertrack-frontend-${INACTIVE_COLOR}"
    
    # Port forward for testing
    log_info "Setting up port forwarding for smoke tests..."
    kubectl port-forward -n "$NAMESPACE" svc/"$backend_service" 8080:80 &
    BACKEND_PF_PID=$!
    kubectl port-forward -n "$NAMESPACE" svc/"$frontend_service" 8081:80 &
    FRONTEND_PF_PID=$!
    
    sleep 5
    
    # Test backend health
    log_info "Testing backend health..."
    if curl -f -s -o /dev/null -w "%{http_code}" http://localhost:8080/health | grep -q "200"; then
        log_success "Backend health check passed"
    else
        log_error "Backend health check failed"
        kill $BACKEND_PF_PID $FRONTEND_PF_PID 2>/dev/null || true
        return 1
    fi
    
    # Test frontend health
    log_info "Testing frontend health..."
    if curl -f -s -o /dev/null -w "%{http_code}" http://localhost:8081/health | grep -q "200"; then
        log_success "Frontend health check passed"
    else
        log_error "Frontend health check failed"
        kill $BACKEND_PF_PID $FRONTEND_PF_PID 2>/dev/null || true
        return 1
    fi
    
    # Test critical API endpoints
    log_info "Testing critical API endpoints..."
    if curl -f -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $TEST_TOKEN" \
        http://localhost:8080/api/health | grep -q "200"; then
        log_success "Authenticated API check passed"
    else
        log_warning "Authenticated API check failed (may need valid token)"
    fi
    
    kill $BACKEND_PF_PID $FRONTEND_PF_PID 2>/dev/null || true
    
    log_success "All smoke tests passed"
    return 0
}

# Switch traffic
switch_traffic() {
    log_info "Switching traffic to $TARGET_COLOR environment..."
    
    if [[ "$DRY_RUN" == "true" ]]; then
        log_warning "DRY RUN: Would switch traffic to $TARGET_COLOR"
        return 0
    fi
    
    # Patch services to point to target color
    log_info "Patching backend service selector..."
    kubectl patch service ethertrack-backend -n "$NAMESPACE" \
        -p "{\"spec\":{\"selector\":{\"app\":\"ethertrack-backend\",\"color\":\"$TARGET_COLOR\"}}}"
    
    log_info "Patching frontend service selector..."
    kubectl patch service ethertrack-frontend -n "$NAMESPACE" \
        -p "{\"spec\":{\"selector\":{\"app\":\"ethertrack-frontend\",\"color\":\"$TARGET_COLOR\"}}}"
    
    # Update ingress if needed
    log_info "Updating ingress rules..."
    kubectl patch ingress ethertrack-api -n "$NAMESPACE" \
        -p "{\"spec\":{\"rules\":[{\"host\":\"api.ethertrack.in\",\"http\":{\"paths\":[{\"path\":\"/\",\"pathType\":\"Prefix\",\"backend\":{\"service\":{\"name\":\"ethertrack-backend\",\"port\":{\"number\":80}}}}}]}}"
    
    log_info "Patching frontend ingress..."
    kubectl patch ingress ethertrack-frontend -n "$NAMESPACE" \
        -p "{\"spec\":{\"rules\":[{\"host\":\"ethertrack.in\",\"http\":{\"paths\":[{\"path\":\"/\",\"pathType\":\"Prefix\",\"backend\":{\"service\":{\"name\":\"ethertrack-frontend\",\"port\":{\"number\":80}}}}}]}}"
    
    log_success "Traffic switched to $TARGET_COLOR environment"
}

# Monitor post-switch
monitor_post_switch() {
    log_info "Monitoring $TARGET_COLOR environment for ${MONITOR_DURATION}s..."
    
    local start_time=$(date +%s)
    local end_time=$((start_time + MONITOR_DURATION))
    local error_count=0
    
    while [[ $(date +%s) -lt $end_time ]]; do
        local elapsed=$(($(date +%s) - start_time))
        local remaining=$((end_time - $(date +%s)))
        
        # Check backend health
        if curl -f -s -o /dev/null -w "%{http_code}" https://api.ethertrack.in/health | grep -q "200"; then
            log_info "Backend healthy (${remaining}s remaining)"
        else
            log_warning "Backend health check failed"
            ((error_count++))
        fi
        
        # Check frontend health
        if curl -f -s -o /dev/null -w "%{http_code}" https://ethertrack.in/health | grep -q "200"; then
            log_info "Frontend healthy (${remaining}s remaining)"
        else
            log_warning "Frontend health check failed"
            ((error_count++))
        fi
        
        # Check error rate from Prometheus (if available)
        if command -v curl &> /dev/null && [[ -n "${PROMETHEUS_URL:-}" ]]; then
            local error_rate=$(curl -s "${PROMETHEUS_URL}/api/v1/query?query=rate(ethertrack_http_request_errors_total[5m])" | jq -r '.data.result[0].value[1] // "0"')
            if (( $(echo "$error_rate > 0.05" | bc -l) )); then
                log_warning "High error rate detected: $error_rate"
                ((error_count++))
            fi
        fi
        
        if [[ $error_count -gt 5 ]]; then
            log_error "Too many errors detected ($error_count), considering rollback"
            return 1
        fi
        
        sleep 30
    done
    
    log_success "Monitoring completed successfully"
    return 0
}

# Rollback function
rollback() {
    log_warning "Initiating rollback to $INACTIVE_COLOR..."
    
    if [[ "$DRY_RUN" == "true" ]]; then
        log_warning "DRY RUN: Would rollback to $INACTIVE_COLOR"
        return 0
    fi
    
    # Switch traffic back
    kubectl patch service ethertrack-backend -n "$NAMESPACE" \
        -p "{\"spec\":{\"selector\":{\"app\":\"ethertrack-backend\",\"color\":\"$INACTIVE_COLOR\"}}}"
    
    kubectl patch service ethertrack-frontend -n "$NAMESPACE" \
        -p "{\"spec\":{\"selector\":{\"app\":\"ethertrack-frontend\",\"color\":\"$INACTIVE_COLOR\"}}}"
    
    log_success "Rollback to $INACTIVE_COLOR completed"
}

# Main execution
main() {
    log_info "=== EtherTrack Blue-Green Deployment ==="
    
    check_prerequisites
    
    # Trap signals for cleanup
    trap 'log_error "Deployment interrupted"; rollback; exit 1' INT TERM
    
    # Deploy to inactive environment
    deploy_inactive
    
    # Run smoke tests
    if ! run_smoke_tests; then
        log_error "Smoke tests failed, aborting deployment"
        exit 1
    fi
    
    # Switch traffic
    switch_traffic
    
    # Monitor post-switch
    if ! monitor_post_switch; then
        log_error "Post-switch monitoring failed, initiating rollback"
        rollback
        exit 1
    fi
    
    log_success "=== Blue-Green Deployment Completed Successfully ==="
    log_info "Active environment: $TARGET_COLOR"
    log_info "Version: $VERSION"
    log_info "Rollback available to: $INACTIVE_COLOR"
}

# Run main
main "$@"