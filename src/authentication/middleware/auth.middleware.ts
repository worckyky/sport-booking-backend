import { Request, Response, NextFunction } from 'express';
import { SupabaseClient } from '@supabase/supabase-js';

export interface AuthRequest extends Request {
  userId?: string;
}

export const authMiddleware = (supabase: SupabaseClient) => {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      // Пытаемся получить токен из cookie или из заголовка Authorization
      let token = req.cookies.auth_token;
      
      if (!token) {
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
          token = authHeader.substring(7);
        }
      }

      if (!token) {
        return res.status(401).json({ error: 'Unauthorized - No token provided' });
      }

      // Проверяем токен через Supabase
      const { data: { user }, error } = await supabase.auth.getUser(token);

      if (error || !user) {
        return res.status(401).json({ 
          error: 'Unauthorized - Invalid token'
        });
      }

      // Сохраняем userId в request для использования в роутах
      req.userId = user.id;
      next();
    } catch (error) {
      if (error instanceof Error) {
        res.status(401).json({ error: `Unauthorized: ${error.message}` });
      } else {
        res.status(401).json({ error: 'Unauthorized' });
      }
    }
  };
};

