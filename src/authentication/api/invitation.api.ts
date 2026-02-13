import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import type { Pool, PoolClient } from 'pg';
import { AUTH_TOKEN_TTL_SECONDS, getJwtSecret } from '../../config/auth';
import { EMAIL_STATUS, USER_ROLE } from '../model/auth.model';
import {
  type DbInvitation,
  type InvitationDetails,
  type TeamMember,
  type ValidateTokenResponse,
  INVITATION_TTL_DAYS
} from '../model/invitation.model';
import { sendInvitationEmail } from '../../utils/invitationEmail';

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function getInvitationStatus(inv: DbInvitation): 'PENDING' | 'USED' | 'EXPIRED' {
  if (inv.used_at) return 'USED';
  if (new Date(inv.expires_at) < new Date()) return 'EXPIRED';
  return 'PENDING';
}

export class InvitationAPI {
  constructor(private db: Pool) {}

  /**
   * Создать приглашение и отправить email
   */
  async createInvitation(
    email: string,
    role: USER_ROLE,
    campaignId: string | null,
    invitedBy: string
  ): Promise<InvitationDetails> {
    const normalizedEmail = email.trim().toLowerCase();

    // 1. Проверить что email не зарегистрирован
    const existingUser = await this.db.query(
      'SELECT id FROM users WHERE email = $1',
      [normalizedEmail]
    );
    if ((existingUser.rowCount ?? 0) > 0) {
      throw new Error('User with this email already exists');
    }

    // 2. Проверить что нет активного pending инвайта
    const existingInvite = await this.db.query<DbInvitation>(
      `SELECT id FROM invitations
       WHERE email = $1 AND used_at IS NULL AND expires_at > NOW()
       ${role === USER_ROLE.CAMPAIGN ? 'AND campaign_id = $2' : 'AND role = $2'}`,
      [normalizedEmail, role === USER_ROLE.CAMPAIGN ? campaignId : 'ADMIN']
    );
    if ((existingInvite.rowCount ?? 0) > 0) {
      throw new Error('Active invitation for this email already exists');
    }

    // 3. Генерация токена
    const token = crypto.randomBytes(32).toString('base64url');
    const tokenHash = hashToken(token);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + INVITATION_TTL_DAYS);

    // 4. Сохранить в БД
    const result = await this.db.query<DbInvitation>(
      `INSERT INTO invitations (email, role, campaign_id, invited_by, token_hash, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [normalizedEmail, role, campaignId, invitedBy, tokenHash, expiresAt.toISOString()]
    );
    const invitation = result.rows[0];

    // 5. Получить имена для email
    const inviterResult = await this.db.query<{ name: string | null }>(
      'SELECT name FROM users WHERE id = $1',
      [invitedBy]
    );
    const inviterName = inviterResult.rows[0]?.name || null;

    let campaignName: string | null = null;
    if (campaignId) {
      const campaignResult = await this.db.query<{ name: string | null }>(
        'SELECT name FROM campaign_info WHERE id = $1',
        [campaignId]
      );
      campaignName = campaignResult.rows[0]?.name || null;
    }

    // 6. Отправить email
    const baseUrl = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/+$/, '');
    const inviteLink = `${baseUrl}/auth/invite?token=${encodeURIComponent(token)}`;

    try {
      await sendInvitationEmail({
        email: normalizedEmail,
        token,
        campaignName: campaignName ?? undefined,
        inviterName: inviterName ?? undefined,
        role: role as 'CAMPAIGN' | 'ADMIN'
      });
    } catch (err) {
      console.error('Failed to send invitation email:', err);
      // Не ломаем flow если email не отправился — ссылка возвращается в ответе
    }

    return {
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      campaign_id: invitation.campaign_id,
      campaign_name: campaignName,
      invited_by_name: inviterName,
      invite_link: inviteLink,
      status: 'PENDING',
      expires_at: invitation.expires_at,
      created_at: invitation.created_at
    };
  }

  /**
   * Валидация токена (публичный endpoint)
   */
  async validateToken(token: string): Promise<ValidateTokenResponse> {
    const tokenHash = hashToken(token);

    const result = await this.db.query<DbInvitation & { campaign_name: string | null; inviter_name: string | null }>(
      `SELECT i.*, ci.name as campaign_name, u.name as inviter_name
       FROM invitations i
       LEFT JOIN campaign_info ci ON ci.id = i.campaign_id
       LEFT JOIN users u ON u.id = i.invited_by
       WHERE i.token_hash = $1`,
      [tokenHash]
    );

    if (result.rowCount === 0) {
      return { valid: false };
    }

    const inv = result.rows[0];

    if (inv.used_at) {
      return { valid: false };
    }

    if (new Date(inv.expires_at) < new Date()) {
      return { valid: false, expired: true, email: inv.email };
    }

    return {
      valid: true,
      email: inv.email,
      role: inv.role,
      campaign_name: inv.campaign_name ?? undefined,
      inviter_name: inv.inviter_name ?? undefined
    };
  }

  /**
   * Принять приглашение — создать пользователя
   */
  async acceptInvitation(
    token: string,
    password: string,
    name?: string,
    phone?: string,
    consentPersonalData?: boolean,
    ipAddress?: string,
    userAgent?: string
  ): Promise<{ id: string; accessToken: string; role: USER_ROLE }> {
    const tokenHash = hashToken(token);
    const client = await this.db.connect();

    try {
      await client.query('BEGIN');

      // 1. Найти и заблокировать инвайт
      const invResult = await client.query<DbInvitation>(
        `SELECT * FROM invitations WHERE token_hash = $1 FOR UPDATE`,
        [tokenHash]
      );

      if (invResult.rowCount === 0) {
        throw new Error('Invalid invitation token');
      }

      const inv = invResult.rows[0];

      if (inv.used_at) {
        throw new Error('Invitation has already been used');
      }

      if (new Date(inv.expires_at) < new Date()) {
        throw new Error('Invitation has expired');
      }

      // 2. Проверить что email всё ещё не занят
      const existingUser = await client.query(
        'SELECT id FROM users WHERE email = $1',
        [inv.email]
      );
      if ((existingUser.rowCount ?? 0) > 0) {
        throw new Error('User with this email already exists');
      }

      // 3. Создать пользователя
      const userId = crypto.randomUUID();
      const passwordHash = await bcrypt.hash(password, 12);
      const now = new Date().toISOString();

      await client.query(
        `INSERT INTO users (id, email, password_hash, role, name, phone, email_verified, campaign_id, invited_by, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          userId,
          inv.email,
          passwordHash,
          inv.role,
          name ?? null,
          phone ?? null,
          EMAIL_STATUS.VERIFIED, // Email верифицирован через invite flow
          inv.campaign_id, // NULL для ADMIN, campaign_id для менеджера
          inv.invited_by,
          now,
          now
        ]
      );

