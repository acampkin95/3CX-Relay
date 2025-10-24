const Redis = require('ioredis');
const logger = require('./logger').component('cache');

/**
 * CacheManager - Redis-based caching layer for performance optimization
 * Reduces database load and improves response times for frequently accessed data
 */
class CacheManager {
  constructor() {
    this.redis = null;
    this.enabled = false;
    this.config = {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD || undefined,
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: true
    };

    // Cache TTL configurations (in seconds)
    this.ttl = {
      activeCalls: 5,        // Active calls change frequently
      connectionStatus: 5,   // Connection status updates every 5s
      apiKeyValidation: 60,  // API keys rarely change
      errorStats: 30,        // Error statistics
      poolStats: 10          // Database pool statistics
    };
  }

  /**
   * Initialize Redis connection
   * Gracefully degrades if Redis is unavailable
   */
  async connect() {
    // Skip if Redis is explicitly disabled
    if (process.env.REDIS_ENABLED === 'false') {
      logger.info('Redis caching disabled by configuration');
      return;
    }

    try {
      this.redis = new Redis(this.config);

      // Setup event handlers
      this.redis.on('connect', () => {
        logger.info('Redis connection established', {
          host: this.config.host,
          port: this.config.port
        });
        this.enabled = true;
      });

      this.redis.on('error', (err) => {
        logger.warn('Redis connection error', { error: err.message });
        this.enabled = false;
      });

      this.redis.on('close', () => {
        logger.warn('Redis connection closed');
        this.enabled = false;
      });

      this.redis.on('reconnecting', () => {
        logger.info('Redis reconnecting...');
      });

      // Attempt connection
      await this.redis.connect();

      // Test connection
      await this.redis.ping();
      logger.info('Redis cache manager initialized successfully');

    } catch (error) {
      logger.warn('Redis unavailable, operating without cache', { error: error.message });
      this.enabled = false;
      this.redis = null;
    }
  }

  /**
   * Get value from cache
   * @param {string} key - Cache key
   * @returns {Promise<any|null>} Cached value or null
   */
  async get(key) {
    if (!this.enabled || !this.redis) return null;

    try {
      const value = await this.redis.get(key);
      if (value) {
        logger.debug('Cache hit', { key });
        return JSON.parse(value);
      }
      logger.debug('Cache miss', { key });
      return null;
    } catch (error) {
      logger.error('Cache get error', { key, error: error.message });
      return null;
    }
  }

  /**
   * Set value in cache with TTL
   * @param {string} key - Cache key
   * @param {any} value - Value to cache
   * @param {number} ttl - Time to live in seconds (optional)
   * @returns {Promise<boolean>} Success status
   */
  async set(key, value, ttl = null) {
    if (!this.enabled || !this.redis) return false;

    try {
      const serialized = JSON.stringify(value);
      if (ttl) {
        await this.redis.setex(key, ttl, serialized);
      } else {
        await this.redis.set(key, serialized);
      }
      logger.debug('Cache set', { key, ttl });
      return true;
    } catch (error) {
      logger.error('Cache set error', { key, error: error.message });
      return false;
    }
  }

  /**
   * Delete value from cache
   * @param {string} key - Cache key
   * @returns {Promise<boolean>} Success status
   */
  async del(key) {
    if (!this.enabled || !this.redis) return false;

    try {
      await this.redis.del(key);
      logger.debug('Cache deleted', { key });
      return true;
    } catch (error) {
      logger.error('Cache delete error', { key, error: error.message });
      return false;
    }
  }

  /**
   * Delete multiple keys matching a pattern
   * @param {string} pattern - Key pattern (e.g., "calls:*")
   * @returns {Promise<number>} Number of keys deleted
   */
  async delPattern(pattern) {
    if (!this.enabled || !this.redis) return 0;

    try {
      const keys = await this.redis.keys(pattern);
      if (keys.length === 0) return 0;

      await this.redis.del(...keys);
      logger.debug('Cache pattern deleted', { pattern, count: keys.length });
      return keys.length;
    } catch (error) {
      logger.error('Cache pattern delete error', { pattern, error: error.message });
      return 0;
    }
  }

  /**
   * Check if key exists in cache
   * @param {string} key - Cache key
   * @returns {Promise<boolean>} Exists status
   */
  async exists(key) {
    if (!this.enabled || !this.redis) return false;

    try {
      const result = await this.redis.exists(key);
      return result === 1;
    } catch (error) {
      logger.error('Cache exists error', { key, error: error.message });
      return false;
    }
  }

  /**
   * Get remaining TTL for a key
   * @param {string} key - Cache key
   * @returns {Promise<number>} TTL in seconds (-1 if no expiry, -2 if key doesn't exist)
   */
  async ttlRemaining(key) {
    if (!this.enabled || !this.redis) return -2;

    try {
      return await this.redis.ttl(key);
    } catch (error) {
      logger.error('Cache TTL error', { key, error: error.message });
      return -2;
    }
  }

