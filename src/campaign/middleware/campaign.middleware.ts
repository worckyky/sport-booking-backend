import { Response, NextFunction } from 'express';
import type { Pool } from 'pg';
import { AuthRequest } from '../../authentication/middleware/auth.middleware';
import { USER_ROLE } from '../../authentication/model/auth.model';

export const campaignRoleMiddleware = (db: Pool) => {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const result = await db.query<{ role: USER_ROLE }>('select role from users where id = $1', [
        req.userId
      ]);
      const user = result.rows[0];

      if (!user) {
        return res.status(401).json({ error: 'User not found' });
      }

      if (user.role !== USER_ROLE.CAMPAIGN) {
        return res.status(403).json({
          error: 'Forbidden - Only users with CAMPAIGN role can access this resource'
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