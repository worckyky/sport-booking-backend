import { Response, NextFunction } from 'express';
import jwt, { type JwtPayload } from 'jsonwebtoken';
import type { Pool } from 'pg';
import { AUTH_COOKIE_NAME, getJwtSecret } from '../../config/auth';
import { USER_ROLE } from '../model/auth.model';
import type { AuthRequest } from './auth.middleware';

function extractToken(req: AuthRequest): string | null {
  const cookieToken = (req as unknown as { cookies?: Record<string, unknown> }).cookies?.[
    AUTH_COOKIE_NAME
  ];
  if (typeof cookieToken === 'string' && cookieToken.length > 0) return cookieToken;

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const bearer = authHeader.substring(7);
    if (bearer.length > 0) return bearer;
  }

  return null;
}

function getUserIdFromPayload(payload: string | JwtPayload): string | null {
  if (typeof payload === 'string') return null;
  const sub = payload.sub;
  if (typeof sub !== 'string' || sub.length === 0) return null;
  return sub;
}

/**
 * Middleware для проверки что пользователь — ADMIN
 */
export const adminMiddleware = (db: Pool) => {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const token = extractToken(req);

      if (!token) {
        return res.status(401).json({ error: 'Unauthorized - No token provided' });
      }

      const payload = jwt.verify(token, getJwtSecret());
      const userId = getUserIdFromPayload(payload);
      if (!userId) {
        return res.status(401).json({ error: 'Unauthorized - Invalid token' });
      }

      // Проверяем что пользователь существует, является ADMIN и не заблокирован
      const result = await db.query<{ id: string; role: string; is_blocked: boolean }>(
        'SELECT id, role, is_blocked FROM users WHERE id = $1',
        [userId]
      );

      if (result.rowCount === 0) {
        return res.status(401).json({ error: 'Unauthorized - User not found' });
      }

      const user = result.rows[0];
      if (user.is_blocked) {
        return res.status(403).json({ error: 'Forbidden - Account is blocked' });
      }
      if (user.role !== USER_ROLE.ADMIN) {
        return res.status(403).json({ error: 'Forbidden - Admin access required' });
      }

      req.userId = userId;
      next();
    } catch (error) {
      if (error instanceof Error) {
        res.status(401).json({ error: `Unauthorized: ${error.message}` });
      } else {
        res.status(401).json({ error: 'Unauthorized' });
      }
    }
  };
};
