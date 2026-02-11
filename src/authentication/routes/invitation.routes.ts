import { Router, Response } from 'express';
import type { Pool } from 'pg';
import { InvitationAPI } from '../api/invitation.api';
import { authMiddleware, type AuthRequest } from '../middleware/auth.middleware';
import { adminMiddleware } from '../middleware/admin.middleware';
import { campaignRoleMiddleware } from '../../campaign/middleware/campaign.middleware';
import { canInviteMiddleware } from '../middleware/can-invite.middleware';
import { USER_ROLE } from '../model/auth.model';
import { AUTH_COOKIE_NAME, AUTH_TOKEN_TTL_SECONDS } from '../../config/auth';

export function createInvitationRoutes(db: Pool): Router {
  const router = Router();
  const api = new InvitationAPI(db);

  // ──────────────────────────────────────
  // Публичные endpoints (без авторизации)
  // ──────────────────────────────────────

  /**
   * Валидация токена приглашения
   * GET /auth/invite/validate?token=XXX
   */
  router.get('/invite/validate', async (req: AuthRequest, res: Response) => {
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
   * Принять приглашение (регистрация по инвайту)
   * POST /auth/invite/accept
   */
  router.post('/invite/accept', async (req: AuthRequest, res: Response) => {
    try {
      const { token, password, name, phone, consent_personal_data } = req.body;

      if (!token || !password) {
        return res.status(400).json({ error: 'Token and password are required' });
      }

      if (password.length < 6) {
        return res.status(400).json({ error: 'Password must be at least 6 characters' });
      }

      const result = await api.acceptInvitation(
        token,
        password,
        name,
        phone,
        consent_personal_data,
        req.ip,
        req.headers['user-agent']
      );

      // Устанавливаем auth cookie (как в signIn)
      res.cookie(AUTH_COOKIE_NAME, result.accessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: AUTH_TOKEN_TTL_SECONDS * 1000,
        path: '/'
      });

      res.json({
        id: result.id,
        role: result.role,
        message: 'Invitation accepted successfully'
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
  // Создание инвайта (авторизованные)
  // ──────────────────────────────────────

  /**
   * Создать приглашение менеджера (Campaign owner)
   * POST /auth/invite/campaign
   */
  router.post(
    '/invite/campaign',
    authMiddleware(db),
    campaignRoleMiddleware(db),
    canInviteMiddleware(db),
    async (req: AuthRequest, res: Response) => {
      try {
        const { email } = req.body;
        if (!email) {
          return res.status(400).json({ error: 'Email is required' });
        }

        // Получить campaign_id пользователя
        const userResult = await db.query<{ campaign_id: string | null }>(
          'SELECT campaign_id FROM users WHERE id = $1',
          [req.userId]
        );
        const campaignId = userResult.rows[0]?.campaign_id;
        if (!campaignId) {
          return res.status(400).json({ error: 'No campaign associated with user' });
        }

        const invitation = await api.createInvitation(email, USER_ROLE.CAMPAIGN, campaignId, req.userId!);
        res.status(201).json(invitation);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Internal server error';
        const status = message.includes('already exists') ? 409 : 400;
        res.status(status).json({ error: message });
      }
    }
  );

  /**
   * Создать приглашение администратора (Superadmin)
   * POST /auth/invite/admin
   */
  router.post(
    '/invite/admin',
    adminMiddleware(db),
    canInviteMiddleware(db),
    async (req: AuthRequest, res: Response) => {
      try {
        const { email } = req.body;
        if (!email) {
          return res.status(400).json({ error: 'Email is required' });
        }

        const invitation = await api.createInvitation(email, USER_ROLE.ADMIN, null, req.userId!);
        res.status(201).json(invitation);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Internal server error';
        const status = message.includes('already exists') ? 409 : 400;
        res.status(status).json({ error: message });
      }
    }
  );

  /**
   * Повторить приглашение (новый токен + email)
   * POST /auth/invite/:id/resend
   */
  router.post(
    '/invite/:id/resend',
    authMiddleware(db),
    canInviteMiddleware(db),
    async (req: AuthRequest, res: Response) => {
      try {
        const result = await api.resendInvitation(req.params.id, req.userId!);
        res.json(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Internal server error';
        const status = message.includes('not found') ? 404
          : message.includes('Forbidden') ? 403
          : message.includes('already been used') ? 409
          : 400;
        res.status(status).json({ error: message });
      }
    }
  );

  // ──────────────────────────────────────
  // Команда площадки
  // ──────────────────────────────────────

  /**
   * Список команды площадки
   * GET /auth/team/campaign/:id
   */
  router.get(
    '/team/campaign/:id',
    authMiddleware(db),
    campaignRoleMiddleware(db),
    async (req: AuthRequest, res: Response) => {
      try {
        // Проверяем что запрашивающий принадлежит к этой площадке
        const userResult = await db.query<{ campaign_id: string | null }>(
          'SELECT campaign_id FROM users WHERE id = $1',
          [req.userId]
        );
        if (userResult.rows[0]?.campaign_id !== req.params.id) {
          return res.status(403).json({ error: 'Forbidden - Not your campaign' });
        }

        const team = await api.getCampaignTeam(req.params.id);
        res.json(team);
      } catch (error) {
        res.status(500).json({ error: error instanceof Error ? error.message : 'Internal server error' });
      }
    }
  );

  /**
   * Активные инвайты площадки
   * GET /auth/team/campaign/:id/invitations
   */
  router.get(
    '/team/campaign/:id/invitations',
    authMiddleware(db),
    campaignRoleMiddleware(db),
    async (req: AuthRequest, res: Response) => {
      try {
        const userResult = await db.query<{ campaign_id: string | null }>(
          'SELECT campaign_id FROM users WHERE id = $1',
          [req.userId]
        );
        if (userResult.rows[0]?.campaign_id !== req.params.id) {
          return res.status(403).json({ error: 'Forbidden - Not your campaign' });
        }

        const invitations = await api.getCampaignInvitations(req.params.id);
        res.json(invitations);
      } catch (error) {
        res.status(500).json({ error: error instanceof Error ? error.message : 'Internal server error' });
      }
    }
  );

  /**
   * Удалить менеджера из команды
   * DELETE /auth/team/campaign/:id/members/:userId
   */
  router.delete(
    '/team/campaign/:id/members/:userId',
    authMiddleware(db),
    campaignRoleMiddleware(db),
    canInviteMiddleware(db),
    async (req: AuthRequest, res: Response) => {
      try {
        // Проверяем принадлежность к площадке
        const userResult = await db.query<{ campaign_id: string | null }>(
          'SELECT campaign_id FROM users WHERE id = $1',
          [req.userId]
        );
        if (userResult.rows[0]?.campaign_id !== req.params.id) {
          return res.status(403).json({ error: 'Forbidden - Not your campaign' });
        }

        await api.removeCampaignMember(req.params.userId, req.params.id, req.userId!);
        res.json({ message: 'Member removed successfully' });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Internal server error';
        const status = message.includes('not found') ? 404
          : message.includes('Cannot remove') ? 403
          : 400;
        res.status(status).json({ error: message });
      }
    }
  );

  // ──────────────────────────────────────
  // Команда суперадминов
  // ──────────────────────────────────────

  /**
   * Список всех ADMIN-ов
   * GET /auth/admin/team
   */
  router.get(
    '/admin/team',
    adminMiddleware(db),
    async (req: AuthRequest, res: Response) => {
      try {
        const team = await api.getAdminTeam();
        res.json(team);
      } catch (error) {
        res.status(500).json({ error: error instanceof Error ? error.message : 'Internal server error' });
      }
    }
  );

  /**
   * Активные инвайты ADMIN
   * GET /auth/admin/invitations
   */
  router.get(
    '/admin/invitations',
    adminMiddleware(db),
    async (req: AuthRequest, res: Response) => {
      try {
        const invitations = await api.getAdminInvitations();
        res.json(invitations);
      } catch (error) {
        res.status(500).json({ error: error instanceof Error ? error.message : 'Internal server error' });
      }
    }
  );

  return router;
}
