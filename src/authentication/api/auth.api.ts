import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import type { Pool } from 'pg';
import { AUTH_TOKEN_TTL_SECONDS, getJwtSecret } from '../../config/auth';
import {
  type AuthRequest,
  type ResetPasswordResponse,
  type SignInRequest,
  type SignInResponse,
  type SignOutResponse,
  EMAIL_STATUS,
  USER_ROLE
} from '../model/auth.model';
import { type DbUser, getEmailStatus } from '../model/user.model';
import { createEmailConfirmToken, sendEmailConfirmation } from '../../utils/emailConfirmation';
import { sendPasswordResetEmail } from '../../utils/passwordResetEmail';

export class AuthAPI {
  constructor(private db: Pool) {}

  async signIn(credentials: SignInRequest): Promise<SignInResponse & { accessToken: string }> {
    const email = credentials.email.trim().toLowerCase();
    const result = await this.db.query<DbUser>('select * from users where email = $1', [email]);
    const user = result.rows[0];

    if (!user) {
      throw new Error('Invalid email or password');
    }

    const ok = await bcrypt.compare(credentials.password, user.password_hash);
    if (!ok) {
      throw new Error('Invalid email or password');
    }

    const accessToken = jwt.sign({ role: user.role }, getJwtSecret(), {
      subject: user.id,
      expiresIn: AUTH_TOKEN_TTL_SECONDS
    });

    return {
      id: user.id,
      accessToken,
      role: user.role,
      email_verified: getEmailStatus(user)
    };
  }

  async signUp(
    credentials: AuthRequest,
    ipAddress?: string,
    userAgent?: string
  ): Promise<SignInResponse & { accessToken: string }> {
    const email = credentials.email.trim().toLowerCase();
    const role = credentials.role ?? USER_ROLE.USER;
    const id = crypto.randomUUID();
    const passwordHash = await bcrypt.hash(credentials.password, 10);
    const now = new Date().toISOString();

    const campaignName = (() => {
      const n = credentials.name?.trim();
      if (n) return n;
      return email;
    })();

    const client = await this.db.connect();
    try {
      await client.query('begin');

      const inserted = await client.query<Pick<DbUser, 'id'>>(
        `
          insert into users (id, email, password_hash, role, name, phone, date_of_birth, email_verified, created_at, updated_at)
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          returning id
        `,
        [
          id,
          email,
          passwordHash,
          role,
          credentials.name ?? null,
          credentials.phone ?? null,
          credentials.date_of_birth ?? null,
          EMAIL_STATUS.NOT_VERIFIED,
          now,
          now
        ]
      );

      const userId = inserted.rows[0].id;

      if (role === USER_ROLE.CAMPAIGN) {
        const campaignId = crypto.randomUUID();
        await client.query(
          `
            insert into campaign_info (id, user_id, name, created_at, updated_at)
            values ($1, $2, $3, $4, $5)
          `,
          [campaignId, userId, campaignName, now, now]
        );

        await client.query('update users set campaign_id = $1 where id = $2', [
          campaignId,
          userId
        ]);
      }

      // Сохраняем согласия в user_consents (если даны)
      if (credentials.consent_personal_data) {
        await client.query(
          `insert into user_consents (user_id, consent_type, accepted, ip_address, user_agent)
           values ($1, 'PERSONAL_DATA', true, $2, $3)`,
          [userId, ipAddress ?? null, userAgent ?? null]
        );
      }

      if (credentials.consent_terms) {
        await client.query(
          `insert into user_consents (user_id, consent_type, accepted, ip_address, user_agent)
           values ($1, 'TERMS', true, $2, $3)`,
          [userId, ipAddress ?? null, userAgent ?? null]
        );
      }

      // Отправляем письмо подтверждения регистрации (локально, без Supabase)
      const confirmToken = createEmailConfirmToken(userId);
      await sendEmailConfirmation(email, confirmToken);

      const accessToken = jwt.sign({ role }, getJwtSecret(), {
        subject: inserted.rows[0].id,
        expiresIn: AUTH_TOKEN_TTL_SECONDS
      });

      await client.query('commit');

      return {
        id: inserted.rows[0].id,
        accessToken,
        role,
        email_verified: EMAIL_STATUS.NOT_VERIFIED
      };
    } catch (error) {
      await client.query('rollback');
      if (error instanceof Error) {
        // unique_violation
        if ((error as unknown as { code?: string }).code === '23505') {
          throw new Error('User already exists');
        }
        throw error;
      }
      throw new Error('User registration failed');
    } finally {
      client.release();
    }
  }

  async confirmEmail(accessToken: string, refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    // Подтверждение email делаем локально:
    // accessToken должен быть нашим JWT; после валидации выставляем email_verified
    const payload = jwt.verify(accessToken, getJwtSecret());
    if (typeof payload !== 'object' || payload === null) {
      throw new Error('Invalid confirmation link');
    }
    if ((payload as unknown as { purpose?: string }).purpose !== 'email_confirm') {
      throw new Error('Invalid confirmation link');
    }
    const userId = payload.sub;
    if (!userId || typeof userId !== 'string') {
      throw new Error('Invalid confirmation link');
    }

    const userResult = await this.db.query<Pick<DbUser, 'role'>>(
      `update users set email_verified = 'VERIFIED'::email_status, updated_at = now() where id = $1 returning role`,
      [userId]
    );

    const userRole = userResult.rows[0]?.role ?? USER_ROLE.USER;

    // После подтверждения выдаём обычный auth_token (7 дней), а не токен подтверждения
    const authToken = jwt.sign({ role: userRole }, getJwtSecret(), {
      subject: userId,
      expiresIn: AUTH_TOKEN_TTL_SECONDS
    });

    return { accessToken: authToken, refreshToken };
  }

