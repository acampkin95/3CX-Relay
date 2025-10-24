const express = require('express');
const rateLimit = require('express-rate-limit');
const createAuthMiddleware = require('../middleware/auth-middleware');

/**
 * Create admin routes
 */
function createAdminRoutes(adminAuth, apiKeyManager, connectionMonitor, errorTracker, stats) {
  const router = express.Router();
  const { requireAuth, requireAdmin } = createAuthMiddleware(adminAuth);

  // Rate limiter for login
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // 5 attempts
    message: { success: false, error: 'Too many login attempts, please try again later' }
  });

  // Rate limiter for API key generation
  const apiKeyLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 10, // 10 keys per hour
    message: { success: false, error: 'Too many API key requests' }
  });

  // Public routes (no auth required)
  
  /**
   * GET /admin/login - Render login page
   */
  router.get('/login', (req, res) => {
    res.render('login', { error: null });
  });

  /**
   * POST /admin/login - Authenticate admin user
   */
  router.post('/login', loginLimiter, async (req, res) => {
    try {
      const { username, password } = req.body;
      
      if (!username || !password) {
        return res.status(400).json({ 
          success: false, 
          error: 'Username and password required' 
        });
      }

      const result = await adminAuth.login(username, password);
      
      // Set HttpOnly cookie
      res.cookie('admin_token', result.token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
      });

      res.json({
        success: true,
        user: result.user,
        token: result.token
      });
    } catch (error) {
      res.status(401).json({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * POST /admin/logout - Clear session
   */
  router.post('/logout', (req, res) => {
    res.clearCookie('admin_token');
    res.json({ success: true, message: 'Logged out successfully' });
  });

  // Protected routes (auth required)
  router.use(requireAuth);

  /**
   * GET /admin/dashboard - Render admin dashboard
   */
  router.get('/dashboard', (req, res) => {
    res.render('dashboard', { user: req.user });
  });

  /**
   * GET /admin/stats - Get system statistics
   */
  router.get('/stats', (req, res) => {
    const errorStats = errorTracker.getStatistics();
    
    res.json({
      success: true,
      data: {
        ...stats,
        uptime: Date.now() - stats.startTime.getTime(),
        errors: errorStats
      }
    });
  });

  /**
   * GET /admin/connections - Get connection status
   */
  router.get('/connections', (req, res) => {
    res.json({
      success: true,
      data: connectionMonitor.getStatus()
    });
  });

  /**
   * POST /admin/connections/:component/reconnect - Manual reconnect
   */
  router.post('/connections/:component/reconnect', requireAdmin, async (req, res) => {
    const { component } = req.params;
    
    try {
      let result = false;
      
      switch (component) {
        case 'database':
          result = await connectionMonitor.reconnectDatabase();
          break;
        case 'xapi':
          result = await connectionMonitor.reconnectXAPI();
          break;
        case 'websocket':
          result = await connectionMonitor.reconnectWebSocket();
          break;
        default:
          return res.status(400).json({
            success: false,
            error: 'Invalid component'
          });
      }

      res.json({
        success: result,
        message: result ? 'Reconnect successful' : 'Reconnect failed'
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * GET /admin/errors - Get error feed
   */
  router.get('/errors', (req, res) => {
    const filters = {
      component: req.query.component,
      severity: req.query.severity,
      acknowledged: req.query.acknowledged === 'true',
      limit: parseInt(req.query.limit || '100')
    };

    const errors = errorTracker.getErrors(filters);
    
    res.json({
      success: true,
      data: errors
    });
  });

  /**
   * POST /admin/errors/:id/acknowledge - Acknowledge error
   */
  router.post('/errors/:id/acknowledge', async (req, res) => {
    const errorId = parseFloat(req.params.id);
    const result = errorTracker.acknowledgeError(errorId);
    
    res.json({
      success: result,
      message: result ? 'Error acknowledged' : 'Error not found'
    });
  });

  /**
   * GET /admin/errors/stats - Get error statistics
   */
  router.get('/errors/stats', (req, res) => {
    res.json({
      success: true,
      data: errorTracker.getStatistics()
    });
  });

  // Admin-only routes
  router.use(requireAdmin);

  /**
   * GET /admin/api-keys - List all API keys
   */
  router.get('/api-keys', async (req, res) => {
    try {
      const keys = await apiKeyManager.listKeys();
      res.json({
        success: true,
        data: keys
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * POST /admin/api-keys - Generate new API key
   */
  router.post('/api-keys', apiKeyLimiter, async (req, res) => {
    try {
      const { clientName, permissions } = req.body;
      
      if (!clientName) {
        return res.status(400).json({
          success: false,
          error: 'Client name required'
        });
      }

      const result = await apiKeyManager.generateKey(
        clientName,
        permissions || ['read'],
        req.user.username
      );

      res.json({
        success: true,
        data: result
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * DELETE /admin/api-keys/:id - Revoke API key
   */
  router.delete('/api-keys/:id', async (req, res) => {
    try {
      const keyId = parseInt(req.params.id);
      await apiKeyManager.revokeKey(keyId, req.user.username);
      
      res.json({
        success: true,
        message: 'API key revoked'
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * GET /admin/api-keys/:id/usage - Get API key usage stats
   */
  router.get('/api-keys/:id/usage', async (req, res) => {
    try {
      const keyId = parseInt(req.params.id);
      const usage = await apiKeyManager.getKeyUsage(keyId);
      
      res.json({
        success: true,
        data: usage
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * GET /admin/users - List all admin users
   */
  router.get('/users', async (req, res) => {
    try {
      const users = await adminAuth.getAllUsers();
      res.json({
        success: true,
        data: users
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * POST /admin/users - Create new admin user
   */
  router.post('/users', async (req, res) => {
    try {
      const { username, password, role } = req.body;
      
      if (!username || !password) {
        return res.status(400).json({
          success: false,
          error: 'Username and password required'
        });
      }

      const user = await adminAuth.createUser(username, password, role || 'viewer');
      
      res.json({
        success: true,
        data: user
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * DELETE /admin/users/:id - Delete user
   */
  router.delete('/users/:id', async (req, res) => {
    try {
      const userId = parseInt(req.params.id);
      
      // Prevent deleting yourself
      if (userId === req.user.id) {
        return res.status(400).json({
          success: false,
          error: 'Cannot delete your own account'
        });
      }

      await adminAuth.deleteUser(userId);
      
      res.json({
        success: true,
        message: 'User deleted'
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  return router;
}

module.exports = createAdminRoutes;
