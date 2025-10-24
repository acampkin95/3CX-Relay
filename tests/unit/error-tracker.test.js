const ErrorTracker = require('../../lib/error-tracker');

describe('ErrorTracker', () => {
  let errorTracker;

  beforeEach(() => {
    errorTracker = new ErrorTracker();
  });

  describe('logError', () => {
    it('should log an error and return error ID', () => {
      const errorId = errorTracker.logError('test-component', 'error', 'Test error message');

      expect(errorId).toBeDefined();
      expect(typeof errorId).toBe('number');
      expect(errorTracker.errors.length).toBe(1);
    });

    it('should store error with correct properties', () => {
      errorTracker.logError('database', 'critical', 'Connection failed', { retries: 3 });

      const error = errorTracker.errors[0];
      expect(error.component).toBe('database');
      expect(error.severity).toBe('critical');
      expect(error.message).toBe('Connection failed');
      expect(error.details).toEqual({ retries: 3 });
      expect(error.acknowledged).toBe(false);
      expect(error.timestamp).toBeInstanceOf(Date);
    });

    it('should maintain maximum buffer size of 1000', () => {
      // Log 1100 errors
      for (let i = 0; i < 1100; i++) {
        errorTracker.logError('test', 'info', `Error ${i}`);
      }

      expect(errorTracker.errors.length).toBe(1000);
    });

    it('should emit new_error event', (done) => {
      errorTracker.on('new_error', (error) => {
        expect(error.component).toBe('test');
        expect(error.message).toBe('Test event');
        done();
      });

      errorTracker.logError('test', 'warn', 'Test event');
    });
  });

  describe('getErrors', () => {
    beforeEach(() => {
      errorTracker.logError('database', 'critical', 'DB Error 1');
      errorTracker.logError('xapi', 'error', 'XAPI Error 1');
      errorTracker.logError('database', 'warning', 'DB Warning 1');
      errorTracker.logError('websocket', 'info', 'WS Info 1');
    });

    it('should return all errors when no filter', () => {
      const errors = errorTracker.getErrors();
      expect(errors.length).toBe(4);
    });

    it('should filter by component', () => {
      const errors = errorTracker.getErrors({ component: 'database' });
      expect(errors.length).toBe(2);
      expect(errors.every(e => e.component === 'database')).toBe(true);
    });

    it('should filter by severity', () => {
      const errors = errorTracker.getErrors({ severity: 'critical' });
      expect(errors.length).toBe(1);
      expect(errors[0].severity).toBe('critical');
    });

    it('should filter by acknowledged status', () => {
      errorTracker.errors[0].acknowledged = true;

      const acknowledged = errorTracker.getErrors({ acknowledged: true });
      const unacknowledged = errorTracker.getErrors({ acknowledged: false });

      expect(acknowledged.length).toBe(1);
      expect(unacknowledged.length).toBe(3);
    });

    it('should limit results', () => {
      const errors = errorTracker.getErrors({ limit: 2 });
      expect(errors.length).toBe(2);
    });
  });

  describe('acknowledgeError', () => {
    it('should acknowledge an error by ID', () => {
      const errorId = errorTracker.logError('test', 'error', 'Test error');
      const result = errorTracker.acknowledgeError(errorId);

      expect(result).toBe(true);
      expect(errorTracker.errors[0].acknowledged).toBe(true);
    });

    it('should return false for non-existent error ID', () => {
      const result = errorTracker.acknowledgeError(999999);
      expect(result).toBe(false);
    });
  });

  describe('getStatistics', () => {
    beforeEach(() => {
      errorTracker.logError('database', 'critical', 'Error 1');
      errorTracker.logError('xapi', 'error', 'Error 2');
      errorTracker.logError('database', 'warning', 'Error 3');
      errorTracker.logError('websocket', 'info', 'Error 4');
      errorTracker.acknowledgeError(errorTracker.errors[0].id);
    });

    it('should return correct statistics', () => {
      const stats = errorTracker.getStatistics();

      expect(stats.total).toBe(4);
      expect(stats.acknowledged).toBe(1);
      expect(stats.unacknowledged).toBe(3);
      expect(stats.bySeverity.critical).toBe(1);
      expect(stats.bySeverity.error).toBe(1);
      expect(stats.bySeverity.warning).toBe(1);
      expect(stats.bySeverity.info).toBe(1);
      expect(stats.byComponent.database).toBe(2);
      expect(stats.byComponent.xapi).toBe(1);
    });

    it('should count errors in last 24 hours', () => {
      const stats = errorTracker.getStatistics();
      expect(stats.last24Hours).toBe(4);
    });
  });

  describe('clearAcknowledged', () => {
    it('should clear acknowledged errors', () => {
      errorTracker.logError('test', 'error', 'Error 1');
      errorTracker.logError('test', 'error', 'Error 2');
      errorTracker.logError('test', 'error', 'Error 3');

      errorTracker.acknowledgeError(errorTracker.errors[0].id);
      errorTracker.acknowledgeError(errorTracker.errors[1].id);

      const cleared = errorTracker.clearAcknowledged();

      expect(cleared).toBe(2);
      expect(errorTracker.errors.length).toBe(1);
      expect(errorTracker.errors[0].acknowledged).toBe(false);
    });
  });
});
