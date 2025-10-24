const axios = require('axios');
const qs = require('querystring');
const https = require('https');

/**
 * XAPIClient - Handles OAuth2 authentication and XAPI calls to 3CX
 */
class XAPIClient {
  constructor(fqdn, clientId, clientSecret) {
    this.baseUrl = `https://${fqdn}`;
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.token = null;
    this.tokenExpiry = null;
    
    // Create axios instance with SSL verification disabled (for self-signed certs)
    this.axiosInstance = axios.create({
      httpsAgent: new https.Agent({
        rejectUnauthorized: false
      })
    });
  }

  /**
   * Authenticate with 3CX using OAuth2 Client Credentials flow
   * @returns {Promise<string>} Access token
   */
  async authenticate() {
    const tokenUrl = `${this.baseUrl}/connect/token`;
    const data = qs.stringify({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      grant_type: 'client_credentials'
    });

    try {
      const response = await this.axiosInstance.post(tokenUrl, data, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      });

      this.token = response.data.access_token;
      this.tokenExpiry = Date.now() + (response.data.expires_in * 1000);
      
      console.log('XAPI authentication successful');
      return this.token;
    } catch (error) {
      console.error('XAPI authentication failed:', error.message);
      throw new Error(`XAPI auth failed: ${error.message}`);
    }
  }

  /**
   * Ensure we have a valid token, refresh if needed
   * @returns {Promise<void>}
   */
  async ensureValidToken() {
    // Refresh if token doesn't exist or expires in less than 60 seconds
    if (!this.token || Date.now() >= this.tokenExpiry - 60000) {
      await this.authenticate();
    }
  }

  /**
   * Get active calls from 3CX
   * @returns {Promise<Array>} List of active calls
   */
  async getActiveCalls() {
    await this.ensureValidToken();
    
    try {
      const response = await this.axiosInstance.get(
        `${this.baseUrl}/xapi/v1/ActiveCalls`,
        {
          headers: { 'Authorization': `Bearer ${this.token}` }
        }
      );
      return response.data;
    } catch (error) {
      console.error('Failed to get active calls:', error.message);
      throw error;
    }
  }

  /**
   * Get call history from 3CX
   * @param {Object} params - Query parameters (start, end, etc.)
   * @returns {Promise<Array>} Call history
   */
  async getCallHistory(params = {}) {
    await this.ensureValidToken();
    
    try {
      const response = await this.axiosInstance.get(
        `${this.baseUrl}/xapi/v1/CallHistoryView`,
        {
          headers: { 'Authorization': `Bearer ${this.token}` },
          params
        }
      );
      return response.data;
    } catch (error) {
      console.error('Failed to get call history:', error.message);
      throw error;
    }
  }

  /**
   * Health check for XAPI connection
   * @returns {Promise<boolean>} Connection status
   */
  async healthCheck() {
    try {
      await this.getActiveCalls();
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get XAPI latency in milliseconds
   * @returns {Promise<number>} Latency in ms
   */
  async getLatency() {
    const start = Date.now();
    await this.getActiveCalls();
    return Date.now() - start;
  }
}

module.exports = XAPIClient;
