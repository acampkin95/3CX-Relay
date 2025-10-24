const EventEmitter = require('events');

/**
 * ConnectionMonitor - Monitors health of all system components
 */
class ConnectionMonitor extends EventEmitter {
  constructor(db, xapi, callControl, errorTracker) {
    super();
    this.db = db;
    this.xapi = xapi;
    this.callControl = callControl;
    this.errorTracker = errorTracker;
    this.checkInterval = 5000; // 5 seconds
    this.intervalId = null;
    this.status = {
      database: { state: 'disconnected', latency: null, error: null, lastCheck: null },
      xapi: { state: 'disconnected', latency: null, error: null, lastCheck: null },
      websocket: { state: 'disconnected', latency: null, error: null, lastCheck: null }
    };
  }

  /**
   * Start monitoring all connections
   */
  startMonitoring() {
    console.log('Starting connection monitoring...');
    
    // Initial check
    this.checkAllConnections();
    
    // Set up periodic checks
    this.intervalId = setInterval(() => {
      this.checkAllConnections();
    }, this.checkInterval);
  }

  /**
   * Stop monitoring
   */
  stopMonitoring() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log('Connection monitoring stopped');
    }
  }

  /**
   * Check all connections
   */
  async checkAllConnections() {
    await Promise.all([
      this.checkDatabase(),
      this.checkXAPI(),
      this.checkWebSocket()
    ]);
  }

  /**
   * Check database connection
   */
  async checkDatabase() {
    const component = 'database';
    try {
      const startTime = Date.now();
      const isHealthy = await this.db.healthCheck();
      const latency = Date.now() - startTime;

      if (isHealthy) {
        this.updateStatus(component, 'connected', latency, null);
      } else {
        this.updateStatus(component, 'error', null, 'Health check failed');
      }
    } catch (error) {
      this.updateStatus(component, 'error', null, error.message);
      if (this.errorTracker) {
        this.errorTracker.logError(component, 'error', 'Database health check failed', { error: error.message });
      }
    }
  }

  /**
   * Check XAPI connection
   */
  async checkXAPI() {
    const component = 'xapi';
    try {
      const startTime = Date.now();
      await this.xapi.ensureValidToken();
      const latency = Date.now() - startTime;

      this.updateStatus(component, 'connected', latency, null);
    } catch (error) {
      this.updateStatus(component, 'error', null, error.message);
      if (this.errorTracker) {
        this.errorTracker.logError(component, 'error', 'XAPI health check failed', { error: error.message });
      }
    }
  }

  /**
   * Check WebSocket connection
   */
  checkWebSocket() {
    const component = 'websocket';
    try {
      const readyState = this.callControl.getReadyState();
      const WebSocket = require('ws');

      if (readyState === WebSocket.OPEN) {
        this.updateStatus(component, 'connected', null, null);
      } else if (readyState === WebSocket.CONNECTING) {
        this.updateStatus(component, 'connecting', null, null);
      } else {
        this.updateStatus(component, 'disconnected', null, 'WebSocket not open');
      }
    } catch (error) {
      this.updateStatus(component, 'error', null, error.message);
      if (this.errorTracker) {
        this.errorTracker.logError(component, 'error', 'WebSocket health check failed', { error: error.message });
      }
    }
  }

  /**
   * Update component status and emit event if changed
   */
  updateStatus(component, state, latency, error) {
    const previousState = this.status[component].state;
    const statusChanged = previousState !== state;

    this.status[component] = {
      state,
      latency,
      error,
      lastCheck: new Date()
    };

    if (statusChanged) {
      console.log(component + ' state changed: ' + previousState + ' -> ' + state);
      this.emit('state_change', { component, previousState, newState: state, latency, error });
    }

    // Persist to database if available
    if (this.db && this.db.client) {
      this.persistStatus(component, state, latency, error).catch(err => {
        console.error('Failed to persist connection status:', err.message);
      });
    }
  }

  /**
   * Persist status to database
   */
  async persistStatus(component, state, latency, error) {
    try {
      await this.db.client.query(
        'INSERT INTO connection_status_history (component, state, latency, error_message, timestamp) VALUES ($1, $2, $3, $4, NOW())',
        [component, state, latency, error]
      );
    } catch (err) {
      // Silently fail if table doesn't exist yet
    }
  }

  /**
   * Get current status of all components
   */
  getStatus() {
    return { ...this.status };
  }

  /**
   * Reconnect database
   */
  async reconnectDatabase() {
    console.log('Reconnecting database...');
    try {
      await this.db.disconnect();
      await this.db.connect();
      this.updateStatus('database', 'connected', null, null);
      return true;
    } catch (error) {
      this.updateStatus('database', 'error', null, error.message);
      if (this.errorTracker) {
        this.errorTracker.logError('database', 'error', 'Database reconnect failed', { error: error.message });
      }
      return false;
    }
  }

  /**
   * Reconnect XAPI
   */
  async reconnectXAPI() {
    console.log('Reconnecting XAPI...');
    try {
      this.xapi.token = null;
      await this.xapi.authenticate();
      this.updateStatus('xapi', 'connected', null, null);
      return true;
    } catch (error) {
      this.updateStatus('xapi', 'error', null, error.message);
      if (this.errorTracker) {
        this.errorTracker.logError('xapi', 'error', 'XAPI reconnect failed', { error: error.message });
      }
      return false;
    }
  }

  /**
   * Reconnect WebSocket
   */
  async reconnectWebSocket() {
    console.log('Reconnecting WebSocket...');
    try {
      this.callControl.close();
      await this.callControl.connect();
      this.updateStatus('websocket', 'connected', null, null);
      return true;
    } catch (error) {
      this.updateStatus('websocket', 'error', null, error.message);
      if (this.errorTracker) {
        this.errorTracker.logError('websocket', 'error', 'WebSocket reconnect failed', { error: error.message });
      }
      return false;
    }
  }
}

module.exports = ConnectionMonitor;
