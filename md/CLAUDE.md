# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a secure relay module for 3CX V20 U7 phone system that:
- Integrates with 3CX's PostgreSQL database (read-only access via logsreader account)
- Connects to 3CX XAPI for call control and history
- Maintains WebSocket connection for real-time call events
- Exposes relay API for external clients
- Provides WebGUI admin panel for management and monitoring

Target deployment: Auto-deployed on the 3CX server at `/opt/3cx-relay/`

## Architecture

### Core Components

1. **Database Client** (`lib/database.js`)
   - Class: `Database3CX`
   - Reads credentials from `/var/lib/3cxpbx/Instance1/Bin/3CXPhoneSystem.ini` under `[CallReports]` section
   - Config fields: `SERVER`, `PORT` (default 5480), `DATABASE` (phonesystem), `USERNAME` (logsreader), `PASSWORD`
   - Uses read-only `logsreader` account
   - Queries tables: `cdr_output`, `operator_state_history`, `error_log`, `api_keys`
   - Libraries: `pg` for PostgreSQL, `ini` for config parsing
   - Methods: `connect()`, `queryCDR(start, end)`

2. **XAPI Client** (`lib/xapi-client.js`)
   - Class: `XAPIClient(fqdn, clientId, clientSecret)`
   - OAuth2 authentication via `/connect/token` endpoint (Client Credentials flow)
   - Token refresh cycle: ~55 minutes (refreshes 60s before expiry via `ensureValidToken()`)
   - Key endpoints: `/xapi/v1/CallHistoryView`, `/xapi/v1/ActiveCalls`
   - Requires System Owner role and 8SC+ Enterprise license
   - Headers: `Content-Type: application/x-www-form-urlencoded` for auth, `Authorization: Bearer {token}` for API calls
   - Libraries: `axios`, `querystring`

3. **WebSocket Manager** (`lib/callcontrol-ws.js`)
   - Class: `CallControlWebSocket(fqdn, clientId, clientSecret)`
   - Persistent connection to `wss://<FQDN>/callcontrol/ws`
   - Authentication: Basic Auth header with base64-encoded `clientId:clientSecret`
   - Real-time event streaming from 3CX (JSON messages)
   - Auto-reconnection with 5-second delay on disconnect
   - Event subscription pattern: `subscribe(handler)` returns unsubscribe function
   - Libraries: `ws`, `events.EventEmitter`

4. **Relay Service** (`lib/relay-server.js`)
   - Class: `RelayService(config)`
   - Express.js server on port 8082 (localhost only, bound to `127.0.0.1`)
   - REST endpoints: `/relay/health`, `/relay/active-calls`
   - WebSocket server for broadcasting call events to external clients
   - Initializes all components: DB, XAPI, CallControl WebSocket
   - Maintains set of connected WebSocket clients
   - Broadcasts 3CX events in format: `{type: 'call_event', data: event}`
   - Libraries: `express`, `http`, `ws`

5. **Admin Authentication** (`lib/admin-auth.js`)
   - Class: `AdminAuth`
   - JWT token-based authentication with configurable secret (`process.env.ADMIN_SECRET`)
   - Bcrypt password hashing (12 rounds for users, 10 rounds for API keys)
   - Middleware: `requireAuth`, `requireAdmin`
   - Token sources: `Authorization: Bearer {token}` header or `admin_token` cookie
   - Roles: `admin` (full access), `viewer` (read-only)
   - Libraries: `bcryptjs`, `jsonwebtoken`

6. **API Key Manager** (`lib/api-key-manager.js`)
   - Class: `APIKeyManager`
   - Generates 32-byte hex API keys with bcrypt hashing
   - Permissions array: e.g., `['read']`, `['read', 'write']`
   - Methods: `generateKey(clientName, permissions, createdBy)`, `validateKey(apiKey)`, `revokeKey(keyId, revokedBy)`, `listKeys()`
   - API keys shown only once at generation time
   - Libraries: `crypto`, `bcryptjs`

7. **Connection Monitor** (`lib/connection-monitor.js`)
   - Class: `ConnectionMonitor(db, xapi, callControl)` extends `EventEmitter`
   - Health checks every 5 seconds for all components
   - Measures latency for DB and XAPI connections
   - Checks WebSocket `readyState`
   - Emits `state_change` events for dashboard updates
   - Methods: `checkDatabase()`, `checkXAPI()`, `checkWebSocket()`, `reconnectDatabase()`, `reconnectXAPI()`, `reconnectWebSocket()`
   - Stores history in `connection_status_history` table

8. **Error Tracker** (`lib/error-tracker.js`)
   - Class: `ErrorTracker` extends `EventEmitter`
   - In-memory error buffer (max 1000 entries)
   - Error fields: `id`, `timestamp`, `component`, `severity`, `message`, `details`, `acknowledged`
   - Methods: `logError(component, severity, message, details)`, `getErrors(filters)`, `acknowledgeError(errorId)`
   - Emits `new_error` events for real-time dashboard updates
   - Also persists to `error_log` table

