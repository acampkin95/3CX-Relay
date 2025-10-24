const APIKeyManager = require('../../lib/api-key-manager');

// Mock database client
const mockDbClient = {
  query: jest.fn()
};

const mockDb = {
  client: mockDbClient
};

describe('APIKeyManager', () => {
  let apiKeyManager;

  beforeEach(() => {
    apiKeyManager = new APIKeyManager(mockDb);
    jest.clearAllMocks();
  });

  describe('generateKey', () => {
    it('should generate a new API key', async () => {
      mockDbClient.query.mockResolvedValue({
        rows: [{
          id: 1,
          client_name: 'Test Client',
          permissions: ['read'],
          created_at: new Date()
        }]
      });

      const result = await apiKeyManager.generateKey('Test Client', ['read'], 'admin');

      expect(result).toHaveProperty('apiKey');
      expect(result).toHaveProperty('id');
      expect(result).toHaveProperty('warning');
      expect(result.apiKey).toMatch(/^[a-f0-9]{64}$/);
      expect(result.clientName).toBe('Test Client');
      expect(mockDbClient.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO api_keys'),
        expect.arrayContaining(['Test Client', expect.any(String), '["read"]', 'admin'])
      );
    });

    it('should use default permissions if not provided', async () => {
      mockDbClient.query.mockResolvedValue({
        rows: [{ id: 1, client_name: 'Test', permissions: ['read'], created_at: new Date() }]
      });

      await apiKeyManager.generateKey('Test');

      expect(mockDbClient.query).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([expect.any(String), expect.any(String), '["read"]', 'system'])
      );
    });
  });

  describe('validateKey', () => {
    it('should validate a correct API key', async () => {
      const testKey = 'a'.repeat(64);
      mockDbClient.query.mockResolvedValue({
        rows: [{
          id: 1,
          client_name: 'Test Client',
          key_hash: '$2a$10$validhashedkey',
          permissions: '["read","write"]'
        }]
      });

      // Mock bcrypt.compare to return true
      const bcrypt = require('bcryptjs');
      bcrypt.compare = jest.fn().mockResolvedValue(true);

      const result = await apiKeyManager.validateKey(testKey);

      expect(result).toBeDefined();
      expect(result.id).toBe(1);
      expect(result.clientName).toBe('Test Client');
      expect(result.permissions).toEqual(['read', 'write']);
    });

    it('should return null for invalid API key', async () => {
      mockDbClient.query.mockResolvedValue({ rows: [] });

      const result = await apiKeyManager.validateKey('invalid-key');

      expect(result).toBeNull();
    });
  });

  describe('revokeKey', () => {
    it('should revoke an API key', async () => {
      mockDbClient.query.mockResolvedValue({ rows: [] });

      const result = await apiKeyManager.revokeKey(1, 'admin');

      expect(result).toBe(true);
      expect(mockDbClient.query).toHaveBeenCalledWith(
        'UPDATE api_keys SET active = false, revoked_by = $1, revoked_at = NOW() WHERE id = $2',
        ['admin', 1]
      );
    });
  });

  describe('listKeys', () => {
    it('should list all API keys', async () => {
      const mockKeys = [
        {
          id: 1,
          client_name: 'Client 1',
          permissions: '["read"]',
          active: true,
          created_by: 'admin',
          created_at: new Date()
        },
        {
          id: 2,
          client_name: 'Client 2',
          permissions: '["read","write"]',
          active: false,
          created_by: 'admin',
          created_at: new Date()
        }
      ];

      mockDbClient.query.mockResolvedValue({ rows: mockKeys });

      const result = await apiKeyManager.listKeys();

      expect(result).toHaveLength(2);
      expect(result[0].permissions).toEqual(['read']);
      expect(result[1].permissions).toEqual(['read', 'write']);
    });
  });

  describe('getKeyUsage', () => {
    it('should return usage statistics for an API key', async () => {
      mockDbClient.query.mockResolvedValue({
        rows: [{
          total_requests: '150',
          successful_requests: '145',
          failed_requests: '5',
          avg_response_time: '250',
          last_used: new Date()
        }]
      });

      const result = await apiKeyManager.getKeyUsage(1);

      expect(result.total_requests).toBe('150');
      expect(result.successful_requests).toBe('145');
      expect(result.failed_requests).toBe('5');
      expect(mockDbClient.query).toHaveBeenCalledWith(
        expect.stringContaining('FROM api_requests'),
        [1]
      );
    });
  });

  describe('logRequest', () => {
    it('should log an API request', async () => {
      mockDbClient.query.mockResolvedValue({ rows: [] });

      await apiKeyManager.logRequest(1, '/relay/active-calls', 'GET', 200, 150);

      expect(mockDbClient.query).toHaveBeenCalledWith(
        'INSERT INTO api_requests (api_key_id, endpoint, method, status_code, response_time, timestamp) VALUES ($1, $2, $3, $4, $5, NOW())',
        [1, '/relay/active-calls', 'GET', 200, 150]
      );
    });
  });
});
