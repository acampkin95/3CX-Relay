const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');

/**
 * Winston Logger Configuration
 * Provides structured logging with daily rotation
 */

// Define log levels
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4
};

// Define colors for each level
const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'blue'
};

winston.addColors(colors);

// Define custom format
const customFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.metadata({ fillExcept: ['message', 'level', 'timestamp', 'label'] })
);

// Console format (colorized for development)
const consoleFormat = winston.format.combine(
  customFormat,
  winston.format.colorize({ all: true }),
  winston.format.printf(
    (info) => {
      const { timestamp, level, message, metadata } = info;
      let msg = `${timestamp} [${level}]: ${message}`;

      if (metadata && Object.keys(metadata).length > 0) {
        msg += ` ${JSON.stringify(metadata)}`;
      }

      return msg;
    }
  )
);

// File format (JSON for parsing)
const fileFormat = winston.format.combine(
  customFormat,
  winston.format.json()
);

// Create transports array
const transports = [
  // Console transport (always enabled)
  new winston.transports.Console({
    format: consoleFormat,
    level: process.env.LOG_LEVEL || 'info'
  })
];

// Add file transports in production
if (process.env.NODE_ENV !== 'test') {
  const logsDir = path.join(__dirname, '../logs');

  // Error logs (daily rotation)
  transports.push(
    new DailyRotateFile({
      filename: path.join(logsDir, 'error-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      level: 'error',
      format: fileFormat,
      maxSize: '20m',
      maxFiles: '14d',
      zippedArchive: true
    })
  );

  // Combined logs (daily rotation)
  transports.push(
    new DailyRotateFile({
      filename: path.join(logsDir, 'combined-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      format: fileFormat,
      maxSize: '20m',
      maxFiles: '30d',
      zippedArchive: true
    })
  );
}

// Create logger instance
const logger = winston.createLogger({
  levels,
  transports,
  exitOnError: false
});

/**
 * Helper function to create child logger with component context
 * @param {string} component - Component name
 * @returns {winston.Logger} Child logger
 */
logger.component = function(componentName) {
  return logger.child({ component: componentName });
};

/**
 * HTTP request logger middleware
 */
logger.httpLogger = (req, res, next) => {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    const logData = {
      method: req.method,
      url: req.url,
      status: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip || req.connection.remoteAddress
    };

    if (res.statusCode >= 500) {
      logger.error('HTTP request failed', logData);
    } else if (res.statusCode >= 400) {
      logger.warn('HTTP request error', logData);
    } else {
      logger.http('HTTP request', logData);
    }
  });

  next();
};

/**
 * Error logger for Express
 */
logger.errorLogger = (err, req, res, next) => {
  logger.error('Express error', {
    error: err.message,
    stack: err.stack,
    method: req.method,
    url: req.url,
    ip: req.ip || req.connection.remoteAddress
  });

  next(err);
};

module.exports = logger;
