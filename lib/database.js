const fs = require('fs');
const { Client } = require('pg');
const ini = require('ini');

/**
 * Database3CX - Manages connection to 3CX PostgreSQL database
 * Reads credentials from 3CX config and provides read-only access
 */
class Database3CX {
  constructor() {
    this.client = null;
    this.config = this.loadConfig();
  }

  /**
   * Load database configuration from 3CX INI file
   * @returns {Object} Database connection config
   */
  loadConfig() {
    const iniPath = '/var/lib/3cxpbx/Instance1/Bin/3CXPhoneSystem.ini';
    
    // For development/testing, use environment variables if INI doesn't exist
    if (!fs.existsSync(iniPath)) {
      console.warn('3CX config file not found, using environment variables');
      return {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5480'),
        database: process.env.DB_NAME || 'phonesystem',
        user: process.env.DB_USER || 'logsreader',
        password: process.env.DB_PASSWORD || '',
        ssl: false
      };
    }

    const content = fs.readFileSync(iniPath, 'utf-8');
    const config = ini.parse(content);
    
    return {
      host: config.CallReports.SERVER || 'localhost',
      port: parseInt(config.CallReports.PORT || '5480'),
      database: config.CallReports.DATABASE || 'phonesystem',
      user: config.CallReports.USERNAME || 'logsreader',
      password: config.CallReports.PASSWORD,
      ssl: false
    };
  }

  /**
   * Establish database connection
   */
  async connect() {
    this.client = new Client(this.config);
    await this.client.connect();
    console.log('Database connected successfully');
  }

  /**
   * Query CDR (Call Detail Records) for a time range
   * @param {Date} start - Start time
   * @param {Date} end - End time
   * @returns {Promise<Array>} CDR records
   */
  async queryCDR(start, end) {
    const result = await this.client.query(
      `SELECT * FROM cdr_output WHERE start_time >= $1 AND start_time <= $2 ORDER BY start_time DESC`,
      [start, end]
    );
    return result.rows;
  }

  /**
   * Health check query
   * @returns {Promise<boolean>} Connection status
   */
  async healthCheck() {
    try {
      await this.client.query('SELECT 1');
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get connection latency in milliseconds
   * @returns {Promise<number>} Latency in ms
   */
  async getLatency() {
    const start = Date.now();
    await this.client.query('SELECT 1');
    return Date.now() - start;
  }

  /**
   * Close database connection
   */
  async disconnect() {
    if (this.client) {
      await this.client.end();
      this.client = null;
      console.log('Database disconnected');
    }
  }
}

module.exports = Database3CX;