9. **Admin Routes** (`routes/admin-routes.js`)
   - Express router with JWT authentication middleware
   - Public routes: `POST /login`
   - Protected routes: All others require `requireAuth` middleware
   - Admin-only routes: Reconnect, API key management (require `requireAdmin`)
   - Returns JSON responses with appropriate status codes
   - Sets HttpOnly cookie `admin_token` on login

10. **Admin Panel Frontend** (`views/`, `public/`)
    - Template engine: EJS or Pug
    - JWT stored in HttpOnly cookie
    - Real-time updates via Socket.io namespace `/admin`
    - Features: Dashboard with live stats, connection status cards, error feed, API key management
    - UI: Bootstrap 5, Chart.js for metrics, DataTables.js for tables, responsive design
    - Dark mode support

### Data Flow

```
3CX System → [PostgreSQL DB] ← Database Client
           → [XAPI REST] ← XAPI Client (OAuth2)
           → [WebSocket] ← WebSocket Manager

All components → Relay Service → External Clients (via REST/WS)
                              → Admin Panel (monitoring/mgmt)
```

## Development Commands

**Note:** This project is in planning phase. Once implemented, typical commands will be:

```bash
# Install dependencies
npm install

# Development (with auto-reload)
npm run dev

# Production
npm start

# Run tests
npm test

# Run specific test file
npm test -- path/to/test.js

# Lint code
npm run lint

# Auto-deploy on 3CX server
sudo bash install.sh
```

## Key Integration Points

### 3CX Database Access
- Config file: `/var/lib/3cxpbx/Instance1/Bin/3CXPhoneSystem.ini`
- Account: `logsreader` (read-only, no ALTER permissions needed)
- Never modify 3CX-owned tables directly

### XAPI Authentication
- Must obtain OAuth2 token before any XAPI calls
- Token stored in-memory, not persisted
- Handle token expiry gracefully (401 responses)
- Store credentials securely in `config/` directory

### WebSocket Connection
- Must authenticate before subscribing to events
- Handle connection drops with reconnect logic
- Buffer events during reconnection to prevent data loss
- Monitor connection health with ping/pong

### Nginx Proxy Configuration
The relay and admin services are accessed through Nginx reverse proxy:
- `/relay/*` → `http://127.0.0.1:8082/relay/*`
- `/admin/*` → `http://127.0.0.1:8082/admin/*`
- All external access must be HTTPS only

## Security Considerations

- **Authentication**: JWT tokens with 24h expiry, HttpOnly cookies
- **Passwords**: Bcrypt with 12 rounds for admin users and API keys
- **Rate Limiting**: Applied to login and API key generation endpoints
- **Input Validation**: All user inputs sanitized against XSS and SQL injection
- **CSRF Protection**: Tokens on all state-changing operations
- **Least Privilege**: Uses read-only database account, no elevated 3CX permissions
- **Audit Logging**: All sensitive operations logged to `error_log` table

## Database Schema

Custom tables (not part of 3CX schema):

