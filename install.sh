#!/bin/bash

# 3CX Relay Module - Auto-deployment Script
# For 3CX V20 U7 on Debian/Ubuntu

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

echo "Step 1: Installing Node.js 18..."
if ! command -v node &> /dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
  apt-get install -y nodejs
else
  echo "Node.js already installed: $(node --version)"
fi

echo
echo "Step 2: Creating installation directory..."
mkdir -p "$INSTALL_DIR"

echo
echo "Step 3: Copying application files..."
cp -r bin lib routes middleware public views config "$INSTALL_DIR/"
cp package.json schema.sql .env.example "$INSTALL_DIR/"

cd "$INSTALL_DIR"

echo
echo "Step 4: Installing dependencies..."
npm install --production

echo
echo "Step 5: Setting up database schema..."
echo "Please provide PostgreSQL connection details:"
read -p "Database host [localhost]: " DB_HOST
DB_HOST=${DB_HOST:-localhost}
read -p "Database port [5480]: " DB_PORT
DB_PORT=${DB_PORT:-5480}
read -p "Database name [phonesystem]: " DB_NAME
DB_NAME=${DB_NAME:-phonesystem}
read -p "Database user: " DB_USER
read -sp "Database password: " DB_PASSWORD
echo

# Test connection and run schema
export PGPASSWORD="$DB_PASSWORD"
if psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -f schema.sql; then
  echo "Database schema created successfully"
else
  echo "WARNING: Failed to create database schema. You may need to run it manually."
fi

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
echo "Step 7: Creating systemd service..."
cat > "$SERVICE_FILE" << EOF
[Unit]
Description=3CX Relay Service
After=network.target postgresql.service

[Service]
Type=simple
User=nobody
WorkingDirectory=$INSTALL_DIR
ExecStart=/usr/bin/node $INSTALL_DIR/bin/relay-service.js
Restart=always
RestartSec=10
StandardOutput=append:$INSTALL_DIR/logs/relay.log
StandardError=append:$INSTALL_DIR/logs/error.log

Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

# Create logs directory
mkdir -p "$INSTALL_DIR/logs"
chown -R nobody:nogroup "$INSTALL_DIR/logs"

echo
echo "Step 8: Configuring nginx proxy..."
echo "Add the following to your 3CX nginx configuration:"
echo
echo "location /relay/ {"
echo "    proxy_pass http://127.0.0.1:8082/relay/;"
echo "    proxy_http_version 1.1;"
echo "    proxy_set_header Upgrade \$http_upgrade;"
echo "    proxy_set_header Connection \"upgrade\";"
echo "    proxy_set_header Host \$host;"
echo "    proxy_set_header X-Real-IP \$remote_addr;"
echo "}"
echo
echo "location /admin/ {"
echo "    proxy_pass http://127.0.0.1:8082/admin/;"
echo "    proxy_http_version 1.1;"
echo "    proxy_set_header Host \$host;"
echo "    proxy_set_header X-Real-IP \$remote_addr;"
echo "}"
echo
read -p "Press Enter to continue after adding nginx config..."

echo
echo "Step 9: Starting service..."
systemctl daemon-reload
systemctl enable 3cx-relay
systemctl start 3cx-relay

echo
echo "========================================"
echo "Installation Complete!"
echo "========================================"
echo
echo "Service Status:"
systemctl status 3cx-relay --no-pager
echo
echo "Default Admin Credentials:"
echo "  Username: admin"
echo "  Password: admin123"
echo
echo "IMPORTANT: Change the default password immediately!"
echo
echo "Admin Panel: https://$FQDN/admin/"
echo "Relay WebSocket: wss://$FQDN/relay/ws"
echo
echo "Logs: $INSTALL_DIR/logs/"
echo "Configuration: $INSTALL_DIR/.env"
echo
echo "To view logs: journalctl -u 3cx-relay -f"
echo "To restart: systemctl restart 3cx-relay"
echo

