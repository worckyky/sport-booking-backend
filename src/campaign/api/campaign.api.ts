import crypto from 'crypto';
import type { Pool } from 'pg';
import {
  Campaign,
  CampaignResponse,
  CampaignStatus,
  CreateCampaignRequest,
  UpdateCampaignRequest,
  type AdminCampaignResponse,
  type ReadinessItem,
  type ReadinessResponse
} from '../model/campaign.model';
import { normalizeEnumArray, normalizeJsonArray, toJsonbValue } from '../../utils/pg';
import { withTransaction } from '../../utils/db-transaction';
import { S3API } from '../../s3/api/s3.api';
import {
  normalizeMediaShape,
  getMediaUrls,
  extractBucketKeyFromUrl,
  extractManagedMediaByBucket,
  applyPendingOverlay,
} from './campaign.helpers';

export class CampaignAPI {
  private readonly s3API = new S3API();

  constructor(private db: Pool) {}

  private async deleteManagedMediaDiff(
    beforeMedia: Campaign['media'],
    afterMedia: Campaign['media'],
    keepMedia?: Campaign['media']
  ): Promise<void> {
    const beforeByBucket = extractManagedMediaByBucket(beforeMedia);
    const afterByBucket = extractManagedMediaByBucket(afterMedia);
    const keepByBucket = keepMedia ? extractManagedMediaByBucket(keepMedia) : new Map<string, Set<string>>();

    for (const [bucket, beforeKeysSet] of beforeByBucket.entries()) {
      const afterKeysSet = afterByBucket.get(bucket) || new Set<string>();
      const keepKeysSet = keepByBucket.get(bucket) || new Set<string>();
      const keysToDelete = [...beforeKeysSet].filter((key) => !afterKeysSet.has(key) && !keepKeysSet.has(key));

      if (keysToDelete.length === 0) continue;

      try {
        await this.s3API.deleteObjects({
          bucket,
          keys: keysToDelete,
        });
      } catch (error) {
        console.error(`Failed to cleanup old media objects in bucket ${bucket}:`, error);
      }
    }
  }

  private async getSportsByCampaignId(campaignId: string): Promise<string[]> {
    const { rows } = await this.db.query<{ sport: string }>(
      `
        SELECT DISTINCT unnest(f.sport_types) as sport
        FROM fields f
        WHERE f.campaign_id = $1 AND f.status = 'active'
        ORDER BY sport
      `,
      [campaignId]
    );
    return rows.map((r) => r.sport);
  }

  private async getSportsByCampaignIds(campaignIds: string[]): Promise<Map<string, string[]>> {
    if (campaignIds.length === 0) return new Map();

    const { rows } = await this.db.query<{ campaign_id: string; sports: string[] }>(
      `
        SELECT f.campaign_id, array_agg(DISTINCT s.sport ORDER BY s.sport) as sports
        FROM fields f, unnest(f.sport_types) as s(sport)
        WHERE f.campaign_id = ANY($1) AND f.status = 'active'
        GROUP BY f.campaign_id
      `,
      [campaignIds]
    );

    const map = new Map<string, string[]>();
    for (const row of rows) {
      map.set(row.campaign_id, row.sports);
    }
    return map;
  }

  async getCampaignById(campaignId: string): Promise<CampaignResponse> {
    const { rows } = await this.db.query<Campaign>(
      'select * from campaign_info where id = $1 limit 1',
      [campaignId]
    );
    const data = rows[0];
    if (!data) {
      throw new Error('Campaign not found');
    }

    const sports = await this.getSportsByCampaignId(campaignId);
    return this.mapCampaignToResponse(data, sports);
  }

  async getCampaignByIdForOwner(campaignId: string, userId: string): Promise<CampaignResponse> {
    const { rows } = await this.db.query<Campaign>(
      'select * from campaign_info where id = $1 and user_id = $2 limit 1',
      [campaignId, userId]
    );
    const data = rows[0];
    if (!data) {
      throw new Error('Campaign not found');
    }

    const sports = await this.getSportsByCampaignId(campaignId);
    const effectiveCampaign = applyPendingOverlay(data);
    return this.mapCampaignToResponse(effectiveCampaign, sports);
  }

  async getPublicCampaignById(campaignId: string): Promise<CampaignResponse> {
    const { rows } = await this.db.query<Campaign>(
      "SELECT * FROM campaign_info WHERE id = $1 AND status = 'published' LIMIT 1",
      [campaignId]
    );
    const data = rows[0];
    if (!data) {
      throw new Error('Campaign not found');
    }

    const sports = await this.getSportsByCampaignId(campaignId);
    return this.mapCampaignToResponse(data, sports);
  }

  async getAllCampaigns(): Promise<CampaignResponse[]> {
    // Публичный каталог — только published площадки, макс 1000 записей
    const { rows } = await this.db.query<Campaign>(
      `SELECT * FROM campaign_info
       WHERE status = 'published'
       ORDER BY created_at DESC
       LIMIT 1000`
    );
    const sportsMap = await this.getSportsByCampaignIds(rows.map(c => c.id));
    return rows.map(campaign =>
      this.mapCampaignToResponse(campaign, sportsMap.get(campaign.id) || [])
    );
  }

