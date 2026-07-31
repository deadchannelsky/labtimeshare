#!/bin/bash
# Production Deployment Script — LabTimeShare Account Cleanup System
# 
# This script handles pulling latest code, applying migrations,
# regenerating Prisma client, building, and restarting the service.
#
# Usage: ./deploy.sh

set -e  # Exit on any error

echo "======================================================"
echo "LabTimeShare Production Deployment"
echo "======================================================"

# Configuration
REPO_URL="https://github.com/deadchannelsky/labtimeshare.git"
BRANCH="main"
APP_DIR="/opt/labtimeshare"
SERVICE_NAME="lts-portal"
NODE_ENV="production"

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_step() {
    echo -e "${GREEN}[$(date +'%H:%M:%S')]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

# Step 1: Navigate to app directory
log_step "Navigating to app directory: $APP_DIR"
if [ ! -d "$APP_DIR" ]; then
    log_error "Directory $APP_DIR does not exist"
    exit 1
fi
cd "$APP_DIR"

# Step 2: Stop the service
log_step "Stopping service: $SERVICE_NAME"
sudo systemctl stop "$SERVICE_NAME" || true

# Step 3: Pull latest code
log_step "Pulling latest code from $BRANCH branch"
git fetch origin
git reset --hard HEAD
git checkout "$BRANCH"
git pull origin "$BRANCH"

# Step 4: Check if there were changes
log_step "Checking for code changes"
if ! git diff HEAD@{1} --quiet; then
    log_warning "Code has changed, proceeding with rebuild"
else
    log_warning "No code changes detected, skipping rebuild"
    log_step "Starting service"
    sudo systemctl start "$SERVICE_NAME"
    log_step "Deployment complete (no changes)"
    exit 0
fi

# Step 5: Install dependencies
log_step "Installing dependencies with npm"
npm install --prefer-offline --no-audit

# Step 6: Apply database migrations
log_step "Applying database migrations"
npx prisma migrate deploy

# Step 7: Regenerate Prisma client (CRITICAL!)
log_step "Regenerating Prisma client"
npx prisma generate

# Step 8: Build the application
log_step "Building application"
npm run build
if [ $? -ne 0 ]; then
    log_error "Build failed!"
    exit 1
fi

# Step 9: Verify build output
log_step "Verifying build output"
if [ ! -f ".next/BUILD_ID" ]; then
    log_error "Build output verification failed - BUILD_ID not found"
    exit 1
fi
log_step "Build verified successfully"

# Step 10: Start the service
log_step "Starting service: $SERVICE_NAME"
sudo systemctl start "$SERVICE_NAME"

# Step 11: Verify service is running
log_step "Verifying service status"
sleep 3
if sudo systemctl is-active --quiet "$SERVICE_NAME"; then
    log_step "Service is running successfully"
else
    log_error "Service failed to start"
    log_step "Checking logs:"
    sudo journalctl -u "$SERVICE_NAME" -n 20 --no-pager
    exit 1
fi

# Step 12: Check for startup messages
log_step "Checking startup messages (waiting 5 seconds)"
sleep 5
if sudo journalctl -u "$SERVICE_NAME" --since "5 seconds ago" | grep -q "Cleanup job started"; then
    log_step "✓ Cleanup job detected in logs"
else
    log_warning "Could not verify cleanup job startup (may be normal)"
fi

# Step 13: Final status
log_step "Deployment completed successfully!"
echo ""
echo "======================================================"
echo "Deployment Summary:"
echo "======================================================"
echo "Service: $SERVICE_NAME"
echo "Status: $(sudo systemctl is-active $SERVICE_NAME)"
echo "Branch: $BRANCH"
echo "Last commit: $(git log -1 --pretty=format:'%H - %s')"
echo ""
echo "Next steps:"
echo "  • Monitor logs: sudo journalctl -u $SERVICE_NAME -f"
echo "  • Check cleanup job: sudo journalctl -u $SERVICE_NAME | grep cleanupJob"
echo "  • View admin panel: https://your-domain.com/admin/requests"
echo "======================================================"

