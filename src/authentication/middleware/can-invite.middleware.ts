import { Response, NextFunction } from 'express';
import type { Pool } from 'pg';
import type { AuthRequest } from './auth.middleware';

/**
 * Middleware: проверяет что текущий пользователь может приглашать других.
 * Только "оригинальные" пользователи (invited_by IS NULL) могут приглашать.
 * Должен использоваться ПОСЛЕ authMiddleware.
 */
export const canInviteMiddleware = (db: Pool) => {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const result = await db.query<{ invited_by: string | null }>(
        'SELECT invited_by FROM users WHERE id = $1',
        [req.userId]
      );

      if (result.rowCount === 0) {
        return res.status(401).json({ error: 'User not found' });
      }

      if (result.rows[0].invited_by !== null) {
        return res.status(403).json({
          error: 'Forbidden - Only original users can manage team invitations'
        });
      }

      next();
    } catch (error) {
      if (error instanceof Error) {
        res.status(500).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  };
};
