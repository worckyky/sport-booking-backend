import { Router, Response } from 'express';
import type { Pool } from 'pg';
import { CampaignAPI } from '../api/campaign.api';
import { authMiddleware, AuthRequest } from '../../authentication/middleware/auth.middleware';
import { adminMiddleware } from '../../authentication/middleware/admin.middleware';
import { campaignRoleMiddleware } from '../middleware/campaign.middleware';
import { CampaignStatus, CreateCampaignRequest, UpdateCampaignRequest } from '../model/campaign.model';
import { AuditAPI, AUDIT_EVENTS } from '../../audit/audit.api';
import { validatePaymentMethods, validateFacilities, validateWorkingTimetable, validateTimezoneId } from '../../utils/validators';

export default function createCampaignRoutes(db: Pool): Router {
  const router = Router();
  const campaignAPI = new CampaignAPI(db);
  const auditAPI = new AuditAPI(db);

// GET /campaign - Получить опубликованные кампании (публичный каталог)
// Query params: sport, q (search), sort (name_asc, name_desc), date (YYYY-MM-DD)
router.get(
  '/',
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { sport, q, sort, date, is_indoor } = req.query as {
        sport?: string;
        q?: string;
        sort?: string;
        date?: string;
        is_indoor?: string;
      };

      const campaigns = await campaignAPI.getPublishedCampaigns({
        sport,
        q,
        sort,
        date,
        is_indoor: is_indoor === 'true' ? true : is_indoor === 'false' ? false : undefined,
      });
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

// GET /campaign/stats/platform - Статистика платформы для landing (публичный)
router.get(
  '/stats/platform',
  async (_req: AuthRequest, res: Response): Promise<void> => {
    try {
      const stats = await campaignAPI.getPlatformStats();
      res.json(stats);
    } catch (error) {
      if (error instanceof Error) {
        res.status(500).json({ error: error.message });
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
      const campaigns = await campaignAPI.getAllCampaignsAdmin();
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

      const campaign = await campaignAPI.getPublicCampaignById(campaignId);
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

// GET /campaign/:id/private - Получить данные кампании с pending overlay (только владелец)
router.get(
  '/:id/private',
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

      const campaign = await campaignAPI.getCampaignByIdForOwner(campaignId, req.userId);
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
      const requestData = req.body as Record<string, unknown>;

      if (!campaignData.name || !campaignData.description) {
        res.status(400).json({ error: 'Name and description are required' });
        return;
      }

      // Валидация enum'ов и форматов
      const paymentMethods = campaignData.paymentMethods ?? requestData.payment_methods;
      if (paymentMethods) {
        const err = validatePaymentMethods(paymentMethods);
        if (err) { res.status(400).json({ error: err }); return; }
      }
      const facilities = campaignData.facilities;
      if (facilities) {
        const err = await validateFacilities(db, facilities);
        if (err) { res.status(400).json({ error: err }); return; }
      }
      const timetable = campaignData.workingTimetable ?? requestData.working_timetable;
      if (timetable) {
        const err = validateWorkingTimetable(timetable);
        if (err) { res.status(400).json({ error: err }); return; }
      }
      const timezoneId = campaignData.timezoneId ?? requestData.timezone_id;
      if (timezoneId) {
        const err = validateTimezoneId(timezoneId);
        if (err) { res.status(400).json({ error: err }); return; }
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
      const requestData = req.body as Record<string, unknown>;

      if (Object.keys(campaignData).length === 0) {
        res.status(400).json({ error: 'No data provided for update' });
        return;
      }

      // Валидация enum'ов и форматов
      const paymentMethods = campaignData.paymentMethods ?? requestData.payment_methods;
      if (paymentMethods !== undefined) {
        const err = validatePaymentMethods(paymentMethods);
        if (err) { res.status(400).json({ error: err }); return; }
      }
      const facilities = campaignData.facilities;
      if (facilities !== undefined) {
        const err = await validateFacilities(db, facilities);
        if (err) { res.status(400).json({ error: err }); return; }
      }
      const timetable = campaignData.workingTimetable ?? requestData.working_timetable;
      if (timetable !== undefined) {
        const err = validateWorkingTimetable(timetable);
        if (err) { res.status(400).json({ error: err }); return; }
      }
      const timezoneId = campaignData.timezoneId ?? requestData.timezone_id;
      if (timezoneId !== undefined) {
        const err = validateTimezoneId(timezoneId);
        if (err) { res.status(400).json({ error: err }); return; }
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
    } catch (error: any) {
      if (error.statusCode === 409) {
        res.status(409).json({ error: error.message });
      } else if (error instanceof Error) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  }
);

// GET /campaign/:id/clients - Получить клиентов кампании (только владелец)
router.get(
  '/:id/clients',
  authMiddleware(db),
  campaignRoleMiddleware(db),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const campaignId = req.params.id;

      if (!campaignId) {
        res.status(400).json({ error: 'Campaign ID is required' });
        return;
      }

      // Verify user owns this campaign
      const campaign = await campaignAPI.getCampaignById(campaignId);
      if (campaign.userId !== req.userId) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }

      // Пагинация: limit (по умолчанию 100, макс 100), offset (по умолчанию 0)
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 100;
      const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : 0;
      const search = req.query.search ? String(req.query.search).trim() : undefined;

      const result = await campaignAPI.getClients(campaignId, limit, offset, search);
      res.json(result);
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

// GET /campaign/:id/client-stats?phone=7XXXXXXXXXX - Статистика клиента по телефону
router.get(
  '/:id/client-stats',
  authMiddleware(db),
  campaignRoleMiddleware(db),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const campaignId = req.params.id;
      const phone = req.query.phone ? String(req.query.phone).trim() : '';

      if (!phone) {
        res.status(400).json({ error: 'Phone is required' });
        return;
      }

      const campaign = await campaignAPI.getCampaignById(campaignId);
      if (campaign.userId !== req.userId) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }

      const stats = await campaignAPI.getClientStatsByPhone(campaignId, phone);
      if (!stats) {
        res.json({ total_bookings: 0, no_shows: 0, cancellations: 0, is_registered: false });
        return;
      }

      res.json(stats);
    } catch (error) {
      if (error instanceof Error) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  }
);

// GET /campaign/:id/clients/:clientId - Получить клиента по ID (O(1))
router.get(
  '/:id/clients/:clientId',
  authMiddleware(db),
  campaignRoleMiddleware(db),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const campaignId = req.params.id;
      const clientId = req.params.clientId;

      if (!campaignId) {
        res.status(400).json({ error: 'Campaign ID is required' });
        return;
      }

      // Проверяем владельца
      const campaign = await campaignAPI.getCampaignById(campaignId);
      if (!campaign) {
        res.status(404).json({ error: 'Campaign not found' });
        return;
      }

      if (campaign.userId !== req.userId) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }

      const client = await campaignAPI.getClientById(campaignId, clientId);
      if (!client) {
        res.status(404).json({ error: 'Client not found' });
        return;
      }

      res.json(client);
    } catch (error) {
      if (error instanceof Error) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  }
);

// GET /campaign/:id/readiness - Чеклист готовности (CAMPAIGN owner)
router.get(
  '/:id/readiness',
  authMiddleware(db),
  campaignRoleMiddleware(db),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const campaignId = req.params.id;

      // Проверить что пользователь принадлежит к этой площадке
      const userResult = await db.query<{ campaign_id: string | null }>(
        'SELECT campaign_id FROM users WHERE id = $1',
        [req.userId]
      );
      if (userResult.rows[0]?.campaign_id !== campaignId) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }

      const readiness = await campaignAPI.getCampaignReadiness(campaignId);
      res.json(readiness);
    } catch (error) {
      if (error instanceof Error) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  }
);

// POST /campaign/:id/submit-moderation - Подать на модерацию (CAMPAIGN owner)
router.post(
  '/:id/submit-moderation',
  authMiddleware(db),
  campaignRoleMiddleware(db),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const campaignId = req.params.id;

      if (!req.userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const campaign = await campaignAPI.submitForModeration(campaignId, req.userId);
      res.json(campaign);
    } catch (error: any) {
      if (error.missing) {
        res.status(400).json({ error: error.message, missing: error.missing });
      } else if (error instanceof Error) {
        const status = error.message === 'Campaign not found' ? 404
          : error.message === 'Access denied' ? 403
          : 400;
        res.status(status).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  }
);

// GET /campaign/:id/admin-readiness - Чеклист готовности (ADMIN view)
router.get(
  '/:id/admin-readiness',
  adminMiddleware(db),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const campaignId = req.params.id;
      const readiness = await campaignAPI.getCampaignReadiness(campaignId);
      res.json(readiness);
    } catch (error) {
      if (error instanceof Error) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  }
);

// GET /campaign/:id/fields-list - Список полей для суперадмина (ADMIN)
router.get(
  '/:id/fields-list',
  adminMiddleware(db),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const campaignId = req.params.id;
      const fields = await campaignAPI.getCampaignFields(campaignId);
      res.json(fields);
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
      const { status, comment } = req.body as { status?: string; comment?: string };

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
        status as CampaignStatus,
        req.userId!,
        comment
      );
      const eventMap: Record<string, string> = {
        published: AUDIT_EVENTS.CAMPAIGN_PUBLISHED,
        draft: AUDIT_EVENTS.CAMPAIGN_REJECTED,
        suspended: AUDIT_EVENTS.CAMPAIGN_SUSPENDED,
      };
      if (eventMap[status]) {
        auditAPI.log({
          eventType: eventMap[status],
          actorId: req.userId!,
          resourceType: 'campaign',
          resourceId: campaignId,
          changes: comment ? { comment: { to: comment } } : undefined,
        }).catch(() => {});
      }
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

// PUT /campaign/:id/approve-changes - Одобрить pending changes (только ADMIN)
router.put(
  '/:id/approve-changes',
  adminMiddleware(db),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const campaignId = req.params.id;
      const campaign = await campaignAPI.approvePendingChanges(campaignId, req.userId!);
      res.json(campaign);
    } catch (error) {
      if (error instanceof Error) {
        const status = error.message === 'Campaign not found' ? 404
          : error.message === 'No pending changes' ? 400
          : 400;
        res.status(status).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  }
);

// PUT /campaign/:id/reject-changes - Отклонить pending changes (только ADMIN)
router.put(
  '/:id/reject-changes',
  adminMiddleware(db),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const campaignId = req.params.id;
      const { comment } = req.body as { comment?: string };
      const campaign = await campaignAPI.rejectPendingChanges(campaignId, req.userId!, comment);
      res.json(campaign);
    } catch (error) {
      if (error instanceof Error) {
        const status = error.message === 'Campaign not found' ? 404
          : error.message === 'No pending changes' ? 400
          : 400;
        res.status(status).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  }
);

// GET /campaign/:id/status-log - История статусов (только ADMIN)
router.get(
  '/:id/status-log',
  adminMiddleware(db),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const campaignId = req.params.id;
      const log = await campaignAPI.getCampaignStatusLog(campaignId);
      res.json(log);
    } catch (error) {
      if (error instanceof Error) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  }
);



  return router;
}
