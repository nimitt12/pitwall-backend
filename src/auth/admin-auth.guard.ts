import { CanActivate, ExecutionContext, HttpException, Injectable, Logger } from '@nestjs/common';
import type { Request } from 'express';
import jwt from 'jsonwebtoken';
import { DatabaseService } from '../database/database.service.js';
import { verifyToken } from './token.js';

export interface AdminUser {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  is_admin: boolean;
}

export interface AdminRequest extends Request {
  adminUser: AdminUser;
}

@Injectable()
export class AdminAuthGuard implements CanActivate {
  private readonly logger = new Logger(AdminAuthGuard.name);

  constructor(private readonly db: DatabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AdminRequest>();
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new HttpException({ error: 'Authentication required' }, 401);
    }
    let decoded: jwt.JwtPayload;
    try {
      decoded = verifyToken(header.slice(7));
    } catch {
      throw new HttpException({ error: 'Invalid or expired session' }, 401);
    }
    let user: AdminUser | undefined;
    try {
      const result = await this.db.query<AdminUser>(
        'SELECT id, email, full_name, avatar_url, is_admin FROM users WHERE id = $1',
        [decoded.id],
      );
      user = result.rows[0];
    } catch (error) {
      this.logger.error('Admin authorization check failed', error);
      throw new HttpException({ error: 'Authorization check failed' }, 500);
    }
    if (!user) throw new HttpException({ error: 'User no longer exists' }, 401);
    if (!user.is_admin) throw new HttpException({ error: 'Admin access required' }, 403);
    request.adminUser = user;
    return true;
  }
}
