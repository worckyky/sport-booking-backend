import { Pool } from 'pg';
import {
  Field,
  CreateFieldRequest,
  UpdateFieldRequest,
  BookingSlot,
  CreateSlotRequest,
  Booking,
  BookingStatus,
  SlotWithBooking,
  BookingDetails
} from '../model/booking.model';

export class BookingAPI {
  constructor(private db: Pool) {}

  // ==================== FIELDS ====================

  async getFieldsByCampaign(campaignId: string): Promise<Field[]> {
    const result = await this.db.query<Field>(
      'SELECT * FROM fields WHERE campaign_id = $1 ORDER BY created_at',
      [campaignId]
    );
    return result.rows;
  }

  async getFieldById(fieldId: string): Promise<Field | null> {
    const result = await this.db.query<Field>(
      'SELECT * FROM fields WHERE id = $1',
      [fieldId]
    );
    return result.rows[0] || null;
  }

  async createField(data: CreateFieldRequest): Promise<Field> {
    const result = await this.db.query<Field>(
      `INSERT INTO fields (campaign_id, name, price_per_hour)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [data.campaign_id, data.name, data.price_per_hour ?? null]
    );
    return result.rows[0];
  }

  async updateField(fieldId: string, data: UpdateFieldRequest): Promise<Field | null> {
    const sets: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (data.name !== undefined) {
      sets.push(`name = $${idx++}`);
      values.push(data.name);
    }
    if (data.price_per_hour !== undefined) {
      sets.push(`price_per_hour = $${idx++}`);
      values.push(data.price_per_hour);
    }

    if (sets.length === 0) return this.getFieldById(fieldId);

    values.push(fieldId);
    const result = await this.db.query<Field>(
      `UPDATE fields SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );
    return result.rows[0] || null;
  }

  async deleteField(fieldId: string): Promise<boolean> {
    const result = await this.db.query(
      'DELETE FROM fields WHERE id = $1',
      [fieldId]
    );
    return (result.rowCount ?? 0) > 0;
  }

  // ==================== SLOTS ====================

  async getSlotsByFieldAndDate(fieldId: string, date: string): Promise<SlotWithBooking[]> {
    const result = await this.db.query(
      `SELECT
         s.id, s.field_id, s.date, s.start_time, s.end_time, s.created_at,
         b.id as booking_id, b.user_id as booking_user_id, b.status as booking_status
       FROM booking_slots s
       LEFT JOIN bookings b ON s.id = b.slot_id
       WHERE s.field_id = $1 AND s.date = $2
       ORDER BY s.start_time`,
      [fieldId, date]
    );

    return result.rows.map(row => ({
      id: row.id,
      field_id: row.field_id,
      date: row.date,
      start_time: row.start_time,
      end_time: row.end_time,
      created_at: row.created_at,
      booking: row.booking_id ? {
        id: row.booking_id,
        user_id: row.booking_user_id,
        status: row.booking_status
      } : null
    }));
  }