  /**
   * Cache active calls data
   * @param {Array} calls - Active calls array
   */
  async cacheActiveCalls(calls) {
    return this.set('calls:active', calls, this.ttl.activeCalls);
  }

  /**
   * Get cached active calls
   * @returns {Promise<Array|null>} Cached calls or null
   */
  async getActiveCalls() {
    return this.get('calls:active');
  }

  /**
   * Cache connection status
   * @param {Object} status - Connection status object
   */
  async cacheConnectionStatus(status) {
    return this.set('status:connections', status, this.ttl.connectionStatus);
  }

  /**
   * Get cached connection status
   * @returns {Promise<Object|null>} Cached status or null
   */
  async getConnectionStatus() {
    return this.get('status:connections');
  }

  /**
   * Cache API key validation result
   * @param {string} keyHash - API key hash
   * @param {Object} validationResult - Validation result
   */
  async cacheApiKeyValidation(keyHash, validationResult) {
    return this.set(`apikey:${keyHash}`, validationResult, this.ttl.apiKeyValidation);
  }

  /**
   * Get cached API key validation
   * @param {string} keyHash - API key hash
   * @returns {Promise<Object|null>} Cached validation or null
   */
  async getApiKeyValidation(keyHash) {
    return this.get(`apikey:${keyHash}`);
  }

  /**
   * Invalidate API key cache (e.g., after revocation)
   * @param {string} keyHash - API key hash
   */
  async invalidateApiKey(keyHash) {
    return this.del(`apikey:${keyHash}`);
  }

  /**
   * Invalidate all API key caches
   */
  async invalidateAllApiKeys() {
    return this.delPattern('apikey:*');
  }

  /**
   * Cache error statistics
   * @param {Object} stats - Error statistics
   */
  async cacheErrorStats(stats) {
    return this.set('stats:errors', stats, this.ttl.errorStats);
  }

  /**
   * Get cached error statistics
   * @returns {Promise<Object|null>} Cached stats or null
   */
  async getErrorStats() {
    return this.get('stats:errors');
  }

  /**
   * Cache database pool statistics
   * @param {Object} stats - Pool statistics
   */
  async cachePoolStats(stats) {
    return this.set('stats:pool', stats, this.ttl.poolStats);
  }

  /**
   * Get cached pool statistics
   * @returns {Promise<Object|null>} Cached stats or null
   */
  async getPoolStats() {
    return this.get('stats:pool');
  }

  /**
   * Get cache statistics
   * @returns {Promise<Object>} Cache statistics
   */
  async getStats() {
    if (!this.enabled || !this.redis) {
      return {
        enabled: false,
        status: 'disabled'
      };
    }

    try {
      const info = await this.redis.info('stats');
      const memory = await this.redis.info('memory');

      // Parse Redis INFO output
      const parseInfo = (str) => {
        const lines = str.split('\r\n');
        const result = {};
        lines.forEach(line => {
          if (line && !line.startsWith('#')) {
            const [key, value] = line.split(':');
            if (key && value) {
              result[key] = value;
            }
          }
        });
        return result;
      };

      const statsData = parseInfo(info);
      const memoryData = parseInfo(memory);

      return {
        enabled: true,
        status: 'connected',
        totalConnections: parseInt(statsData.total_connections_received || 0),
        totalCommands: parseInt(statsData.total_commands_processed || 0),
        usedMemory: memoryData.used_memory_human,
        keys: await this.redis.dbsize()
      };
    } catch (error) {
      logger.error('Failed to get cache stats', { error: error.message });
      return {
        enabled: false,
        status: 'error',
        error: error.message
      };
    }
  }

  /**
   * Flush all cache data (use with caution!)
   * @returns {Promise<boolean>} Success status
   */
  async flushAll() {
    if (!this.enabled || !this.redis) return false;

    try {
      await this.redis.flushdb();
      logger.warn('Cache flushed - all data cleared');
      return true;
    } catch (error) {
      logger.error('Cache flush error', { error: error.message });
      return false;
    }
  }

  /**
   * Close Redis connection
   */
  async disconnect() {
    if (this.redis) {
      await this.redis.quit();
      this.redis = null;
      this.enabled = false;
      logger.info('Redis connection closed');
    }
  }

  /**
   * Health check for Redis connection
   * @returns {Promise<boolean>} Health status
   */
  async healthCheck() {
    if (!this.enabled || !this.redis) return false;

    try {
      await this.redis.ping();
      return true;
    } catch (error) {
      return false;
    }
  }
}

module.exports = CacheManager;
