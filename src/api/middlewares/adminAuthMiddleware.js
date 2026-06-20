const jwt = require('jsonwebtoken');
const db = require('../../config/database');

/**
 * Guards the admin portal endpoints.
 *
 * 1. Requires a valid Bearer JWT (issued by the auth service on login).
 * 2. Re-reads `is_admin` from the database on every request so that the
 *    privilege check is authoritative — a forged/edited token can't grant
 *    access, and revoking admin in the DB takes effect immediately.
 *
 * On success the fresh user row is attached to `req.adminUser`.
 */
const adminAuthMiddleware = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const token = authHeader.split(' ')[1];

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (error) {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }

  try {
    const result = await db.query(
      'SELECT id, email, full_name, avatar_url, is_admin FROM users WHERE id = $1',
      [decoded.id]
    );
    const user = result.rows[0];

    if (!user) {
      return res.status(401).json({ error: 'User no longer exists' });
    }

    if (!user.is_admin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    req.adminUser = user;
    next();
  } catch (error) {
    console.error('Admin authorization check failed:', error.message);
    return res.status(500).json({ error: 'Authorization check failed' });
  }
};

module.exports = adminAuthMiddleware;