  /**
   * Получить все кампании с cross-data для суперадмина
   */
  async getAllCampaignsAdmin(): Promise<AdminCampaignResponse[]> {
    const { rows } = await this.db.query<Campaign & {
      owner_name: string | null;
      owner_email: string | null;
      owner_id: string | null;
      fields_count: string;
      bookings_count: string;
    }>(
      `SELECT ci.*,
         u.name as owner_name,
         u.email as owner_email,
         u.id as owner_id,
         COALESCE(fc.cnt, 0)::text as fields_count,
         COALESCE(bc.cnt, 0)::text as bookings_count
       FROM campaign_info ci
       LEFT JOIN users u ON u.campaign_id = ci.id AND u.invited_by IS NULL
       LEFT JOIN LATERAL (
         SELECT COUNT(*) as cnt FROM fields f WHERE f.campaign_id = ci.id AND f.deleted_at IS NULL
       ) fc ON true
       LEFT JOIN LATERAL (
         SELECT COUNT(*) as cnt
         FROM bookings b
         JOIN booking_slots s ON b.slot_id = s.id
         JOIN fields f ON s.field_id = f.id
         WHERE f.campaign_id = ci.id
       ) bc ON true
       ORDER BY ci.created_at DESC`
    );

    const sportsMap = await this.getSportsByCampaignIds(rows.map(r => r.id));
    return rows.map(row => {
      const base = this.mapCampaignToResponse(row, sportsMap.get(row.id) || []);
      return {
        ...base,
        ownerName: row.owner_name ?? null,
        ownerEmail: row.owner_email ?? null,
        ownerId: row.owner_id ?? null,
        fieldsCount: parseInt(row.fields_count, 10) || 0,
        bookingsCount: parseInt(row.bookings_count, 10) || 0,
      };
    });
  }

  async createCampaign(
    userId: string,
    campaignData: CreateCampaignRequest
  ): Promise<CampaignResponse> {
    const requestData = campaignData as unknown as Record<string, unknown>;

    const now = new Date().toISOString();
    const id = crypto.randomUUID();

    const insert = await this.db.query<Campaign>(
      `
        insert into campaign_info (
          id,
          user_id,
          name,
          description,
          short_description,
          location,
          contacts,
          working_timetable,
          socials_links,
          payment_methods,
          facilities,
          media,
          timezone_id,
          created_at,
          updated_at
        )
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
        returning *
      `,
      [
        id,
        userId,
        campaignData.name,
        campaignData.description,
        campaignData.shortDescription || requestData.short_description || null,
        toJsonbValue(campaignData.location),
        toJsonbValue(campaignData.contacts),
        toJsonbValue(campaignData.workingTimetable || requestData.working_timetable || null),
        toJsonbValue(campaignData.socialsLinks || requestData.socials_links || null),
        campaignData.paymentMethods || requestData.payment_methods || null,
        campaignData.facilities ?? null,
        toJsonbValue(campaignData.media ?? null),
        campaignData.timezoneId || requestData.timezone_id || 'Europe/Moscow',
        now,
        now
      ]
    );

    const created = insert.rows[0];
    if (!created) throw new Error('Failed to create campaign');

    // No fields yet, sports will be empty
    return this.mapCampaignToResponse(created, []);
  }

  // ─── Audit Log ───

  private async logStatusChange(
    campaignId: string,
    oldStatus: string | null,
    newStatus: string,
    changedBy: string,
    reason?: string,
    client?: any
  ): Promise<void> {
    const db = client || this.db;
    await db.query(
      `INSERT INTO campaign_status_log (campaign_id, old_status, new_status, changed_by, reason)
       VALUES ($1, $2, $3, $4, $5)`,
      [campaignId, oldStatus, newStatus, changedBy, reason ?? null]
    );
  }

  // ─── Validation for published campaigns ───

  private validateRequiredFields(data: UpdateCampaignRequest, status: CampaignStatus): void {
    if (status !== CampaignStatus.PUBLISHED) return;

    if (data.name !== undefined && !data.name?.trim()) {
      const err: any = new Error('Название обязательно для опубликованной площадки');
      err.statusCode = 400;
      throw err;
    }
    if (data.description !== undefined && !data.description?.trim()) {
      const err: any = new Error('Описание обязательно для опубликованной площадки');
      err.statusCode = 400;
      throw err;
    }
    if (data.location !== undefined && (!(data.location as any)?.city || !(data.location as any)?.street)) {
      const err: any = new Error('Адрес обязателен для опубликованной площадки');
      err.statusCode = 400;
      throw err;
    }
    if (data.contacts !== undefined && !(data.contacts as any)?.phone) {
      const err: any = new Error('Телефон обязателен для опубликованной площадки');
      err.statusCode = 400;
      throw err;
    }
    if (data.paymentMethods !== undefined && (!data.paymentMethods || data.paymentMethods.length === 0)) {
      const err: any = new Error('Способы оплаты обязательны для опубликованной площадки');
      err.statusCode = 400;
      throw err;
    }
    if (data.media !== undefined && !(data.media as any)?.main_src) {
      const err: any = new Error('Главное фото обязательно для опубликованной площадки');
      err.statusCode = 400;
      throw err;
    }
  }

  // ─── Critical fields separation ───

  private static readonly CRITICAL_FIELDS = ['name', 'location', 'media'] as const;

  /** Normalize empty strings / undefined to null for stable JSON comparison */
  private static normalizeForCompare(val: unknown): string {
    return JSON.stringify(val, (_key, value) => {
      if (value === '' || value === undefined) return null;
      return value;
    });
  }

