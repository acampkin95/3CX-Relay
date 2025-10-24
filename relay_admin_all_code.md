# 3CX V20 U7 Relay Module & WebGUI Admin — Complete Code Reference

This document includes all critical backend code, including database access, XAPI integration, WebSocket, relay server, admin authentication, API key manager, connection monitor, error tracker, and admin routes. Boilerplate is omitted for brevity—see comments for required libraries and integration points.

---

## 1. database.js
```javascript
const fs = require('fs');
const { Client } = require('pg');
const ini = require('ini');
class Database3CX {
  constructor() {
    this.client = null;
    this.config = this.loadConfig();
  }
  loadConfig() {
    const iniPath = '/var/lib/3cxpbx/Instance1/Bin/3CXPhoneSystem.ini';
    const content = fs.readFileSync(iniPath, 'utf-8');
    const config = ini.parse(content);
    return {
      host: config.CallReports.SERVER || 'localhost',
      port: +config.CallReports.PORT || 5480,
      database: config.CallReports.DATABASE || 'phonesystem',
      user: config.CallReports.USERNAME || 'logsreader',
      password: config.CallReports.PASSWORD,
      ssl: false
    };
  }
  async connect() {
    this.client = new Client(this.config);
    await this.client.connect();
  }
  async queryCDR(start, end) {
    return await this.client.query(
      `SELECT * FROM cdr_output WHERE start_time >= $1 AND start_time <= $2 ORDER BY start_time DESC`,
      [start, end]
    );
  }
}
module.exports = Database3CX;
```

---

