const jwt = require('jsonwebtoken');

/**
 * Authentication middleware factory
 */
function createAuthMiddleware(adminAuth) {
  /**
   * Require authentication middleware
   */
  function requireAuth(req, res, next) {
    // Try to get token from Authorization header or cookie
    let token = null;
    
    if (req.headers.authorization) {
      token = req.headers.authorization.replace('Bearer ', '');
    } else if (req.cookies && req.cookies.admin_token) {
      token = req.cookies.admin_token;
    }

    if (!token) {
      return res.status(401).json({ 
        success: false, 
        error: 'Authentication required' 
      });
    }

    try {
      const decoded = adminAuth.verifyToken(token);
      req.user = decoded;
      next();
    } catch (error) {
      return res.status(401).json({ 
        success: false, 
        error: 'Invalid or expired token' 
      });
    }
  }

  /**
   * Require admin role middleware
   */
  function requireAdmin(req, res, next) {
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({ 
        success: false, 
        error: 'Admin privileges required' 
      });
    }
    next();
  }

  /**
   * Optional auth middleware (doesn't fail if no token)
   */
  function optionalAuth(req, res, next) {
    let token = null;
    
    if (req.headers.authorization) {
      token = req.headers.authorization.replace('Bearer ', '');
    } else if (req.cookies && req.cookies.admin_token) {
      token = req.cookies.admin_token;
    }

    if (token) {
      try {
        req.user = adminAuth.verifyToken(token);
      } catch (error) {
        // Token invalid, but continue anyway
      }
    }
    
    next();
  }

  return {
    requireAuth,
    requireAdmin,
    optionalAuth
  };
}

module.exports = createAuthMiddleware;
