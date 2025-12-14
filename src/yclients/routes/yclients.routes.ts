import { Router, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import { YClientsAPI } from '../api/yclients.api';
import { authMiddleware, AuthRequest } from '../../authentication/middleware/auth.middleware';
import { campaignRoleMiddleware } from '../middleware/campaign.middleware';

const router = Router();

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

const yclientsAPI = new YClientsAPI(supabase);

// GET /yclients - Получить YClients данные текущего пользователя
router.get(
  '/',
  authMiddleware(supabase),
  campaignRoleMiddleware,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      if (!req.userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const yclientsInfo = await yclientsAPI.getYClientsInfo(req.userId);
      res.json(yclientsInfo);
    } catch (error) {
      if (error instanceof Error) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  }
);

// PUT /yclients - Обновить YClients данные текущего пользователя
router.put(
  '/',
  authMiddleware(supabase),
  campaignRoleMiddleware,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      if (!req.userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { ycPartnerToken, ycLogin, ycPassword, yclientsCompanyId } = req.body;

      if (!ycPartnerToken || !ycLogin || !ycPassword || !yclientsCompanyId) {
        res
          .status(400)
          .json({ error: 'ycPartnerToken, ycLogin, ycPassword and yclientsCompanyId are required' });
        return;
      }

      const yclientsInfo = await yclientsAPI.updateYClientsInfo(req.userId, {
        ycPartnerToken,
        ycLogin,
        ycPassword,
        yclientsCompanyId
      });

      res.json(yclientsInfo);
    } catch (error) {
      if (error instanceof Error) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  }
);

export default router;

