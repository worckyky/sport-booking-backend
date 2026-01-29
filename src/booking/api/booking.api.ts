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

interface WorkingTimetable {
  monday?: { from: string; to: string };
  tuesday?: { from: string; to: string };
  wednesday?: { from: string; to: string };
  thursday?: { from: string; to: string };
  friday?: { from: string; to: string };
  saturday?: { from: string; to: string };
  sunday?: { from: string; to: string };
}

export class BookingAPI {
  constructor(private db: Pool) {}

  // ==================== HELPERS ====================

  private async getCampaignWorkingTimetable(campaignId: string): Promise<WorkingTimetable | null> {
    const result = await this.db.query<{ working_timetable: WorkingTimetable | null }>(
      'SELECT working_timetable FROM campaign_info WHERE id = $1',
      [campaignId]
    );
    if (!result.rows[0]) return null;
    const timetable = result.rows[0].working_timetable;
    // Проверяем, что это не пустой объект
    if (!timetable || Object.keys(timetable).length === 0) return null;
    return timetable;
  }

  private validateFieldWorkingHours(
    fieldFrom: string | null | undefined,
    fieldTo: string | null | undefined,
    campaignTimetable: WorkingTimetable
  ): void {
    if (!fieldFrom || !fieldTo) return; // Если время поля не задано, пропускаем

    // Получаем минимальное/максимальное время работы кампании
    const campaignHours: { from: string; to: string }[] = [];
    const days: (keyof WorkingTimetable)[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

    for (const day of days) {
      const schedule = campaignTimetable[day];
      if (schedule?.from && schedule?.to) {
        campaignHours.push({ from: schedule.from, to: schedule.to });
      }
    }

    if (campaignHours.length === 0) return; // Нет расписания кампании

    // Находим самое раннее открытие и самое позднее закрытие
    const earliestOpen = campaignHours.reduce((min, h) => h.from < min ? h.from : min, '23:59');
    const latestClose = campaignHours.reduce((max, h) => h.to > max ? h.to : max, '00:00');

    // Проверяем, что время поля не выходит за рамки
    if (fieldFrom < earliestOpen) {
      throw new Error(`Время начала работы поля (${fieldFrom}) не может быть раньше открытия площадки (${earliestOpen})`);
    }
    if (fieldTo > latestClose) {
      throw new Error(`Время окончания работы поля (${fieldTo}) не может быть позже закрытия площадки (${latestClose})`);
    }
  }

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
    // Валидация: время работы поля не может выходить за время работы площадки
    const campaignTimetable = await this.getCampaignWorkingTimetable(data.campaign_id);
    if (campaignTimetable) {
      this.validateFieldWorkingHours(data.working_hours_from, data.working_hours_to, campaignTimetable);
    }

    const result = await this.db.query<Field>(
      `INSERT INTO fields (
        campaign_id, name, sport_types, is_indoor, photos, price_per_hour,
        slot_duration, working_hours_from, working_hours_to, working_days, client_info
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *`,
      [
        data.campaign_id,
        data.name,
        data.sport_types,
        data.is_indoor,
        data.photos,
        data.price_per_hour,
        data.slot_duration ?? 60,
        data.working_hours_from ?? null,
        data.working_hours_to ?? null,
        data.working_days ?? ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
        data.client_info ?? null
      ]
    );
    return result.rows[0];
  }