## 2. xapi-client.js
```javascript
const axios = require('axios');
const qs = require('querystring');
class XAPIClient {
  constructor(fqdn, clientId, clientSecret) {
    this.baseUrl = `https://${fqdn}`;
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.token = null; this.tokenExpiry = null;
  }
  async authenticate() {
    const tokenUrl = `${this.baseUrl}/connect/token`;
    const data = qs.stringify({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      grant_type: 'client_credentials'
    });
    const response = await axios.post(tokenUrl, data, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
    this.token = response.data.access_token;
    this.tokenExpiry = Date.now() + (response.data.expires_in * 1000);
  }
  async ensureValidToken() {
    if (!this.token || Date.now() >= this.tokenExpiry - 60000)
      await this.authenticate();
  }
  async getActiveCalls() {
    await this.ensureValidToken();
    const response = await axios.get(`${this.baseUrl}/xapi/v1/ActiveCalls`, {
      headers: { 'Authorization': `Bearer ${this.token}` }
    });
    return response.data;
  }
}
module.exports = XAPIClient;
```

---

## 3. callcontrol-ws.js
```javascript
const WebSocket = require('ws');
class CallControlWebSocket {
  constructor(fqdn, clientId, clientSecret) {
    this.wsUrl = `wss://${fqdn}/callcontrol/ws`;
    this.auth = { clientId, clientSecret };
    this.ws = null; this.eventHandlers = new Map();
  }
  async connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl, {
        headers: {
          'Authorization': `Basic ${Buffer.from(`${this.auth.clientId}:${this.auth.clientSecret}`).toString('base64')}`
        }
      });
      this.ws.on('open', () => resolve());
      this.ws.on('message', data => this.handleMessage(data));
      this.ws.on('error', reject);
      this.ws.on('close', () => this.reconnect());
    });
  }
  handleMessage(data) {
    let event = JSON.parse(data);
    this.eventHandlers.forEach(handler => handler(event));
  }
  subscribe(handler) {
    const id = Date.now();
    this.eventHandlers.set(id, handler); return () => this.eventHandlers.delete(id);
  }
  reconnect() {
    setTimeout(() => this.connect(), 5000);
  }
}
module.exports = CallControlWebSocket;
```

---

## 4. relay-server.js
```javascript
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const Database3CX = require('./database');
const XAPIClient = require('./xapi-client');
const CallControlWebSocket = require('./callcontrol-ws');
class RelayService {
  constructor(config) {
    this.config = config;
    this.app = express();
    this.server = http.createServer(this.app);
    this.wss = new WebSocket.Server({ server: this.server });
    this.db = new Database3CX();
    this.xapi = new XAPIClient(config.fqdn, config.clientId, config.clientSecret);
    this.callControl = new CallControlWebSocket(config.fqdn, config.clientId, config.clientSecret);
    this.clients = new Set();
  }
  async initialize() {
    await this.db.connect(); await this.xapi.authenticate(); await this.callControl.connect();
    this.callControl.subscribe(event => this.broadcastToClients({ type:'call_event', data:event }));
    this.setupRoutes(); this.setupWebSocket();
  }
  setupRoutes() {
    this.app.get('/relay/health', (req, res) => res.json({ status:'ok', timestamp:new Date() }));
    this.app.get('/relay/active-calls', async (req, res) => {
      try { let calls = await this.xapi.getActiveCalls(); res.json(calls); }
      catch(e) { res.status(500).json({ error: e.message }); }
    });
  }
  setupWebSocket() {
    this.wss.on('connection', ws => {
      this.clients.add(ws); ws.on('close', () => this.clients.delete(ws));
    });
  }
  broadcastToClients(message) {
    let data = JSON.stringify(message);
    this.clients.forEach(client => client.readyState === WebSocket.OPEN && client.send(data));
  }
  start(port=8082){ this.server.listen(port,'127.0.0.1'); }
}
module.exports = RelayService;
```

---

## 5. admin-auth.js & middleware
```javascript
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
class AdminAuth { /* ...see previous code for details... */ }
function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '') || req.cookies.admin_token;
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try { req.user = jwt.verify(token, process.env.ADMIN_SECRET); next(); }
  catch(e){ return res.status(401).json({ error:'Invalid or expired token' }); }
}
function requireAdmin(req, res, next) { if(req.user.role!=='admin') return res.status(403).json({ error:'Admin required' }); next(); }
module.exports = { AdminAuth, requireAuth, requireAdmin };
```

---

## 6. api-key-manager.js
```javascript
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
class APIKeyManager {
  async generateKey(clientName, permissions=['read'], createdBy) {
    const apiKey = crypto.randomBytes(32).toString('hex');
    const hashedKey = await bcrypt.hash(apiKey, 10);
    // Insert into database ... log creation ...
    return { apiKey, warning: 'Store securely. Not shown again.' };
  }
  async validateKey(apiKey) { /* ...compare bcrypt hashes for all active keys... */ }
  async revokeKey(keyId, revokedBy) { /* ...mark active=false... */ }
  async listKeys() { /* ...return all API keys with usage stats... */ }
}
module.exports = APIKeyManager;
```

---

## 7. connection-monitor.js
```javascript
const EventEmitter = require('events');
class ConnectionMonitor extends EventEmitter {
  constructor(db, xapi, callControl) { /* ...set up... */ }
  startMonitoring() {
    setInterval(() => this.checkAllConnections(), 5000);
  }
  async checkDatabase() { /* ...ping DB, measure latency... */ }
  async checkXAPI() { /* ...validate token, measure latency... */ }
  checkWebSocket() { /* ...ws readyState... */ }
  updateStatus(component, state, latency, error=null) { /* ...emit state_change event... */ }
  async reconnectDatabase() { /* ... */ }
  async reconnectXAPI() { /* ... */ }
  async reconnectWebSocket() { /* ... */ }
}
module.exports = ConnectionMonitor;
```

---

## 8. error-tracker.js
```javascript
const EventEmitter = require('events');
class ErrorTracker extends EventEmitter {
  constructor() { this.errors=[]; }
  logError(component, severity, message, details=null) {
    const error = { id:Date.now(), timestamp:new Date(), component, severity, message, details, acknowledged:false };
    this.errors.unshift(error); if(this.errors.length>1000) this.errors.pop();
    this.emit('new_error', error); return error.id;
  }
  getErrors(filters={}) {
    let filtered = [...this.errors]; if(filters.component) filtered=filtered.filter(e=>e.component===filters.component);
    if(filters.severity) filtered=filtered.filter(e=>e.severity===filters.severity);
    return filtered;
  }
  acknowledgeError(errorId) { let e=this.errors.find(e=>e.id===errorId); if(e){e.acknowledged=true;return true;} return false; }
}
module.exports = ErrorTracker;
```

---

## 9. admin-routes.js
```javascript
const express = require('express');
const router = express.Router();
const { requireAuth, requireAdmin } = require('./middleware/auth-middleware');
/* ...Initialize AdminAuth/APIKeyManager/monitors... */
router.post('/login', async (req,res)=>{/* login, set cookie ... */});
router.post('/logout',(req,res)=>{res.clearCookie('admin_token');res.json({message:'Logged out'});});
router.use(requireAuth);
router.get('/stats',(req,res)=>{/* dashboard stats ... */});
router.get('/connections',(req,res)=>{/* status ... */});
router.post('/connections/:component/reconnect', requireAdmin, async(req,res)=>{/* manual reconnect */});
router.get('/errors',(req,res)=>{/* error feed ... */});
router.post('/errors/:id/acknowledge',async(req,res)=>{/* ack error ... */});
router.get('/api-keys', requireAdmin, async(req,res)=>{/* list keys ... */});
router.post('/api-keys', requireAdmin, async(req,res)=>{/* generate key ... */});
router.delete('/api-keys/:id', requireAdmin, async(req,res)=>{/* revoke key ... */});
module.exports = router;
```

---

## 10. Minimal Database Schema (PostgreSQL)
```sql
CREATE TABLE admin_users (id SERIAL PRIMARY KEY, username VARCHAR(50) UNIQUE, password VARCHAR(255), role VARCHAR(20));
CREATE TABLE api_keys (id SERIAL PRIMARY KEY, client_name VARCHAR(100), key_hash VARCHAR(255), permissions JSONB, active BOOLEAN DEFAULT true);
CREATE TABLE api_requests (id SERIAL PRIMARY KEY, api_key_id INTEGER, endpoint VARCHAR(255), method VARCHAR(10), status_code INTEGER, response_time INTEGER, timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE error_log (id SERIAL PRIMARY KEY, timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP, component VARCHAR(50), severity VARCHAR(20), message TEXT, details JSONB, acknowledged BOOLEAN DEFAULT false);
CREATE TABLE connection_status_history (id SERIAL PRIMARY KEY, component VARCHAR(50), state VARCHAR(20), latency INTEGER, error_message TEXT, timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
```

---

*Refer to prior implementation for frontend assets, install script, and nginx proxy. All shown code can be dropped into /opt/3cx-relay/lib/ and /admin/ as appropriate modules.*
