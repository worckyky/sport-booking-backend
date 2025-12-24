import { Response, NextFunction } from 'express';
import { SupabaseClient } from '@supabase/supabase-js';
import { AuthRequest } from '../../authentication/middleware/auth.middleware';
import { USER_ROLE } from '../../authentication/model/auth.model';

export const campaignRoleMiddleware = (supabase: SupabaseClient) => {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const { data: { user }, error } = await supabase.auth.admin.getUserById(req.userId);

      if (error || !user) {
        return res.status(401).json({ error: 'User not found' });
      }

      const userRole = user.user_metadata?.role;

      if (userRole !== USER_ROLE.CAMPAIGN) {
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