```sql
CREATE TABLE admin_users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(50) UNIQUE,
  password VARCHAR(255),
  role VARCHAR(20)
);

CREATE TABLE api_keys (
  id SERIAL PRIMARY KEY,
  client_name VARCHAR(100),
  key_hash VARCHAR(255),
  permissions JSONB,
  active BOOLEAN DEFAULT true
);

CREATE TABLE api_requests (
  id SERIAL PRIMARY KEY,
  api_key_id INTEGER,
  endpoint VARCHAR(255),
  method VARCHAR(10),
  status_code INTEGER,
  response_time INTEGER,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE error_log (
  id SERIAL PRIMARY KEY,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  component VARCHAR(50),
  severity VARCHAR(20),
  message TEXT,
  details JSONB,
  acknowledged BOOLEAN DEFAULT false
);

CREATE TABLE connection_status_history (
  id SERIAL PRIMARY KEY,
  component VARCHAR(50),
  state VARCHAR(20),
  latency INTEGER,
  error_message TEXT,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

3CX tables (read-only access):
- `cdr_output` - Call detail records (query with `start_time >= $1 AND start_time <= $2`)
- `operator_state_history` - Agent/operator states

## Admin API Routes

All routes require JWT authentication:
- `POST /admin/login` - Authenticate and set JWT cookie
- `POST /admin/logout` - Clear session
- `GET /admin/stats` - Dashboard statistics
- `GET /admin/connections` - DB/XAPI/WS connection status
- `POST /admin/connections/:component/reconnect` - Manual reconnect trigger
- `GET /admin/errors` - Error feed with filtering
- `POST /admin/errors/:id/acknowledge` - Mark error as acknowledged
- `GET /admin/api-keys` - List all API keys
- `POST /admin/api-keys` - Generate new API key
- `DELETE /admin/api-keys/:id` - Revoke API key
- `GET /admin/api-keys/:id/usage` - Key usage statistics

## Module Independence

The relay service is designed to work independently:
- Relay core functionality does not depend on admin panel
- Admin panel can be disabled without affecting relay operations
- Each component (DB, XAPI, WS) has isolated error handling
- Failure in one component does not cascade to others

## Testing Approach

When implementing tests:
- Mock 3CX database responses (don't require actual 3CX instance)
- Mock XAPI OAuth2 flow and endpoints
- Mock WebSocket server for event testing
- Integration tests should use test database, not production
- Test reconnection logic with simulated network failures
- Verify rate limiting and authentication logic thoroughly

## Implementation Notes

### Critical Configuration Requirements

1. **Environment Variables**
   - `ADMIN_SECRET` - JWT signing secret (required for admin authentication)
   - `FQDN` - 3CX server FQDN for XAPI and WebSocket connections
   - `CLIENT_ID` - OAuth2 client ID for XAPI (System Owner role)
   - `CLIENT_SECRET` - OAuth2 client secret
   - `PORT` - Relay service port (default: 8082)

2. **3CX Prerequisites**
   - 3CX V20 U7 or later
   - 8SC+ Enterprise license (required for XAPI)
   - System Owner role credentials for OAuth2 client
   - Read-only database access via `logsreader` account

3. **Dependencies**
   Core libraries: `express`, `pg`, `ini`, `axios`, `querystring`, `ws`, `bcryptjs`, `jsonwebtoken`, `crypto`

   Admin UI: `socket.io`, `ejs` or `pug`, `bootstrap@5`, `chart.js`, `datatables.net`

### WebSocket Event Handling

The CallControl WebSocket streams events in JSON format. Common event types:
- Call state changes (ringing, answered, held, transferred, ended)
- Queue events
- Extension status updates

Events should be parsed and re-broadcast to connected relay clients in the format:
```json
{
  "type": "call_event",
  "data": { /* original 3CX event */ }
}
```

### Token Refresh Strategy

XAPI tokens expire after ~60 minutes. The `ensureValidToken()` method:
- Checks if token exists and if expiry is more than 60 seconds away
- Automatically refreshes if needed before any API call
- Stores `tokenExpiry` as milliseconds timestamp

### Error Severity Levels

Use consistent severity levels across all components:
- `critical` - Service cannot function (DB connection lost, XAPI auth failed)
- `error` - Operation failed but service continues (single API call failed)
- `warning` - Potential issue detected (slow response, retry succeeded)
- `info` - Informational events (new client connected, reconnection succeeded)

### Connection Health Checks

The ConnectionMonitor runs checks every 5 seconds:
- **Database**: Execute simple query (`SELECT 1`), measure latency
- **XAPI**: Verify token validity, optionally test endpoint
- **WebSocket**: Check `readyState === WebSocket.OPEN`

State transitions emit events to update dashboard in real-time.

### Project Directory Structure

```
/opt/3cx-relay/
├── bin/
│   ├── relay-service.js      # Main entry point
│   └── admin-service.js      # Admin panel entry (or combined)
├── config/
│   ├── default.json          # Default config
│   └── production.json       # Production overrides
├── lib/
│   ├── database.js
│   ├── xapi-client.js
│   ├── callcontrol-ws.js
│   ├── relay-server.js
│   ├── admin-auth.js
│   ├── api-key-manager.js
│   ├── connection-monitor.js
│   └── error-tracker.js
├── routes/
│   └── admin-routes.js
├── middleware/
│   └── auth-middleware.js
├── public/
│   ├── css/
│   ├── js/
│   └── images/
├── views/
│   ├── login.ejs
│   ├── dashboard.ejs
│   └── partials/
├── logs/
├── tests/
├── install.sh
├── package.json
└── README.md
```

### Nginx Configuration Example

Add to 3CX nginx config (typically in `/etc/nginx/sites-available/3cx`):

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

### Auto-Deploy Script Requirements

The `install.sh` should:
1. Install Node.js 18+ (via NodeSource repository)
2. Create `/opt/3cx-relay/` directory structure
3. Copy all application files
4. Run `npm install --production`
5. Create systemd service file at `/etc/systemd/system/3cx-relay.service`
6. Add nginx configuration block (or provide manual instructions)
7. Enable and start service: `systemctl enable 3cx-relay && systemctl start 3cx-relay`
8. Create initial admin user (prompt for username/password)
9. Set proper file permissions (www-data or appropriate user)

### Reference Implementation Files

Full code examples are available in [relay_admin_all_code.md](relay_admin_all_code.md) including:
- Complete class implementations
- Database query patterns
- OAuth2 authentication flow
- WebSocket connection handling
- JWT middleware
- API key generation and validation
