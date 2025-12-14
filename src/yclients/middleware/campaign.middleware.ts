import { Response, NextFunction } from 'express';
import { createClient } from '@supabase/supabase-js';
import { AuthRequest } from '../../authentication/middleware/auth.middleware';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

export const campaignRoleMiddleware = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { data, error } = await supabaseAdmin.auth.admin.getUserById(req.userId);

    if (error || !data.user) {
      res.status(401).json({ error: 'User not found' });
      return;
    }

    if (data.user.user_metadata?.role !== 'CAMPAIGN') {
      res.status(403).json({ error: 'Access denied. Only CAMPAIGN users can access this resource' });
      return;
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

