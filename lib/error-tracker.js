const EventEmitter = require('events');

/**
 * ErrorTracker - Tracks and manages application errors
 */
class ErrorTracker extends EventEmitter {
  constructor(dbClient = null) {
    super();
    this.db = dbClient;
    this.errors = [];
    this.maxBufferSize = 1000;
  }

  /**
   * Log an error
   * @param {string} component - Component name (db, xapi, websocket, relay, admin)
   * @param {string} severity - Severity level (critical, error, warning, info)
   * @param {string} message - Error message
   * @param {Object} details - Additional error details
   * @returns {number} Error ID
   */
  logError(component, severity, message, details = null) {
    const error = {
      id: Date.now() + Math.random(),
      timestamp: new Date(),
      component,
      severity,
      message,
      details,
      acknowledged: false
    };

    this.errors.unshift(error);
    
    if (this.errors.length > this.maxBufferSize) {
      this.errors.pop();
    }

    console.error('[' + severity.toUpperCase() + '] ' + component + ':', message);

    if (this.db && this.db.client) {
      this.persistError(error).catch(err => {
        console.error('Failed to persist error to database:', err.message);
      });
    }

    this.emit('new_error', error);
    
    return error.id;
  }

  /**
   * Persist error to database
   * @param {Object} error - Error object
   * @returns {Promise<void>}
   */
  async persistError(error) {
    try {
      await this.db.client.query(
        'INSERT INTO error_log (timestamp, component, severity, message, details, acknowledged) VALUES ($1, $2, $3, $4, $5, $6)',
        [error.timestamp, error.component, error.severity, error.message, JSON.stringify(error.details), error.acknowledged]
      );
    } catch (err) {
      console.error('Database error logging failed:', err.message);
    }
  }

  /**
   * Get errors with optional filters
   * @param {Object} filters - Filter options
   * @returns {Array} Filtered errors
   */
  getErrors(filters = {}) {
    let filtered = [...this.errors];

    if (filters.component) {
      filtered = filtered.filter(e => e.component === filters.component);
    }

    if (filters.severity) {
      filtered = filtered.filter(e => e.severity === filters.severity);
    }

    if (filters.acknowledged !== undefined) {
      filtered = filtered.filter(e => e.acknowledged === filters.acknowledged);
    }

    if (filters.limit) {
      filtered = filtered.slice(0, filters.limit);
    }

    return filtered;
  }

  /**
   * Acknowledge an error
   * @param {number} errorId - Error ID
   * @returns {boolean} Success status
   */
  acknowledgeError(errorId) {
    const error = this.errors.find(e => e.id === errorId);
    
    if (error) {
      error.acknowledged = true;
      
      if (this.db && this.db.client) {
        this.db.client.query(
          'UPDATE error_log SET acknowledged = true WHERE timestamp = $1 AND component = $2',
          [error.timestamp, error.component]
        ).catch(err => {
          console.error('Failed to update error in database:', err.message);
        });
      }
      
      return true;
    }
    
    return false;
  }

  /**
   * Get error statistics
   * @returns {Object} Error statistics
   */
  getStatistics() {
    const stats = {
      total: this.errors.length,
      bySeverity: {},
      byComponent: {},
      acknowledged: 0,
      unacknowledged: 0,
      last24Hours: 0
    };

    const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);

    this.errors.forEach(error => {
      stats.bySeverity[error.severity] = (stats.bySeverity[error.severity] || 0) + 1;
      stats.byComponent[error.component] = (stats.byComponent[error.component] || 0) + 1;
      
      if (error.acknowledged) {
        stats.acknowledged++;
      } else {
        stats.unacknowledged++;
      }

      if (error.timestamp.getTime() > oneDayAgo) {
        stats.last24Hours++;
      }
    });

    return stats;
  }

  /**
   * Clear acknowledged errors from buffer
   * @returns {number} Number of errors cleared
   */
  clearAcknowledged() {
    const initialLength = this.errors.length;
    this.errors = this.errors.filter(e => !e.acknowledged);
    return initialLength - this.errors.length;
  }
}

module.exports = ErrorTracker;
