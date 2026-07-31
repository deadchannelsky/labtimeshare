# Production Deployment Commands

## Quick Start (Complete Deployment)

### Using the Automated Script
```bash
cd /opt/labtimeshare
chmod +x deploy.sh
./deploy.sh
```

The script handles:
- Git pull
- Dependency installation
- Database migrations
- Prisma client regeneration
- Build
- Service restart
- Verification

---

## Step-by-Step Manual Commands

If you prefer to run commands individually:

### 1. Navigate to Application Directory
```bash
cd /opt/labtimeshare
```

### 2. Stop the Service
```bash
sudo systemctl stop lts-portal
```

### 3. Pull Latest Code
```bash
git fetch origin
git reset --hard HEAD
git checkout main
git pull origin main
```

### 4. Install Dependencies
```bash
npm install --prefer-offline --no-audit
```

### 5. Apply Database Migrations
```bash
npx prisma migrate deploy
```

### 6. Regenerate Prisma Client (CRITICAL!)
```bash
npx prisma generate
```

### 7. Build the Application
```bash
npm run build
```

### 8. Start the Service
```bash
sudo systemctl start lts-portal
```

### 9. Verify Service Status
```bash
sudo systemctl status lts-portal
```

### 10. Monitor Logs
```bash
sudo journalctl -u lts-portal -f
```

---

## Common Commands for Production

### Check Service Status
```bash
sudo systemctl status lts-portal
```

### View Logs (Last 50 lines)
```bash
sudo journalctl -u lts-portal -n 50 --no-pager
```

### Follow Logs in Real-Time
```bash
sudo journalctl -u lts-portal -f
```

### Check Cleanup Job Status
```bash
sudo journalctl -u lts-portal | grep cleanupJob
```

### Restart Service
```bash
sudo systemctl restart lts-portal
```

### Stop Service
```bash
sudo systemctl stop lts-portal
```

### Start Service
```bash
sudo systemctl start lts-portal
```

### Enable Auto-Start on Boot
```bash
sudo systemctl enable lts-portal
```

---

## Database Maintenance

### Apply Pending Migrations
```bash
cd /opt/labtimeshare
npx prisma migrate deploy
```

### Check Migration Status
```bash
cd /opt/labtimeshare
npx prisma migrate status
```

### Regenerate Prisma Client
```bash
cd /opt/labtimeshare
npx prisma generate
```

### View Database Schema
```bash
cd /opt/labtimeshare
npx prisma studio
```

---

## Troubleshooting

### Build Fails: "deletedAt does not exist"
```bash
# This means Prisma client wasn't regenerated
cd /opt/labtimeshare
npx prisma generate
npm run build
```

### Service Won't Start
```bash
# Check logs for errors
sudo journalctl -u lts-portal -n 100 --no-pager

# Check if port is in use
sudo lsof -i :3000

# Check if node process is running
ps aux | grep node
```

### Cleanup Job Not Running
```bash
# Check if job started
sudo journalctl -u lts-portal | grep "Cleanup job"

# Check environment variables
grep CLEANUP_CHECK_INTERVAL_MINUTES /opt/labtimeshare/.env
```

### Sudoers Permission Issues
```bash
# If userdel fails, check sudoers entry
sudo visudo -f /etc/sudoers.d/labtimeshare

# Should contain:
# nodeuser ALL=(ALL) NOPASSWD: /sbin/useradd, /sbin/usermod, /sbin/userdel, /bin/mkdir, /usr/bin/tee, /bin/chmod, /bin/chown, /usr/bin/truncate
```

---

## Pre-Deployment Checklist

- [ ] Code changes pulled and reviewed
- [ ] `.env` file updated with correct values
- [ ] Backup of database created
- [ ] `CLEANUP_CHECK_INTERVAL_MINUTES` configured
- [ ] `EXPIRY_CHECK_INTERVAL_MINUTES` configured
- [ ] Sudoers entry includes `/sbin/userdel`
- [ ] Node process user verified
- [ ] Disk space sufficient (migration creates new tables)
- [ ] System time synchronized (important for cleanup job)

---

## Post-Deployment Verification

### 1. Service Running
```bash
sudo systemctl is-active lts-portal
# Should output: active
```

