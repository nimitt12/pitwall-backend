import jwt from 'jsonwebtoken';

export function verifyToken(token: string): jwt.JwtPayload & { id: string } {
  if (token.length > 8192) throw new Error('Invalid token');
  const decoded = jwt.verify(token, process.env.JWT_SECRET!, { algorithms: ['HS256'] });
  if (
    typeof decoded === 'string' ||
    typeof decoded.id !== 'string' ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(decoded.id) ||
    typeof decoded.exp !== 'number'
  )
    throw new Error('Invalid token claims');
  return decoded as jwt.JwtPayload & { id: string };
}
