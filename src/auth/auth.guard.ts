import { CanActivate, ExecutionContext, HttpException, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import jwt from 'jsonwebtoken';

export interface AuthenticatedRequest extends Request {
  user: string | jwt.JwtPayload;
}

@Injectable()
export class AuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new HttpException({ message: 'No token provided, authorization denied' }, 401);
    }
    try {
      request.user = jwt.verify(header.split(' ')[1], process.env.JWT_SECRET!);
      return true;
    } catch {
      throw new HttpException({ message: 'Token is not valid' }, 401);
    }
  }
}
