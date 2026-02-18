import { Request, Response, NextFunction } from 'express';
import type { Pool } from 'pg';

const MAX_FAILED_ATTEMPTS = 5;
const BLOCK_DURATION_MINUTES = 30;
const ATTEMPT_WINDOW_MINUTES = 15; // Окно для подсчёта попыток

interface LoginAttempt {
  id: string;
  email: string;
  success: boolean;
  attempted_at: Date;
  blocked_until: Date | null;
}

/**
 * Записывает попытку входа в БД
 */
export async function recordLoginAttempt(
  db: Pool,
  email: string,
  success: boolean,
  ipAddress?: string,
  userAgent?: string
): Promise<void> {
  await db.query(
    `INSERT INTO login_attempts (email, ip_address, user_agent, success, attempted_at)
     VALUES ($1, $2, $3, $4, NOW())`,
    [email.toLowerCase(), ipAddress, userAgent, success]
  );
}

/**
 * Проверяет, заблокирован ли пользователь после неудачных попыток
 */
export async function isUserBlocked(db: Pool, email: string): Promise<{ blocked: boolean; until?: Date }> {
  const result = await db.query<{ blocked_until: Date }>(
    `SELECT blocked_until FROM login_attempts
     WHERE email = $1 AND blocked_until IS NOT NULL AND blocked_until > NOW()
     ORDER BY blocked_until DESC
     LIMIT 1`,
    [email.toLowerCase()]
  );

  if (result.rows.length > 0) {
    return { blocked: true, until: result.rows[0].blocked_until };
  }

  // Проверяем количество неудачных попыток за последние N минут
  const attemptsResult = await db.query<{ count: string }>(
    `SELECT COUNT(*) as count FROM login_attempts
     WHERE email = $1
       AND success = false
       AND attempted_at > NOW() - INTERVAL '${ATTEMPT_WINDOW_MINUTES} minutes'`,
    [email.toLowerCase()]
  );

  const failedAttempts = parseInt(attemptsResult.rows[0].count, 10);

  if (failedAttempts >= MAX_FAILED_ATTEMPTS) {
    // Блокируем пользователя
    const blockedUntil = new Date(Date.now() + BLOCK_DURATION_MINUTES * 60 * 1000);
    await db.query(
      `INSERT INTO login_attempts (email, success, attempted_at, blocked_until)
       VALUES ($1, false, NOW(), $2)`,
      [email.toLowerCase(), blockedUntil]
    );
    return { blocked: true, until: blockedUntil };
  }

  return { blocked: false };
}

/**
 * Middleware для проверки brute-force атак перед входом
 */
export const bruteForcePrevention = (db: Pool) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const email = req.body.email?.trim().toLowerCase();

      if (!email) {
        next();
        return;
      }

      const blockStatus = await isUserBlocked(db, email);

      if (blockStatus.blocked) {
        const minutesLeft = blockStatus.until
          ? Math.ceil((blockStatus.until.getTime() - Date.now()) / 60000)
          : BLOCK_DURATION_MINUTES;

        res.status(429).json({
          error: 'Too many failed login attempts',
          message: `Account temporarily locked. Try again in ${minutesLeft} minutes.`,
          blocked_until: blockStatus.until
        });
        return;
      }

      next();
    } catch (error) {
      // В случае ошибки middleware пропускаем запрос (fail-open для availability)
      console.error('Brute-force prevention error:', error);
      next();
    }
  };
};

/**
 * Очистка старых записей (запускать через cron или периодически)
 */
export async function cleanupOldAttempts(db: Pool, daysToKeep = 30): Promise<number> {
  const result = await db.query(
    `DELETE FROM login_attempts
     WHERE attempted_at < NOW() - INTERVAL '${daysToKeep} days'`
  );
  return result.rowCount || 0;
}
