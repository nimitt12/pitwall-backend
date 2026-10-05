import { CanActivate, ExecutionContext, HttpException, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { DatabaseService } from '../database/database.service.js';
import { verifyToken } from './token.js';

export interface AuthenticatedRequest extends Request {
  user: { id: string; email: string };
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly db: DatabaseService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer '))
      throw new HttpException({ message: 'Authentication required' }, 401);
    let decoded;
    try {
      decoded = verifyToken(header.slice(7));
    } catch {
      throw new HttpException({ message: 'Invalid or expired session' }, 401);
    }
    const { rows } = await this.db.query('SELECT id, email FROM users WHERE id = $1', [decoded.id]);
    if (!rows[0]) throw new HttpException({ message: 'Invalid or expired session' }, 401);
    request.user = rows[0] as AuthenticatedRequest['user'];
    const target = request.params.id ?? request.body?.userId;
    if (target !== undefined && target !== request.user.id)
      throw new HttpException({ message: 'Access denied' }, 403);
    return true;
  }
}
