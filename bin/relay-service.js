#!/usr/bin/env node

/**
 * 3CX Relay Service - Main Entry Point
 */

require('dotenv').config();
const RelayService = require('../lib/relay-server');

// Configuration from environment variables
const config = {
  fqdn: process.env.FQDN || 'localhost',
  clientId: process.env.CLIENT_ID || '',
  clientSecret: process.env.CLIENT_SECRET || '',
  port: parseInt(process.env.PORT || '8082'),
  host: process.env.HOST || '127.0.0.1'
};

// Validate required configuration
if (!config.clientId || !config.clientSecret) {
  console.error('ERROR: CLIENT_ID and CLIENT_SECRET must be set in environment variables');
  console.error('Please create a .env file with the required configuration');
  process.exit(1);
}

console.log('='.repeat(60));
console.log('3CX Relay Service');
console.log('='.repeat(60));
console.log('Configuration:');
console.log('  FQDN:', config.fqdn);
console.log('  Port:', config.port);
console.log('  Host:', config.host);
console.log('='.repeat(60));

// Create and initialize relay service
const relay = new RelayService(config);

// Handle graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully...');
  await relay.shutdown();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down gracefully...');
  await relay.shutdown();
  process.exit(0);
});

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  if (relay.errorTracker) {
    relay.errorTracker.logError('system', 'critical', 'Uncaught exception', { error: error.message, stack: error.stack });
  }
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  if (relay.errorTracker) {
    relay.errorTracker.logError('system', 'critical', 'Unhandled promise rejection', { reason: String(reason) });
  }
});

// Start the service
(async () => {
  try {
    await relay.initialize();
    relay.start(config.port, config.host);
  } catch (error) {
    console.error('Failed to start relay service:', error);
    process.exit(1);
  }
})();
