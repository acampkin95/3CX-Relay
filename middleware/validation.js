const Joi = require('joi');

/**
 * Request validation middleware using Joi
 */

// Common validation schemas
const schemas = {
  // Login validation
  login: Joi.object({
    username: Joi.string().alphanum().min(3).max(50).required(),
    password: Joi.string().min(6).max(100).required()
  }),

  // API key generation
  apiKeyGeneration: Joi.object({
    clientName: Joi.string().min(3).max(100).required(),
    permissions: Joi.array().items(Joi.string().valid('read', 'write', 'admin')).min(1).default(['read'])
  }),

  // User creation
  userCreation: Joi.object({
    username: Joi.string().alphanum().min(3).max(50).required(),
    password: Joi.string().min(8).max(100).required()
      .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
      .message('Password must contain uppercase, lowercase, and number'),
    role: Joi.string().valid('admin', 'viewer').default('viewer')
  }),

  // Password change
  passwordChange: Joi.object({
    oldPassword: Joi.string().required(),
    newPassword: Joi.string().min(8).max(100).required()
      .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
      .message('Password must contain uppercase, lowercase, and number')
  }),

  // Error query parameters
  errorQuery: Joi.object({
    component: Joi.string().valid('database', 'xapi', 'websocket', 'relay', 'admin', 'system').optional(),
    severity: Joi.string().valid('critical', 'error', 'warning', 'info').optional(),
    acknowledged: Joi.boolean().optional(),
    limit: Joi.number().integer().min(1).max(1000).default(100)
  }),

  // Reconnect component parameter
  reconnectComponent: Joi.object({
    component: Joi.string().valid('database', 'xapi', 'websocket').required()
  }),

  // ID parameter
  idParam: Joi.object({
    id: Joi.number().integer().positive().required()
  })
};

/**
 * Create validation middleware for request body
 * @param {Joi.Schema} schema - Joi validation schema
 * @returns {Function} Express middleware
 */
function validateBody(schema) {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true
    });

    if (error) {
      const errors = error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message
      }));

      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors
      });
    }

    // Replace req.body with validated and sanitized value
    req.body = value;
    next();
  };
}

/**
 * Create validation middleware for query parameters
 * @param {Joi.Schema} schema - Joi validation schema
 * @returns {Function} Express middleware
 */
function validateQuery(schema) {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.query, {
      abortEarly: false,
      stripUnknown: true
    });

    if (error) {
      const errors = error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message
      }));

      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors
      });
    }

    // Replace req.query with validated value
    req.query = value;
    next();
  };
}

/**
 * Create validation middleware for URL parameters
 * @param {Joi.Schema} schema - Joi validation schema
 * @returns {Function} Express middleware
 */
function validateParams(schema) {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.params, {
      abortEarly: false,
      stripUnknown: true
    });

    if (error) {
      const errors = error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message
      }));

      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors
      });
    }

    // Replace req.params with validated value
    req.params = value;
    next();
  };
}

module.exports = {
  schemas,
  validateBody,
  validateQuery,
  validateParams
};
