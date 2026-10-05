import { Injectable } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { OAuth2Client } from 'google-auth-library';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../database/database.service.js';
import { integerSetting } from '../security/config.js';

interface UserRow {
  [key: string]: any;
  id: string;
  email: string;
  password?: string;
  is_admin?: boolean;
}

@Injectable()
export class AuthService {
  client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

  constructor(private readonly db: DatabaseService) {}

  private publicUser(user: UserRow) {
    const fields = [
      'id',
      'email',
      'full_name',
      'avatar_url',
      'is_admin',
      'fav_constructor',
      'fav_drivers',
      'created_at',
      'updated_at',
    ];
    return Object.fromEntries(
      fields.filter((key) => Object.hasOwn(user, key)).map((key) => [key, user[key]]),
    );
  }

  generateToken(user: { id: string; email: string; is_admin?: boolean }) {
    return jwt.sign(
      { id: user.id, email: user.email, is_admin: user.is_admin },
      process.env.JWT_SECRET!,
      { algorithm: 'HS256', expiresIn: integerSetting('JWT_TTL_SECONDS', 3600, 60, 86400) },
    );
  }

  async register({
    email,
    password,
    fullName,
  }: {
    email: string;
    password: string;
    fullName?: string;
  }) {
    // Check if user already exists
    const existingUser = await this.db.query<UserRow>('SELECT * FROM users WHERE email = $1', [
      email,
    ]);
    if (existingUser.rows.length > 0) {
      throw new Error('User with this email already exists');
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const id = randomUUID();

    const result = await this.db.query<UserRow>(
      'INSERT INTO users (id, email, password, full_name) VALUES ($1, $2, $3, $4) RETURNING *',
      [id, email, passwordHash, fullName],
    );

    const user = result.rows[0];
    const token = this.generateToken(user);

    return { user: this.publicUser(user), token };
  }

  async login(email: string, password: string) {
    const result = await this.db.query<UserRow>('SELECT * FROM users WHERE email = $1', [email]);
    const user = result.rows[0];

    const dummyHash = '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';
    const isMatch = await bcrypt.compare(password, user?.password || dummyHash);
    if (!user?.password || !isMatch) {
      throw new Error('Invalid email or password');
    }

    const token = this.generateToken(user);
    return { user: this.publicUser(user), token };
  }

  async googleLogin(idToken: string) {
    try {
      if (!process.env.GOOGLE_CLIENT_ID) throw new Error('Google login is not configured');
      const ticket = await this.client.verifyIdToken({
        idToken,
        audience: process.env.GOOGLE_CLIENT_ID,
      });
      const payload = ticket.getPayload();
      if (!payload?.email || !payload.email_verified || !payload.sub)
        throw new Error('Unverified Google account');
      const { sub: googleId, email, name, picture } = payload;

      // Check if user exists
      let result = await this.db.query<UserRow>('SELECT * FROM users WHERE email = $1', [email]);
      let user = result.rows[0];

      if (user) {
        // Never silently link a password account or a different Google subject by email.
        // This also prevents pre-hijacking through unverified password registration.
        if (user.password || user.id !== googleId)
          throw new Error('Account linking requires explicit verification');
        // Update existing user
        result = await this.db.query<UserRow>(
          'UPDATE users SET full_name = $1, avatar_url = $2, updated_at = NOW() WHERE email = $3 RETURNING *',
          [name, picture, email],
        );
        user = result.rows[0];
      } else {
        // Create new user
        result = await this.db.query<UserRow>(
          'INSERT INTO users (id, email, full_name, avatar_url) VALUES ($1, $2, $3, $4) RETURNING *',
          [googleId, email, name, picture],
        );
        user = result.rows[0];
      }

      const token = this.generateToken(user);
      return { user: this.publicUser(user), token };
    } catch (error) {
      console.error('Google verification error:', error.message);
      throw new Error('Invalid Google token');
    }
  }
}
