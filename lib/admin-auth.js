const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

/**
 * AdminAuth - Handles admin user authentication and authorization
 */
class AdminAuth {
  constructor(dbClient) {
    this.db = dbClient;
    this.jwtSecret = process.env.ADMIN_SECRET || 'change-this-secret-in-production';
    this.tokenExpiry = '24h';
    this.bcryptRounds = 12;
  }

  /**
   * Create a new admin user
   * @param {string} username
   * @param {string} password
   * @param {string} role - 'admin' or 'viewer'
   * @returns {Promise<Object>} Created user (without password)
   */
  async createUser(username, password, role = 'viewer') {
    const hashedPassword = await bcrypt.hash(password, this.bcryptRounds);
    
    const result = await this.db.client.query(
      'INSERT INTO admin_users (username, password, role) VALUES ($1, $2, $3) RETURNING id, username, role',
      [username, hashedPassword, role]
    );
    
    return result.rows[0];
  }

  /**
   * Authenticate user and generate JWT token
   * @param {string} username
   * @param {string} password
   * @returns {Promise<Object>} Token and user info
   */
  async login(username, password) {
    const result = await this.db.client.query(
      'SELECT id, username, password, role FROM admin_users WHERE username = $1',
      [username]
    );

    if (result.rows.length === 0) {
      throw new Error('Invalid credentials');
    }

    const user = result.rows[0];
    const isValid = await bcrypt.compare(password, user.password);

    if (!isValid) {
      throw new Error('Invalid credentials');
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      this.jwtSecret,
      { expiresIn: this.tokenExpiry }
    );

    return {
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role
      }
    };
  }

  /**
   * Verify JWT token
   * @param {string} token
   * @returns {Object} Decoded token payload
   */
  verifyToken(token) {
    try {
      return jwt.verify(token, this.jwtSecret);
    } catch (error) {
      throw new Error('Invalid or expired token');
    }
  }

  /**
   * Change user password
   * @param {number} userId
   * @param {string} oldPassword
   * @param {string} newPassword
   * @returns {Promise<boolean>} Success status
   */
  async changePassword(userId, oldPassword, newPassword) {
    const result = await this.db.client.query(
      'SELECT password FROM admin_users WHERE id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      throw new Error('User not found');
    }

    const isValid = await bcrypt.compare(oldPassword, result.rows[0].password);
    if (!isValid) {
      throw new Error('Invalid current password');
    }

    const hashedPassword = await bcrypt.hash(newPassword, this.bcryptRounds);
    await this.db.client.query(
      'UPDATE admin_users SET password = $1 WHERE id = $2',
      [hashedPassword, userId]
    );

    return true;
  }

  /**
   * Get all users (without passwords)
   * @returns {Promise<Array>} List of users
   */
  async getAllUsers() {
    const result = await this.db.client.query(
      'SELECT id, username, role FROM admin_users ORDER BY username'
    );
    return result.rows;
  }

  /**
   * Delete user
   * @param {number} userId
   * @returns {Promise<boolean>} Success status
   */
  async deleteUser(userId) {
    await this.db.client.query('DELETE FROM admin_users WHERE id = $1', [userId]);
    return true;
  }
}

module.exports = AdminAuth;
