import { Router, Request, Response } from 'express';
import { AuthAPI } from '../api/auth.api';
import { BookingAPI } from '../../booking/api/booking.api';
import jwt from 'jsonwebtoken';
import type { Pool } from 'pg';
import { AUTH_COOKIE_NAME, AUTH_TOKEN_TTL_SECONDS, getJwtSecret } from '../../config/auth';
import {
  type AuthRequest,
  type ResetPasswordRequest,
  type SignInRequest,
  type UpdatePasswordWithTokenRequest,
  type UserProfile,
  EMAIL_STATUS,
  USER_ROLE
} from '../model/auth.model';
import { authMiddleware, AuthRequest as AuthReq } from '../middleware/auth.middleware';
import { adminMiddleware } from '../middleware/admin.middleware';
import { bruteForcePrevention, recordLoginAttempt } from '../middleware/brute-force.middleware';
import type { DbUser } from '../model/user.model';
import { AuditAPI, AUDIT_EVENTS } from '../../audit/audit.api';
import { validatePassword } from '../../utils/validators';

export class AuthRoutes {
  private router: Router;
  private authAPI: AuthAPI;
  private bookingAPI: BookingAPI;
  private auditAPI: AuditAPI;
  private db: Pool;

  constructor(db: Pool) {
    this.router = Router();
    this.authAPI = new AuthAPI(db);
    this.bookingAPI = new BookingAPI(db);
    this.auditAPI = new AuditAPI(db);
    this.db = db;
    this.initializeRoutes();
  }