  async updateField(fieldId: string, data: UpdateFieldRequest): Promise<Field | null> {
    // Валидация: время работы поля не может выходить за время работы площадки
    if (data.working_hours_from !== undefined || data.working_hours_to !== undefined) {
      const currentField = await this.getFieldById(fieldId);
      if (currentField) {
        const campaignTimetable = await this.getCampaignWorkingTimetable(currentField.campaign_id);
        if (campaignTimetable) {
          const newFrom = data.working_hours_from !== undefined ? data.working_hours_from : currentField.working_hours_from;
          const newTo = data.working_hours_to !== undefined ? data.working_hours_to : currentField.working_hours_to;
          this.validateFieldWorkingHours(newFrom, newTo, campaignTimetable);
        }
      }
    }

    const sets: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (data.name !== undefined) {
      sets.push(`name = $${idx++}`);
      values.push(data.name);
    }
    if (data.sport_types !== undefined) {
      sets.push(`sport_types = $${idx++}`);
      values.push(data.sport_types);
    }
    if (data.is_indoor !== undefined) {
      sets.push(`is_indoor = $${idx++}`);
      values.push(data.is_indoor);
    }
    if (data.photos !== undefined) {
      sets.push(`photos = $${idx++}`);
      values.push(data.photos);
    }
    if (data.price_per_hour !== undefined) {
      sets.push(`price_per_hour = $${idx++}`);
      values.push(data.price_per_hour);
    }
    if (data.status !== undefined) {
      sets.push(`status = $${idx++}`);
      values.push(data.status);
    }
    if (data.slot_duration !== undefined) {
      sets.push(`slot_duration = $${idx++}`);
      values.push(data.slot_duration);
    }
    if (data.working_hours_from !== undefined) {
      sets.push(`working_hours_from = $${idx++}`);
      values.push(data.working_hours_from);
    }
    if (data.working_hours_to !== undefined) {
      sets.push(`working_hours_to = $${idx++}`);
      values.push(data.working_hours_to);
    }
    if (data.working_days !== undefined) {
      sets.push(`working_days = $${idx++}`);
      values.push(data.working_days);
    }
    if (data.client_info !== undefined) {
      sets.push(`client_info = $${idx++}`);
      values.push(data.client_info);
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
    // Проверяем активные брони
    const activeBookings = await this.db.query(
      `SELECT b.id FROM bookings b
       JOIN booking_slots s ON b.slot_id = s.id
       WHERE s.field_id = $1 AND b.status IN ('pending', 'confirmed')`,
      [fieldId]
    );

    if (activeBookings.rows.length > 0) {
      throw new Error('Cannot delete field with active bookings');
    }

    const result = await this.db.query(
      'DELETE FROM fields WHERE id = $1',
      [fieldId]
    );
    return (result.rowCount ?? 0) > 0;
  }

  // ==================== SLOTS ====================

  async getSlotsByFieldAndDate(fieldId: string, date: string): Promise<SlotWithBooking[]> {
    // Получаем настройки поля
    const field = await this.getFieldById(fieldId);
    if (!field || field.status !== 'active') {
      return [];
    }

    // Проверяем диапазон дат (14 дней вперёд)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const requestedDate = new Date(date);
    const maxDate = new Date(today);
    maxDate.setDate(maxDate.getDate() + 14);

    if (requestedDate < today || requestedDate > maxDate) {
      return [];
    }

    // Проверяем рабочий день
    const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    const dayOfWeek = dayNames[requestedDate.getDay()];

    if (!field.working_days?.includes(dayOfWeek)) {
      return [];
    }

    // Проверяем существующие слоты
    const existingSlots = await this.db.query(
      `SELECT s.*, b.id as booking_id, b.user_id as booking_user_id, b.status as booking_status
       FROM booking_slots s
       LEFT JOIN bookings b ON s.id = b.slot_id
       WHERE s.field_id = $1 AND s.date = $2
       ORDER BY s.start_time`,
      [fieldId, date]
    );

    if (existingSlots.rows.length > 0) {
      return this.mapSlotsWithBookings(existingSlots.rows);
    }

    // Lazy генерация слотов
    if (!field.working_hours_from || !field.working_hours_to) {
      return [];
    }

    const slots = this.generateSlots(field);

    if (slots.length === 0) {
      return [];
    }

    // Batch INSERT
    const placeholders: string[] = [];
    const values: (string | boolean | null)[] = [];

    slots.forEach((slot, i) => {
      const offset = i * 4;
      placeholders.push(
        `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4})`
      );
      values.push(fieldId, date, slot.start_time, slot.end_time);
    });

    await this.db.query(
      `INSERT INTO booking_slots (field_id, date, start_time, end_time)
       VALUES ${placeholders.join(', ')}
       ON CONFLICT (field_id, date, start_time) DO NOTHING`,
      values
    );

    // Возвращаем созданные слоты
    const newSlots = await this.db.query(
      `SELECT s.*, NULL as booking_id, NULL as booking_user_id, NULL as booking_status
       FROM booking_slots s
       WHERE s.field_id = $1 AND s.date = $2
       ORDER BY s.start_time`,
      [fieldId, date]
    );

    return this.mapSlotsWithBookings(newSlots.rows);
  }

  private generateSlots(field: Field): Array<{ start_time: string; end_time: string }> {
    const slots: Array<{ start_time: string; end_time: string }> = [];

    if (!field.working_hours_from || !field.working_hours_to) {
      return slots;
    }

    const startMinutes = this.timeToMinutes(field.working_hours_from);
    const endMinutes = this.timeToMinutes(field.working_hours_to);
    const duration = field.slot_duration || 60;

    let current = startMinutes;

    while (current + duration <= endMinutes) {
      slots.push({
        start_time: this.minutesToTime(current),
        end_time: this.minutesToTime(current + duration)
      });
      current += duration;
    }

    return slots;
  }

  private timeToMinutes(time: string): number {
    const [hours, minutes] = time.split(':').map(Number);
    return hours * 60 + (minutes || 0);
  }

  private minutesToTime(minutes: number): string {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return h.toString().padStart(2, '0') + ':' + m.toString().padStart(2, '0');
  }

  private mapSlotsWithBookings(rows: any[]): SlotWithBooking[] {
    return rows.map(row => ({
      id: row.id,
      field_id: row.field_id,
      date: typeof row.date === 'object' ? row.date.toISOString().split('T')[0] : row.date,
      start_time: row.start_time,
      end_time: row.end_time,
      is_blocked: row.is_blocked || false,
      block_reason: row.block_reason || null,
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
       AND (start_time < $4 AND end_time > $3)`,
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

  async blockSlot(slotId: string, reason?: string): Promise<BookingSlot | null> {
    // Проверяем нет ли pending брони
    const pendingBooking = await this.db.query(
      `SELECT id FROM bookings WHERE slot_id = $1 AND status = 'pending'`,
      [slotId]
    );

    if (pendingBooking.rows.length > 0) {
      throw new Error('Cannot block slot with pending booking');
    }

    const result = await this.db.query<BookingSlot>(
      `UPDATE booking_slots SET is_blocked = true, block_reason = $2
       WHERE id = $1 RETURNING *`,
      [slotId, reason ?? null]
    );
    return result.rows[0] || null;
  }

  async unblockSlot(slotId: string): Promise<BookingSlot | null> {
    const result = await this.db.query<BookingSlot>(
      `UPDATE booking_slots SET is_blocked = false, block_reason = NULL
       WHERE id = $1 RETURNING *`,
      [slotId]
    );
    return result.rows[0] || null;
  }

  // ==================== BOOKINGS ====================

  async getMyBookings(userId: string): Promise<BookingDetails[]> {
    const result = await this.db.query(
      `SELECT
         b.id as booking_id, b.slot_id, b.user_id, b.status as booking_status, b.comment as booking_comment, b.created_at as booking_created_at,
         s.field_id, s.date, s.start_time, s.end_time, s.is_blocked, s.block_reason, s.created_at as slot_created_at,
         f.id as field_id, f.campaign_id, f.name, f.sport_types, f.is_indoor, f.photos,
         f.price_per_hour, f.status as field_status, f.slot_duration, f.working_hours_from,
         f.working_hours_to, f.working_days, f.client_info, f.created_at as field_created_at
       FROM bookings b
       JOIN booking_slots s ON b.slot_id = s.id
       JOIN fields f ON s.field_id = f.id
       WHERE b.user_id = $1
       ORDER BY s.date DESC, s.start_time DESC`,
      [userId]
    );

    return this.mapBookingDetails(result.rows);
  }

  async getBookingsByCampaign(campaignId: string): Promise<BookingDetails[]> {
    const result = await this.db.query(
      `SELECT
         b.id as booking_id, b.slot_id, b.user_id, b.status as booking_status, b.comment as booking_comment, b.created_at as booking_created_at,
         s.field_id, s.date, s.start_time, s.end_time, s.is_blocked, s.block_reason, s.created_at as slot_created_at,
         f.id as field_id, f.campaign_id, f.name, f.sport_types, f.is_indoor, f.photos,
         f.price_per_hour, f.status as field_status, f.slot_duration, f.working_hours_from,
         f.working_hours_to, f.working_days, f.client_info, f.created_at as field_created_at,
         u.name as user_name, u.phone as user_phone, u.email as user_email
       FROM bookings b
       JOIN booking_slots s ON b.slot_id = s.id
       JOIN fields f ON s.field_id = f.id
       JOIN users u ON b.user_id = u.id
       WHERE f.campaign_id = $1
       ORDER BY s.date DESC, s.start_time DESC`,
      [campaignId]
    );

    return this.mapBookingDetails(result.rows);
  }

  private mapBookingDetails(rows: any[]): BookingDetails[] {
    return rows.map(row => ({
      id: row.booking_id,
      slot_id: row.slot_id,
      user_id: row.user_id,
      status: row.booking_status,
      comment: row.booking_comment || null,
      created_at: row.booking_created_at,
      user: row.user_name !== undefined ? {
        name: row.user_name || null,
        phone: row.user_phone || null,
        email: row.user_email || null,
      } : undefined,
      slot: {
        id: row.slot_id,
        field_id: row.field_id,
        date: typeof row.date === 'object' ? row.date.toISOString().split('T')[0] : row.date,
        start_time: row.start_time,
        end_time: row.end_time,
        is_blocked: row.is_blocked || false,
        block_reason: row.block_reason || null,
        created_at: row.slot_created_at
      },
      field: {
        id: row.field_id,
        campaign_id: row.campaign_id,
        name: row.name,
        sport_types: row.sport_types || [],
        is_indoor: row.is_indoor || false,
        photos: row.photos || [],
        price_per_hour: row.price_per_hour,
        status: row.field_status,
        slot_duration: row.slot_duration || 60,
        working_hours_from: row.working_hours_from,
        working_hours_to: row.working_hours_to,
        working_days: row.working_days || [],
        client_info: row.client_info,
        created_at: row.field_created_at || row.created_at
      }
    }));
  }

  async createBooking(slotId: string, userId: string, comment?: string): Promise<Booking> {
    // Проверяем что слот существует, не заблокирован и свободен
    const slot = await this.db.query(
      'SELECT id, is_blocked FROM booking_slots WHERE id = $1',
      [slotId]
    );

    if (slot.rows.length === 0) {
      throw new Error('Slot not found');
    }

    if (slot.rows[0].is_blocked) {
      throw new Error('Slot is blocked');
    }

    const existing = await this.db.query(
      'SELECT id FROM bookings WHERE slot_id = $1',
      [slotId]
    );

    if (existing.rows.length > 0) {
      throw new Error('Slot already booked');
    }

    const result = await this.db.query<Booking>(
      `INSERT INTO bookings (slot_id, user_id, status, comment)
       VALUES ($1, $2, 'pending', $3)
       RETURNING *`,
      [slotId, userId, comment ?? null]
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
      `UPDATE bookings SET status = 'cancelled_by_client'
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

  async getBookingDetailsById(bookingId: string, userId: string): Promise<BookingDetails | null> {
    const result = await this.db.query(
      `SELECT
         b.id as booking_id, b.slot_id, b.user_id, b.status as booking_status, b.comment as booking_comment, b.created_at as booking_created_at,
         s.field_id, s.date, s.start_time, s.end_time, s.is_blocked, s.block_reason, s.created_at as slot_created_at,
         f.id as field_id, f.campaign_id, f.name, f.sport_types, f.is_indoor, f.photos,
         f.price_per_hour, f.status as field_status, f.slot_duration, f.working_hours_from,
         f.working_hours_to, f.working_days, f.client_info, f.created_at as field_created_at
       FROM bookings b
       JOIN booking_slots s ON b.slot_id = s.id
       JOIN fields f ON s.field_id = f.id
       WHERE b.id = $1 AND b.user_id = $2`,
      [bookingId, userId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapBookingDetails(result.rows)[0];
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
