const fs = require('fs');
const { Pool } = require('pg');
const ini = require('ini');
const logger = require('./logger').component('database');

/**
 * Database3CX - Manages connection pool to 3CX PostgreSQL database
 * Uses connection pooling for better performance and resource management
 */
class Database3CX {
  constructor() {
    this.pool = null;
    this.client = null; // Backwards compatibility proxy
    this.config = this.loadConfig();
  }

  /**
   * Load database configuration from 3CX INI file
   * @returns {Object} Database connection config with pool settings
   */
  loadConfig() {
    const iniPath = '/var/lib/3cxpbx/Instance1/Bin/3CXPhoneSystem.ini';

    // For development/testing, use environment variables if INI doesn't exist
    if (!fs.existsSync(iniPath)) {
      logger.warn('3CX config file not found, using environment variables');
      return {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5480'),
        database: process.env.DB_NAME || 'phonesystem',
        user: process.env.DB_USER || 'logsreader',
        password: process.env.DB_PASSWORD || '',
        ssl: false,
        // Connection pool settings
        max: parseInt(process.env.DB_POOL_MAX || '10'),
        min: parseInt(process.env.DB_POOL_MIN || '2'),
        idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT || '30000'),
        connectionTimeoutMillis: parseInt(process.env.DB_CONNECT_TIMEOUT || '5000'),
        statement_timeout: parseInt(process.env.DB_STATEMENT_TIMEOUT || '30000')
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
      ssl: false,
      // Connection pool settings
      max: parseInt(process.env.DB_POOL_MAX || '10'), // max 10 connections
      min: parseInt(process.env.DB_POOL_MIN || '2'),  // min 2 connections
      idleTimeoutMillis: 30000,  // close idle clients after 30s
      connectionTimeoutMillis: 5000, // connection timeout 5s
      statement_timeout: 30000 // query timeout 30s
    };
  }

  /**
   * Establish database connection pool
   */
  async connect() {
    this.pool = new Pool(this.config);

    // Setup pool event handlers for monitoring
    this.pool.on('error', (err) => {
      logger.error('Unexpected database pool error', { error: err.message, stack: err.stack });
    });

    this.pool.on('connect', () => {
      logger.debug('New database client connected to pool');
    });

    this.pool.on('remove', () => {
      logger.debug('Database client removed from pool');
    });

    // Create a proxy client for backwards compatibility
    this.client = {
      query: async (...args) => this.pool.query(...args)
    };

    // Test connection
    try {
      await this.pool.query('SELECT 1');
      logger.info('Database pool initialized successfully', {
        host: this.config.host,
        database: this.config.database,
        poolSize: this.config.max
      });
    } catch (error) {
      logger.error('Database pool initialization failed', { error: error.message });
      throw error;
    }
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
   * Get pool statistics for monitoring
   * @returns {Object} Pool statistics
   */
  getPoolStats() {
    if (!this.pool) {
      return null;
    }

    return {
      totalCount: this.pool.totalCount,
      idleCount: this.pool.idleCount,
      waitingCount: this.pool.waitingCount
    };
  }

  /**
   * Close database connection pool
   */
  async disconnect() {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      this.client = null;
      logger.info('Database pool closed');
    }
  }
}

module.exports = Database3CX;
