import { Router, Response } from 'express';
import type { Pool } from 'pg';
import { DictionaryAPI } from '../api/dictionary.api';
import { authMiddleware, type AuthRequest } from '../middleware/auth.middleware';
import { adminMiddleware } from '../middleware/admin.middleware';
import type { ReorderRequest } from '../model/dictionary.model';

type TableName = 'sport_types' | 'facilities';

export function createDictionaryRoutes(db: Pool): Router {
  const router = Router();
  const api = new DictionaryAPI(db);

  // ─── Public (any authenticated user) ───

  router.get('/dictionaries/sport-types', authMiddleware(db), async (_req: AuthRequest, res: Response) => {
    try {
      const items = await api.getAll('sport_types', true);
      res.json(items);
    } catch {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.get('/dictionaries/facilities', authMiddleware(db), async (_req: AuthRequest, res: Response) => {
    try {
      const items = await api.getAll('facilities', true);
      res.json(items);
    } catch {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ─── Admin CRUD ───

  function adminCrud(path: string, table: TableName) {
    // GET all (including inactive)
    router.get(`/admin/dictionaries/${path}`, adminMiddleware(db), async (_req: AuthRequest, res: Response) => {
      try {
        const items = await api.getAll(table, false);
        res.json(items);
      } catch {
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // POST create
    router.post(`/admin/dictionaries/${path}`, adminMiddleware(db), async (req: AuthRequest, res: Response) => {
      try {
        const { code, name } = req.body;
        if (!code || !name) {
          res.status(400).json({ error: 'code and name are required' });
          return;
        }
        if (typeof code !== 'string' || code.length > 50) {
          res.status(400).json({ error: 'code must be a string (max 50 chars)' });
          return;
        }
        if (typeof name !== 'string' || name.length > 100) {
          res.status(400).json({ error: 'name must be a string (max 100 chars)' });
          return;
        }
        const item = await api.create(table, { code, name });
        res.status(201).json(item);
      } catch (error: unknown) {
        if (error instanceof Error && error.message.includes('duplicate key')) {
          res.status(409).json({ error: 'Код уже существует' });
        } else {
          res.status(500).json({ error: 'Internal server error' });
        }
      }
    });

    // PUT reorder — MUST be before /:id to avoid matching "reorder" as id
    router.put(`/admin/dictionaries/${path}/reorder`, adminMiddleware(db), async (req: AuthRequest, res: Response) => {
      try {
        const { items } = req.body as ReorderRequest;
        if (!Array.isArray(items) || items.length === 0) {
          res.status(400).json({ error: 'items array is required' });
          return;
        }
        await api.reorder(table, items);
        const updated = await api.getAll(table, false);
        res.json(updated);
      } catch {
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // PUT update
    router.put(`/admin/dictionaries/${path}/:id`, adminMiddleware(db), async (req: AuthRequest, res: Response) => {
      try {
        const { code, name, is_active } = req.body;
        const item = await api.update(table, req.params.id, { code, name, is_active });
        if (!item) {
          res.status(404).json({ error: 'Not found' });
          return;
        }
        res.json(item);
      } catch (error: unknown) {
        if (error instanceof Error && error.message.includes('duplicate key')) {
          res.status(409).json({ error: 'Код уже существует' });
        } else {
          res.status(500).json({ error: 'Internal server error' });
        }
      }
    });

    // DELETE (soft-delete with usage protection)
    router.delete(`/admin/dictionaries/${path}/:id`, adminMiddleware(db), async (req: AuthRequest, res: Response) => {
      try {
        const result = await api.delete(table, req.params.id);
        if (!result.deleted) {
          const status = result.error === 'Not found' ? 404 : 409;
          res.status(status).json({ error: result.error });
          return;
        }
        res.json({ success: true });
      } catch {
        res.status(500).json({ error: 'Internal server error' });
      }
    });
  }

  adminCrud('sport-types', 'sport_types');
  adminCrud('facilities', 'facilities');

  return router;
}
