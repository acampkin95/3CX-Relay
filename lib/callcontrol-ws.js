const WebSocket = require('ws');
const EventEmitter = require('events');

/**
 * CallControlWebSocket - Manages WebSocket connection to 3CX Call Control
 * Provides real-time call event streaming
 */
class CallControlWebSocket extends EventEmitter {
  constructor(fqdn, clientId, clientSecret) {
    super();
    this.wsUrl = `wss://${fqdn}/callcontrol/ws`;
    this.auth = { clientId, clientSecret };
    this.ws = null;
    this.eventHandlers = new Map();
    this.reconnectDelay = 5000;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.isConnected = false;
  }

  /**
   * Connect to 3CX WebSocket
   * @returns {Promise<void>}
   */
  async connect() {
    return new Promise((resolve, reject) => {
      try {
        // Create Basic Auth header
        const credentials = this.auth.clientId + ':' + this.auth.clientSecret;
        const authHeader = 'Basic ' + Buffer.from(credentials).toString('base64');

        this.ws = new WebSocket(this.wsUrl, {
          headers: {
            'Authorization': authHeader
          },
          rejectUnauthorized: false
        });

        this.ws.on('open', () => {
          console.log('CallControl WebSocket connected');
          this.isConnected = true;
          this.reconnectAttempts = 0;
          this.emit('connected');
          resolve();
        });

        this.ws.on('message', (data) => {
          this.handleMessage(data);
        });

        this.ws.on('error', (error) => {
          console.error('WebSocket error:', error.message);
          this.emit('error', error);
          reject(error);
        });

        this.ws.on('close', () => {
          console.log('WebSocket connection closed');
          this.isConnected = false;
          this.emit('disconnected');
          this.reconnect();
        });

        this.ws.on('ping', () => {
          this.ws.pong();
        });

      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Handle incoming WebSocket messages
   * @param {Buffer|String} data - Message data
   */
  handleMessage(data) {
    try {
      const event = JSON.parse(data.toString());
      
      this.eventHandlers.forEach(handler => {
        try {
          handler(event);
        } catch (error) {
          console.error('Error in event handler:', error);
        }
      });
      
      this.emit('call_event', event);
    } catch (error) {
      console.error('Failed to parse WebSocket message:', error);
    }
  }

  /**
   * Subscribe to call events
   * @param {Function} handler - Event handler function
   * @returns {Function} Unsubscribe function
   */
  subscribe(handler) {
    const id = Date.now() + Math.random();
    this.eventHandlers.set(id, handler);
    
    return () => this.eventHandlers.delete(id);
  }

  /**
   * Reconnect to WebSocket with exponential backoff
   */
  reconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnection attempts reached');
      this.emit('max_reconnect_reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts - 1);
    
    console.log('Reconnecting in ' + delay + 'ms (attempt ' + this.reconnectAttempts + '/' + this.maxReconnectAttempts + ')');
    
    setTimeout(() => {
      console.log('Attempting to reconnect...');
      this.connect().catch(error => {
        console.error('Reconnection failed:', error.message);
      });
    }, delay);
  }

  /**
   * Get WebSocket connection status
   * @returns {boolean} Connection status
   */
  isConnectedStatus() {
    return this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * Get WebSocket ready state
   * @returns {number} WebSocket ready state
   */
  getReadyState() {
    return this.ws ? this.ws.readyState : WebSocket.CLOSED;
  }

  /**
   * Close WebSocket connection
   */
  close() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
      this.isConnected = false;
    }
  }
}

module.exports = CallControlWebSocket;