  private extractCriticalChanges(
    data: UpdateCampaignRequest,
    currentCampaign: Campaign
  ): {
    critical: Record<string, unknown>;
    nonCritical: UpdateCampaignRequest;
  } {
    const critical: Record<string, unknown> = {};
    const nonCritical = { ...data };

    for (const field of CampaignAPI.CRITICAL_FIELDS) {
      const newVal = (data as any)[field];
      if (newVal === undefined) continue;

      // Compare with current DB value — skip if unchanged
      // Normalize null / "" / undefined to avoid false diffs (e.g. coordinates: null vs "")
      const curVal = (currentCampaign as any)[field];
      if (CampaignAPI.normalizeForCompare(newVal) === CampaignAPI.normalizeForCompare(curVal)) {
        // Value unchanged — remove from nonCritical (don't re-write same value)
        delete (nonCritical as any)[field];
        continue;
      }

      critical[field] = newVal;
      delete (nonCritical as any)[field];
    }

    return { critical, nonCritical };
  }

  // ─── Update Campaign ───

  async updateCampaign(
    campaignId: string,
    userId: string,
    campaignData: UpdateCampaignRequest
  ): Promise<CampaignResponse> {
    // Get current campaign data (need name, location, media for critical field comparison)
    const currentResult = await this.db.query<Campaign>(
      'SELECT status, pending_changes, name, location, media FROM campaign_info WHERE id = $1 AND user_id = $2',
      [campaignId, userId]
    );
    if (currentResult.rowCount === 0) throw new Error('Campaign not found or not updated');
    const currentCampaign = currentResult.rows[0];
    const currentStatus = currentCampaign.status;

    // Validate required fields can't be cleared for published campaigns
    this.validateRequiredFields(campaignData, currentStatus);

    // For published: separate critical fields → pending_changes
    let dataToApply = campaignData;
    let pendingChanges: Record<string, unknown> | null = null;

    let replacedPendingMediaBefore: Campaign['media'] | null = null;
    let replacedPendingMediaAfter: Campaign['media'] | null = null;
    const currentActiveMedia = normalizeMediaShape(currentCampaign.media);

    if (currentStatus === CampaignStatus.PUBLISHED) {
      const { critical, nonCritical } = this.extractCriticalChanges(campaignData, currentCampaign);
      if (Object.keys(critical).length > 0) {
        // Merge with existing pending_changes
        const existingPending = currentCampaign.pending_changes ?? {};
        pendingChanges = { ...existingPending, ...critical };

        const existingPendingObj = existingPending as Record<string, unknown>;
        replacedPendingMediaBefore = normalizeMediaShape(existingPendingObj.media);
        replacedPendingMediaAfter = normalizeMediaShape((pendingChanges as Record<string, unknown>).media);
      }
      dataToApply = nonCritical;
    }

    const requestData = dataToApply as unknown as Record<string, unknown>;

    const setParts: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    const add = (col: string, val: unknown): void => {
      setParts.push(`${col} = $${i}`);
      values.push(val);
      i += 1;
    };

    if (dataToApply.name !== undefined) add('name', dataToApply.name);
    if (dataToApply.description !== undefined) add('description', dataToApply.description);

    if (dataToApply.shortDescription !== undefined) {
      add('short_description', dataToApply.shortDescription);
    } else if (requestData.short_description !== undefined) {
      add('short_description', requestData.short_description);
    }

    if (dataToApply.location !== undefined) add('location', toJsonbValue(dataToApply.location));
    if (dataToApply.contacts !== undefined) add('contacts', toJsonbValue(dataToApply.contacts));

    if (dataToApply.workingTimetable !== undefined) {
      add('working_timetable', toJsonbValue(dataToApply.workingTimetable));
    } else if (requestData.working_timetable !== undefined) {
      add('working_timetable', toJsonbValue(requestData.working_timetable));
    }

    if (dataToApply.socialsLinks !== undefined) {
      add('socials_links', toJsonbValue(dataToApply.socialsLinks));
    } else if (requestData.socials_links !== undefined) {
      add('socials_links', toJsonbValue(requestData.socials_links));
    }

    if (dataToApply.paymentMethods !== undefined) {
      add('payment_methods', dataToApply.paymentMethods);
    } else if (requestData.payment_methods !== undefined) {
      add('payment_methods', requestData.payment_methods);
    }

    if (dataToApply.facilities !== undefined) add('facilities', dataToApply.facilities);
    if (dataToApply.media !== undefined) add('media', toJsonbValue(dataToApply.media));

    if (dataToApply.timezoneId !== undefined) {
      add('timezone_id', dataToApply.timezoneId);
    } else if (requestData.timezone_id !== undefined) {
      add('timezone_id', requestData.timezone_id);
    }

    // Save pending_changes if any critical fields changed
    if (pendingChanges !== null) {
      add('pending_changes', JSON.stringify(pendingChanges));
    }

    add('updated_at', new Date().toISOString());

    if (setParts.length === 0) {
      throw new Error('Campaign not found or not updated');
    }

    values.push(campaignId, userId);

    const updated = await this.db.query<Campaign>(
      `
        update campaign_info
        set ${setParts.join(', ')}
        where id = $${i} and user_id = $${i + 1}
        returning *
      `,
      values
    );

    if (updated.rowCount === 0) throw new Error('Campaign not found or not updated');

    if (currentStatus === CampaignStatus.PUBLISHED && replacedPendingMediaBefore && replacedPendingMediaAfter) {
      // User may update pending media several times before moderation.
      // Remove obsolete pending objects, but keep anything still used by active media.
      await this.deleteManagedMediaDiff(replacedPendingMediaBefore, replacedPendingMediaAfter, currentActiveMedia);
    }

    const sports = await this.getSportsByCampaignId(campaignId);
    const effectiveCampaign = applyPendingOverlay(updated.rows[0]);
    return this.mapCampaignToResponse(effectiveCampaign, sports);
  }

