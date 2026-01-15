import { Router, Request, Response } from 'express';
import { AuthAPI } from '../api/auth.api';
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
import type { DbUser } from '../model/user.model';

export class AuthRoutes {
  private router: Router;
  private authAPI: AuthAPI;
  private db: Pool;

  constructor(db: Pool) {
    this.router = Router();
    this.authAPI = new AuthAPI(db);
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
      const campaignRes = await this.db.query<{ id: string }>(
        'select id from campaign_info where user_id = $1 limit 1',
        [userId]
      );
      if ((campaignRes.rowCount ?? 0) > 0) {
        profile.campaign_id = campaignRes.rows[0].id;
      }
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

    this.router.post('/signin', async (req: Request<{}, any, SignInRequest>, res: Response) => {
      try {
        const { email, password } = req.body;

        if (!email || !password) {
          return res.status(400).json({ error: 'Email and password are required' });
        }

        const data = await this.authAPI.signIn({ email, password });
        
        this.setAuthCookie(res, data.accessToken);

        // Возвращаем ID и статус верификации email
        res.json({ 
          id: data.id,
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

    this.router.post('/signup', async (req: Request<{}, any, AuthRequest>, res: Response) => {
      try {
        const { email, password, role, name, phone, date_of_birth } = req.body;

        if (!email || !password) {
          return res.status(400).json({ error: 'Email and password are required' });
        }

        if (role !== undefined && !Object.values(USER_ROLE).includes(role)) {
          return res.status(400).json({ error: 'Invalid role' });
        }

        const data = await this.authAPI.signUp({ email, password, role, name, phone, date_of_birth });
        
        this.setAuthCookie(res, data.accessToken);

        // Возвращаем ID и статус верификации email
        res.json({ 
          id: data.id,
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

        const newJwt = jwt.sign({}, getJwtSecret(), {
          subject: updated.userId,
          expiresIn: AUTH_TOKEN_TTL_SECONDS
        });
        this.setAuthCookie(res, newJwt);

        const profile = await this.getUserProfileById(updated.userId);
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
  }

  getRouter(): Router {
    return this.router;
  }
}