  async createSlot(data: CreateSlotRequest): Promise<BookingSlot> {
    // Проверяем пересечение времени
    const overlap = await this.db.query(
      `SELECT id FROM booking_slots
       WHERE field_id = $1 AND date = $2
       AND (
         (start_time < $4 AND end_time > $3)
       )`,
      [data.field_id, data.date, data.start_time, data.end_time]
    );

    if (overlap.rows.length > 0) {
      throw new Error('Slot overlaps with existing slot');
    }

    const result = await this.db.query<BookingSlot>(
      `INSERT INTO booking_slots (field_id, date, start_time, end_time)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [data.field_id, data.date, data.start_time, data.end_time]
    );
    return result.rows[0];
  }

  async deleteSlot(slotId: string): Promise<boolean> {
    const result = await this.db.query(
      'DELETE FROM booking_slots WHERE id = $1',
      [slotId]
    );
    return (result.rowCount ?? 0) > 0;
  }

  // ==================== BOOKINGS ====================

  async getMyBookings(userId: string): Promise<BookingDetails[]> {
    const result = await this.db.query(
      `SELECT
         b.id, b.slot_id, b.user_id, b.status, b.created_at,
         s.field_id, s.date, s.start_time, s.end_time, s.created_at as slot_created_at,
         f.campaign_id, f.name as field_name, f.price_per_hour, f.created_at as field_created_at
       FROM bookings b
       JOIN booking_slots s ON b.slot_id = s.id
       JOIN fields f ON s.field_id = f.id
       WHERE b.user_id = $1
       ORDER BY s.date DESC, s.start_time DESC`,
      [userId]
    );

    return result.rows.map(row => ({
      id: row.id,
      slot_id: row.slot_id,
      user_id: row.user_id,
      status: row.status,
      created_at: row.created_at,
      slot: {
        id: row.slot_id,
        field_id: row.field_id,
        date: row.date,
        start_time: row.start_time,
        end_time: row.end_time,
        created_at: row.slot_created_at
      },
      field: {
        id: row.field_id,
        campaign_id: row.campaign_id,
        name: row.field_name,
        price_per_hour: row.price_per_hour,
        created_at: row.field_created_at
      }
    }));
  }

  async getBookingsByCampaign(campaignId: string): Promise<BookingDetails[]> {
    const result = await this.db.query(
      `SELECT
         b.id, b.slot_id, b.user_id, b.status, b.created_at,
         s.field_id, s.date, s.start_time, s.end_time, s.created_at as slot_created_at,
         f.campaign_id, f.name as field_name, f.price_per_hour, f.created_at as field_created_at
       FROM bookings b
       JOIN booking_slots s ON b.slot_id = s.id
       JOIN fields f ON s.field_id = f.id
       WHERE f.campaign_id = $1
       ORDER BY s.date DESC, s.start_time DESC`,
      [campaignId]
    );

    return result.rows.map(row => ({
      id: row.id,
      slot_id: row.slot_id,
      user_id: row.user_id,
      status: row.status,
      created_at: row.created_at,
      slot: {
        id: row.slot_id,
        field_id: row.field_id,
        date: row.date,
        start_time: row.start_time,
        end_time: row.end_time,
        created_at: row.slot_created_at
      },
      field: {
        id: row.field_id,
        campaign_id: row.campaign_id,
        name: row.field_name,
        price_per_hour: row.price_per_hour,
        created_at: row.field_created_at
      }
    }));
  }

  async createBooking(slotId: string, userId: string): Promise<Booking> {
    // Проверяем что слот существует и свободен
    const slot = await this.db.query(
      'SELECT id FROM booking_slots WHERE id = $1',
      [slotId]
    );

    if (slot.rows.length === 0) {
      throw new Error('Slot not found');
    }

    const existing = await this.db.query(
      'SELECT id FROM bookings WHERE slot_id = $1',
      [slotId]
    );

    if (existing.rows.length > 0) {
      throw new Error('Slot already booked');
    }

    const result = await this.db.query<Booking>(
      `INSERT INTO bookings (slot_id, user_id, status)
       VALUES ($1, $2, 'pending')
       RETURNING *`,
      [slotId, userId]
    );
    return result.rows[0];
  }

  async updateBookingStatus(bookingId: string, status: BookingStatus): Promise<Booking | null> {
    const result = await this.db.query<Booking>(
      'UPDATE bookings SET status = $1 WHERE id = $2 RETURNING *',
      [status, bookingId]
    );
    return result.rows[0] || null;
  }

  async cancelBooking(bookingId: string, userId: string): Promise<boolean> {
    const result = await this.db.query(
      `UPDATE bookings SET status = 'cancelled'
       WHERE id = $1 AND user_id = $2 AND status IN ('pending', 'confirmed')
       RETURNING id`,
      [bookingId, userId]
    );
    return (result.rowCount ?? 0) > 0;
  }

  async getBookingById(bookingId: string): Promise<Booking | null> {
    const result = await this.db.query<Booking>(
      'SELECT * FROM bookings WHERE id = $1',
      [bookingId]
    );
    return result.rows[0] || null;
  }

  // ==================== HELPERS ====================

  async getCampaignIdByFieldId(fieldId: string): Promise<string | null> {
    const result = await this.db.query<{ campaign_id: string }>(
      'SELECT campaign_id FROM fields WHERE id = $1',
      [fieldId]
    );
    return result.rows[0]?.campaign_id || null;
  }

  async getCampaignIdBySlotId(slotId: string): Promise<string | null> {
    const result = await this.db.query<{ campaign_id: string }>(
      `SELECT f.campaign_id
       FROM booking_slots s
       JOIN fields f ON s.field_id = f.id
       WHERE s.id = $1`,
      [slotId]
    );
    return result.rows[0]?.campaign_id || null;
  }

  async getCampaignIdByBookingId(bookingId: string): Promise<string | null> {
    const result = await this.db.query<{ campaign_id: string }>(
      `SELECT f.campaign_id
       FROM bookings b
       JOIN booking_slots s ON b.slot_id = s.id
       JOIN fields f ON s.field_id = f.id
       WHERE b.id = $1`,
      [bookingId]
    );
    return result.rows[0]?.campaign_id || null;
  }
}
