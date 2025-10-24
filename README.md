# 3CX Relay Module with WebGUI Admin

Secure relay module for 3CX V20 U7 phone system with real-time call event streaming and administrative web interface.

## Features

- **Real-time Call Events**: WebSocket streaming of 3CX call events
- **Database Integration**: Read-only access to 3CX PostgreSQL database
- **XAPI Integration**: OAuth2-authenticated REST API access to 3CX
- **Admin Dashboard**: Web-based management interface
- **API Key Management**: Secure external client authentication
- **Health Monitoring**: Connection status and error tracking
- **Modular Architecture**: Independent components with isolated error handling

## Prerequisites

- 3CX V20 U7 or later
- 8SC+ Enterprise license (required for XAPI)
- OAuth2 System Owner credentials
- Node.js 18+ (installed automatically by setup script)
- PostgreSQL access (via 3CX logsreader account)
- Root access to 3CX server

## Quick Start

### 1. Auto-Deploy on 3CX Server

```bash
# Upload project to 3CX server
scp -r . root@your-3cx-server:/tmp/3cx-relay/

# SSH into server
ssh root@your-3cx-server

# Run installer
cd /tmp/3cx-relay
sudo bash install.sh
```

The installer will:
- Install Node.js 18
- Create `/opt/3cx-relay/` directory
- Install dependencies
- Set up database schema
- Create systemd service
- Configure environment

### 2. Manual Installation

#### Install Dependencies

```bash
npm install
```

#### Configure Environment

```bash
cp .env.example .env
nano .env
```

Required configuration:
```env
FQDN=your-3cx-server.example.com
CLIENT_ID=your_oauth_client_id
CLIENT_SECRET=your_oauth_client_secret
ADMIN_SECRET=your_secure_random_string
```

#### Initialize Database

```bash
psql -h localhost -p 5480 -U logsreader -d phonesystem -f schema.sql
```

#### Start Service

```bash
# Development
npm run dev

# Production
npm start
```

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `FQDN` | 3CX server FQDN | Required |
| `CLIENT_ID` | OAuth2 client ID | Required |
| `CLIENT_SECRET` | OAuth2 client secret | Required |
| `ADMIN_SECRET` | JWT signing secret | Required |
| `PORT` | Server port | 8082 |
| `HOST` | Bind address | 127.0.0.1 |
| `NODE_ENV` | Environment | production |

### Database Configuration

The module automatically reads 3CX database credentials from:
```
/var/lib/3cxpbx/Instance1/Bin/3CXPhoneSystem.ini
```

For development/testing, override with environment variables:
```env
DB_HOST=localhost
DB_PORT=5480
DB_NAME=phonesystem
DB_USER=logsreader
DB_PASSWORD=your_password
```

### Nginx Configuration

Add to 3CX nginx config (`/etc/nginx/sites-available/3cx`):

```nginx
location /relay/ {
    proxy_pass http://127.0.0.1:8082/relay/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
}

location /admin/ {
    proxy_pass http://127.0.0.1:8082/admin/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
}
```

Reload nginx:
```bash
systemctl reload nginx
```

## Usage

### Admin Dashboard

Access the admin panel at: `https://your-3cx-server/admin/`

Default credentials:
- Username: `admin`
- Password: `admin123`

**IMPORTANT**: Change the default password immediately after first login!

### Relay API Endpoints

#### Health Check
```bash
curl https://your-3cx-server/relay/health
```

#### Active Calls
```bash
curl https://your-3cx-server/relay/active-calls
```

#### Call History
```bash
curl https://your-3cx-server/relay/call-history?start=2024-01-01&end=2024-01-31
```

### WebSocket Client

Connect to real-time call events:

```javascript
const ws = new WebSocket('wss://your-3cx-server/relay/ws');

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  if (data.type === 'call_event') {
    console.log('Call event:', data.data);
  }
};
```

## API Key Management

Generate API keys for external clients via the admin dashboard:

1. Navigate to **API Keys** section
2. Click **Generate New Key**
3. Provide client name and permissions
4. Copy the key (shown only once!)

Use API keys in requests:
```bash
curl -H "Authorization: Bearer YOUR_API_KEY" \
  https://your-3cx-server/relay/active-calls
```

## Management

### Service Control

```bash
# Start service
systemctl start 3cx-relay

# Stop service
systemctl stop 3cx-relay

# Restart service
systemctl restart 3cx-relay

# View status
systemctl status 3cx-relay

# View logs
journalctl -u 3cx-relay -f
```

### Log Files

- Application logs: `/opt/3cx-relay/logs/`
- Systemd logs: `journalctl -u 3cx-relay`

### Database Maintenance

Clean up old records (run periodically):

```sql
SELECT cleanup_old_records();
```

## Development

### Project Structure

```
3cx-relay/
├── bin/
│   └── relay-service.js      # Main entry point
├── lib/
│   ├── database.js           # PostgreSQL client
│   ├── xapi-client.js        # XAPI OAuth2 client
│   ├── callcontrol-ws.js     # WebSocket manager
│   ├── admin-auth.js         # Authentication
│   ├── api-key-manager.js    # API key management
│   ├── connection-monitor.js # Health monitoring
│   ├── error-tracker.js      # Error logging
│   └── relay-server.js       # Main orchestrator
├── routes/
│   └── admin-routes.js       # Admin API routes
├── middleware/
│   └── auth-middleware.js    # JWT middleware
├── views/
│   ├── login.ejs            # Login page
│   └── dashboard.ejs        # Admin dashboard
├── public/                   # Static assets
├── config/                   # Configuration files
├── tests/                    # Test files
├── schema.sql               # Database schema
├── install.sh               # Auto-deploy script
└── package.json
```

### Running Tests

```bash
npm test
```

### Linting

```bash
npm run lint
```

## Security

- All admin endpoints protected by JWT authentication
- Bcrypt password hashing (12 rounds)
- Role-based access control (admin/viewer)
- Rate limiting on authentication and API key generation
- HttpOnly cookies for session tokens
- Read-only database access
- No elevated 3CX permissions required

## Troubleshooting

### Service won't start

Check logs:
```bash
journalctl -u 3cx-relay -n 50
```

Common issues:
- Missing environment variables
- Invalid OAuth2 credentials
- Database connection failure
- Port 8082 already in use

### Connection errors

Use the admin dashboard to:
1. Check connection status for DB/XAPI/WebSocket
2. Manually trigger reconnection
3. View error logs

### XAPI authentication fails

Verify:
- Client ID and secret are correct
- OAuth2 client has System Owner role
- 3CX has 8SC+ Enterprise license
- FQDN is correctly configured

### WebSocket disconnects

- Check network connectivity
- Verify nginx proxy configuration
- Review WebSocket error logs
- Check 3CX firewall settings

## Architecture

See [CLAUDE.md](CLAUDE.md) for detailed architecture documentation.

## License

MIT

## Support

For issues and questions, please refer to the project documentation or contact your system administrator.
