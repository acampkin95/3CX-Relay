# 3CX Relay Module with WebGUI Admin

Secure relay module for 3CX V20 U7 phone system with real-time call event streaming and administrative web interface.

## Features

- **Real-time Call Events**: WebSocket streaming of 3CX call events
- **Database Integration**: Read-only access to 3CX PostgreSQL database with connection pooling
- **XAPI Integration**: OAuth2-authenticated REST API access to 3CX
- **Admin Dashboard**: Web-based management interface
- **API Key Management**: Secure external client authentication
- **Health Monitoring**: Connection status and error tracking
- **Modular Architecture**: Independent components with isolated error handling
- **Production Optimized**: Resource limits, caching, compression, and security hardening

## Production Features

### Performance Optimizations
- **Redis Caching**: Optional caching layer for active calls, API keys, and statistics
  - Gracefully degrades if Redis is unavailable
  - Configurable TTLs for different data types
  - Reduces database load and improves response times
- **Database Connection Pooling**: PostgreSQL connection pool (10 max connections)
  - Automatic connection management and recycling
  - Pool statistics monitoring
  - Optimized for 3CX server compatibility
- **Response Compression**: Gzip compression for all HTTP responses
- **Performance Indexes**: Composite and GIN indexes for common query patterns
  - Optimized for time-range queries
  - JSONB column indexing for faster JSON queries

### Security Hardening
- **Helmet Security Headers**: CSP, XSS protection, and security headers
- **Input Validation**: Joi schema validation on all API endpoints
- **Rate Limiting**: Authentication and API key generation endpoints
- **Bcrypt Password Hashing**: 12 rounds for admin passwords
- **JWT Authentication**: Secure session management with HttpOnly cookies
- **Dedicated Service User**: Runs as isolated system user (3cxrelay)

### Reliability & Monitoring
- **Structured Logging**: Winston with daily log rotation
  - Separate error and combined logs
  - JSON format for log aggregation
  - Component-based logging
  - HTTP request logging
- **Resource Limits**: Systemd limits prevent impact on 3CX
  - Memory: 512MB limit (768MB max)
  - CPU: 50% of one core
  - Tasks: 256 concurrent tasks
- **Graceful Shutdown**: Proper cleanup of connections and resources
- **Health Checks**: Comprehensive health endpoint with cache and pool stats
- **Automated Testing**: Jest test framework with 70% coverage threshold

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
| `LOG_LEVEL` | Logging level (error/warn/info/debug) | info |
| `ALLOWED_ORIGINS` | CORS allowed origins (comma-separated) | http://localhost:8082 |
| `REDIS_ENABLED` | Enable Redis caching | true |
| `REDIS_HOST` | Redis server host | localhost |
| `REDIS_PORT` | Redis server port | 6379 |
| `REDIS_PASSWORD` | Redis password | - |

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
DB_POOL_MAX=10
DB_POOL_MIN=2
DB_IDLE_TIMEOUT=30000
DB_CONNECT_TIMEOUT=5000
```

### Redis Configuration (Optional)

Redis caching is optional but recommended for production. The service gracefully degrades if Redis is unavailable.

**Install Redis on 3CX server:**
```bash
apt-get install redis-server
systemctl enable redis-server
systemctl start redis-server
```

**Configure in `.env`:**
```env
REDIS_ENABLED=true
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
```

**Disable caching:**
```env
REDIS_ENABLED=false
```

**Cache TTL Configuration:**
- Active calls: 5 seconds
- Connection status: 5 seconds
- API key validation: 60 seconds
- Error statistics: 30 seconds
- Pool statistics: 10 seconds

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
│   ├── database.js           # PostgreSQL connection pool
│   ├── cache-manager.js      # Redis cache manager
│   ├── logger.js             # Winston logging
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
│   ├── auth-middleware.js    # JWT middleware
│   └── validation.js         # Joi validation middleware
├── views/
│   ├── login.ejs            # Login page
│   └── dashboard.ejs        # Admin dashboard
├── public/                   # Static assets
├── tests/
│   └── unit/                # Unit tests
│       ├── error-tracker.test.js
│       └── api-key-manager.test.js
├── logs/                     # Application logs
│   ├── error-*.log          # Error logs (daily rotation)
│   └── combined-*.log       # Combined logs (daily rotation)
├── schema.sql               # Database schema with indexes
├── install.sh               # Auto-deploy script (3CX optimized)
├── jest.config.js           # Test configuration
├── .env.example             # Environment template
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
