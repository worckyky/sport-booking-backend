import crypto from 'crypto';
import type { Pool } from 'pg';
import {
  Campaign,
  CampaignResponse,
  CampaignStatus,
  CreateCampaignRequest,
  UpdateCampaignRequest
} from '../model/campaign.model';
import { normalizeEnumArray, normalizeJsonArray, toJsonbValue } from '../../utils/pg';

export class CampaignAPI {
  constructor(private db: Pool) {}

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

  async getAllCampaigns(): Promise<CampaignResponse[]> {
    const { rows } = await this.db.query<Campaign>('select * from campaign_info');
    const results: CampaignResponse[] = [];
    for (const campaign of rows) {
      const sports = await this.getSportsByCampaignId(campaign.id);
      results.push(this.mapCampaignToResponse(campaign, sports));
    }
    return results;
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

  async updateCampaign(
    campaignId: string,
    userId: string,
    campaignData: UpdateCampaignRequest
  ): Promise<CampaignResponse> {
    const requestData = campaignData as unknown as Record<string, unknown>;

    const setParts: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    const add = (col: string, val: unknown): void => {
      setParts.push(`${col} = $${i}`);
      values.push(val);
      i += 1;
    };

    if (campaignData.name !== undefined) add('name', campaignData.name);
    if (campaignData.description !== undefined) add('description', campaignData.description);

    if (campaignData.shortDescription !== undefined) {
      add('short_description', campaignData.shortDescription);
    } else if (requestData.short_description !== undefined) {
      add('short_description', requestData.short_description);
    }

    if (campaignData.location !== undefined) add('location', toJsonbValue(campaignData.location));
    if (campaignData.contacts !== undefined) add('contacts', toJsonbValue(campaignData.contacts));

    if (campaignData.workingTimetable !== undefined) {
      add('working_timetable', toJsonbValue(campaignData.workingTimetable));
    } else if (requestData.working_timetable !== undefined) {
      add('working_timetable', toJsonbValue(requestData.working_timetable));
    }

    if (campaignData.socialsLinks !== undefined) {
      add('socials_links', toJsonbValue(campaignData.socialsLinks));
    } else if (requestData.socials_links !== undefined) {
      add('socials_links', toJsonbValue(requestData.socials_links));
    }

    if (campaignData.paymentMethods !== undefined) {
      add('payment_methods', campaignData.paymentMethods);
    } else if (requestData.payment_methods !== undefined) {
      add('payment_methods', requestData.payment_methods);
    }

    if (campaignData.facilities !== undefined) add('facilities', campaignData.facilities);
    if (campaignData.media !== undefined) add('media', toJsonbValue(campaignData.media));

    if (campaignData.timezoneId !== undefined) {
      add('timezone_id', campaignData.timezoneId);
    } else if (requestData.timezone_id !== undefined) {
      add('timezone_id', requestData.timezone_id);
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
    const sports = await this.getSportsByCampaignId(campaignId);
    return this.mapCampaignToResponse(updated.rows[0], sports);
  }

  async deleteCampaign(campaignId: string, userId: string): Promise<void> {
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
    status: CampaignStatus
  ): Promise<CampaignResponse> {
    const updated = await this.db.query<Campaign>(
      `
        UPDATE campaign_info
        SET status = $1, updated_at = $2
        WHERE id = $3
        RETURNING *
      `,
      [status, new Date().toISOString(), campaignId]
    );

    if (updated.rowCount === 0) {
      throw new Error('Campaign not found');
    }

    const sports = await this.getSportsByCampaignId(campaignId);
    return this.mapCampaignToResponse(updated.rows[0], sports);
  }

  async getPublishedCampaigns(filters?: {
    sport?: string;
    q?: string;
    sort?: string;
    date?: string;
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
            AND s.date = $${dateParamIndex}
            AND s.is_blocked = false
            AND b.id IS NULL
            ${fieldSportCondition}
        )
        ORDER BY ${orderBy}
      `;

      const { rows } = await this.db.query<Campaign>(query, values);
      const results: CampaignResponse[] = [];
      for (const campaign of rows) {
        const sports = await this.getSportsByCampaignId(campaign.id);
        results.push(this.mapCampaignToResponse(campaign, sports));
      }
      return results;
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
    let sportSubquery = '';
    if (filters?.sport) {
      sportSubquery = `
        AND EXISTS (
          SELECT 1 FROM fields f
          WHERE f.campaign_id = id
            AND f.status = 'active'
            AND $${paramIndex} = ANY(f.sport_types)
        )
      `;
      values.push(filters.sport.toUpperCase());
      paramIndex++;
    }

    const query = `
      SELECT * FROM campaign_info
      WHERE ${conditions.join(' AND ')}
      ${sportSubquery}
      ORDER BY ${orderBy}
    `;

    const { rows } = await this.db.query<Campaign>(query, values);
    const results: CampaignResponse[] = [];
    for (const campaign of rows) {
      const sports = await this.getSportsByCampaignId(campaign.id);
      results.push(this.mapCampaignToResponse(campaign, sports));
    }
    return results;
  }

  private mapCampaignToResponse(campaign: Campaign, sports: string[]): CampaignResponse {
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
      media: campaign.media,
      bookingInfo: campaign.booking_info,
      timezoneId: campaign.timezone_id,
      status: campaign.status,
      createdAt: campaign.created_at,
      updatedAt: campaign.updated_at
    };
  }

  async getClients(campaignId: string): Promise<{
    id: string;
    name: string | null;
    email: string | null;
    phone: string | null;
    bookings_count: number;
    last_booking_date: string | null;
    first_booking_date: string | null;
    total_spent: number;
    is_registered: boolean;
  }[]> {
    // Registered users who booked
    const registeredQuery = this.db.query<{
      id: string;
      name: string | null;
      email: string | null;
      phone: string | null;
      bookings_count: string;
      last_booking_date: string | null;
      first_booking_date: string | null;
      total_spent: string;
    }>(
      `
        SELECT
          u.id,
          u.name,
          u.email,
          u.phone,
          COUNT(DISTINCT b.id)::text as bookings_count,
          MAX(b.created_at) as last_booking_date,
          MIN(b.created_at) as first_booking_date,
          COALESCE(SUM(f.price_per_hour), 0)::text as total_spent
        FROM users u
        INNER JOIN bookings b ON b.user_id = u.id
        INNER JOIN booking_slots s ON s.id = b.slot_id
        INNER JOIN fields f ON f.id = s.field_id
        WHERE f.campaign_id = $1
          AND b.status IN ('confirmed', 'completed')
        GROUP BY u.id, u.name, u.email, u.phone
      `,
      [campaignId]
    );

    // Guest bookings (no user_id, identified by contact_phone)
    const guestQuery = this.db.query<{
      phone: string;
      name: string | null;
      bookings_count: string;
      last_booking_date: string | null;
      first_booking_date: string | null;
      total_spent: string;
    }>(
      `
        SELECT
          b.contact_phone as phone,
          MAX(b.contact_name) as name,
          COUNT(DISTINCT b.id)::text as bookings_count,
          MAX(b.created_at) as last_booking_date,
          MIN(b.created_at) as first_booking_date,
          COALESCE(SUM(f.price_per_hour), 0)::text as total_spent
        FROM bookings b
        INNER JOIN booking_slots s ON s.id = b.slot_id
        INNER JOIN fields f ON f.id = s.field_id
        WHERE f.campaign_id = $1
          AND b.user_id IS NULL
          AND b.contact_phone IS NOT NULL
          AND b.status IN ('confirmed', 'completed')
        GROUP BY b.contact_phone
      `,
      [campaignId]
    );

    const [registeredResult, guestResult] = await Promise.all([registeredQuery, guestQuery]);

    const clients: {
      id: string;
      name: string | null;
      email: string | null;
      phone: string | null;
      bookings_count: number;
      last_booking_date: string | null;
      first_booking_date: string | null;
      total_spent: number;
      is_registered: boolean;
    }[] = [];

    // Add registered users
    for (const row of registeredResult.rows) {
      clients.push({
        id: row.id,
        name: row.name,
        email: row.email,
        phone: row.phone,
        bookings_count: parseInt(row.bookings_count, 10),
        last_booking_date: row.last_booking_date,
        first_booking_date: row.first_booking_date,
        total_spent: parseFloat(row.total_spent),
        is_registered: true,
      });
    }

    // Add guests (use phone as id with prefix)
    for (const row of guestResult.rows) {
      clients.push({
        id: `guest_${row.phone}`,
        name: row.name,
        email: null,
        phone: row.phone,
        bookings_count: parseInt(row.bookings_count, 10),
        last_booking_date: row.last_booking_date,
        first_booking_date: row.first_booking_date,
        total_spent: parseFloat(row.total_spent),
        is_registered: false,
      });
    }

    // Sort by last_booking_date desc
    clients.sort((a, b) => {
      if (!a.last_booking_date) return 1;
      if (!b.last_booking_date) return -1;
      return new Date(b.last_booking_date).getTime() - new Date(a.last_booking_date).getTime();
    });

    return clients;
  }

  /**
   * Получить клиента по ID (O(1) вместо загрузки всех клиентов)
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
    // Проверяем, гостевой ли это клиент (id начинается с "guest_")
    if (clientId.startsWith('guest_')) {
      const phone = clientId.replace('guest_', '');
      const result = await this.db.query<{
        phone: string;
        name: string;
        bookings_count: string;
        last_booking_date: string;
        first_booking_date: string;
      }>(
        `
          SELECT
            b.contact_phone as phone,
            MAX(b.contact_name) as name,
            COUNT(*)::text as bookings_count,
            MAX(s.date)::text as last_booking_date,
            MIN(s.date)::text as first_booking_date
          FROM bookings b
          JOIN booking_slots s ON b.slot_id = s.id
          JOIN fields f ON s.field_id = f.id
          WHERE f.campaign_id = $1
            AND b.user_id IS NULL
            AND b.contact_phone = $2
          GROUP BY b.contact_phone
        `,
        [campaignId, phone]
      );

      if (result.rowCount === 0) return null;

      const row = result.rows[0];
      return {
        id: clientId,
        name: row.name,
        email: null,
        phone: row.phone,
        bookings_count: parseInt(row.bookings_count, 10),
        last_booking_date: row.last_booking_date,
        first_booking_date: row.first_booking_date,
        is_registered: false,
      };
    }

    // Зарегистрированный пользователь
    const result = await this.db.query<{
      id: string;
      name: string;
      email: string;
      phone: string;
      bookings_count: string;
      last_booking_date: string;
      first_booking_date: string;
    }>(
      `
        SELECT
          u.id,
          u.name,
          u.email,
          u.phone,
          COUNT(b.id)::text as bookings_count,
          MAX(s.date)::text as last_booking_date,
          MIN(s.date)::text as first_booking_date
        FROM users u
        JOIN bookings b ON b.user_id = u.id
        JOIN booking_slots s ON b.slot_id = s.id
        JOIN fields f ON s.field_id = f.id
        WHERE f.campaign_id = $1 AND u.id = $2
        GROUP BY u.id
      `,
      [campaignId, clientId]
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
      is_registered: true,
    };
  }
}