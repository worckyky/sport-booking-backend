import { Router, Response } from 'express';
import type { Pool } from 'pg';
import { RegistrationLinkAPI } from '../api/registration-link.api';
import { authMiddleware, type AuthRequest } from '../middleware/auth.middleware';
import { adminMiddleware } from '../middleware/admin.middleware';
import { AUTH_COOKIE_NAME, getAuthCookieOptions } from '../../config/auth';
import { AuditAPI, AUDIT_EVENTS } from '../../audit/audit.api';
import { validatePassword } from '../../utils/validators';

export function createRegistrationLinkRoutes(db: Pool): Router {
  const router = Router();
  const api = new RegistrationLinkAPI(db);
  const auditAPI = new AuditAPI(db);

  // ──────────────────────────────────────
  // Публичные endpoints
  // ──────────────────────────────────────

  /**
   * Валидация токена регистрации
   * GET /auth/registration-link/validate?token=XXX
   */
  router.get('/registration-link/validate', async (req: AuthRequest, res: Response) => {
    try {
      const token = req.query.token as string;
      if (!token) {
        return res.status(400).json({ error: 'Token is required' });
      }

      const result = await api.validateToken(token);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Internal server error' });
    }
  });

  /**
   * Принять ссылку — зарегистрироваться как владелец площадки
   * POST /auth/registration-link/accept
   */
  router.post('/registration-link/accept', async (req: AuthRequest, res: Response) => {
    try {
      const { token, name, email, phone, password, consent_personal_data, consent_terms, consent_marketing } = req.body;

      if (!token || !name || !email || !password) {
        return res.status(400).json({ error: 'Token, name, email and password are required' });
      }

      const pwError = validatePassword(password);
      if (pwError) {
        return res.status(400).json({ error: pwError });
      }

      const result = await api.acceptLink(
        token,
        name,
        email,
        phone,
        password,
        consent_personal_data,
        consent_terms,
        consent_marketing,
        req.ip,
        req.headers['user-agent']
      );

      // Устанавливаем auth cookie
      res.cookie(AUTH_COOKIE_NAME, result.accessToken, getAuthCookieOptions());

      res.json({
        id: result.id,
        role: result.role,
        campaignId: result.campaignId,
        message: 'Registration successful'
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal server error';
      const status = message.includes('expired') ? 410
        : message.includes('already been used') ? 409
        : message.includes('Invalid') ? 400
        : message.includes('already exists') ? 409
        : 500;
      res.status(status).json({ error: message });
    }
  });

  // ──────────────────────────────────────
  // ADMIN endpoints
  // ──────────────────────────────────────

  /**
   * Создать ссылку регистрации
   * POST /auth/registration-link/create
   */
  router.post(
    '/registration-link/create',
    adminMiddleware(db),
    async (req: AuthRequest, res: Response) => {
      try {
        const result = await api.createLink(req.userId!);
        auditAPI.log({
          eventType: AUDIT_EVENTS.REGISTRATION_LINK_CREATED,
          actorId: req.userId!,
          resourceType: 'registration_link',
          resourceId: result.id,
        }).catch(() => {});
        res.status(201).json(result);
      } catch (error) {
        res.status(500).json({ error: error instanceof Error ? error.message : 'Internal server error' });
      }
    }
  );

  /**
   * Список всех ссылок
   * GET /auth/registration-link/list
   */
  router.get(
    '/registration-link/list',
    adminMiddleware(db),
    async (req: AuthRequest, res: Response) => {
      try {
        const links = await api.getLinks();
        res.json(links);
      } catch (error) {
        res.status(500).json({ error: error instanceof Error ? error.message : 'Internal server error' });
      }
    }
  );

  return router;
}
