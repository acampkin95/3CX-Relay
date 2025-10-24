const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cookieParser = require('cookie-parser');
const path = require('path');
const socketIO = require('socket.io');

const Database3CX = require('./database');
const XAPIClient = require('./xapi-client');
const CallControlWebSocket = require('./callcontrol-ws');
const AdminAuth = require('./admin-auth');
const APIKeyManager = require('./api-key-manager');
const ConnectionMonitor = require('./connection-monitor');
const ErrorTracker = require('./error-tracker');

/**
 * RelayService - Main orchestrator for the 3CX relay system
 */
class RelayService {
  constructor(config) {
    this.config = config;
    
    // Express app setup
    this.app = express();
    this.server = http.createServer(this.app);
    
    // WebSocket server for relay clients
    this.wss = new WebSocket.Server({ noServer: true });
    
    // Socket.io for admin panel
    this.io = socketIO(this.server, {
      path: '/admin/socket.io',
      cors: { origin: '*' }
    });
    
    // Core components
    this.db = new Database3CX();
    this.xapi = new XAPIClient(config.fqdn, config.clientId, config.clientSecret);
    this.callControl = new CallControlWebSocket(config.fqdn, config.clientId, config.clientSecret);
    
    // Management components
    this.errorTracker = new ErrorTracker();
    this.adminAuth = null; // Initialized after DB connection
    this.apiKeyManager = null; // Initialized after DB connection
    this.connectionMonitor = null; // Initialized after components are ready
    
    // Connected relay clients
    this.relayClients = new Set();
    
    // Stats
    this.stats = {
      startTime: new Date(),
      totalRequests: 0,
      activeClients: 0,
      callEventsRelayed: 0
    };
  }

  /**
   * Initialize all components
   */
  async initialize() {
    console.log('Initializing 3CX Relay Service...');

    try {
      // Connect to database
      console.log('Connecting to database...');
      await this.db.connect();
      this.errorTracker.db = this.db;

      // Initialize auth and API key manager
      this.adminAuth = new AdminAuth(this.db);
      this.apiKeyManager = new APIKeyManager(this.db);

      // Authenticate with XAPI
      console.log('Authenticating with 3CX XAPI...');
      await this.xapi.authenticate();

      // Connect to CallControl WebSocket
      console.log('Connecting to CallControl WebSocket...');
      await this.callControl.connect();

      // Subscribe to call events
      this.callControl.subscribe((event) => {
        this.handleCallEvent(event);
      });

      // Initialize connection monitor
      this.connectionMonitor = new ConnectionMonitor(
        this.db,
        this.xapi,
        this.callControl,
        this.errorTracker
      );
      
      // Listen for connection state changes
      this.connectionMonitor.on('state_change', (data) => {
        this.broadcastToAdmin('connection_status', data);
      });

      // Listen for errors
      this.errorTracker.on('new_error', (error) => {
        this.broadcastToAdmin('new_error', error);
      });

      // Start monitoring
      this.connectionMonitor.startMonitoring();

      // Setup Express routes
      this.setupMiddleware();
      this.setupRoutes();
      this.setupWebSocket();
      this.setupAdminSocket();

      console.log('Initialization complete');
    } catch (error) {
      console.error('Initialization failed:', error);
      this.errorTracker.logError('relay', 'critical', 'Initialization failed', { error: error.message });
      throw error;
    }
  }