  async deleteCampaign(campaignId: string, userId: string): Promise<void> {
    // Проверяем наличие активных бронирований
    const activeBookings = await this.db.query(
      `SELECT COUNT(*)::int as count
       FROM bookings b
       JOIN booking_slots s ON b.slot_id = s.id
       JOIN fields f ON s.field_id = f.id
       WHERE f.campaign_id = $1
         AND b.status IN ('pending', 'confirmed')`,
      [campaignId]
    );

    if (activeBookings.rows[0]?.count > 0) {
      const err: any = new Error(
        `Невозможно удалить площадку с активными бронированиями (${activeBookings.rows[0].count}). Отмените или завершите их.`
      );
      err.statusCode = 409;
      throw err;
    }

    const result = await this.db.query('delete from campaign_info where id = $1 and user_id = $2', [
      campaignId,
      userId
    ]);

    if (result.rowCount === 0) {
      throw new Error('Campaign not found or not deleted');
    }
  }

  async updateCampaignStatus(
    campaignId: string,
    status: CampaignStatus,
    changedBy: string,
    comment?: string
  ): Promise<CampaignResponse> {
    const updated = await withTransaction(this.db, async (client) => {
      // Get old status for audit log
      const oldResult = await client.query<{ status: string }>(
        'SELECT status FROM campaign_info WHERE id = $1',
        [campaignId]
      );
      if (oldResult.rowCount === 0) throw new Error('Campaign not found');
      const oldStatus = oldResult.rows[0].status;

      const now = new Date().toISOString();

      // При отклонении (draft) — сохранить комментарий
      // При публикации — очистить комментарий
      let moderationComment: string | null = null;
      let moderationAt: string | null = null;

      if (status === CampaignStatus.DRAFT && comment) {
        moderationComment = comment;
        moderationAt = now;
      }

      // При suspend/reject/published — очистить pending_changes
      const clearPending = status === CampaignStatus.SUSPENDED
        || status === CampaignStatus.DRAFT
        || status === CampaignStatus.PUBLISHED;

      let query: string;
      let params: unknown[];

      if (status === CampaignStatus.DRAFT || status === CampaignStatus.PUBLISHED || status === CampaignStatus.PENDING) {
        query = `
          UPDATE campaign_info
          SET status = $1, moderation_comment = $2, moderation_at = $3,
              ${clearPending ? 'pending_changes = NULL,' : ''} updated_at = $4
          WHERE id = $5
          RETURNING *
        `;
        params = [status, moderationComment, moderationAt, now, campaignId];
      } else {
        query = `
          UPDATE campaign_info
          SET status = $1, ${clearPending ? 'pending_changes = NULL,' : ''} updated_at = $2
          WHERE id = $3
          RETURNING *
        `;
        params = [status, now, campaignId];
      }

      const updatedResult = await client.query<Campaign>(query, params);

      if (updatedResult.rowCount === 0) {
        throw new Error('Campaign not found');
      }

      // Audit log
      const reason = status === CampaignStatus.PUBLISHED ? 'Approved'
        : status === CampaignStatus.SUSPENDED ? `Suspended${comment ? ': ' + comment : ''}`
        : status === CampaignStatus.DRAFT && comment ? `Rejected: ${comment}`
        : status === CampaignStatus.PENDING ? 'Submitted for moderation'
        : undefined;
      await this.logStatusChange(campaignId, oldStatus, status, changedBy, reason, client);

      return updatedResult.rows[0];
    });

    const sports = await this.getSportsByCampaignId(campaignId);
    return this.mapCampaignToResponse(updated, sports);
  }

  /**
   * Проверка готовности площадки к модерации (8 пунктов)
   */
  async getCampaignReadiness(campaignId: string): Promise<ReadinessResponse> {
    const campaign = await this.db.query<Campaign>(
      'SELECT * FROM campaign_info WHERE id = $1',
      [campaignId]
    );

    if (campaign.rowCount === 0) {
      throw new Error('Campaign not found');
    }

    const c = campaign.rows[0];

    // Подсчёт активных полей
    const fieldsResult = await this.db.query<{ count: string }>(
      `SELECT COUNT(*)::text as count FROM fields
       WHERE campaign_id = $1 AND deleted_at IS NULL AND status = 'active'`,
      [campaignId]
    );
    const fieldsCount = parseInt(fieldsResult.rows[0]?.count || '0', 10);

    // Проверка рабочего расписания (хотя бы 1 рабочий день)
    let hasWorkingDay = false;
    if (c.working_timetable) {
      const timetable = typeof c.working_timetable === 'string'
        ? JSON.parse(c.working_timetable)
        : c.working_timetable;
      for (const day of Object.values(timetable) as any[]) {
        if (day && !day.isWeekend && day.from && day.to) {
          hasWorkingDay = true;
          break;
        }
      }
    }

    const items: ReadinessItem[] = [
      { key: 'name', label: 'Название площадки', done: !!c.name && c.name.trim().length > 0 },
      { key: 'description', label: 'Описание', done: !!c.description && c.description.trim().length > 0 },
      {
        key: 'location',
        label: 'Адрес',
        done: !!(c.location && (c.location as any).city && (c.location as any).street)
      },
      {
        key: 'phone',
        label: 'Контактный телефон',
        done: !!(c.contacts && (c.contacts as any).phone)
      },
      { key: 'timetable', label: 'Расписание работы', done: hasWorkingDay },
      {
        key: 'payment',
        label: 'Способы оплаты',
        done: !!(c.payment_methods && c.payment_methods.length > 0)
      },
      {
        key: 'photo',
        label: 'Главное фото',
        done: !!(c.media && (c.media as any).main_src)
      },
      { key: 'fields', label: 'Минимум 1 поле', done: fieldsCount > 0 }
    ];

    const missingCount = items.filter(i => !i.done).length;

    return {
      ready: missingCount === 0,
      items,
      missingCount
    };
  }