      // 4. Согласие на обработку ПД
      if (consentPersonalData) {
        await client.query(
          `INSERT INTO user_consents (user_id, consent_type, accepted, ip_address, user_agent)
           VALUES ($1, 'PERSONAL_DATA', true, $2, $3)`,
          [userId, ipAddress ?? null, userAgent ?? null]
        );
      }

      // 5. Пометить инвайт как использованный
      await client.query(
        'UPDATE invitations SET used_at = NOW() WHERE id = $1',
        [inv.id]
      );

      // 6. JWT
      const accessToken = jwt.sign({ role: inv.role }, getJwtSecret(), {
        subject: userId,
        expiresIn: AUTH_TOKEN_TTL_SECONDS
      });

      await client.query('COMMIT');

      return { id: userId, accessToken, role: inv.role };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Повторная отправка приглашения (новый токен)
   */
  async resendInvitation(invitationId: string, requesterId: string): Promise<InvitationDetails> {
    // Находим оригинальный инвайт
    const invResult = await this.db.query<DbInvitation>(
      'SELECT * FROM invitations WHERE id = $1',
      [invitationId]
    );

    if (invResult.rowCount === 0) {
      throw new Error('Invitation not found');
    }

    const inv = invResult.rows[0];

    // Проверяем что запрашивающий — тот кто пригласил
    if (inv.invited_by !== requesterId) {
      throw new Error('Forbidden');
    }

    // Проверяем что инвайт не использован
    if (inv.used_at) {
      throw new Error('Invitation has already been used');
    }

    // Новый токен + обновляем expires
    const token = crypto.randomBytes(32).toString('base64url');
    const tokenHash = hashToken(token);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + INVITATION_TTL_DAYS);

    await this.db.query(
      'UPDATE invitations SET token_hash = $1, expires_at = $2 WHERE id = $3',
      [tokenHash, expiresAt.toISOString(), invitationId]
    );

    // Получить имена
    const inviterResult = await this.db.query<{ name: string | null }>(
      'SELECT name FROM users WHERE id = $1',
      [requesterId]
    );
    const inviterName = inviterResult.rows[0]?.name || null;

    let campaignName: string | null = null;
    if (inv.campaign_id) {
      const campaignResult = await this.db.query<{ name: string | null }>(
        'SELECT name FROM campaign_info WHERE id = $1',
        [inv.campaign_id]
      );
      campaignName = campaignResult.rows[0]?.name || null;
    }

