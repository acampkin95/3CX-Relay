#!/bin/bash

# 3CX Relay Module - Auto-deployment Script
# For 3CX V20 U7 on Debian/Ubuntu
# Optimized to minimize conflicts with 3CX server

set -e

echo "========================================"
echo "3CX Relay Module Installer"
echo "========================================"
echo

# Check if running as root
if [ "$EUID" -ne 0 ]; then
  echo "ERROR: This script must be run as root"
  echo "Please run: sudo bash install.sh"
  exit 1
fi

# Installation directory
INSTALL_DIR="/opt/3cx-relay"
SERVICE_FILE="/etc/systemd/system/3cx-relay.service"
SERVICE_USER="3cxrelay"
LOG_DIR="/var/log/3cx-relay"

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check 3CX installation
echo
log_info "Checking 3CX installation..."
if [ ! -f "/var/lib/3cxpbx/Instance1/Bin/3CXPhoneSystem.ini" ]; then
    log_error "3CX installation not found. This script must run on a 3CX server."
    exit 1
fi

# Check 3CX version
if grep -q "Version=20" /var/lib/3cxpbx/Instance1/Bin/3CXPhoneSystem.ini; then
    log_info "3CX V20 detected - compatible"
else
    log_warn "3CX version may not be V20. Proceed with caution."
    read -p "Continue anyway? (y/N): " CONTINUE
    if [[ ! "$CONTINUE" =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Check for port conflicts
echo
log_info "Checking port availability..."
if netstat -tuln | grep -q ":8082 "; then
    log_error "Port 8082 is already in use. Please free it or choose another port."
    exit 1
fi
log_info "Port 8082 is available"

# Check system resources
echo
log_info "Checking system resources..."
TOTAL_MEM=$(free -m | awk '/^Mem:/{print $2}')
if [ "$TOTAL_MEM" -lt 2048 ]; then
    log_warn "System has less than 2GB RAM. Performance may be impacted."
fi

# Check disk space
DISK_AVAIL=$(df -BG /opt | awk 'NR==2 {print $4}' | sed 's/G//')
if [ "$DISK_AVAIL" -lt 1 ]; then
    log_error "Insufficient disk space in /opt (need at least 1GB)"
    exit 1
fi
log_info "System resources check passed"

# Create dedicated service user
echo
log_info "Creating dedicated service user..."
if ! id "$SERVICE_USER" &>/dev/null; then
    useradd --system --no-create-home --shell /bin/false "$SERVICE_USER"
    log_info "User $SERVICE_USER created"
else
    log_info "User $SERVICE_USER already exists"
fi

# Install Node.js if needed (check version compatibility with 3CX)
echo
log_info "Checking Node.js installation..."
if ! command -v node &> /dev/null; then
    log_info "Installing Node.js 18 LTS..."
    curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
    apt-get install -y nodejs
    log_info "Node.js installed: $(node --version)"
else
    NODE_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$NODE_VERSION" -lt 16 ]; then
        log_warn "Node.js version is too old ($(node --version)). Upgrading to Node.js 18..."
        curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
        apt-get install -y nodejs
    else
        log_info "Node.js already installed: $(node --version)"
    fi
fi

# Check npm
if ! command -v npm &> /dev/null; then
    log_error "npm not found. Installing..."
    apt-get install -y npm
fi

# Backup existing installation if present
echo
if [ -d "$INSTALL_DIR" ]; then
    log_warn "Existing installation found at $INSTALL_DIR"
    BACKUP_DIR="${INSTALL_DIR}_backup_$(date +%Y%m%d_%H%M%S)"
    log_info "Creating backup at $BACKUP_DIR"
    cp -r "$INSTALL_DIR" "$BACKUP_DIR"
    log_info "Backup created. You can restore with: mv $BACKUP_DIR $INSTALL_DIR"
fi

log_info "Creating installation directory..."
mkdir -p "$INSTALL_DIR"
mkdir -p "$LOG_DIR"

log_info "Copying application files..."
cp -r bin lib routes middleware public views "$INSTALL_DIR/" 2>/dev/null || true
cp package.json schema.sql .env.example "$INSTALL_DIR/"

# Set proper ownership
chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"
chown -R "$SERVICE_USER:$SERVICE_USER" "$LOG_DIR"
chmod 755 "$INSTALL_DIR"

cd "$INSTALL_DIR"

log_info "Installing Node.js dependencies..."
# Install as root but for the service user's directory
npm install --production --no-audit --no-fund 2>&1 | grep -v "npm WARN" || true
log_info "Dependencies installed"

echo
log_info "Setting up database schema..."
log_info "Reading 3CX database configuration..."

# Try to auto-detect database config from 3CX
if [ -f "/var/lib/3cxpbx/Instance1/Bin/3CXPhoneSystem.ini" ]; then
    DB_HOST=$(grep -E "^SERVER=" /var/lib/3cxpbx/Instance1/Bin/3CXPhoneSystem.ini | cut -d'=' -f2 | tr -d '\r' || echo "localhost")
    DB_PORT=$(grep -E "^PORT=" /var/lib/3cxpbx/Instance1/Bin/3CXPhoneSystem.ini | cut -d'=' -f2 | tr -d '\r' || echo "5480")
    DB_NAME=$(grep -E "^DATABASE=" /var/lib/3cxpbx/Instance1/Bin/3CXPhoneSystem.ini | cut -d'=' -f2 | tr -d '\r' || echo "phonesystem")
    log_info "Auto-detected database config from 3CX: $DB_HOST:$DB_PORT/$DB_NAME"
else
    DB_HOST="localhost"
    DB_PORT="5480"
    DB_NAME="phonesystem"
fi

echo
echo "Database configuration (press Enter to accept defaults):"
read -p "Database host [$DB_HOST]: " INPUT_DB_HOST
DB_HOST=${INPUT_DB_HOST:-$DB_HOST}

read -p "Database port [$DB_PORT]: " INPUT_DB_PORT
DB_PORT=${INPUT_DB_PORT:-$DB_PORT}

read -p "Database name [$DB_NAME]: " INPUT_DB_NAME
DB_NAME=${INPUT_DB_NAME:-$DB_NAME}

read -p "Database user (use a user with CREATE TABLE permissions): " DB_USER
while [ -z "$DB_USER" ]; do
    log_error "Database user cannot be empty"
    read -p "Database user: " DB_USER
done

read -sp "Database password: " DB_PASSWORD
echo

# Test database connection
log_info "Testing database connection..."
export PGPASSWORD="$DB_PASSWORD"
if psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "SELECT 1;" &>/dev/null; then
    log_info "Database connection successful"

    # Run schema
    log_info "Creating database schema..."
    if psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -f schema.sql 2>&1 | tee /tmp/schema_install.log; then
        log_info "Database schema created successfully"
    else
        log_error "Failed to create database schema"
        log_warn "Check /tmp/schema_install.log for details"
        log_warn "You can run the schema manually later: psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -f $INSTALL_DIR/schema.sql"
    fi
else
    log_error "Database connection failed"
    log_warn "Database schema not created. You must run it manually:"
    log_warn "  psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -f $INSTALL_DIR/schema.sql"
fi
unset PGPASSWORD

echo
echo "Step 6: Creating environment configuration..."
read -p "3CX FQDN (e.g., pbx.example.com): " FQDN
read -p "OAuth Client ID: " CLIENT_ID
read -sp "OAuth Client Secret: " CLIENT_SECRET
echo

# Generate random admin secret
ADMIN_SECRET=$(openssl rand -hex 32)

cat > "$INSTALL_DIR/.env" << EOF
# 3CX Configuration
FQDN=$FQDN
CLIENT_ID=$CLIENT_ID
CLIENT_SECRET=$CLIENT_SECRET

# Server Configuration
PORT=8082
HOST=127.0.0.1
NODE_ENV=production

# Admin Authentication
ADMIN_SECRET=$ADMIN_SECRET

# Database
DB_HOST=$DB_HOST
DB_PORT=$DB_PORT
DB_NAME=$DB_NAME
DB_USER=$DB_USER
DB_PASSWORD=$DB_PASSWORD
EOF

chmod 600 "$INSTALL_DIR/.env"

echo
log_info "Creating systemd service with resource limits..."
cat > "$SERVICE_FILE" << EOF
[Unit]
Description=3CX Relay Service
Documentation=https://github.com/acampkin95/3CX-Relay
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=simple
User=$SERVICE_USER
Group=$SERVICE_USER
WorkingDirectory=$INSTALL_DIR

# Security settings
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$INSTALL_DIR $LOG_DIR
ProtectKernelTunables=true
ProtectControlGroups=true

# Resource limits (prevent impact on 3CX)
MemoryLimit=512M
MemoryMax=768M
CPUQuota=50%
TasksMax=256
LimitNOFILE=4096

# Service execution
ExecStart=/usr/bin/node $INSTALL_DIR/bin/relay-service.js
ExecReload=/bin/kill -HUP \$MAINPID

# Restart policy
Restart=on-failure
RestartSec=10
StartLimitBurst=5
StartLimitIntervalSec=60

# Logging
StandardOutput=append:$LOG_DIR/relay.log
StandardError=append:$LOG_DIR/error.log
SyslogIdentifier=3cx-relay

# Environment
Environment=NODE_ENV=production
Environment=NODE_OPTIONS=--max-old-space-size=384
EnvironmentFile=$INSTALL_DIR/.env

[Install]
WantedBy=multi-user.target
EOF

log_info "Systemd service created with resource limits:"
log_info "  - Memory limit: 512MB (max 768MB)"
log_info "  - CPU quota: 50%"
log_info "  - Max tasks: 256"
log_info "These limits prevent the relay service from impacting 3CX performance"

echo
log_info "Nginx proxy configuration..."
echo
echo "You need to add the following to your 3CX nginx configuration."
echo "Location: /etc/nginx/sites-enabled/default or /etc/nginx/conf.d/3cx.conf"
echo
echo "${YELLOW}Add these location blocks inside the existing server block:${NC}"
echo
cat > /tmp/3cx-relay-nginx.conf << 'NGINX_EOF'
    # 3CX Relay API
    location /relay/ {
        proxy_pass http://127.0.0.1:8082/relay/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Timeouts
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # 3CX Relay Admin Panel
    location /admin/ {
        proxy_pass http://127.0.0.1:8082/admin/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cookie_path / "/; HTTPOnly; Secure";
    }
NGINX_EOF

cat /tmp/3cx-relay-nginx.conf
echo
log_info "Nginx configuration saved to: /tmp/3cx-relay-nginx.conf"
echo
read -p "Press Enter after adding the nginx configuration and running 'systemctl reload nginx'..."

# Verify nginx config
if nginx -t 2>/dev/null; then
    log_info "Nginx configuration is valid"
else
    log_warn "Nginx configuration test failed. Please check your nginx config."
fi

echo
log_info "Starting 3CX Relay service..."
systemctl daemon-reload
systemctl enable 3cx-relay

if systemctl start 3cx-relay; then
    log_info "Service started successfully"
else
    log_error "Failed to start service. Check logs: journalctl -u 3cx-relay -n 50"
    exit 1
fi

# Wait for service to be fully up
log_info "Waiting for service to initialize..."
sleep 5

# Health check
log_info "Performing health check..."
if curl -sf http://127.0.0.1:8082/relay/health > /dev/null 2>&1; then
    log_info "Health check passed - service is responding"
else
    log_warn "Health check failed - service may still be starting"
    log_warn "Check status with: systemctl status 3cx-relay"
fi

echo
echo "========================================"
log_info "Installation Complete!"
echo "========================================"
echo
echo "${GREEN}Service Status:${NC}"
systemctl status 3cx-relay --no-pager --lines=0
echo
echo "${YELLOW}Default Admin Credentials:${NC}"
echo "  Username: admin"
echo "  Password: admin123"
echo
echo "${RED}IMPORTANT: Change the default password immediately!${NC}"
echo
echo "${GREEN}Access URLs:${NC}"
echo "  Admin Panel:     https://$FQDN/admin/"
echo "  Relay WebSocket: wss://$FQDN/relay/ws"
echo "  Health Check:    http://127.0.0.1:8082/relay/health"
echo
echo "${GREEN}Files & Directories:${NC}"
echo "  Installation:    $INSTALL_DIR"
echo "  Logs:            $LOG_DIR"
echo "  Configuration:   $INSTALL_DIR/.env"
echo "  Service file:    $SERVICE_FILE"
echo
echo "${GREEN}Useful Commands:${NC}"
echo "  View logs:       journalctl -u 3cx-relay -f"
echo "  Service status:  systemctl status 3cx-relay"
echo "  Restart:         systemctl restart 3cx-relay"
echo "  Stop:            systemctl stop 3cx-relay"
echo "  Resource usage:  systemctl status 3cx-relay | grep -E 'Memory|CPU'"
echo
echo "${GREEN}Monitoring:${NC}"
echo "  The service has resource limits to prevent impact on 3CX:"
echo "  - Memory: Limited to 512MB (hard limit: 768MB)"
echo "  - CPU: Limited to 50% of one core"
echo "  - Tasks: Limited to 256 concurrent tasks"
echo
echo "${YELLOW}Next Steps:${NC}"
echo "  1. Access https://$FQDN/admin/ and login"
echo "  2. Change the default admin password"
echo "  3. Generate API keys for external clients"
echo "  4. Monitor resource usage for first 24 hours"
echo "  5. Review logs for any errors"
echo
if [ -n "$BACKUP_DIR" ]; then
    log_info "Previous installation backed up to: $BACKUP_DIR"
    echo "  To rollback: systemctl stop 3cx-relay && rm -rf $INSTALL_DIR && mv $BACKUP_DIR $INSTALL_DIR && systemctl start 3cx-relay"
fi
echo
log_info "Installation completed successfully!"
echo