  /**
   * Подать площадку на модерацию (draft → pending)
   */
  async submitForModeration(campaignId: string, userId: string): Promise<CampaignResponse> {
    // Проверить готовность до транзакции (read-only, не требует блокировки)
    const readiness = await this.getCampaignReadiness(campaignId);
    if (!readiness.ready) {
      const missing = readiness.items.filter(i => !i.done).map(i => ({ key: i.key, label: i.label }));
      const error: any = new Error('Campaign is not ready for moderation');
      error.missing = missing;
      error.statusCode = 400;
      throw error;
    }

    const updated = await withTransaction(this.db, async (client) => {
      // SELECT FOR UPDATE — блокирует строку, защита от double-submit
      const campaignResult = await client.query<Campaign>(
        'SELECT * FROM campaign_info WHERE id = $1 FOR UPDATE',
        [campaignId]
      );

      if (campaignResult.rowCount === 0) {
        throw new Error('Campaign not found');
      }

      const campaign = campaignResult.rows[0];

      if (campaign.user_id !== userId) {
        throw new Error('Access denied');
      }

      if (campaign.status !== CampaignStatus.DRAFT) {
        throw new Error('Campaign can only be submitted from draft status');
      }

      const now = new Date().toISOString();
      const updatedResult = await client.query<Campaign>(
        `UPDATE campaign_info
         SET status = $1, moderation_comment = NULL, moderation_at = NULL, updated_at = $2
         WHERE id = $3
         RETURNING *`,
        [CampaignStatus.PENDING, now, campaignId]
      );

      await this.logStatusChange(
        campaignId, CampaignStatus.DRAFT, CampaignStatus.PENDING,
        userId, 'Submitted for moderation', client
      );

      return updatedResult.rows[0];
    });

    const sports = await this.getSportsByCampaignId(campaignId);
    return this.mapCampaignToResponse(updated, sports);
  }

  /**
   * Получить поля площадки (для суперадмина)
   */
  async getCampaignFields(campaignId: string): Promise<{
    id: string;
    name: string;
    sport_types: string[];
    status: string;
    price_per_hour: number | null;
    photos: string[];
    pending_photos: string[] | null;
  }[]> {
    const result = await this.db.query<{
      id: string;
      name: string;
      sport_types: string[];
      status: string;
      price_per_hour: number | null;
      photos: string[];
      pending_photos: string[] | null;
    }>(
      `SELECT id, name, sport_types, status, price_per_hour, photos, pending_photos
       FROM fields
       WHERE campaign_id = $1 AND deleted_at IS NULL
       ORDER BY created_at ASC`,
      [campaignId]
    );
    return result.rows;
  }

  // ─── Pending Changes Management ───

  async approvePendingChanges(campaignId: string, userId: string): Promise<CampaignResponse> {
    const result = await this.db.query<Campaign>(
      'SELECT * FROM campaign_info WHERE id = $1',
      [campaignId]
    );
    if (result.rowCount === 0) throw new Error('Campaign not found');

    const campaign = result.rows[0];
    if (!campaign.pending_changes || Object.keys(campaign.pending_changes).length === 0) {
      throw new Error('No pending changes');
    }

    const pending = campaign.pending_changes as Record<string, unknown>;
    const currentMedia = normalizeMediaShape(campaign.media);
    const pendingMedia = normalizeMediaShape(pending.media);
    const setParts: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    if (pending.name !== undefined) {
      setParts.push(`name = $${i}`);
      values.push(pending.name);
      i++;
    }
    if (pending.location !== undefined) {
      setParts.push(`location = $${i}`);
      values.push(JSON.stringify(pending.location));
      i++;
    }
    if (pending.media !== undefined) {
      setParts.push(`media = $${i}`);
      values.push(JSON.stringify(pending.media));
      i++;
    }

    setParts.push(`pending_changes = NULL`);
    setParts.push(`updated_at = $${i}`);
    values.push(new Date().toISOString());
    i++;

    values.push(campaignId);

    const updated = await this.db.query<Campaign>(
      `UPDATE campaign_info SET ${setParts.join(', ')} WHERE id = $${i} RETURNING *`,
      values
    );

    // Audit log (no status change, just changes approved)
    await this.logStatusChange(campaignId, campaign.status, campaign.status, userId, 'Changes approved');

    const updatedMedia = normalizeMediaShape(updated.rows[0].media);
    const targetMedia = updatedMedia || pendingMedia;
    if (currentMedia && targetMedia) {
      // After approve, old active media can be removed if not referenced anymore.
      await this.deleteManagedMediaDiff(currentMedia, targetMedia);
    }

    const sports = await this.getSportsByCampaignId(campaignId);
    return this.mapCampaignToResponse(updated.rows[0], sports);
  }

