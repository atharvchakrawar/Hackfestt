const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('../config');
const { query } = require('../db/pool');

/**
 * Hash a plain-text password.
 * @param {string} password
 * @returns {Promise<string>}
 */
async function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

/**
 * Compare password with hash.
 * @param {string} password
 * @param {string} hash
 * @returns {Promise<boolean>}
 */
async function comparePassword(password, hash) {
  return bcrypt.compare(password, hash);
}

/**
 * Create a signed JWT for a user.
 * @param {{ id: string, email: string, role: string, name: string }} user
 * @returns {string}
 */
function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role, name: user.name },
    config.jwtSecret,
    { expiresIn: '7d' }
  );
}

/**
 * Verify JWT and return payload.
 * @param {string} token
 * @returns {object}
 */
function verifyToken(token) {
  return jwt.verify(token, config.jwtSecret);
}

/**
 * Extract bearer token from Authorization header.
 * @param {import('express').Request} req
 * @returns {string|null}
 */
function extractToken(req) {
  const auth = req.headers.authorization || '';
  return auth.startsWith('Bearer ') ? auth.slice(7) : null;
}

/**
 * Require authenticated user with optional role check.
 * @param {...string} roles
 * @returns {import('express').RequestHandler}
 */
function requireAuth(...roles) {
  return async (req, res, next) => {
    try {
      const token = extractToken(req);
      if (!token) return res.status(401).json({ error: 'Token missing' });

      const payload = verifyToken(token);
      let result = await query(
        'SELECT id, email, name, role, avatar_url, auth_provider FROM users WHERE id = $1',
        [payload.id]
      );
      if (!result.rows[0] && config.nodeEnv !== 'production') {
        await query(
          `INSERT INTO users (id, email, name, role, auth_provider)
           VALUES ($1, $2, $3, $4, 'local')
           ON CONFLICT (id) DO NOTHING`,
          [payload.id, payload.email, payload.name || payload.email, payload.role]
        );
        result = await query(
          'SELECT id, email, name, role, avatar_url, auth_provider FROM users WHERE id = $1',
          [payload.id]
        );
      }
      if (!result.rows[0]) return res.status(401).json({ error: 'User not found. Please login again.' });

      if (roles.length && !roles.includes(result.rows[0].role)) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }

      req.user = result.rows[0];
      next();
    } catch (err) {
      return res.status(401).json({ error: 'Invalid token', detail: err.message });
    }
  };
}

/** @type {import('express').RequestHandler} */
const isStudent = requireAuth('student');
/** @type {import('express').RequestHandler} */
const isOrganizer = requireAuth('organizer');
/** @type {import('express').RequestHandler} */
const isAdmin = requireAuth('admin');
/** @type {import('express').RequestHandler} */
const isOrganizerOrAdmin = requireAuth('organizer', 'admin');

module.exports = {
  hashPassword,
  comparePassword,
  signToken,
  verifyToken,
  extractToken,
  requireAuth,
  isStudent,
  isOrganizer,
  isAdmin,
  isOrganizerOrAdmin,
};
