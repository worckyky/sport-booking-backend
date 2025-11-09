import { Router, Request, Response } from 'express';
import { AuthAPI } from '../api/auth.api';
import { AuthRequest, SignInRequest, UserProfile } from '../model/auth.model';
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

        // Возвращаем только ID
        res.json({ id: data.id });
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

        // Возвращаем только ID
        res.json({ id: data.id });
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
  }

  getRouter(): Router {
    return this.router;
  }
}