  async rejectPendingChanges(campaignId: string, userId: string, comment?: string): Promise<CampaignResponse> {
    const result = await this.db.query<Campaign>(
      'SELECT * FROM campaign_info WHERE id = $1',
      [campaignId]
    );
    if (result.rowCount === 0) throw new Error('Campaign not found');

    const campaign = result.rows[0];
    if (!campaign.pending_changes || Object.keys(campaign.pending_changes).length === 0) {
      throw new Error('No pending changes');
    }

    const pending = campaign.pending_changes as Record<string, unknown>;
    const currentMedia = normalizeMediaShape(campaign.media);
    const pendingMedia = normalizeMediaShape(pending.media);

    const now = new Date().toISOString();
    const updated = await this.db.query<Campaign>(
      `UPDATE campaign_info
       SET pending_changes = NULL,
           moderation_comment = COALESCE($1, moderation_comment),
           moderation_at = CASE WHEN $1 IS NOT NULL THEN $2 ELSE moderation_at END,
           updated_at = $2
       WHERE id = $3
       RETURNING *`,
      [comment ?? null, now, campaignId]
    );

    // Audit log
    const reason = comment ? `Changes rejected: ${comment}` : 'Changes rejected';
    await this.logStatusChange(campaignId, campaign.status, campaign.status, userId, reason);

    if (pendingMedia && currentMedia) {
      // After reject, pending media should be removed if it is not used by current active media.
      await this.deleteManagedMediaDiff(pendingMedia, currentMedia);
    }

    const sports = await this.getSportsByCampaignId(campaignId);
    return this.mapCampaignToResponse(updated.rows[0], sports);
  }

  // ─── Status Log ───

  async getCampaignStatusLog(campaignId: string): Promise<{
    id: string;
    old_status: string | null;
    new_status: string;
    reason: string | null;
    changed_by_name: string;
    changed_by_email: string;
    created_at: string;
  }[]> {
    const result = await this.db.query<{
      id: string;
      old_status: string | null;
      new_status: string;
      reason: string | null;
      changed_by_name: string;
      changed_by_email: string;
      created_at: string;
    }>(
      `SELECT l.id, l.old_status, l.new_status, l.reason,
              COALESCE(u.name, u.email) as changed_by_name, u.email as changed_by_email,
              l.created_at
       FROM campaign_status_log l
       JOIN users u ON u.id = l.changed_by
       WHERE l.campaign_id = $1
       ORDER BY l.created_at DESC`,
      [campaignId]
    );
    return result.rows;
  }

  async getPublishedCampaigns(filters?: {
    sport?: string;
    q?: string;
    sort?: string;
    date?: string;
    is_indoor?: boolean;
  }): Promise<CampaignResponse[]> {
    const values: unknown[] = [];
    let paramIndex = 1;

    // If date filter is provided, we need a more complex query with JOINs
    if (filters?.date) {
      const conditions: string[] = ["c.status = 'published'"];

      // Search by name
      if (filters?.q) {
        conditions.push(`c.name ILIKE $${paramIndex}`);
        values.push(`%${filters.q}%`);
        paramIndex++;
      }

      // Date filter - find campaigns with available slots on this date
      const dateParamIndex = paramIndex;
      values.push(filters.date);
      paramIndex++;

      // Build field sport filter if needed (filter only at field level, not campaign)
      // This is because fields.sport_types is text[] while campaign.sports is enum[]
      let fieldSportCondition = '';
      if (filters?.sport) {
        fieldSportCondition = `AND $${paramIndex} = ANY(f.sport_types)`;
        values.push(filters.sport.toUpperCase());
        paramIndex++;
      }

      let fieldIndoorCondition = '';
      if (filters?.is_indoor !== undefined) {
        fieldIndoorCondition = `AND f.is_indoor = $${paramIndex}`;
        values.push(filters.is_indoor);
        paramIndex++;
      }

      // Sort order
      let orderBy = 'c.created_at DESC';
      if (filters?.sort === 'name_asc') {
        orderBy = 'c.name ASC';
      } else if (filters?.sort === 'name_desc') {
        orderBy = 'c.name DESC';
      }

      const query = `
        SELECT DISTINCT c.* FROM campaign_info c
        WHERE ${conditions.join(' AND ')}
        AND EXISTS (
          SELECT 1 FROM fields f
          JOIN booking_slots s ON s.field_id = f.id
          LEFT JOIN bookings b ON b.slot_id = s.id AND b.status IN ('pending', 'confirmed')
          WHERE f.campaign_id = c.id
            AND f.status = 'active'
            AND f.deleted_at IS NULL
            AND s.date = $${dateParamIndex}
            AND s.is_blocked = false
            AND b.id IS NULL
            ${fieldSportCondition}
            ${fieldIndoorCondition}
        )
        ORDER BY ${orderBy}
      `;

      const { rows } = await this.db.query<Campaign>(query, values);
      const sportsMap = await this.getSportsByCampaignIds(rows.map(c => c.id));
      return rows.map(campaign =>
        this.mapCampaignToResponse(campaign, sportsMap.get(campaign.id) || [])
      );
    }

    // Simple query without date filter
    const conditions: string[] = ["status = 'published'"];

    // Search by name (case-insensitive)
    if (filters?.q) {
      conditions.push(`name ILIKE $${paramIndex}`);
      values.push(`%${filters.q}%`);
      paramIndex++;
    }

    // Sort order
    let orderBy = 'created_at DESC'; // default: newest first
    if (filters?.sort === 'name_asc') {
      orderBy = 'name ASC';
    } else if (filters?.sort === 'name_desc') {
      orderBy = 'name DESC';
    }

    // Filter by sport through fields.sport_types (text[]) instead of campaign.sports (enum[])
    // This allows filtering by all sports including those not in the sport_type enum
    let fieldSubquery = '';
    const fieldConditions: string[] = [];

    if (filters?.sport) {
      fieldConditions.push(`$${paramIndex} = ANY(f.sport_types)`);
      values.push(filters.sport.toUpperCase());
      paramIndex++;
    }

    if (filters?.is_indoor !== undefined) {
      fieldConditions.push(`f.is_indoor = $${paramIndex}`);
      values.push(filters.is_indoor);
      paramIndex++;
    }

    if (fieldConditions.length > 0) {
      fieldSubquery = `
        AND EXISTS (
          SELECT 1 FROM fields f
          WHERE f.campaign_id = campaign_info.id
            AND f.status = 'active'
            AND f.deleted_at IS NULL
            AND ${fieldConditions.join(' AND ')}
        )
      `;
    }

    const query = `
      SELECT * FROM campaign_info
      WHERE ${conditions.join(' AND ')}
      ${fieldSubquery}
      ORDER BY ${orderBy}
    `;

    const { rows } = await this.db.query<Campaign>(query, values);
    const sportsMap = await this.getSportsByCampaignIds(rows.map(c => c.id));
    return rows.map(campaign =>
      this.mapCampaignToResponse(campaign, sportsMap.get(campaign.id) || [])
    );
  }