### 2. Cleanup Job Started
```bash
sudo journalctl -u lts-portal | grep "Cleanup job started"
# Should show: [cleanupJob] Cleanup job started — running every 60 minute(s)
```

### 3. Expiry Job Started
```bash
sudo journalctl -u lts-portal | grep "Expiry check started"
# Should show: [expiryJob] Expiry check started — running every 5 minute(s)
```

### 4. Admin Panel Accessible
```bash
curl -s http://localhost:3000/admin/requests | head -20
# Should return HTML (or redirect to login)
```

### 5. Database Schema Updated
```bash
cd /opt/labtimeshare
sqlite3 lts.db ".schema ShellGrant" | grep deletedAt
# Should show: deletedAt DateTime
```

---

## Deployment Workflow (Recommended)

```bash
# 1. Prepare
sudo systemctl stop lts-portal
cd /opt/labtimeshare

# 2. Pull and build
git pull origin main
npm install
npx prisma migrate deploy
npx prisma generate
npm run build

# 3. Verify build
test -f .next/BUILD_ID && echo "✓ Build successful" || echo "✗ Build failed"

# 4. Start and verify
sudo systemctl start lts-portal
sleep 5
sudo systemctl is-active lts-portal

# 5. Monitor
sudo journalctl -u lts-portal -n 20 --no-pager
```

---

## Automated Deployment via CI/CD

If using a CI/CD tool (GitHub Actions, GitLab CI, etc.), use:

```yaml
# Example GitHub Actions
- name: Deploy to Production
  run: |
    cd /opt/labtimeshare
    git pull origin main
    npm install
    npx prisma migrate deploy
    npx prisma generate
    npm run build
    sudo systemctl restart lts-portal
```

---

## Rollback Procedure

If deployment fails:

```bash
# 1. Revert to previous commit
cd /opt/labtimeshare
git revert --no-edit HEAD
git push origin main

# 2. Rebuild and restart
npm install
npm run build
sudo systemctl restart lts-portal

# 3. If migration needs rollback:
npx prisma migrate revert
npx prisma generate
npm run build
sudo systemctl restart lts-portal
```

---

## Monitoring Script

Save as `monitor.sh` to check system health:

```bash
#!/bin/bash
echo "=== Service Status ==="
sudo systemctl status lts-portal

echo ""
echo "=== Recent Logs ==="
sudo journalctl -u lts-portal -n 20 --no-pager

echo ""
echo "=== Cleanup Job Status ==="
sudo journalctl -u lts-portal | grep -i cleanup | tail -5

echo ""
echo "=== Database Info ==="
sqlite3 /opt/labtimeshare/lts.db "SELECT COUNT(*) as active_users FROM User WHERE status='ACTIVE';"
sqlite3 /opt/labtimeshare/lts.db "SELECT COUNT(*) as deleted_accounts FROM ShellGrant WHERE deletedAt IS NOT NULL;"

echo ""
echo "=== OS Accounts ==="
getent passwd | grep lts- | wc -l
```

Run with:
```bash
chmod +x monitor.sh
./monitor.sh
```

---

## Environment Variables Reference

Key variables for `.env`:

```env
# Database
DATABASE_URL=file:./lts.db

# Authentication
JWT_SECRET=<random 64-char hex string>

# Server
SERVER_IP=192.168.1.100
PORT=3000

# vLLM Integration
VLLM_KEYS_FILE=/path/to/vllm/permitted_keys.txt

# Background Jobs
EXPIRY_CHECK_INTERVAL_MINUTES=5
CLEANUP_CHECK_INTERVAL_MINUTES=60

# UI
NEXT_PUBLIC_APP_NAME=LabTimeShare
```

---

## Support & Debugging

### Enable Verbose Logging
```bash
# Restart with debug output
cd /opt/labtimeshare
DEBUG=* npm start
```

### Check Disk Space
```bash
df -h /opt/labtimeshare
```

### Monitor System Resources
```bash
watch -n 1 'ps aux | grep node'
```

### Check Network Connectivity
```bash
# Verify git access
cd /opt/labtimeshare
git ls-remote origin main

# Verify npm access
npm ping
```

---

**For questions or issues, see:**
- PRODUCTION_DEPLOYMENT.md — Full deployment guide
- README.md — General documentation
- BUILD_FIX.md — Prisma client regeneration issues

