import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import type { Pool } from 'pg';
import { AUTH_TOKEN_TTL_SECONDS, getJwtSecret } from '../../config/auth';
import { EMAIL_STATUS, USER_ROLE } from '../model/auth.model';
import {
  type DbRegistrationLink,
  type RegistrationLinkDetails,
  REGISTRATION_LINK_TTL_DAYS
} from '../model/registration-link.model';

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function getLinkStatus(link: DbRegistrationLink): 'ACTIVE' | 'USED' | 'EXPIRED' {
  if (link.used_at) return 'USED';
  if (new Date(link.expires_at) < new Date()) return 'EXPIRED';
  return 'ACTIVE';
}

export class RegistrationLinkAPI {
  constructor(private db: Pool) {}

  /**
   * Создать одноразовую ссылку регистрации (ADMIN only)
   */
  async createLink(createdBy: string): Promise<{ id: string; token: string; link: string; expiresAt: string }> {
    const token = crypto.randomBytes(32).toString('base64url');
    const tokenHash = hashToken(token);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + REGISTRATION_LINK_TTL_DAYS);

    const result = await this.db.query<DbRegistrationLink>(
      `INSERT INTO registration_links (token_hash, created_by, expires_at)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [tokenHash, createdBy, expiresAt.toISOString()]
    );

    const baseUrl = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/+$/, '');
    const link = `${baseUrl}/auth/register-campaign?token=${encodeURIComponent(token)}`;

    return {
      id: result.rows[0].id,
      token,
      link,
      expiresAt: expiresAt.toISOString()
    };
  }

  /**
   * Валидация токена (публичный)
   */
  async validateToken(token: string): Promise<{ valid: boolean; expired?: boolean }> {
    const tokenHash = hashToken(token);

    const result = await this.db.query<DbRegistrationLink>(
      'SELECT * FROM registration_links WHERE token_hash = $1',
      [tokenHash]
    );

    if (result.rowCount === 0) {
      return { valid: false };
    }

    const link = result.rows[0];

    if (link.used_at) {
      return { valid: false };
    }

    if (new Date(link.expires_at) < new Date()) {
      return { valid: false, expired: true };
    }

    return { valid: true };
  }

  /**
   * Принять ссылку — зарегистрировать владельца площадки
   */
  async acceptLink(
    token: string,
    name: string,
    email: string,
    phone: string,
    password: string,
    consentPersonalData?: boolean,
    ipAddress?: string,
    userAgent?: string
  ): Promise<{ id: string; accessToken: string; role: USER_ROLE; campaignId: string }> {
    const tokenHash = hashToken(token);
    const normalizedEmail = email.trim().toLowerCase();
    const client = await this.db.connect();

    try {
      await client.query('BEGIN');

      // 1. Найти и заблокировать ссылку
      const linkResult = await client.query<DbRegistrationLink>(
        'SELECT * FROM registration_links WHERE token_hash = $1 FOR UPDATE',
        [tokenHash]
      );

      if (linkResult.rowCount === 0) {
        throw new Error('Invalid registration link');
      }

      const link = linkResult.rows[0];

      if (link.used_at) {
        throw new Error('Registration link has already been used');
      }

      if (new Date(link.expires_at) < new Date()) {
        throw new Error('Registration link has expired');
      }

      // 2. Проверить что email не занят
      const existingUser = await client.query(
        'SELECT id FROM users WHERE email = $1',
        [normalizedEmail]
      );
      if ((existingUser.rowCount ?? 0) > 0) {
        throw new Error('User with this email already exists');
      }

      // 3. Создать campaign_info (draft)
      const campaignId = crypto.randomUUID();
      const now = new Date().toISOString();

      await client.query(
        `INSERT INTO campaign_info (id, name, status, timezone_id, created_at, updated_at)
         VALUES ($1, $2, 'draft', 'Europe/Moscow', $3, $4)`,
        [campaignId, `${name}`, now, now]
      );

      // 4. Создать пользователя
      const userId = crypto.randomUUID();
      const passwordHash = await bcrypt.hash(password, 10);

      await client.query(
        `INSERT INTO users (id, email, password_hash, role, name, phone, email_verified, campaign_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          userId,
          normalizedEmail,
          passwordHash,
          USER_ROLE.CAMPAIGN,
          name,
          phone || null,
          EMAIL_STATUS.VERIFIED,
          campaignId,
          now,
          now
        ]
      );

      // 5. Привязать campaign к владельцу
      await client.query(
        'UPDATE campaign_info SET user_id = $1 WHERE id = $2',
        [userId, campaignId]
      );

      // 6. Согласие на обработку ПД
      if (consentPersonalData) {
        await client.query(
          `INSERT INTO user_consents (user_id, consent_type, accepted, ip_address, user_agent)
           VALUES ($1, 'PERSONAL_DATA', true, $2, $3)`,
          [userId, ipAddress ?? null, userAgent ?? null]
        );
      }

      // 7. Пометить ссылку как использованную
      await client.query(
        'UPDATE registration_links SET used_by = $1, used_at = NOW() WHERE id = $2',
        [userId, link.id]
      );

      // 8. JWT
      const accessToken = jwt.sign({ role: USER_ROLE.CAMPAIGN }, getJwtSecret(), {
        subject: userId,
        expiresIn: AUTH_TOKEN_TTL_SECONDS
      });

      await client.query('COMMIT');

      return { id: userId, accessToken, role: USER_ROLE.CAMPAIGN, campaignId };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Список всех ссылок (ADMIN)
   */
  async getLinks(): Promise<RegistrationLinkDetails[]> {
    const result = await this.db.query<DbRegistrationLink & { created_by_name: string | null; used_by_email: string | null }>(
      `SELECT rl.*,
              creator.name as created_by_name,
              used_user.email as used_by_email
       FROM registration_links rl
       LEFT JOIN users creator ON creator.id = rl.created_by
       LEFT JOIN users used_user ON used_user.id = rl.used_by
       ORDER BY rl.created_at DESC`
    );

    return result.rows.map(row => ({
      id: row.id,
      link: null, // Не возвращаем токен в списке
      created_by_name: row.created_by_name,
      used_by_email: row.used_by_email,
      status: getLinkStatus(row),
      expires_at: row.expires_at,
      created_at: row.created_at
    }));
  }
}