  private mapCampaignToResponse(campaign: Campaign, sports: string[]): CampaignResponse {
    const normalizedMedia = normalizeMediaShape(campaign.media);
    return {
      id: campaign.id,
      userId: campaign.user_id,
      name: campaign.name,
      description: campaign.description,
      shortDescription: campaign.short_description,
      location: campaign.location,
      contacts: campaign.contacts,
      workingTimetable: campaign.working_timetable,
      socialsLinks: normalizeJsonArray(campaign.socials_links),
      paymentMethods: normalizeEnumArray(campaign.payment_methods),
      facilities: normalizeEnumArray(campaign.facilities),
      sports: sports as any[], // Computed from fields
      media: normalizedMedia,
      bookingInfo: campaign.booking_info,
      timezoneId: campaign.timezone_id,
      status: campaign.status,
      pendingChanges: campaign.pending_changes ?? null,
      moderationComment: campaign.moderation_comment ?? null,
      moderationAt: campaign.moderation_at ?? null,
      createdAt: campaign.created_at,
      updatedAt: campaign.updated_at
    };
  }

  async getClients(
    campaignId: string,
    limit: number = 100,
    offset: number = 0,
    search?: string
  ): Promise<{
    clients: {
      id: string;
      name: string | null;
      email: string | null;
      phone: string | null;
      bookings_count: number;
      last_booking_date: string | null;
      first_booking_date: string | null;
      total_spent: number;
      is_registered: boolean;
    }[];
    total: number;
  }> {
    // Валидация параметров
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const safeOffset = Math.max(offset, 0);

    // Единый запрос для всех клиентов (registered + guests)
    // Гости теперь тоже имеют user_id, отличаются по email/password_hash = NULL
    const searchTrimmed = search?.trim() || '';
    const searchDigits = searchTrimmed.replace(/\D/g, '');
    const hasPhoneDigits = searchDigits.length >= 3;

    let searchCondition = '';
    if (searchTrimmed) {
      const phonePart = hasPhoneDigits ? `OR u.phone LIKE '%' || $5 || '%'` : '';
      searchCondition = `HAVING (
        u.name ILIKE '%' || $4 || '%'
        OR MAX(b.contact_name) ILIKE '%' || $4 || '%'
        ${phonePart}
      )`;
    }
    const params: (string | number)[] = [campaignId, safeLimit, safeOffset];
    if (searchTrimmed) {
      params.push(searchTrimmed);
      if (hasPhoneDigits) params.push(searchDigits);
    }

    const result = await this.db.query<{
      id: string;
      name: string | null;
      email: string | null;
      phone: string | null;
      bookings_count: string;
      last_booking_date: string | null;
      first_booking_date: string | null;
      total_spent: string;
      is_registered: boolean;
      total_count: string;
    }>(
      `
        WITH all_clients AS (
          SELECT
            u.id::text as id,
            COALESCE(u.name, MAX(b.contact_name)) as name,
            u.email,
            u.phone,
            COUNT(DISTINCT b.id) as bookings_count,
            MAX(b.created_at) as last_booking_date,
            MIN(b.created_at) as first_booking_date,
            COALESCE(SUM(f.price_per_hour), 0) as total_spent,
            (u.email IS NOT NULL AND u.password_hash IS NOT NULL) as is_registered
          FROM users u
          INNER JOIN bookings b ON b.user_id = u.id
          INNER JOIN booking_slots s ON s.id = b.slot_id
          INNER JOIN fields f ON f.id = s.field_id
          WHERE f.campaign_id = $1
            AND b.status IN ('confirmed', 'completed')
          GROUP BY u.id, u.email, u.phone, u.password_hash
          ${searchCondition}
        )
        SELECT
          *,
          COUNT(*) OVER() as total_count
        FROM all_clients
        ORDER BY last_booking_date DESC NULLS LAST
        LIMIT $2 OFFSET $3
      `,
      params
    );

    const total = result.rows.length > 0 ? parseInt(result.rows[0].total_count, 10) : 0;

    const clients = result.rows.map(row => ({
      id: row.id,
      name: row.name,
      email: row.email,
      phone: row.phone,
      bookings_count: typeof row.bookings_count === 'string'
        ? parseInt(row.bookings_count, 10)
        : row.bookings_count,
      last_booking_date: row.last_booking_date,
      first_booking_date: row.first_booking_date,
      total_spent: typeof row.total_spent === 'string'
        ? parseFloat(row.total_spent)
        : row.total_spent,
      is_registered: row.is_registered,
    }));

    return { clients, total };
  }

