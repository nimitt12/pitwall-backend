const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const db = require('../../config/database');

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

class AuthService {
  /**
   * Generate a JWT for a user
   */
  generateToken(user) {
    return jwt.sign(
      { id: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
  }

  /**
   * Register a new user with email and password
   */
  async register({ email, password, fullName }) {
    // Check if user already exists
    const existingUser = await db.query('SELECT * FROM profiles WHERE email = $1', [email]);
    if (existingUser.rows.length > 0) {
      throw new Error('User with this email already exists');
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const id = Math.random().toString(36).substring(2, 15); // Simple ID generation, or use UUID

    const result = await db.query(
      'INSERT INTO profiles (id, email, password, full_name) VALUES ($1, $2, $3, $4) RETURNING *',
      [id, email, passwordHash, fullName]
    );

    const user = result.rows[0];
    const token = this.generateToken(user);

    return { user, token };
  }

  /**
   * Login with email and password
   */
  async login(email, password) {
    const result = await db.query('SELECT * FROM profiles WHERE email = $1', [email]);
    const user = result.rows[0];

    if (!user || !user.password) {
      throw new Error('Invalid email or password');
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      throw new Error('Invalid email or password');
    }

    const token = this.generateToken(user);
    return { user, token };
  }

  /**
   * Handle Google Login
   */
  async googleLogin(idToken) {
    try {
      const ticket = await client.verifyIdToken({
        idToken,
        audience: process.env.GOOGLE_CLIENT_ID,
      });
      const payload = ticket.getPayload();
      const { sub: googleId, email, name, picture } = payload;

      // Check if user exists
      let result = await db.query('SELECT * FROM profiles WHERE email = $1', [email]);
      let user = result.rows[0];

      if (user) {
        // Update existing user
        result = await db.query(
          'UPDATE profiles SET full_name = $1, avatar_url = $2, updated_at = NOW() WHERE email = $3 RETURNING *',
          [name, picture, email]
        );
        user = result.rows[0];
      } else {
        // Create new user
        result = await db.query(
          'INSERT INTO profiles (id, email, full_name, avatar_url) VALUES ($1, $2, $3, $4) RETURNING *',
          [googleId, email, name, picture]
        );
        user = result.rows[0];
      }

      const token = this.generateToken(user);
      return { user, token };
    } catch (error) {
      console.error('Google verification error:', error.message);
      throw new Error('Invalid Google token');
    }
  }
}

module.exports = new AuthService();
