#!/bin/bash
# EtherTrack - Database Migration Script
# Usage: ./scripts/migrate.sh [up|down|status] [version]

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
MIGRATIONS_DIR="$(dirname "$0")/../ethertrack-backend/db/migrations"
DATABASE_URL="${DATABASE_URL:-postgresql://ethertrack:ethertrack_dev_password@localhost:5432/ethertrack}"

show_help() {
    cat << EOF
Usage: $0 [command] [version]

Commands:
  up [version]     Run pending migrations (up to version if specified)
  down [version]   Rollback migrations (down to version if specified)
  status           Show migration status
  create <name>    Create new migration file
  validate         Validate migration files

Examples:
  $0 up
  $0 up 005
  $0 down 003
  $0 status
  $0 create add_user_kyc_status
  $0 validate
EOF
}

check_prerequisites() {
    if ! command -v psql &> /dev/null; then
        log_error "psql not found. Please install PostgreSQL client."
        exit 1
    fi
    
    if [[ ! -d "$MIGRATIONS_DIR" ]]; then
        log_error "Migrations directory not found: $MIGRATIONS_DIR"
        exit 1
    fi
}

run_migration_up() {
    local target_version="${1:-}"
    
    log_info "Running migrations up${target_version:+ to version $target_version}..."
    
    local migration_files=()
    for file in "$MIGRATIONS_DIR"/*.sql; do
        [[ -f "$file" ]] || continue
        local basename=$(basename "$file")
        local version=$(echo "$basename" | cut -d'_' -f1)
        migration_files+=("$version:$file")
    done
    
    IFS=$'\n' migration_files=($(sort <<<"${migration_files[*]}"))
    
    for entry in "${migration_files[@]}"; do
        local version="${entry%%:*}"
        local file="${entry#*:}"
        
        if [[ -n "$target_version" && "$version" > "$target_version" ]]; then
            break
        fi
        
        log_info "Applying migration: $version"
        if psql "$DATABASE_URL" -f "$file" -q; then
            log_success "Applied: $version"
        else
            log_error "Failed to apply: $version"
            return 1
        fi
    done
    
    log_success "All migrations applied successfully"
}

run_migration_down() {
    local target_version="${1:-}"
    
    if [[ -z "$target_version" ]]; then
        log_error "Target version required for rollback"
        return 1
    fi
    
    log_warning "Rolling back to version: $target_version"
    
    local migration_files=()
    for file in "$MIGRATIONS_DIR"/*.sql; do
        [[ -f "$file" ]] || continue
        local basename=$(basename "$file")
        local version=$(echo "$basename" | cut -d'_' -f1)
        migration_files+=("$version:$file")
    done
    
    IFS=$'\n' migration_files=($(sort -r <<<"${migration_files[*]}"))
    
    for entry in "${migration_files[@]}"; do
        local version="${entry%%:*}"
        local file="${entry#*:}"
        
        if [[ "$version" <= "$target_version" ]]; then
            break
        fi
        
        log_warning "Rolling back migration: $version"
        log_warning "Down migration not implemented for: $version"
    done
}

show_status() {
    log_info "Migration Status:"
    
    psql "$DATABASE_URL" -c "
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version VARCHAR(50) PRIMARY KEY,
            applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
    " -q
    
    local applied=$(psql "$DATABASE_URL" -t -c "SELECT version FROM schema_migrations ORDER BY version;")
    
    echo "Applied migrations:"
    echo "$applied" | while read -r v; do
        [[ -n "$v" ]] && echo "  $v"
    done
    
    local pending=()
    for file in "$MIGRATIONS_DIR"/*.sql; do
        [[ -f "$file" ]] || continue
        local basename=$(basename "$file")
        local version=$(echo "$basename" | cut -d'_' -f1)
        if ! echo "$applied" | grep -q "^$version$"; then
            pending+=("$version")
        fi
    done
    
    echo "Pending migrations:"
    for v in "${pending[@]}"; do
        echo "  $v"
    done
}

create_migration() {
    local name="${1:-}"
    
    if [[ -z "$name" ]]; then
        log_error "Migration name required"
        return 1
    fi
    
    local timestamp=$(date +"%Y%m%d%H%M%S")
    local filename="${timestamp}_${name}.sql"
    local filepath="$MIGRATIONS_DIR/$filename"
    
    cat > "$filepath" << EOF
-- Migration: $name
-- Created: $(date -u +"%Y-%m-%d %H:%M:%S UTC")
-- Description: $name

BEGIN;

-- Add your SQL here

COMMIT;
EOF
    
    log_success "Created migration: $filepath"
}

validate_migrations() {
    log_info "Validating migration files..."
    
    local errors=0
    for file in "$MIGRATIONS_DIR"/*.sql; do
        [[ -f "$file" ]] || continue
        local basename=$(basename "$file")
        local version=$(echo "$basename" | cut -d'_' -f1)
        
        if [[ ! "$version" =~ ^[0-9]{14}$ ]]; then
            log_error "Invalid version format in: $basename (expected YYYYMMDDHHMMSS)"
            ((errors++))
        fi
        
        if ! grep -q "BEGIN;" "$file"; then
            log_warning "Missing BEGIN in: $basename"
        fi
        if ! grep -q "COMMIT;" "$file"; then
            log_warning "Missing COMMIT in: $basename"
        fi
    done
    
    if [[ $errors -eq 0 ]]; then
        log_success "All migration files valid"
    else
        log_error "Found $errors validation errors"
        return 1
    fi
}

main() {
    local command="${1:-}"
    local arg="${2:-}"
    
    case "$command" in
        up)
            check_prerequisites
            run_migration_up "$arg"
            ;;
        down)
            check_prerequisites
            run_migration_down "$arg"
            ;;
        status)
            check_prerequisites
            show_status
            ;;
        create)
            create_migration "$arg"
            ;;
        validate)
            check_prerequisites
            validate_migrations
            ;;
        *)
            show_help
            exit 1
            ;;
    esac
}

main "$@"