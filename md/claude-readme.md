# 3CX V20 U7 Relay Module & WebGUI Admin – Technical Implementation Guide

## Overview
This technical specification details building a secure relay module for 3CX V20 U7 (auto-deployed on the 3CX server), enabling integration with Database, XAPI, Webhook, and real-time relay to external clients. Also included: a WebGUI admin panel for authentication, management, status monitoring, and error feed.

---

## 1. Project Structure

```
/opt/3cx-relay/
├── bin/                     # Main Node.js services
├── config/                  # Credentials, settings
├── lib/                     # Core logic modules
├── logs/                    # Logs
├── public/                  # Admin panel static assets
├── views/                   # Admin HTML templates (EJS/PUG)
└── install.sh               # Autodeploy script
```

## 2. Database Access
- **File:** `/var/lib/3cxpbx/Instance1/Bin/3CXPhoneSystem.ini` (extracts [CallReports] DB credentials, logsreader account—read-only)
- **Tables:** `cdr_output`, `operator_state_history`, `error_log`, `api_keys`, etc.
- **Libraries:** `pg`, `ini`
- **Access Mode:** Read-only, never alters 3CX-owned tables.

Example (database.js):
```js
const {Client} = require('pg');
const ini = require('ini');
class Database3CX {
  constructor() {/* ... */}
  async connect() {/* ... */}
  async queryCDR(start,end){/* ... */}
}
```

## 3. XAPI and WebSocket (Call Control) Integration
- **XAPI Auth:** OAuth2 Client Credentials POST `/connect/token`, stores token in-memory (refreshes ~55 min)
- **Endpoints:** `/xapi/v1/CallHistoryView`, `/xapi/v1/ActiveCalls`
- **WebSocket:** wss://<FQDN>/callcontrol/ws, permanent connection, real-time event streaming
- **Libraries:** `axios`, `ws`, `querystring`

Example (xapi-client.js):
```js
class XAPIClient {
  async authenticate() {/* ... */}
  async getActiveCalls() {/* ... */}
}
```

## 4. Relay Service
- **Express.js** server (port 8082, localhost)
- **REST API:** `/relay/health`, `/relay/active-calls`, `/relay/call-history`
- **WebSocket:** Real-time push to clients (`ws` or `socket.io`)
- **Nginx Proxy:** `/relay/` → `http://127.0.0.1:8082/relay/` (see nginx.conf snippet)

## 5. WebGUI Admin Panel

### Tech Stack
- **Frontend:** Bootstrap 5, Vanilla JS (or Alpine.js), Socket.io, Chart.js, DataTables.js
- **Backend:** Reuses Express with extra `/admin` routes, JWT, bcrypt, passport.js
- **Sessions:** JWT + express-session (24h expiry)

### Features
- Login/logout, role-based admin/viewer access
- API key management: generate, revoke, permission scopes
- Live status of 3CX DB/XAPI/WS connections (color+latency)
- Error feed: real-time, severity filtering, acknowledge
- System stats: clients, API usage, uptime, error rate
- Manual reconnect triggers
- Responsive, dark mode UI

### Example Layout
```
Navbar: [Logo] [Dashboard] [API Keys] [Errors] [User Menu]
------------------------------------------------------------
|DB Status   | XAPI Status | WS Status   |   [Error Feed] |
------------------------------------------------------------
|Stats: Clients, API Hits, Errors, Uptime [Charts]         |
|API Keys Table [search, add, revoke]                      |
------------------------------------------------------------
```

### Real-Time
- Socket.io namespace `/admin` for dashboard push (status/errors/stats)


## 6. Security
- All admin endpoints require JWT-authenticated session
- Bcrypt passwords (12 rounds) for all admin users, bcrypt API key hashes
- Admin roles: Admin (full), Viewer (read-only)
- Rate limiting on login and API key generation
- CSRF and XSS prevention on forms and cookies
- All connections HTTPS via Nginx only

## 7. Database Schema (minimal, PostgreSQL SQL)
```sql
CREATE TABLE admin_users (...);
CREATE TABLE api_keys (...);
CREATE TABLE api_requests (...);
CREATE TABLE error_log (...);
CREATE TABLE connection_status_history (...);
```

## 8. Autodeploy Script (install.sh excerpt)
```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs
npm install
# Nginx block for /relay/ and /admin/ proxy
sudo systemctl enable 3cx-relay && sudo systemctl start 3cx-relay
```

## 9. Admin API Routes (technical only)
- `POST   /admin/login`  — authenticate, sets JWT cookie
- `POST   /admin/logout` — clears session
- `GET    /admin/stats`  — dashboard stats
- `GET    /admin/connections` — DB/XAPI/WS status
- `POST   /admin/connections/:component/reconnect`
- `GET    /admin/errors`   — error feed/history
- `POST   /admin/errors/:id/acknowledge`
- `GET    /admin/api-keys` — list keys
- `POST   /admin/api-keys` — generate key
- `DELETE /admin/api-keys/:id` — revoke key
- `GET    /admin/api-keys/:id/usage` — usage stats

## 10. Key Implementation Notes
- Only uses built-in 3CX read-only DB user (`logsreader`)
- No custom permissions or ALTER needed
- XAPI: must use System Owner role, 8SC+ Enterprise license
- All persistent logs/keys/configs stored outside 3CX core
- All real-time bridges go through local WebSocket + Nginx proxy
- Security audit logs for all sensitive operations
- Modular: relay still works if admin panel disabled

--

*All code, schemas, and routes above are technical reference only — see source files for logic details/usage.*