  async signOut(): Promise<SignOutResponse> {
    return { message: 'Signed out successfully' };
  }

  async requestPasswordReset(email: string): Promise<ResetPasswordResponse> {
    const normalizedEmail = email.trim().toLowerCase();
    const user = await this.db.query<Pick<DbUser, 'id'>>('select id from users where email = $1', [
      normalizedEmail
    ]);

    // Не раскрываем существование email
    if (user.rowCount === 0) {
      return { message: 'Password reset requested' };
    }

    const token = crypto.randomBytes(32).toString('base64url');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 час

    await this.db.query(
      `
        insert into password_reset_tokens (id, user_id, token_hash, expires_at, used_at, created_at)
        values ($1, $2, $3, $4, null, now())
      `,
      [crypto.randomUUID(), user.rows[0].id, tokenHash, expiresAt]
    );

    try {
      await sendPasswordResetEmail(normalizedEmail, token);
    } catch (error) {
      // Не логируем email/токен; только факт ошибки
      if (error instanceof Error) {
        console.error('Password reset email send failed:', error.message);
      } else {
        console.error('Password reset email send failed');
      }
    }

    // Всегда возвращаем нейтральный ответ (без токена)
    return { message: 'Password reset requested' };
  }

  async updatePasswordWithResetToken(
    resetToken: string,
    password: string,
    confirmPassword: string
  ): Promise<{ message: string; userId: string }> {
    if (password !== confirmPassword) {
      throw new Error('Passwords do not match');
    }

    const tokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');

    const tokenRow = await this.db.query<{ id: string; user_id: string }>(
      `
        select id, user_id
        from password_reset_tokens
        where token_hash = $1
          and used_at is null
          and expires_at > now()
      `,
      [tokenHash]
    );

    if (tokenRow.rowCount === 0) {
      throw new Error('Invalid or expired token');
    }

    const newHash = await bcrypt.hash(password, 10);
    const userId = tokenRow.rows[0].user_id;

    await this.db.query('update users set password_hash = $1, updated_at = now() where id = $2', [
      newHash,
      userId
    ]);
    await this.db.query('update password_reset_tokens set used_at = now() where id = $1', [
      tokenRow.rows[0].id
    ]);

    return { message: 'Password updated successfully', userId };
  }

  /**
   * Получить пользователя по ID (только для ADMIN)
   */
  async getUserById(userId: string): Promise<{
    id: string;
    email: string;
    name: string | null;
    phone: string | null;
    role: USER_ROLE;
    email_verified: EMAIL_STATUS;
    is_blocked: boolean;
    created_at: string;
  } | null> {
    const result = await this.db.query<DbUser>(
      `SELECT id, email, name, phone, role, email_verified, is_blocked, created_at
       FROM users
       WHERE id = $1`,
      [userId]
    );

    if (result.rowCount === 0) {
      return null;
    }

    const user = result.rows[0];
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      phone: user.phone,
      role: user.role,
      email_verified: user.email_verified ?? EMAIL_STATUS.NOT_VERIFIED,
      is_blocked: user.is_blocked ?? false,
      created_at: user.created_at
    };
  }

  /**
   * Получить всех пользователей (только для ADMIN)
   */
  async getAllUsers(): Promise<Array<{
    id: string;
    email: string;
    name: string | null;
    phone: string | null;
    role: USER_ROLE;
    email_verified: EMAIL_STATUS;
    is_blocked: boolean;
    created_at: string;
  }>> {
    const result = await this.db.query<DbUser>(
      `SELECT id, email, name, phone, role, email_verified, is_blocked, created_at
       FROM users
       ORDER BY created_at DESC`
    );

    return result.rows.map(user => ({
      id: user.id,
      email: user.email,
      name: user.name,
      phone: user.phone,
      role: user.role,
      email_verified: user.email_verified ?? EMAIL_STATUS.NOT_VERIFIED,
      is_blocked: user.is_blocked ?? false,
      created_at: user.created_at
    }));
  }

  /**
   * Заблокировать/разблокировать пользователя (только для ADMIN)
   */
  async setUserBlocked(userId: string, isBlocked: boolean): Promise<{
    id: string;
    email: string;
    is_blocked: boolean;
  }> {
    const result = await this.db.query<Pick<DbUser, 'id' | 'email' | 'is_blocked'>>(
      `UPDATE users
       SET is_blocked = $1, updated_at = now()
       WHERE id = $2
       RETURNING id, email, is_blocked`,
      [isBlocked, userId]
    );

    if (result.rowCount === 0) {
      throw new Error('User not found');
    }

    return result.rows[0];
  }
}