  /**
   * Получить клиента по ID (O(1) вместо загрузки всех клиентов)
   * Единый запрос для registered и guest users
   */
  async getClientById(campaignId: string, clientId: string): Promise<{
    id: string;
    name: string | null;
    email: string | null;
    phone: string | null;
    bookings_count: number;
    last_booking_date: string | null;
    first_booking_date: string | null;
    is_registered: boolean;
  } | null> {
    // Проверка на валидный UUID (больше не поддерживаем 'guest_*' формат)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(clientId)) {
      return null;
    }

    const result = await this.db.query<{
      id: string;
      name: string | null;
      email: string | null;
      phone: string | null;
      bookings_count: string;
      last_booking_date: string | null;
      first_booking_date: string | null;
      is_registered: boolean;
    }>(
      `
        SELECT
          u.id::text as id,
          COALESCE(u.name, MAX(b.contact_name)) as name,
          u.email,
          u.phone,
          COUNT(DISTINCT b.id)::text as bookings_count,
          MAX(b.created_at) as last_booking_date,
          MIN(b.created_at) as first_booking_date,
          (u.email IS NOT NULL AND u.password_hash IS NOT NULL) as is_registered
        FROM users u
        INNER JOIN bookings b ON b.user_id = u.id
        INNER JOIN booking_slots s ON s.id = b.slot_id
        INNER JOIN fields f ON f.id = s.field_id
        WHERE u.id = $1
          AND f.campaign_id = $2
          AND b.status IN ('confirmed', 'completed')
        GROUP BY u.id, u.email, u.phone, u.password_hash
      `,
      [clientId, campaignId]
    );

    if (result.rowCount === 0) return null;

    const row = result.rows[0];
    return {
      id: row.id,
      name: row.name,
      email: row.email,
      phone: row.phone,
      bookings_count: parseInt(row.bookings_count, 10),
      last_booking_date: row.last_booking_date,
      first_booking_date: row.first_booking_date,
      is_registered: row.is_registered,
    };
  }

  /**
   * Получить статистику клиента по телефону (для контекста при approve)
   */
  async getClientStatsByPhone(campaignId: string, phone: string): Promise<{
    total_bookings: number;
    no_shows: number;
    cancellations: number;
    is_registered: boolean;
  } | null> {
    const result = await this.db.query<{
      total_bookings: string;
      no_shows: string;
      cancellations: string;
      is_registered: boolean;
    }>(
      `
        SELECT
          COUNT(DISTINCT b.id) as total_bookings,
          COUNT(DISTINCT CASE WHEN b.status = 'no_show' THEN b.id END) as no_shows,
          COUNT(DISTINCT CASE WHEN b.status IN ('cancelled_by_client', 'cancelled_by_facility') THEN b.id END) as cancellations,
          (u.email IS NOT NULL AND u.password_hash IS NOT NULL) as is_registered
        FROM users u
        INNER JOIN bookings b ON b.user_id = u.id
        INNER JOIN booking_slots s ON s.id = b.slot_id
        INNER JOIN fields f ON f.id = s.field_id
        WHERE f.campaign_id = $1 AND u.phone = $2
        GROUP BY u.id, u.email, u.password_hash
      `,
      [campaignId, phone]
    );

    if (result.rowCount === 0) return null;

    const row = result.rows[0];
    return {
      total_bookings: parseInt(row.total_bookings, 10),
      no_shows: parseInt(row.no_shows, 10),
      cancellations: parseInt(row.cancellations, 10),
      is_registered: row.is_registered,
    };
  }

  /**
   * Получить статистику платформы для landing page trust badges
   */
  async getPlatformStats(): Promise<{ campaigns: number; bookings: number; rating: number }> {
    // Параллельные запросы для производительности
    const [campaignsResult, bookingsResult] = await Promise.all([
      this.db.query<{ count: string }>(
        `SELECT COUNT(*) as count
         FROM campaign_info
         WHERE status = 'published'`
      ),
      this.db.query<{ count: string }>(
        `SELECT COUNT(*) as count
         FROM bookings
         WHERE status IN ('completed', 'confirmed')`
      ),
    ]);

    return {
      campaigns: parseInt(campaignsResult.rows[0].count, 10),
      bookings: parseInt(bookingsResult.rows[0].count, 10),
      rating: 4.8, // Хардкод до реализации reviews
    };
  }
}
