import { Router, Response } from 'express';
import type { Pool } from 'pg';
import { CampaignAPI } from '../api/campaign.api';
import { authMiddleware, AuthRequest } from '../../authentication/middleware/auth.middleware';
import { adminMiddleware } from '../../authentication/middleware/admin.middleware';
import { campaignRoleMiddleware } from '../middleware/campaign.middleware';
import { CampaignStatus, CreateCampaignRequest, UpdateCampaignRequest } from '../model/campaign.model';

export default function createCampaignRoutes(db: Pool): Router {
  const router = Router();
  const campaignAPI = new CampaignAPI(db);

// GET /campaign - Получить опубликованные кампании (публичный каталог)
router.get(
  '/',
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const campaigns = await campaignAPI.getPublishedCampaigns();
      res.json(campaigns);
    } catch (error) {
      if (error instanceof Error) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  }
);

// GET /campaign/admin/all - Получить все кампании (только ADMIN)
router.get(
  '/admin/all',
  adminMiddleware(db),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const campaigns = await campaignAPI.getAllCampaigns();
      res.json(campaigns);
    } catch (error) {
      if (error instanceof Error) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  }
);

// GET /campaign/:id - Получить данные кампании по ID (публичный эндпоинт)
router.get(
  '/:id',
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const campaignId = req.params.id;

      if (!campaignId) {
        res.status(400).json({ error: 'Campaign ID is required' });
        return;
      }

      const campaign = await campaignAPI.getCampaignById(campaignId);
      res.json(campaign);
    } catch (error) {
      if (error instanceof Error) {
        if (error.message === 'Campaign not found') {
          res.status(404).json({ error: error.message });
        } else {
          res.status(400).json({ error: error.message });
        }
      } else {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  }
);

// POST /campaign - Создать новую кампанию
router.post(
  '/',
  authMiddleware(db),
  campaignRoleMiddleware(db),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      if (!req.userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const campaignData: CreateCampaignRequest = req.body;

      if (!campaignData.name || !campaignData.description) {
        res.status(400).json({ error: 'Name and description are required' });
        return;
      }

      const campaign = await campaignAPI.createCampaign(req.userId, campaignData);
      res.status(201).json(campaign);
    } catch (error) {
      if (error instanceof Error) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  }
);

// PUT /campaign/:id - Обновить кампанию
router.put(
  '/:id',
  authMiddleware(db),
  campaignRoleMiddleware(db),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      if (!req.userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const campaignId = req.params.id;

      if (!campaignId) {
        res.status(400).json({ error: 'Campaign ID is required' });
        return;
      }

      const campaignData: UpdateCampaignRequest = req.body;

      if (Object.keys(campaignData).length === 0) {
        res.status(400).json({ error: 'No data provided for update' });
        return;
      }

      const campaign = await campaignAPI.updateCampaign(campaignId, req.userId, campaignData);
      res.json(campaign);
    } catch (error) {
      if (error instanceof Error) {
        if (error.message === 'Campaign not found or not updated') {
          res.status(404).json({ error: error.message });
        } else {
          res.status(400).json({ error: error.message });
        }
      } else {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  }
);

// DELETE /campaign/:id - Удалить кампанию
router.delete(
  '/:id',
  authMiddleware(db),
  campaignRoleMiddleware(db),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      if (!req.userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const campaignId = req.params.id;

      if (!campaignId) {
        res.status(400).json({ error: 'Campaign ID is required' });
        return;
      }

      await campaignAPI.deleteCampaign(campaignId, req.userId);
      res.status(204).send();
    } catch (error) {
      if (error instanceof Error) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  }
);

// PUT /campaign/:id/status - Изменить статус кампании (только ADMIN)
router.put(
  '/:id/status',
  adminMiddleware(db),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const campaignId = req.params.id;
      const { status } = req.body as { status?: string };

      if (!campaignId) {
        res.status(400).json({ error: 'Campaign ID is required' });
        return;
      }

      if (!status) {
        res.status(400).json({ error: 'Status is required' });
        return;
      }

      const validStatuses = Object.values(CampaignStatus);
      if (!validStatuses.includes(status as CampaignStatus)) {
        res.status(400).json({
          error: `Invalid status. Must be one of: ${validStatuses.join(', ')}`
        });
        return;
      }

      const campaign = await campaignAPI.updateCampaignStatus(
        campaignId,
        status as CampaignStatus
      );
      res.json(campaign);
    } catch (error) {
      if (error instanceof Error) {
        if (error.message === 'Campaign not found') {
          res.status(404).json({ error: error.message });
        } else {
          res.status(400).json({ error: error.message });
        }
      } else {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  }
);

  return router;
}