  /**
   * Setup Express middleware
   */
  setupMiddleware() {
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));
    this.app.use(cookieParser());
    this.app.set('view engine', 'ejs');
    this.app.set('views', path.join(__dirname, '../views'));
    this.app.use('/admin/static', express.static(path.join(__dirname, '../public')));
  }

  /**
   * Setup Express routes
   */
  setupRoutes() {
    // Relay API routes
    this.app.get('/relay/health', (req, res) => {
      this.stats.totalRequests++;
      res.json({
        status: 'ok',
        timestamp: new Date(),
        uptime: Date.now() - this.stats.startTime.getTime(),
        connections: this.connectionMonitor.getStatus(),
        stats: this.stats
      });
    });

    this.app.get('/relay/active-calls', async (req, res) => {
      this.stats.totalRequests++;
      try {
        const calls = await this.xapi.getActiveCalls();
        res.json({ success: true, data: calls });
      } catch (error) {
        this.errorTracker.logError('relay', 'error', 'Failed to get active calls', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
      }
    });

    this.app.get('/relay/call-history', async (req, res) => {
      this.stats.totalRequests++;
      try {
        const history = await this.xapi.getCallHistory(req.query);
        res.json({ success: true, data: history });
      } catch (error) {
        this.errorTracker.logError('relay', 'error', 'Failed to get call history', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Admin routes
    const adminRoutes = require('../routes/admin-routes')(
      this.adminAuth,
      this.apiKeyManager,
      this.connectionMonitor,
      this.errorTracker,
      this.stats
    );
    this.app.use('/admin', adminRoutes);

    // Root redirect
    this.app.get('/', (req, res) => {
      res.redirect('/admin/login');
    });
  }

  /**
   * Setup WebSocket server for relay clients
   */
  setupWebSocket() {
    this.server.on('upgrade', (request, socket, head) => {
      if (request.url === '/relay/ws') {
        this.wss.handleUpgrade(request, socket, head, (ws) => {
          this.wss.emit('connection', ws, request);
        });
      }
    });

    this.wss.on('connection', (ws) => {
      console.log('Relay client connected');
      this.relayClients.add(ws);
      this.stats.activeClients = this.relayClients.size;

      ws.on('close', () => {
        console.log('Relay client disconnected');
        this.relayClients.delete(ws);
        this.stats.activeClients = this.relayClients.size;
      });

      ws.on('error', (error) => {
        console.error('Relay client error:', error.message);
      });

      // Send initial connection message
      ws.send(JSON.stringify({
        type: 'connected',
        message: '3CX Relay connected',
        timestamp: new Date()
      }));
    });
  }

  /**
   * Setup Socket.IO for admin panel
   */
  setupAdminSocket() {
    this.io.on('connection', (socket) => {
      console.log('Admin client connected:', socket.id);

      // Send initial status
      socket.emit('connection_status', this.connectionMonitor.getStatus());
      socket.emit('error_stats', this.errorTracker.getStatistics());
      socket.emit('stats', this.stats);

      socket.on('disconnect', () => {
        console.log('Admin client disconnected:', socket.id);
      });
    });
  }

  /**
   * Handle call events from 3CX
   */
  handleCallEvent(event) {
    this.stats.callEventsRelayed++;
    
    const message = {
      type: 'call_event',
      data: event,
      timestamp: new Date()
    };

    this.broadcastToRelayClients(message);
    this.broadcastToAdmin('call_event', event);
  }

  /**
   * Broadcast message to all relay clients
   */
  broadcastToRelayClients(message) {
    const data = JSON.stringify(message);
    this.relayClients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    });
  }

  /**
   * Broadcast message to admin panel
   */
  broadcastToAdmin(event, data) {
    this.io.emit(event, data);
  }

  /**
   * Start the server
   */
  start(port = 8082, host = '127.0.0.1') {
    this.server.listen(port, host, () => {
      console.log('3CX Relay Service running on ' + host + ':' + port);
      console.log('Relay WebSocket: ws://' + host + ':' + port + '/relay/ws');
      console.log('Admin Panel: http://' + host + ':' + port + '/admin');
    });
  }

  /**
   * Graceful shutdown
   */
  async shutdown() {
    console.log('Shutting down...');
    
    this.connectionMonitor.stopMonitoring();
    this.callControl.close();
    await this.db.disconnect();
    
    this.server.close(() => {
      console.log('Server closed');
    });
  }
}

module.exports = RelayService;
