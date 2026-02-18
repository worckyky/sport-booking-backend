import { Router, Response } from 'express';
import type { Pool } from 'pg';
import { AuditAPI } from './audit.api';
import { adminMiddleware } from '../authentication/middleware/admin.middleware';
import type { AuthRequest } from '../authentication/middleware/auth.middleware';

export function createAuditRoutes(db: Pool): Router {
  const router = Router();
  const api = new AuditAPI(db);

  /**
   * GET /audit/activity — paginated audit log
   */
  router.get(
    '/activity',
    adminMiddleware(db),
    async (req: AuthRequest, res: Response) => {
      try {
        const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
        const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : 0;
        const eventType = req.query.event_type as string | undefined;
        const resourceType = req.query.resource_type as string | undefined;
        const actorId = req.query.actor_id as string | undefined;

        const result = await api.getActivity({ limit, offset, eventType, resourceType, actorId });
        res.json(result);
      } catch (error) {
        res.status(500).json({ error: error instanceof Error ? error.message : 'Internal server error' });
      }
    }
  );

  /**
   * GET /audit/activity/export — CSV export of audit log
   */
  router.get(
    '/activity/export',
    adminMiddleware(db),
    async (req: AuthRequest, res: Response) => {
      try {
        const eventType = req.query.event_type as string | undefined;
        const resourceType = req.query.resource_type as string | undefined;
        const result = await api.getActivity({ limit: 10000, offset: 0, eventType, resourceType });
        const header = 'ID,Событие,Актор,Email,Ресурс,Ресурс ID,Дата\n';
        const rows = result.items.map(r => [
          r.id,
          r.event_type,
          r.actor_id,
          r.actor_email || '',
          r.resource_type || '',
          r.resource_id || '',
          r.created_at,
        ].join(',')).join('\n');
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="audit_${new Date().toISOString().slice(0,10)}.csv"`);
        res.send('\uFEFF' + header + rows);
      } catch (error) {
        res.status(500).json({ error: error instanceof Error ? error.message : 'Internal server error' });
      }
    }
  );

  /**
   * GET /audit/recent — last N events for dashboard widget
   */
  router.get(
    '/recent',
    adminMiddleware(db),
    async (req: AuthRequest, res: Response) => {
      try {
        const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 10;
        const items = await api.getRecentActivity(limit);
        res.json(items);
      } catch (error) {
        res.status(500).json({ error: error instanceof Error ? error.message : 'Internal server error' });
      }
    }
  );

  return router;
}
