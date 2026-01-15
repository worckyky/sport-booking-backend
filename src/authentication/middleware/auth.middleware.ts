import { Request, Response, NextFunction } from 'express';
import jwt, { type JwtPayload } from 'jsonwebtoken';
import type { Pool } from 'pg';
import { AUTH_COOKIE_NAME, getJwtSecret } from '../../config/auth';

export interface AuthRequest extends Request {
  userId?: string;
}

function extractToken(req: Request): string | null {
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

export const authMiddleware = (db: Pool) => {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      // Пытаемся получить токен из cookie или из заголовка Authorization
      const token = extractToken(req);

      if (!token) {
        return res.status(401).json({ error: 'Unauthorized - No token provided' });
      }

      const payload = jwt.verify(token, getJwtSecret());
      const userId = getUserIdFromPayload(payload);
      if (!userId) {
        return res.status(401).json({ error: 'Unauthorized - Invalid token' });
      }

      // Проверяем что пользователь существует
      const result = await db.query<{ id: string }>('select id from users where id = $1', [userId]);
      if (result.rowCount === 0) {
        return res.status(401).json({ error: 'Unauthorized - User not found' });
      }

      // Сохраняем userId в request для использования в роутах
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

