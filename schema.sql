-- 3CX Relay Module Database Schema
-- PostgreSQL schema for custom tables (separate from 3CX tables)

-- Admin Users Table
CREATE TABLE IF NOT EXISTS admin_users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'viewer',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_login TIMESTAMP
);

-- Create indexes on admin_users
CREATE INDEX IF NOT EXISTS idx_admin_users_username ON admin_users(username);

-- API Keys Table
CREATE TABLE IF NOT EXISTS api_keys (
  id SERIAL PRIMARY KEY,
  client_name VARCHAR(100) NOT NULL,
  key_hash VARCHAR(255) NOT NULL,
  permissions JSONB DEFAULT '["read"]'::jsonb,
  active BOOLEAN DEFAULT true,
  created_by VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  revoked_by VARCHAR(50),
  revoked_at TIMESTAMP
);

-- Create indexes on api_keys
CREATE INDEX IF NOT EXISTS idx_api_keys_active ON api_keys(active);
CREATE INDEX IF NOT EXISTS idx_api_keys_client_name ON api_keys(client_name);

-- GIN index for JSONB permissions column
CREATE INDEX IF NOT EXISTS idx_api_keys_permissions_gin ON api_keys USING GIN (permissions);

-- API Requests Table (for usage tracking)
CREATE TABLE IF NOT EXISTS api_requests (
  id SERIAL PRIMARY KEY,
  api_key_id INTEGER REFERENCES api_keys(id) ON DELETE CASCADE,
  endpoint VARCHAR(255) NOT NULL,
  method VARCHAR(10) NOT NULL,
  status_code INTEGER,
  response_time INTEGER,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes on api_requests
CREATE INDEX IF NOT EXISTS idx_api_requests_api_key_id ON api_requests(api_key_id);
CREATE INDEX IF NOT EXISTS idx_api_requests_timestamp ON api_requests(timestamp DESC);

-- Composite indexes for api_requests analytics
CREATE INDEX IF NOT EXISTS idx_api_requests_key_time ON api_requests(api_key_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_api_requests_endpoint_time ON api_requests(endpoint, timestamp DESC);

-- Error Log Table
CREATE TABLE IF NOT EXISTS error_log (
  id SERIAL PRIMARY KEY,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  component VARCHAR(50) NOT NULL,
  severity VARCHAR(20) NOT NULL,
  message TEXT NOT NULL,
  details JSONB,
  acknowledged BOOLEAN DEFAULT false,
  acknowledged_by VARCHAR(50),
  acknowledged_at TIMESTAMP
);

-- Create indexes on error_log
CREATE INDEX IF NOT EXISTS idx_error_log_timestamp ON error_log(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_error_log_component ON error_log(component);
CREATE INDEX IF NOT EXISTS idx_error_log_severity ON error_log(severity);
CREATE INDEX IF NOT EXISTS idx_error_log_acknowledged ON error_log(acknowledged);

-- Composite indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_error_log_comp_sev_time ON error_log(component, severity, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_error_log_ack_time ON error_log(acknowledged, timestamp DESC);

-- GIN index for JSONB details column for faster JSON queries
CREATE INDEX IF NOT EXISTS idx_error_log_details_gin ON error_log USING GIN (details);

-- Connection Status History Table
CREATE TABLE IF NOT EXISTS connection_status_history (
  id SERIAL PRIMARY KEY,
  component VARCHAR(50) NOT NULL,
  state VARCHAR(20) NOT NULL,
  latency INTEGER,
  error_message TEXT,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes on connection_status_history
CREATE INDEX IF NOT EXISTS idx_conn_status_component ON connection_status_history(component);
CREATE INDEX IF NOT EXISTS idx_conn_status_timestamp ON connection_status_history(timestamp);

-- Create a function to clean up old records (optional)
CREATE OR REPLACE FUNCTION cleanup_old_records()
RETURNS void AS $$
BEGIN
  -- Delete API requests older than 90 days
  DELETE FROM api_requests WHERE timestamp < NOW() - INTERVAL '90 days';
  
  -- Delete connection status history older than 30 days
  DELETE FROM connection_status_history WHERE timestamp < NOW() - INTERVAL '30 days';
  
  -- Delete acknowledged errors older than 30 days
  DELETE FROM error_log WHERE acknowledged = true AND timestamp < NOW() - INTERVAL '30 days';
END;
$$ LANGUAGE plpgsql;

-- Insert default admin user (password: admin123 - CHANGE THIS!)
-- Password hash for 'admin123' with bcrypt rounds=12
INSERT INTO admin_users (username, password, role)
VALUES ('admin', '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewY5GyYCNJqYqR9W', 'admin')
ON CONFLICT (username) DO NOTHING;

-- Display information
DO $$
BEGIN
  RAISE NOTICE 'Schema created successfully!';
  RAISE NOTICE 'Default admin user created: username=admin, password=admin123';
  RAISE NOTICE 'IMPORTANT: Change the default admin password immediately!';
END
$$;