    // Отправить email
    const baseUrl = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/+$/, '');
    const inviteLink = `${baseUrl}/auth/invite?token=${encodeURIComponent(token)}`;

    try {
      await sendInvitationEmail({
        email: inv.email,
        token,
        campaignName: campaignName ?? undefined,
        inviterName: inviterName ?? undefined,
        role: inv.role as 'CAMPAIGN' | 'ADMIN'
      });
    } catch (err) {
      console.error('Failed to resend invitation email:', err);
    }

    return {
      id: inv.id,
      email: inv.email,
      role: inv.role,
      campaign_id: inv.campaign_id,
      campaign_name: campaignName,
      invited_by_name: inviterName,
      invite_link: inviteLink,
      status: 'PENDING',
      expires_at: expiresAt.toISOString(),
      created_at: inv.created_at
    };
  }

  /**
   * Список команды площадки
   */
  async getCampaignTeam(campaignId: string): Promise<TeamMember[]> {
    const result = await this.db.query<TeamMember & { invited_by: string | null; last_login_at: string | null }>(
      `SELECT id, email, name, phone, invited_by, created_at, last_login_at
       FROM users
       WHERE campaign_id = $1 AND role = 'CAMPAIGN'
       ORDER BY invited_by NULLS FIRST, created_at ASC`,
      [campaignId]
    );

    return result.rows.map(row => ({
      id: row.id,
      email: row.email,
      name: row.name,
      phone: row.phone,
      is_owner: row.invited_by === null,
      created_at: row.created_at,
      last_login_at: row.last_login_at,
    }));
  }

  /**
   * Активные инвайты площадки
   */
  async getCampaignInvitations(campaignId: string): Promise<InvitationDetails[]> {
    const result = await this.db.query<DbInvitation & { inviter_name: string | null; campaign_name: string | null }>(
      `SELECT i.*, u.name as inviter_name, ci.name as campaign_name
       FROM invitations i
       LEFT JOIN users u ON u.id = i.invited_by
       LEFT JOIN campaign_info ci ON ci.id = i.campaign_id
       WHERE i.campaign_id = $1 AND i.used_at IS NULL
       ORDER BY i.created_at DESC`,
      [campaignId]
    );

    return result.rows.map(row => ({
      id: row.id,
      email: row.email,
      role: row.role,
      campaign_id: row.campaign_id,
      campaign_name: row.campaign_name,
      invited_by_name: row.inviter_name,
      invite_link: null, // Не возвращаем ссылку в списке (токен уже не доступен)
      status: getInvitationStatus(row),
      expires_at: row.expires_at,
      created_at: row.created_at
    }));
  }

  /**
   * Удалить менеджера из команды
   */
  async removeCampaignMember(userId: string, campaignId: string, requesterId: string): Promise<void> {
    // Нельзя удалить самого себя
    if (userId === requesterId) {
      throw new Error('Cannot remove yourself');
    }

    const result = await this.db.query<{ invited_by: string | null }>(
      `SELECT invited_by FROM users WHERE id = $1 AND campaign_id = $2 AND role = 'CAMPAIGN'`,
      [userId, campaignId]
    );

    if (result.rowCount === 0) {
      throw new Error('User not found in campaign team');
    }

    // Нельзя удалить владельца
    if (result.rows[0].invited_by === null) {
      throw new Error('Cannot remove campaign owner');
    }

    // Удаляем привязку к площадке и роль → делаем USER
    await this.db.query(
      `UPDATE users SET campaign_id = NULL, role = 'USER', invited_by = NULL, updated_at = NOW() WHERE id = $1`,
      [userId]
    );
  }

  /**
   * Список всех ADMIN-ов
   */
  async getAdminTeam(): Promise<TeamMember[]> {
    const result = await this.db.query<TeamMember & { invited_by: string | null; last_login_at: string | null }>(
      `SELECT id, email, name, phone, invited_by, created_at, last_login_at
       FROM users
       WHERE role = 'ADMIN'
       ORDER BY invited_by NULLS FIRST, created_at ASC`
    );

    return result.rows.map(row => ({
      id: row.id,
      email: row.email,
      name: row.name,
      phone: row.phone,
      is_owner: row.invited_by === null,
      created_at: row.created_at,
      last_login_at: row.last_login_at,
    }));
  }

  /**
   * Активные инвайты ADMIN
   */
  async getAdminInvitations(): Promise<InvitationDetails[]> {
    const result = await this.db.query<DbInvitation & { inviter_name: string | null }>(
      `SELECT i.*, u.name as inviter_name
       FROM invitations i
       LEFT JOIN users u ON u.id = i.invited_by
       WHERE i.role = 'ADMIN' AND i.used_at IS NULL
       ORDER BY i.created_at DESC`
    );

    return result.rows.map(row => ({
      id: row.id,
      email: row.email,
      role: row.role,
      campaign_id: null,
      campaign_name: null,
      invited_by_name: row.inviter_name,
      invite_link: null,
      status: getInvitationStatus(row),
      expires_at: row.expires_at,
      created_at: row.created_at
    }));
  }
}
