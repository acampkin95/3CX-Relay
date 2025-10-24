const crypto = require('crypto');
const bcrypt = require('bcryptjs');

/**
 * APIKeyManager - Manages API keys for external clients
 */
class APIKeyManager {
  constructor(dbClient) {
    this.db = dbClient;
    this.bcryptRounds = 10;
  }

  /**
   * Generate a new API key
   * @param {string} clientName - Name/description of the client
   * @param {Array<string>} permissions - Array of permission strings
   * @param {string} createdBy - Username of creator
   * @returns {Promise<Object>} Generated API key info
   */
  async generateKey(clientName, permissions = ['read'], createdBy = 'system') {
    const apiKey = crypto.randomBytes(32).toString('hex');
    const hashedKey = await bcrypt.hash(apiKey, this.bcryptRounds);

    const result = await this.db.client.query(
      'INSERT INTO api_keys (client_name, key_hash, permissions, active, created_by, created_at) VALUES ($1, $2, $3, true, $4, NOW()) RETURNING id, client_name, permissions, created_at',
      [clientName, hashedKey, JSON.stringify(permissions), createdBy]
    );

    console.log('API key generated for:', clientName);

    return {
      id: result.rows[0].id,
      apiKey: apiKey,
      clientName: result.rows[0].client_name,
      permissions: result.rows[0].permissions,
      createdAt: result.rows[0].created_at,
      warning: 'Store this key securely. It will not be shown again.'
    };
  }

  /**
   * Validate an API key
   * @param {string} apiKey - API key to validate
   * @returns {Promise<Object|null>} Key info if valid, null otherwise
   */
  async validateKey(apiKey) {
    const result = await this.db.client.query(
      'SELECT id, client_name, key_hash, permissions FROM api_keys WHERE active = true'
    );

    for (const row of result.rows) {
      const isValid = await bcrypt.compare(apiKey, row.key_hash);
      if (isValid) {
        return {
          id: row.id,
          clientName: row.client_name,
          permissions: typeof row.permissions === 'string' 
            ? JSON.parse(row.permissions) 
            : row.permissions
        };
      }
    }

    return null;
  }

  /**
   * Revoke an API key
   * @param {number} keyId - ID of key to revoke
   * @param {string} revokedBy - Username of revoker
   * @returns {Promise<boolean>} Success status
   */
  async revokeKey(keyId, revokedBy = 'system') {
    await this.db.client.query(
      'UPDATE api_keys SET active = false, revoked_by = $1, revoked_at = NOW() WHERE id = $2',
      [revokedBy, keyId]
    );
    
    console.log('API key revoked:', keyId, 'by', revokedBy);
    return true;
  }

  /**
   * List all API keys (without hashes)
   * @returns {Promise<Array>} List of API keys
   */
  async listKeys() {
    const result = await this.db.client.query(
      'SELECT id, client_name, permissions, active, created_by, created_at, revoked_by, revoked_at FROM api_keys ORDER BY created_at DESC'
    );
    
    return result.rows.map(row => ({
      ...row,
      permissions: typeof row.permissions === 'string' 
        ? JSON.parse(row.permissions) 
        : row.permissions
    }));
  }

  /**
   * Get usage statistics for an API key
   * @param {number} keyId - API key ID
   * @returns {Promise<Object>} Usage statistics
   */
  async getKeyUsage(keyId) {
    const result = await this.db.client.query(
      `SELECT 
        COUNT(*) as total_requests,
        COUNT(CASE WHEN status_code >= 200 AND status_code < 300 THEN 1 END) as successful_requests,
        COUNT(CASE WHEN status_code >= 400 THEN 1 END) as failed_requests,
        AVG(response_time) as avg_response_time,
        MAX(timestamp) as last_used
      FROM api_requests 
      WHERE api_key_id = $1`,
      [keyId]
    );

    return result.rows[0];
  }

  /**
   * Log an API request
   * @param {number} keyId - API key ID
   * @param {string} endpoint - Endpoint called
   * @param {string} method - HTTP method
   * @param {number} statusCode - Response status code
   * @param {number} responseTime - Response time in ms
   * @returns {Promise<void>}
   */
  async logRequest(keyId, endpoint, method, statusCode, responseTime) {
    await this.db.client.query(
      'INSERT INTO api_requests (api_key_id, endpoint, method, status_code, response_time, timestamp) VALUES ($1, $2, $3, $4, $5, NOW())',
      [keyId, endpoint, method, statusCode, responseTime]
    );
  }
}

module.exports = APIKeyManager;