  private setAuthCookie(res: Response, accessToken: string): void {
    res.cookie(AUTH_COOKIE_NAME, accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: AUTH_TOKEN_TTL_SECONDS * 1000
    });
  }

  private async getUserProfileById(userId: string): Promise<UserProfile | null> {
    const userRes = await this.db.query<DbUser>('select * from users where id = $1', [userId]);
    const user = userRes.rows[0];
    if (!user) return null;

    const emailVerified = user.email_verified ?? EMAIL_STATUS.NOT_VERIFIED;

    const profile: UserProfile = {
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.name ?? undefined,
      phone: user.phone ?? undefined,
      date_of_birth: user.date_of_birth ?? undefined,
      email_verified: emailVerified,
      registration_date: user.created_at,
      created_at: user.created_at,
      updated_at: user.updated_at
    };

    if (user.role === USER_ROLE.CAMPAIGN) {
      // JOIN через users.campaign_id — работает и для owner, и для manager
      const campaignRes = await this.db.query<{ id: string; timezone_id: string | null; name: string | null; status: string | null; moderation_comment: string | null }>(
        `SELECT ci.id, ci.timezone_id, ci.name, ci.status, ci.moderation_comment
         FROM campaign_info ci
         JOIN users u ON u.campaign_id = ci.id
         WHERE u.id = $1
         LIMIT 1`,
        [userId]
      );
      if ((campaignRes.rowCount ?? 0) > 0) {
        profile.campaign_id = campaignRes.rows[0].id;
        profile.campaign_timezone_id = campaignRes.rows[0].timezone_id ?? 'Europe/Moscow';
        profile.campaign_name = campaignRes.rows[0].name ?? undefined;
        profile.campaign_status = campaignRes.rows[0].status ?? undefined;
        profile.campaign_moderation_comment = campaignRes.rows[0].moderation_comment ?? undefined;
      }
      // invited_by для определения прав на управление командой
      profile.invited_by = user.invited_by ?? undefined;
    }

    return profile;
  }

  private initializeRoutes(): void {
    this.router.get('/confirm', async (req: Request, res: Response) => {
      try {
        const { access_token, refresh_token } = req.query;

        // refresh_token оставлен для совместимости со старым контрактом, но для локального flow не нужен
        if (!access_token) {
          return res.status(400).json({ error: 'Invalid confirmation link' });
        }

        const data = await this.authAPI.confirmEmail(
          access_token as string,
          typeof refresh_token === 'string' ? refresh_token : ''
        );

        this.setAuthCookie(res, data.accessToken);

        const payload = jwt.verify(data.accessToken, getJwtSecret());
        const userId = typeof payload === 'string' ? null : payload.sub;
        if (!userId || typeof userId !== 'string') {
          return res.status(400).json({ error: 'Failed to get user data' });
        }

        // Возвращаем ID и статус верификации email
        res.json({
          id: userId,
          email_verified: 'VERIFIED'
        });
      } catch (error) {
        if (error instanceof Error) {
          res.status(400).json({ error: error.message });
        } else {
          res.status(500).json({ error: 'Internal server error' });
        }
      }
    });

    this.router.post('/signin', bruteForcePrevention(this.db), async (req: Request<{}, any, SignInRequest>, res: Response) => {
      const { email, password } = req.body;
      const ipAddress = req.ip || req.headers['x-forwarded-for'] as string;
      const userAgent = req.headers['user-agent'];

      try {
        if (!email || !password) {
          return res.status(400).json({ error: 'Email and password are required' });
        }

        const data = await this.authAPI.signIn({ email, password });

        // Успешный вход — записываем в лог
        await recordLoginAttempt(this.db, email, true, ipAddress, userAgent);

        this.setAuthCookie(res, data.accessToken);

        // Возвращаем ID, роль и статус верификации email
        res.json({
          id: data.id,
          role: data.role,
          email_verified: data.email_verified
        });
      } catch (error) {
        // Неудачная попытка — записываем в лог
        await recordLoginAttempt(this.db, email, false, ipAddress, userAgent);

        if (error instanceof Error) {
          res.status(400).json({ error: error.message });
        } else {
          res.status(500).json({ error: 'Internal server error' });
        }
      }
    });

    this.router.post('/signup', async (req: Request<{}, any, AuthRequest>, res: Response) => {
      try {
        const { email, password, role, name, phone, date_of_birth, consent_personal_data, consent_terms } = req.body;

        if (!email || !password) {
          return res.status(400).json({ error: 'Email and password are required' });
        }

        const pwError = validatePassword(password);
        if (pwError) {
          return res.status(400).json({ error: pwError });
        }

        if (role !== undefined && !Object.values(USER_ROLE).includes(role)) {
          return res.status(400).json({ error: 'Invalid role' });
        }

        const ipAddress = req.ip || req.socket.remoteAddress;
        const userAgent = req.headers['user-agent'];

        const data = await this.authAPI.signUp(
          { email, password, role, name, phone, date_of_birth, consent_personal_data, consent_terms },
          ipAddress,
          userAgent
        );
        
        this.setAuthCookie(res, data.accessToken);

        // Возвращаем ID, роль и статус верификации email
        res.json({
          id: data.id,
          role: data.role,
          email_verified: data.email_verified
        });
      } catch (error) {
        if (error instanceof Error) {
          res.status(400).json({ error: error.message });
        } else {
          res.status(500).json({ error: 'Internal server error' });
        }
      }
    });

    this.router.post('/signout', async (req: Request, res: Response) => {
      try {
        const data = await this.authAPI.signOut();
        
        // Удаляем cookie
        res.clearCookie(AUTH_COOKIE_NAME, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'strict'
        });
        
        res.json(data);
      } catch (error) {
        if (error instanceof Error) {
          res.status(400).json({ error: error.message });
        } else {
          res.status(500).json({ error: 'Internal server error' });
        }
      }
    });

    this.router.get('/profile', authMiddleware(this.db), async (req: AuthReq, res: Response) => {
      try {
        const userId = req.userId;

        if (!userId) {
          return res.status(401).json({ error: 'User not authenticated' });
        }

        const profile = await this.getUserProfileById(userId);
        if (!profile) return res.status(404).json({ error: 'User profile not found' });

        res.json(profile);
      } catch (error) {
        if (error instanceof Error) {
          res.status(400).json({ error: error.message });
        } else {
          res.status(500).json({ error: 'Internal server error' });
        }
      }
    });

    this.router.put('/profile', authMiddleware(this.db), async (req: AuthReq, res: Response) => {
      try {
        const userId = req.userId;

        if (!userId) {
          return res.status(401).json({ error: 'User not authenticated' });
        }

        const updates = req.body;
        
        const fields: Array<'role' | 'name' | 'phone' | 'date_of_birth'> = [
          'role',
          'name',
          'phone',
          'date_of_birth'
        ];

        const setParts: string[] = [];
        const values: Array<string | null> = [];
        let idx = 1;

        for (const f of fields) {
          if (updates[f] !== undefined) {
            setParts.push(`${f} = $${idx}`);
            values.push(updates[f] ?? null);
            idx += 1;
          }
        }

        if (setParts.length === 0) {
          return res.status(400).json({ error: 'No data provided for update' });
        }

        values.push(userId);
        await this.db.query(
          `update users set ${setParts.join(', ')}, updated_at = now() where id = $${idx}`,
          values
        );

        const updatedProfile = await this.getUserProfileById(userId);
        if (!updatedProfile) return res.status(404).json({ error: 'User profile not found' });

        res.json(updatedProfile);
      } catch (error) {
        if (error instanceof Error) {
          res.status(400).json({ error: error.message });
        } else {
          res.status(500).json({ error: 'Internal server error' });
        }
      }
    });

    this.router.post('/reset-password', async (req: Request<{}, any, ResetPasswordRequest>, res: Response) => {
      try {
        const { email } = req.body;

        if (!email) {
          return res.status(400).json({ error: 'Email is required' });
        }

        const data = await this.authAPI.requestPasswordReset(email);
        res.json(data);
      } catch (error) {
        if (error instanceof Error) {
          res.status(400).json({ error: error.message });
        } else {
          res.status(500).json({ error: 'Internal server error' });
        }
      }
    });

    this.router.post('/new-password', async (req: Request<{}, any, UpdatePasswordWithTokenRequest>, res: Response) => {
      try {
        const { password, confirmPassword, access_token, refresh_token } = req.body;

        if (!password || !confirmPassword) {
          return res.status(400).json({ error: 'Password and confirm password are required' });
        }

        const pwError = validatePassword(password);
        if (pwError) {
          return res.status(400).json({ error: pwError });
        }

        if (!access_token) {
          return res.status(400).json({ error: 'Access token is required' });
        }

        // refresh_token оставлен для совместимости со старым контрактом, но не используется
        void refresh_token;

        const updated = await this.authAPI.updatePasswordWithResetToken(
          access_token,
          password,
          confirmPassword
        );

        const profile = await this.getUserProfileById(updated.userId);
        const newJwt = jwt.sign({ role: profile?.role ?? USER_ROLE.USER }, getJwtSecret(), {
          subject: updated.userId,
          expiresIn: AUTH_TOKEN_TTL_SECONDS
        });
        this.setAuthCookie(res, newJwt);
        if (!profile) {
          return res.status(404).json({ error: 'User profile not found' });
        }

        res.json({
          message: updated.message,
          id: profile.id,
          email_verified: profile.email_verified
        });
      } catch (error) {
        if (error instanceof Error) {
          res.status(400).json({ error: error.message });
        } else {
          res.status(500).json({ error: 'Internal server error' });
        }
      }
    });

    // Admin routes
    this.router.get('/admin/stats', adminMiddleware(this.db), async (_req: AuthReq, res: Response) => {
      try {
        const stats = await this.authAPI.getAdminStats();
        res.json(stats);
      } catch (error) {
        if (error instanceof Error) {
          res.status(400).json({ error: error.message });
        } else {
          res.status(500).json({ error: 'Internal server error' });
        }
      }
    });

    // Charts data for dashboard
    this.router.get('/admin/charts', adminMiddleware(this.db), async (req: AuthReq, res: Response) => {
      try {
        const days = req.query.days ? parseInt(req.query.days as string, 10) : 7;
        const [bookingsDaily, statusDistribution] = await Promise.all([
          // Bookings per day (fill missing days with 0)
          this.db.query<{ date: string; count: string }>(
            `SELECT d.dt::date::text as date, COALESCE(cnt.count, 0)::int as count
             FROM generate_series(
               (CURRENT_DATE - INTERVAL '1 day' * ($1 - 1))::date,
               CURRENT_DATE::date,
               '1 day'::interval
             ) AS d(dt)
             LEFT JOIN (
               SELECT s.date, COUNT(b.id) as count
               FROM bookings b
               JOIN booking_slots s ON b.slot_id = s.id
               WHERE s.date >= CURRENT_DATE - INTERVAL '1 day' * ($1 - 1)
                 AND s.date <= CURRENT_DATE
               GROUP BY s.date
             ) cnt ON cnt.date = d.dt::date
             ORDER BY d.dt ASC`,
            [days]
          ),
          // Booking status distribution
          this.db.query<{ status: string; count: string }>(
            `SELECT status, COUNT(*)::int as count
             FROM bookings
             GROUP BY status
             ORDER BY count DESC`
          ),
        ]);

        res.json({
          bookingsDaily: bookingsDaily.rows,
          statusDistribution: statusDistribution.rows,
        });
      } catch (error) {
        res.status(500).json({ error: error instanceof Error ? error.message : 'Internal server error' });
      }
    });

    this.router.get('/admin/users', adminMiddleware(this.db), async (_req: AuthReq, res: Response) => {
      try {
        const users = await this.authAPI.getAllUsers();
        res.json(users);
      } catch (error) {
        if (error instanceof Error) {
          res.status(400).json({ error: error.message });
        } else {
          res.status(500).json({ error: 'Internal server error' });
        }
      }
    });

    // Export users CSV (admin only)
    this.router.get('/admin/users/export', adminMiddleware(this.db), async (_req: AuthReq, res: Response) => {
      try {
        const users = await this.authAPI.getAllUsers();
        const header = 'ID,Имя,Email,Телефон,Роль,Заблокирован,Площадка,Кол-во броней,Последняя бронь,Дата регистрации\n';
        const rows = users.map((u: any) => [
          u.id,
          `"${(u.name || '').replace(/"/g, '""')}"`,
          u.email,
          u.phone || '',
          u.role,
          u.is_blocked ? 'Да' : 'Нет',
          `"${(u.campaign_name || '').replace(/"/g, '""')}"`,
          u.bookings_count || 0,
          u.last_booking_at || '',
          u.created_at || '',
        ].join(',')).join('\n');
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="users_${new Date().toISOString().slice(0,10)}.csv"`);
        res.send('\uFEFF' + header + rows);
      } catch (error) {
        res.status(500).json({ error: error instanceof Error ? error.message : 'Internal server error' });
      }
    });

    // Export bookings CSV (admin only)
    this.router.get('/admin/bookings/export', adminMiddleware(this.db), async (_req: AuthReq, res: Response) => {
      try {
        const result = await this.db.query(
          `SELECT b.id, b.status, b.contact_name, b.contact_phone, b.comment,
                  b.created_at, s.date as slot_date, s.start_time, s.end_time,
                  f.name as field_name, ci.name as campaign_name,
                  u.email as user_email
           FROM bookings b
           JOIN booking_slots s ON b.slot_id = s.id
           JOIN fields f ON s.field_id = f.id
           JOIN campaign_info ci ON f.campaign_id = ci.id
           LEFT JOIN users u ON b.user_id = u.id
           ORDER BY b.created_at DESC`
        );
        const header = 'ID,Статус,Дата,Начало,Конец,Поле,Площадка,Клиент,Телефон,Email,Комментарий,Дата создания\n';
        const rows = result.rows.map((r: any) => [
          r.id,
          r.status,
          r.slot_date,
          r.start_time,
          r.end_time,
          `"${(r.field_name || '').replace(/"/g, '""')}"`,
          `"${(r.campaign_name || '').replace(/"/g, '""')}"`,
          `"${(r.contact_name || '').replace(/"/g, '""')}"`,
          r.contact_phone || '',
          r.user_email || '',
          `"${(r.comment || '').replace(/"/g, '""')}"`,
          r.created_at,
        ].join(',')).join('\n');
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="bookings_${new Date().toISOString().slice(0,10)}.csv"`);
        res.send('\uFEFF' + header + rows);
      } catch (error) {
        res.status(500).json({ error: error instanceof Error ? error.message : 'Internal server error' });
      }
    });

    // Get single user by ID (admin only)
    this.router.get('/admin/users/:id', adminMiddleware(this.db), async (req: AuthReq, res: Response) => {
      try {
        const userId = req.params.id;
        if (!userId) {
          return res.status(400).json({ error: 'User ID is required' });
        }

        const user = await this.authAPI.getUserById(userId);
        if (!user) {
          return res.status(404).json({ error: 'User not found' });
        }

        res.json(user);
      } catch (error) {
        if (error instanceof Error) {
          res.status(400).json({ error: error.message });
        } else {
          res.status(500).json({ error: 'Internal server error' });
        }
      }
    });

    // Get user's bookings (admin only)
    this.router.get('/admin/users/:id/bookings', adminMiddleware(this.db), async (req: AuthReq, res: Response) => {
      try {
        const userId = req.params.id;
        const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 5;

        const result = await this.db.query(
          `SELECT
             b.id, b.status, b.comment, b.contact_name, b.contact_phone, b.created_at,
             s.date as slot_date, s.start_time as slot_start_time, s.end_time as slot_end_time,
             f.name as field_name, f.id as field_id, f.campaign_id,
             ci.name as campaign_name
           FROM bookings b
           JOIN booking_slots s ON b.slot_id = s.id
           JOIN fields f ON s.field_id = f.id
           JOIN campaign_info ci ON f.campaign_id = ci.id
           WHERE b.user_id = $1
           ORDER BY b.created_at DESC
           LIMIT $2`,
          [userId, limit]
        );

        res.json(result.rows);
      } catch (error) {
        if (error instanceof Error) {
          res.status(400).json({ error: error.message });
        } else {
          res.status(500).json({ error: 'Internal server error' });
        }
      }
    });

    this.router.get('/admin/bookings', adminMiddleware(this.db), async (req: AuthReq, res: Response) => {
      try {
        const { page, limit } = req.query;
        const pagination = {
          page: page ? parseInt(page as string, 10) : undefined,
          limit: limit ? parseInt(limit as string, 10) : undefined,
        };
        const result = await this.bookingAPI.getAllBookings(pagination);
        res.json(result);
      } catch (error) {
        if (error instanceof Error) {
          res.status(400).json({ error: error.message });
        } else {
          res.status(500).json({ error: 'Internal server error' });
        }
      }
    });

    // Block user (admin only)
    this.router.put('/admin/users/:id/block', adminMiddleware(this.db), async (req: AuthReq, res: Response) => {
      try {
        const userId = req.params.id;
        if (!userId) {
          return res.status(400).json({ error: 'User ID is required' });
        }

        const result = await this.authAPI.setUserBlocked(userId, true);
        this.auditAPI.log({ eventType: AUDIT_EVENTS.USER_BLOCKED, actorId: req.userId!, resourceType: 'user', resourceId: userId }).catch(() => {});
        res.json(result);
      } catch (error) {
        if (error instanceof Error) {
          if (error.message === 'User not found') {
            res.status(404).json({ error: error.message });
          } else {
            res.status(400).json({ error: error.message });
          }
        } else {
          res.status(500).json({ error: 'Internal server error' });
        }
      }
    });

    // Unblock user (admin only)
    this.router.put('/admin/users/:id/unblock', adminMiddleware(this.db), async (req: AuthReq, res: Response) => {
      try {
        const userId = req.params.id;
        if (!userId) {
          return res.status(400).json({ error: 'User ID is required' });
        }

        const result = await this.authAPI.setUserBlocked(userId, false);
        this.auditAPI.log({ eventType: AUDIT_EVENTS.USER_UNBLOCKED, actorId: req.userId!, resourceType: 'user', resourceId: userId }).catch(() => {});
        res.json(result);
      } catch (error) {
        if (error instanceof Error) {
          if (error.message === 'User not found') {
            res.status(404).json({ error: error.message });
          } else {
            res.status(400).json({ error: error.message });
          }
        } else {
          res.status(500).json({ error: 'Internal server error' });
        }
      }
    });

    // Get platform settings (admin only)
    this.router.get('/admin/settings', adminMiddleware(this.db), async (req: AuthReq, res: Response) => {
      try {
        const result = await this.db.query('SELECT key, value, updated_at FROM platform_settings ORDER BY key');
        const settings: Record<string, unknown> = {};
        for (const row of result.rows) {
          settings[row.key] = row.value;
        }
        res.json(settings);
      } catch (error) {
        if (error instanceof Error) {
          res.status(400).json({ error: error.message });
        } else {
          res.status(500).json({ error: 'Internal server error' });
        }
      }
    });

    // Update platform settings (admin only)
    this.router.put('/admin/settings', adminMiddleware(this.db), async (req: AuthReq, res: Response) => {
      try {
        const updates = req.body as Record<string, unknown>;
        if (!updates || Object.keys(updates).length === 0) {
          return res.status(400).json({ error: 'No settings provided' });
        }

        const allowedKeys = [
          'booking_limit_per_user',
          'booking_rate_limit_per_min',
          'registration_link_ttl_days',
          'invitation_ttl_days',
          'default_timezone',
        ];

        for (const [key, value] of Object.entries(updates)) {
          if (!allowedKeys.includes(key)) {
            return res.status(400).json({ error: `Unknown setting: ${key}` });
          }
          await this.db.query(
            `INSERT INTO platform_settings (key, value, updated_by, updated_at)
             VALUES ($1, $2, $3, NOW())
             ON CONFLICT (key) DO UPDATE SET value = $2, updated_by = $3, updated_at = NOW()`,
            [key, JSON.stringify(value), req.userId]
          );
        }

        this.auditAPI.log({
          eventType: AUDIT_EVENTS.SETTINGS_UPDATED,
          actorId: req.userId!,
          resourceType: 'settings',
          changes: Object.fromEntries(
            Object.entries(updates).map(([k, v]) => [k, { to: v }])
          ),
        }).catch(() => {});

        // Return updated settings
        const result = await this.db.query('SELECT key, value FROM platform_settings ORDER BY key');
        const settings: Record<string, unknown> = {};
        for (const row of result.rows) {
          settings[row.key] = row.value;
        }
        res.json(settings);
      } catch (error) {
        if (error instanceof Error) {
          res.status(400).json({ error: error.message });
        } else {
          res.status(500).json({ error: 'Internal server error' });
        }
      }
    });
  }

  getRouter(): Router {
    return this.router;
  }
}
