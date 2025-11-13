import { Router, Request, Response } from 'express';
import { AuthAPI } from '../api/auth.api';
import { AuthRequest, SignInRequest, UserProfile, ResetPasswordRequest, UpdatePasswordWithTokenRequest } from '../model/auth.model';
import { SupabaseClient } from '@supabase/supabase-js';
import { authMiddleware, AuthRequest as AuthReq } from '../middleware/auth.middleware';

export class AuthRoutes {
  private router: Router;
  private authAPI: AuthAPI;
  private supabase: SupabaseClient;
  private supabaseAdmin: SupabaseClient;

  constructor(supabase: SupabaseClient, supabaseAdmin: SupabaseClient) {
    this.router = Router();
    this.authAPI = new AuthAPI(supabase);
    this.supabase = supabase;
    this.supabaseAdmin = supabaseAdmin;
    this.initializeRoutes();
  }

  private initializeRoutes(): void {
    this.router.get('/confirm', async (req: Request, res: Response) => {
      try {
        const { access_token, refresh_token } = req.query;

        if (!access_token || !refresh_token) {
          return res.status(400).json({ error: 'Invalid confirmation link' });
        }

        const data = await this.authAPI.confirmEmail(
          access_token as string,
          refresh_token as string
        );

        // Устанавливаем cookie с токеном на 7 дней
        res.cookie('auth_token', data.accessToken, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'strict',
          maxAge: 7 * 24 * 60 * 60 * 1000
        });

        // Получаем информацию о пользователе
        const { data: userData, error: userError } = await this.supabase.auth.getUser(data.accessToken);

        if (userError || !userData.user) {
          return res.status(400).json({ error: 'Failed to get user data' });
        }

        // Возвращаем ID и статус верификации email
        res.json({
          id: userData.user.id,
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
        
        // Устанавливаем cookie с токеном на 7 дней
        res.cookie('auth_token', data.accessToken, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'strict',
          maxAge: 7 * 24 * 60 * 60 * 1000 // 7 дней в миллисекундах
        });

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
        const { email, password, role, name, phone } = req.body;

        if (!email || !password) {
          return res.status(400).json({ error: 'Email and password are required' });
        }

        const data = await this.authAPI.signUp({ email, password, role, name, phone });
        
        // Устанавливаем cookie с токеном на 7 дней
        res.cookie('auth_token', data.accessToken, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'strict',
          maxAge: 7 * 24 * 60 * 60 * 1000 // 7 дней в миллисекундах
        });

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
        res.clearCookie('auth_token', {
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

    this.router.get('/profile', authMiddleware(this.supabaseAdmin), async (req: AuthReq, res: Response) => {
      try {
        const userId = req.userId;

        if (!userId) {
          return res.status(401).json({ error: 'User not authenticated' });
        }

        // Используем admin клиент для получения профиля
        const { data, error } = await this.supabaseAdmin.auth.admin.getUserById(userId);

        if (error || !data.user) {
          return res.status(404).json({ error: 'User profile not found' });
        }

        const profile = {
          id: data.user.id,
          email: data.user.email,
          role: data.user.user_metadata?.role,
          name: data.user.user_metadata?.name,
          phone: data.user.user_metadata?.phone,
          registration_date: data.user.created_at,
          created_at: data.user.created_at,
          updated_at: data.user.updated_at || data.user.created_at
        };

        res.json(profile);
      } catch (error) {
        if (error instanceof Error) {
          res.status(400).json({ error: error.message });
        } else {
          res.status(500).json({ error: 'Internal server error' });
        }
      }
    });

    this.router.put('/profile', authMiddleware(this.supabaseAdmin), async (req: AuthReq, res: Response) => {
      try {
        const userId = req.userId;

        if (!userId) {
          return res.status(401).json({ error: 'User not authenticated' });
        }

        const updates = req.body;
        
        // Используем admin клиент для обновления профиля
        const { data, error } = await this.supabaseAdmin.auth.admin.updateUserById(userId, {
          user_metadata: {
            role: updates.role,
            name: updates.name,
            phone: updates.phone
          }
        });

        if (error || !data.user) {
          return res.status(400).json({ error: 'Failed to update profile' });
        }

        const updatedProfile = {
          id: data.user.id,
          email: data.user.email,
          role: data.user.user_metadata?.role,
          name: data.user.user_metadata?.name,
          phone: data.user.user_metadata?.phone,
          registration_date: data.user.created_at,
          created_at: data.user.created_at,
          updated_at: data.user.updated_at || data.user.created_at
        };

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

        // Устанавливаем сессию с токенами из ссылки восстановления пароля
        const { data: sessionData, error: sessionError } = await this.supabase.auth.setSession({
          access_token: access_token,
          refresh_token: refresh_token || ''
        });

        if (sessionError || !sessionData.session || !sessionData.user) {
          return res.status(400).json({ error: 'Invalid or expired token' });
        }

        const data = await this.authAPI.updatePassword({ password, confirmPassword });

        // Устанавливаем cookie с новым access_token для автоматической авторизации
        res.cookie('auth_token', sessionData.session.access_token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'strict',
          maxAge: 7 * 24 * 60 * 60 * 1000
        });

        // Возвращаем информацию о пользователе
        res.json({
          ...data,
          id: sessionData.user.id,
          email_verified: sessionData.user.email_confirmed_at ? 'VERIFIED' : 'NOT_VERIFIED'
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
