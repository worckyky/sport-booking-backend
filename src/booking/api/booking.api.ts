import { Pool, PoolClient } from 'pg';
import {
  Field,
  CreateFieldRequest,
  UpdateFieldRequest,
  BookingSlot,
  CreateSlotRequest,
  Booking,
  BookingStatus,
  SlotWithBooking,
  BookingDetails,
  FieldDaySchedule,
  FieldWorkingTimetable,
  DayOfWeek,
  CampaignStats,
  RevenueByDay,
  HeatmapCell,
} from '../model/booking.model';
import { toJsonbValue } from '../../utils/pg';
import { normalizePhone } from '../../utils/phone';

// Типы для классификации изменений
type FieldChangeType = 'COSMETIC' | 'BREAK_CHANGE' | 'SCHEDULE_CHANGE';

// Структурированная ошибка конфликта расписания
export interface ScheduleConflict {
  bookingId: string;
  date: string;
  startTime: string;
  endTime: string;
  clientName: string | null;
  clientPhone: string | null;
  status: string;
}

export class ScheduleConflictError extends Error {
  code = 'SCHEDULE_CONFLICT' as const;
  conflicts: ScheduleConflict[];

  constructor(message: string, conflicts: ScheduleConflict[]) {
    super(message);
    this.name = 'ScheduleConflictError';
    this.conflicts = conflicts;
  }
}

export interface PaginationParams {
  page?: number;
  limit?: number;
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

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

  // ==================== TRANSACTION HELPER ====================

  private async withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // ==================== CHANGE CLASSIFICATION ====================

  /**
   * Определяет тип изменения поля: COSMETIC | BREAK_CHANGE | SCHEDULE_CHANGE
   * Приоритет: SCHEDULE_CHANGE > BREAK_CHANGE > COSMETIC
   */
  private classifyFieldChanges(current: Field, data: UpdateFieldRequest): FieldChangeType {
    // slot_duration изменился → SCHEDULE_CHANGE
    if (data.slot_duration !== undefined && data.slot_duration !== current.slot_duration) {
      return 'SCHEDULE_CHANGE';
    }

    // working_timetable изменился — нужно детально сравнить
    if (data.working_timetable !== undefined) {
      const oldTT = current.working_timetable || {};
      const newTT = data.working_timetable || {};
      const days: DayOfWeek[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

      let onlyBreaksChanged = false;

      for (const day of days) {
        const oldDay = oldTT[day];
        const newDay = newTT[day];

        // День включён/выключен → SCHEDULE_CHANGE
        const oldEnabled = oldDay !== null && oldDay !== undefined;
        const newEnabled = newDay !== null && newDay !== undefined;
        if (oldEnabled !== newEnabled) return 'SCHEDULE_CHANGE';

        if (!oldEnabled || !newEnabled) continue;

        // Часы работы изменились → SCHEDULE_CHANGE
        if (oldDay!.from !== newDay!.from || oldDay!.to !== newDay!.to) {
          return 'SCHEDULE_CHANGE';
        }

        // Перерывы изменились
        const oldBreaks = JSON.stringify(oldDay!.breaks || []);
        const newBreaks = JSON.stringify(newDay!.breaks || []);
        if (oldBreaks !== newBreaks) {
          onlyBreaksChanged = true;
        }
      }

      if (onlyBreaksChanged) return 'BREAK_CHANGE';
    }

    return 'COSMETIC';
  }

  // ==================== SLOT MANAGEMENT ====================

  /**
   * Удаляет ВСЕ будущие свободные слоты (включая break-blocked).
   * Они перегенерируются лениво при следующем запросе.
   */
  private async deleteAllFutureFreeSlots(fieldId: string, client?: PoolClient): Promise<number> {
    const queryRunner = client || this.db;
    const result = await queryRunner.query(
      `DELETE FROM booking_slots
       WHERE field_id = $1
         AND date >= CURRENT_DATE
         AND id NOT IN (
           SELECT slot_id FROM bookings
           WHERE status IN ('pending', 'confirmed')
         )`,
      [fieldId]
    );
    return result.rowCount || 0;
  }

  /**
   * Синхронизирует блокировку слотов при изменении перерывов.
   * Старые break-слоты разблокируются, новые — блокируются.
   */
  private async syncBreakBlocks(
    fieldId: string,
    oldTimetable: FieldWorkingTimetable | null,
    newTimetable: FieldWorkingTimetable | null,
    client?: PoolClient
  ): Promise<void> {
    const queryRunner = client || this.db;
    const days: DayOfWeek[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    const dayNames: DayOfWeek[] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

    const oldTT = oldTimetable || {};
    const newTT = newTimetable || {};

    for (const day of days) {
      const oldDay = oldTT[day];
      const newDay = newTT[day];

      if (!oldDay && !newDay) continue;

      const oldBreaks = oldDay?.breaks || [];
      const newBreaks = newDay?.breaks || [];

      const oldBreaksStr = JSON.stringify(oldBreaks);
      const newBreaksStr = JSON.stringify(newBreaks);
      if (oldBreaksStr === newBreaksStr) continue;

      // Номер дня недели в JS (0=Sun, 1=Mon, ...)
      const dayIndex = dayNames.indexOf(day);

      // Разблокировать слоты в старых перерывах (которых нет в новых)
      for (const oldBrk of oldBreaks) {
        const stillExists = newBreaks.some(nb => nb.from === oldBrk.from && nb.to === oldBrk.to);
        if (stillExists) continue;

        await queryRunner.query(
          `UPDATE booking_slots
           SET is_blocked = false, block_reason = NULL
           WHERE field_id = $1
             AND date >= CURRENT_DATE
             AND EXTRACT(DOW FROM date) = $2
             AND start_time >= $3::time AND end_time <= $4::time
             AND is_blocked = true AND block_reason = 'break'`,
          [fieldId, dayIndex, oldBrk.from, oldBrk.to]
        );
      }

      // Заблокировать слоты в новых перерывах (которых не было в старых)
      for (const newBrk of newBreaks) {
        const alreadyExisted = oldBreaks.some(ob => ob.from === newBrk.from && ob.to === newBrk.to);
        if (alreadyExisted) continue;

        await queryRunner.query(
          `UPDATE booking_slots
           SET is_blocked = true, block_reason = 'break'
           WHERE field_id = $1
             AND date >= CURRENT_DATE
             AND EXTRACT(DOW FROM date) = $2
             AND start_time >= $3::time AND end_time <= $4::time
             AND is_blocked = false
             AND id NOT IN (
               SELECT slot_id FROM bookings WHERE status IN ('pending', 'confirmed')
             )`,
          [fieldId, dayIndex, newBrk.from, newBrk.to]
        );
      }
    }
  }

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

  private validateFieldTimetableAgainstCampaign(
    fieldTimetable: FieldWorkingTimetable,
    campaignTimetable: WorkingTimetable,
    slotDuration?: number
  ): void {
    const days: DayOfWeek[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

    for (const day of days) {
      const fieldDay = fieldTimetable[day];
      const campaignDay = campaignTimetable[day];

      if (!fieldDay) continue; // выходной у поля - OK
      if (!campaignDay) {
        throw new Error(`Поле не может работать в ${day}, когда площадка закрыта`);
      }

      if (fieldDay.from < campaignDay.from) {
        throw new Error(`Время начала работы поля (${fieldDay.from}) в ${day} не может быть раньше открытия площадки (${campaignDay.from})`);
      }
      if (fieldDay.to > campaignDay.to) {
        throw new Error(`Время окончания работы поля (${fieldDay.to}) в ${day} не может быть позже закрытия площадки (${campaignDay.to})`);
      }

      // Валидация перерывов (с проверкой grid alignment если slotDuration известен)
      if (fieldDay.breaks) {
        this.validateBreaks(fieldDay, slotDuration);
      }
    }
  }

  private validateBreaks(schedule: FieldDaySchedule, slotDuration?: number): void {
    const breaks = schedule.breaks || [];
    const workStart = this.timeToMinutes(schedule.from);
    const workEnd = this.timeToMinutes(schedule.to);

    for (const brk of breaks) {
      const brkStart = this.timeToMinutes(brk.from);
      const brkEnd = this.timeToMinutes(brk.to);

      if (brkStart >= brkEnd) {
        throw new Error(`Время начала перерыва (${brk.from}) должно быть раньше времени окончания (${brk.to})`);
      }
      if (brkStart < workStart || brkEnd > workEnd) {
        throw new Error(`Перерыв (${brk.from}-${brk.to}) должен быть в пределах рабочего времени (${schedule.from}-${schedule.to})`);
      }

      // Проверка grid alignment: перерыв должен совпадать с границами слотов
      if (slotDuration && slotDuration > 0) {
        const startOffset = (brkStart - workStart) % slotDuration;
        const endOffset = (brkEnd - workStart) % slotDuration;

        if (startOffset !== 0 || endOffset !== 0) {
          const nearestStart = startOffset !== 0
            ? this.minutesToTime(brkStart - startOffset)
            : brk.from;
          const nearestEnd = endOffset !== 0
            ? this.minutesToTime(brkEnd + (slotDuration - endOffset))
            : brk.to;
          throw new Error(
            `Перерыв ${brk.from}-${brk.to} не совпадает с сеткой слотов (шаг ${slotDuration} мин от ${schedule.from}). Ближайшие допустимые: ${nearestStart}-${nearestEnd}`
          );
        }
      }
    }

    // Проверка на пересечение перерывов между собой
    for (let i = 0; i < breaks.length; i++) {
      for (let j = i + 1; j < breaks.length; j++) {
        const a = { start: this.timeToMinutes(breaks[i].from), end: this.timeToMinutes(breaks[i].to) };
        const b = { start: this.timeToMinutes(breaks[j].from), end: this.timeToMinutes(breaks[j].to) };
        if (a.start < b.end && a.end > b.start) {
          throw new Error(`Перерывы не должны пересекаться: ${breaks[i].from}-${breaks[i].to} и ${breaks[j].from}-${breaks[j].to}`);
        }
      }
    }
  }

  private getDaySchedule(
    field: Field,
    date: Date,
    campaignTimetable?: WorkingTimetable | null
  ): FieldDaySchedule | null {
    const dayNames: DayOfWeek[] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const dayOfWeek = dayNames[date.getDay()];

    // 1. Приоритет: working_timetable поля
    if (field.working_timetable && dayOfWeek in field.working_timetable) {
      const schedule = field.working_timetable[dayOfWeek];
      return schedule ?? null; // null = выходной
    }

    // 2. Fallback: старые поля working_hours_from/to
    if (field.working_hours_from && field.working_hours_to) {
      const shortDayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
      const shortDay = shortDayNames[date.getDay()];
      if (field.working_days?.includes(shortDay)) {
        return { from: field.working_hours_from, to: field.working_hours_to };
      }
      return null; // выходной
    }

    // 3. Fallback: расписание кампании
    if (campaignTimetable && dayOfWeek in campaignTimetable) {
      const campaignDay = campaignTimetable[dayOfWeek];
      if (campaignDay) {
        return { from: campaignDay.from, to: campaignDay.to };
      }
    }

    return null; // нет расписания
  }

  // ==================== FIELDS ====================

  async getFieldsByCampaign(campaignId: string): Promise<Field[]> {
    const result = await this.db.query<Field>(
      'SELECT * FROM fields WHERE campaign_id = $1 AND deleted_at IS NULL ORDER BY created_at, id',
      [campaignId]
    );
    return result.rows;
  }

  async getFieldById(fieldId: string): Promise<Field | null> {
    const result = await this.db.query<Field>(
      'SELECT * FROM fields WHERE id = $1 AND deleted_at IS NULL',
      [fieldId]
    );
    return result.rows[0] || null;
  }

  async createField(data: CreateFieldRequest): Promise<Field> {
    // Валидация: время работы поля не может выходить за время работы площадки
    const campaignTimetable = await this.getCampaignWorkingTimetable(data.campaign_id);
    if (campaignTimetable) {
      // Валидация нового формата working_timetable (с проверкой grid alignment)
      if (data.working_timetable) {
        this.validateFieldTimetableAgainstCampaign(data.working_timetable, campaignTimetable, data.slot_duration || 60);
      }
      // Валидация legacy формата
      this.validateFieldWorkingHours(data.working_hours_from, data.working_hours_to, campaignTimetable);
    }

    const result = await this.db.query<Field>(
      `INSERT INTO fields (
        campaign_id, name, sport_types, is_indoor, photos, price_per_hour,
        slot_duration, working_hours_from, working_hours_to, working_days, working_timetable, client_info
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
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
        toJsonbValue(data.working_timetable ?? null),
        data.client_info ?? null
      ]
    );
    return result.rows[0];
  }

  /**
   * Проверяет, есть ли активные брони, которые не вписываются в новое расписание
   * Возвращает список конфликтующих бронирований
   */
  async getConflictingBookingsForScheduleChange(
    fieldId: string,
    newTimetable: FieldWorkingTimetable
  ): Promise<Array<{ bookingId: string; date: string; startTime: string; endTime: string; clientName: string | null }>> {
    const dayNames: DayOfWeek[] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

    // Получаем все будущие слоты с активными бронями
    const result = await this.db.query<{
      booking_id: string;
      date: Date;
      start_time: string;
      end_time: string;
      contact_name: string | null;
      user_name: string | null;
    }>(
      `SELECT b.id as booking_id, s.date, s.start_time, s.end_time,
              COALESCE(b.contact_name, u.name) as user_name, b.contact_name
       FROM bookings b
       JOIN booking_slots s ON b.slot_id = s.id
       LEFT JOIN users u ON b.user_id = u.id
       WHERE s.field_id = $1
         AND b.status IN ('pending', 'confirmed')
         AND s.date >= CURRENT_DATE
       ORDER BY s.date, s.start_time`,
      [fieldId]
    );

    const conflicts: Array<{ bookingId: string; date: string; startTime: string; endTime: string; clientName: string | null }> = [];

    for (const row of result.rows) {
      const date = typeof row.date === 'object' ? row.date : new Date(row.date);
      const dayOfWeek = dayNames[date.getDay()];
      const schedule = newTimetable[dayOfWeek];

      // Если в этот день выходной или слот не вписывается в рабочее время
      const slotStart = this.timeToMinutes(row.start_time);
      const slotEnd = this.timeToMinutes(row.end_time);

      let isConflict = false;

      if (!schedule) {
        // День стал выходным
        isConflict = true;
      } else {
        const workStart = this.timeToMinutes(schedule.from);
        const workEnd = this.timeToMinutes(schedule.to);

        // Слот выходит за рамки рабочего времени
        if (slotStart < workStart || slotEnd > workEnd) {
          isConflict = true;
        }

        // Слот попадает в перерыв
        if (!isConflict && schedule.breaks) {
          for (const brk of schedule.breaks) {
            const brkStart = this.timeToMinutes(brk.from);
            const brkEnd = this.timeToMinutes(brk.to);
            if (slotStart < brkEnd && slotEnd > brkStart) {
              isConflict = true;
              break;
            }
          }
        }
      }

      if (isConflict) {
        conflicts.push({
          bookingId: row.booking_id,
          date: date.toISOString().split('T')[0],
          startTime: row.start_time,
          endTime: row.end_time,
          clientName: row.user_name || row.contact_name || null,
        });
      }
    }

    return conflicts;
  }

  /**
   * Получает активные брони (pending/confirmed) для поля с будущими датами
   * Используется для предупреждения при отключении поля
   */
  async getActiveBookingsForField(
    fieldId: string
  ): Promise<Array<{
    id: string;
    date: string;
    startTime: string;
    endTime: string;
    status: BookingStatus;
    clientName: string | null;
    clientPhone: string | null;
  }>> {
    const result = await this.db.query<{
      id: string;
      date: Date;
      start_time: string;
      end_time: string;
      status: BookingStatus;
      contact_name: string | null;
      user_name: string | null;
      contact_phone: string | null;
      user_phone: string | null;
    }>(
      `SELECT b.id, s.date, s.start_time, s.end_time, b.status,
              b.contact_name, u.name as user_name,
              b.contact_phone, u.phone as user_phone
       FROM bookings b
       JOIN booking_slots s ON b.slot_id = s.id
       LEFT JOIN users u ON b.user_id = u.id
       WHERE s.field_id = $1
         AND b.status IN ('pending', 'confirmed')
         AND s.date >= CURRENT_DATE
       ORDER BY s.date, s.start_time`,
      [fieldId]
    );

    return result.rows.map(row => ({
      id: row.id,
      date: typeof row.date === 'object' ? row.date.toISOString().split('T')[0] : row.date,
      startTime: row.start_time,
      endTime: row.end_time,
      status: row.status,
      clientName: row.contact_name || row.user_name || null,
      clientPhone: row.contact_phone || row.user_phone || null,
    }));
  }

  /**
   * Удаляет свободные слоты, которые не вписываются в новое расписание
   */
  async deleteOrphanedSlots(fieldId: string, newTimetable: FieldWorkingTimetable): Promise<number> {
    const dayNames: DayOfWeek[] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

    // Получаем все будущие слоты без бронирований
    const result = await this.db.query<{ id: string; date: Date; start_time: string; end_time: string }>(
      `SELECT s.id, s.date, s.start_time, s.end_time
       FROM booking_slots s
       LEFT JOIN bookings b ON s.id = b.slot_id
         AND b.status NOT IN ('cancelled_by_client', 'cancelled_by_facility', 'cancelled_by_admin', 'rejected', 'expired')
       WHERE s.field_id = $1
         AND s.date >= CURRENT_DATE
         AND b.id IS NULL
         AND s.is_blocked = false`,
      [fieldId]
    );

    const toDelete: string[] = [];

    for (const row of result.rows) {
      const date = typeof row.date === 'object' ? row.date : new Date(row.date);
      const dayOfWeek = dayNames[date.getDay()];
      const schedule = newTimetable[dayOfWeek];

      const slotStart = this.timeToMinutes(row.start_time);
      const slotEnd = this.timeToMinutes(row.end_time);

      let shouldDelete = false;

      if (!schedule) {
        shouldDelete = true;
      } else {
        const workStart = this.timeToMinutes(schedule.from);
        const workEnd = this.timeToMinutes(schedule.to);

        if (slotStart < workStart || slotEnd > workEnd) {
          shouldDelete = true;
        }

        if (!shouldDelete && schedule.breaks) {
          for (const brk of schedule.breaks) {
            const brkStart = this.timeToMinutes(brk.from);
            const brkEnd = this.timeToMinutes(brk.to);
            if (slotStart < brkEnd && slotEnd > brkStart) {
              shouldDelete = true;
              break;
            }
          }
        }
      }

      if (shouldDelete) {
        toDelete.push(row.id);
      }
    }

    if (toDelete.length > 0) {
      await this.db.query(
        `DELETE FROM booking_slots WHERE id = ANY($1)`,
        [toDelete]
      );
    }

    return toDelete.length;
  }

  async updateField(fieldId: string, data: UpdateFieldRequest): Promise<Field | null> {
    const currentField = await this.getFieldById(fieldId);
    if (!currentField) {
      return null;
    }

    // 1. Валидация расписания против площадки
    const needsValidation = data.working_hours_from !== undefined ||
                            data.working_hours_to !== undefined ||
                            data.working_timetable !== undefined;

    if (needsValidation) {
      const campaignTimetable = await this.getCampaignWorkingTimetable(currentField.campaign_id);
      if (campaignTimetable) {
        if (data.working_timetable !== undefined && data.working_timetable !== null) {
          const effectiveSlotDuration = data.slot_duration || currentField.slot_duration || 60;
          this.validateFieldTimetableAgainstCampaign(data.working_timetable, campaignTimetable, effectiveSlotDuration);
        }
        const newFrom = data.working_hours_from !== undefined ? data.working_hours_from : currentField.working_hours_from;
        const newTo = data.working_hours_to !== undefined ? data.working_hours_to : currentField.working_hours_to;
        this.validateFieldWorkingHours(newFrom, newTo, campaignTimetable);
      }
    }

    // 2. Логика паузы поля
    let pendingToCancel: string[] = [];

    if (data.status === 'disabled' && currentField.status === 'active') {
      const bookings = await this.getActiveBookingsForField(fieldId);
      const confirmed = bookings.filter(b => b.status === 'confirmed');

      if (confirmed.length > 0) {
        throw new ScheduleConflictError(
          'Невозможно поставить на паузу: есть подтверждённые бронирования',
          confirmed.map(b => ({
            bookingId: b.id,
            date: b.date,
            startTime: b.startTime,
            endTime: b.endTime,
            clientName: b.clientName,
            clientPhone: b.clientPhone,
            status: b.status,
          }))
        );
      }

      pendingToCancel = bookings.filter(b => b.status === 'pending').map(b => b.id);
    }

    // 3. Классификация типа изменения
    const changeType = this.classifyFieldChanges(currentField, data);

    // 4. Проверка конфликтов в зависимости от типа изменения
    if (changeType === 'SCHEDULE_CHANGE') {
      // При изменении slot_duration — проверяем ВСЕ будущие брони
      // При изменении from/to/days — проверяем конфликты с новым расписанием
      const activeBookings = await this.getActiveBookingsForField(fieldId);

      if (data.slot_duration !== undefined && data.slot_duration !== currentField.slot_duration) {
        // Смена длительности — блок при любых будущих бронях
        if (activeBookings.length > 0) {
          throw new ScheduleConflictError(
            'Невозможно изменить длительность слотов: есть активные бронирования',
            activeBookings.map(b => ({
              bookingId: b.id,
              date: b.date,
              startTime: b.startTime,
              endTime: b.endTime,
              clientName: b.clientName,
              clientPhone: b.clientPhone,
              status: b.status,
            }))
          );
        }
      }

      // Проверяем конфликты с новым расписанием (дни/часы)
      if (data.working_timetable !== undefined && data.working_timetable !== null) {
        const conflicts = await this.getConflictingBookingsForScheduleChange(fieldId, data.working_timetable);
        if (conflicts.length > 0) {
          // Обогащаем данными о телефоне и статусе
          const enriched = await this.enrichConflictsWithDetails(conflicts, fieldId);
          throw new ScheduleConflictError(
            'Невозможно изменить расписание: есть бронирования, которые не вписываются',
            enriched
          );
        }
      }
    }

    if (changeType === 'BREAK_CHANGE') {
      // Проверяем только конфликты с новыми перерывами
      if (data.working_timetable !== undefined && data.working_timetable !== null) {
        const conflicts = await this.getConflictingBookingsForScheduleChange(fieldId, data.working_timetable);
        if (conflicts.length > 0) {
          const enriched = await this.enrichConflictsWithDetails(conflicts, fieldId);
          throw new ScheduleConflictError(
            'Невозможно изменить перерывы: есть бронирования в новом перерыве',
            enriched
          );
        }
      }
    }

    // 4. Формирование UPDATE запроса
    const sets: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (data.name !== undefined) { sets.push(`name = $${idx++}`); values.push(data.name); }
    if (data.sport_types !== undefined) { sets.push(`sport_types = $${idx++}`); values.push(data.sport_types); }
    if (data.is_indoor !== undefined) { sets.push(`is_indoor = $${idx++}`); values.push(data.is_indoor); }
    if (data.photos !== undefined) { sets.push(`photos = $${idx++}`); values.push(data.photos); }
    if (data.price_per_hour !== undefined) { sets.push(`price_per_hour = $${idx++}`); values.push(data.price_per_hour); }
    if (data.status !== undefined) { sets.push(`status = $${idx++}`); values.push(data.status); }
    if (data.slot_duration !== undefined) { sets.push(`slot_duration = $${idx++}`); values.push(data.slot_duration); }
    if (data.working_hours_from !== undefined) { sets.push(`working_hours_from = $${idx++}`); values.push(data.working_hours_from); }
    if (data.working_hours_to !== undefined) { sets.push(`working_hours_to = $${idx++}`); values.push(data.working_hours_to); }
    if (data.working_days !== undefined) { sets.push(`working_days = $${idx++}`); values.push(data.working_days); }
    if (data.working_timetable !== undefined) { sets.push(`working_timetable = $${idx++}`); values.push(toJsonbValue(data.working_timetable)); }
    if (data.client_info !== undefined) { sets.push(`client_info = $${idx++}`); values.push(data.client_info); }

    if (sets.length === 0) return this.getFieldById(fieldId);

    // 6. Выполнение в зависимости от типа изменения
    if (changeType === 'COSMETIC') {
      if (pendingToCancel.length > 0) {
        // Пауза поля — авто-отмена pending + UPDATE в транзакции
        return this.withTransaction(async (client) => {
          await client.query(
            `UPDATE bookings SET status = 'cancelled_by_facility' WHERE id = ANY($1)`,
            [pendingToCancel]
          );
          values.push(fieldId);
          const result = await client.query<Field>(
            `UPDATE fields SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
            values
          );
          return result.rows[0] || null;
        });
      }

      // Простой UPDATE без слотовой логики
      values.push(fieldId);
      const result = await this.db.query<Field>(
        `UPDATE fields SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
        values
      );
      return result.rows[0] || null;
    }

    if (changeType === 'SCHEDULE_CHANGE') {
      // UPDATE + удаление ВСЕХ будущих свободных слотов (в транзакции)
      return this.withTransaction(async (client) => {
        values.push(fieldId);
        const result = await client.query<Field>(
          `UPDATE fields SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
          values
        );
        const updatedField = result.rows[0] || null;

        if (updatedField) {
          await this.deleteAllFutureFreeSlots(fieldId, client);
        }

        return updatedField;
      });
    }

    // BREAK_CHANGE — UPDATE + sync break blocks (в транзакции)
    return this.withTransaction(async (client) => {
      values.push(fieldId);
      const result = await client.query<Field>(
        `UPDATE fields SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
        values
      );
      const updatedField = result.rows[0] || null;

      if (updatedField) {
        await this.syncBreakBlocks(
          fieldId,
          currentField.working_timetable,
          data.working_timetable || null,
          client
        );
      }

      return updatedField;
    });
  }

  /**
   * Обогащает конфликты данными о телефоне и статусе
   */
  private async enrichConflictsWithDetails(
    conflicts: Array<{ bookingId: string; date: string; startTime: string; endTime: string; clientName: string | null }>,
    fieldId: string
  ): Promise<ScheduleConflict[]> {
    const bookingIds = conflicts.map(c => c.bookingId);
    if (bookingIds.length === 0) return [];

    const result = await this.db.query<{
      id: string;
      status: string;
      contact_phone: string | null;
      user_phone: string | null;
    }>(
      `SELECT b.id, b.status, b.contact_phone, u.phone as user_phone
       FROM bookings b
       LEFT JOIN users u ON b.user_id = u.id
       WHERE b.id = ANY($1)`,
      [bookingIds]
    );

    const detailsMap = new Map(result.rows.map(r => [r.id, r]));

    return conflicts.map(c => {
      const details = detailsMap.get(c.bookingId);
      return {
        bookingId: c.bookingId,
        date: c.date,
        startTime: c.startTime,
        endTime: c.endTime,
        clientName: c.clientName,
        clientPhone: details?.contact_phone || details?.user_phone || null,
        status: details?.status || 'unknown',
      };
    });
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

    // Защита последнего поля для published/pending площадок
    const fieldInfo = await this.db.query<{ campaign_id: string }>(
      'SELECT campaign_id FROM fields WHERE id = $1 AND deleted_at IS NULL',
      [fieldId]
    );
    if (fieldInfo.rowCount === 0) return false;

    const campaignId = fieldInfo.rows[0].campaign_id;
    const campaignStatus = await this.db.query<{ status: string }>(
      'SELECT status FROM campaign_info WHERE id = $1',
      [campaignId]
    );

    if (campaignStatus.rows[0]?.status === 'published' || campaignStatus.rows[0]?.status === 'pending') {
      const fieldCount = await this.db.query<{ count: string }>(
        'SELECT COUNT(*)::text as count FROM fields WHERE campaign_id = $1 AND deleted_at IS NULL',
        [campaignId]
      );
      if (parseInt(fieldCount.rows[0]?.count || '0', 10) <= 1) {
        throw new Error('Cannot delete the last field of a published campaign');
      }
    }

    // Soft delete: set deleted_at instead of physical deletion
    // This preserves booking history for reporting
    const result = await this.db.query(
      'UPDATE fields SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL',
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

    // Проверяем диапазон дат
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const requestedDate = new Date(date);
    requestedDate.setHours(0, 0, 0, 0);
    const maxDate = new Date(today);
    maxDate.setDate(maxDate.getDate() + 14);

    const isPastDate = requestedDate < today;
    const isTooFarInFuture = requestedDate > maxDate;

    // Для прошлых дат — возвращаем только существующие слоты (история)
    // Для слишком далёкого будущего — пустой массив
    if (isTooFarInFuture) {
      return [];
    }

    // Проверяем существующие слоты
    const existingSlots = await this.db.query(
      `SELECT s.*, b.id as booking_id, b.user_id as booking_user_id, b.status as booking_status,
              COALESCE(b.contact_name, u.name) as user_name,
              COALESCE(b.contact_phone, u.phone) as user_phone
       FROM booking_slots s
       LEFT JOIN LATERAL (
         SELECT * FROM bookings
         WHERE slot_id = s.id
           AND status NOT IN ('cancelled_by_client', 'cancelled_by_facility', 'cancelled_by_admin', 'rejected', 'expired')
         ORDER BY created_at DESC LIMIT 1
       ) b ON true
       LEFT JOIN users u ON b.user_id = u.id
       WHERE s.field_id = $1 AND s.date = $2
       ORDER BY s.start_time`,
      [fieldId, date]
    );

    // Для прошлых дат — возвращаем только существующие (история)
    if (isPastDate) {
      return existingSlots.rows.length > 0
        ? this.mapSlotsWithBookings(existingSlots.rows)
        : [];
    }

    // Получаем расписание кампании для fallback
    const campaignTimetable = await this.getCampaignWorkingTimetable(field.campaign_id);

    // Получаем расписание на конкретный день (с учетом fallback логики)
    const daySchedule = this.getDaySchedule(field, requestedDate, campaignTimetable);

    if (!daySchedule) {
      // Выходной — возвращаем существующие (если seed создал)
      return existingSlots.rows.length > 0
        ? this.mapSlotsWithBookings(existingSlots.rows)
        : [];
    }

    // Генерируем полный набор слотов по расписанию
    const slots = this.generateSlotsFromSchedule(daySchedule, field.slot_duration || 60);

    if (slots.length === 0) {
      return existingSlots.rows.length > 0
        ? this.mapSlotsWithBookings(existingSlots.rows)
        : [];
    }

    // INSERT missing slots (ON CONFLICT DO NOTHING — не трогаем существующие)
    const placeholders: string[] = [];
    const values: (string | boolean | null)[] = [];

    slots.forEach((slot, i) => {
      const offset = i * 6;
      placeholders.push(
        `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6})`
      );
      values.push(fieldId, date, slot.start_time, slot.end_time, slot.is_blocked, slot.block_reason);
    });

    await this.db.query(
      `INSERT INTO booking_slots (field_id, date, start_time, end_time, is_blocked, block_reason)
       VALUES ${placeholders.join(', ')}
       ON CONFLICT (field_id, date, start_time) DO NOTHING`,
      values
    );

    // Возвращаем полный набор слотов (старые + новые)
    const allSlots = await this.db.query(
      `SELECT s.*, b.id as booking_id, b.user_id as booking_user_id, b.status as booking_status,
              COALESCE(b.contact_name, u.name) as user_name,
              COALESCE(b.contact_phone, u.phone) as user_phone
       FROM booking_slots s
       LEFT JOIN LATERAL (
         SELECT * FROM bookings
         WHERE slot_id = s.id
           AND status NOT IN ('cancelled_by_client', 'cancelled_by_facility', 'cancelled_by_admin', 'rejected', 'expired')
         ORDER BY created_at DESC LIMIT 1
       ) b ON true
       LEFT JOIN users u ON b.user_id = u.id
       WHERE s.field_id = $1 AND s.date = $2
       ORDER BY s.start_time`,
      [fieldId, date]
    );

    return this.mapSlotsWithBookings(allSlots.rows);
  }

  /**
   * Генерация слотов по фиксированной сетке.
   * Слоты всегда идут от `from` с шагом `slotDuration`.
   * Перерывы НЕ сдвигают сетку — слоты в перерыве помечаются как заблокированные.
   */
  private generateSlotsFromSchedule(
    schedule: FieldDaySchedule,
    slotDuration: number
  ): Array<{ start_time: string; end_time: string; is_blocked: boolean; block_reason: string | null }> {
    const slots: Array<{ start_time: string; end_time: string; is_blocked: boolean; block_reason: string | null }> = [];

    const startMinutes = this.timeToMinutes(schedule.from);
    const endMinutes = this.timeToMinutes(schedule.to);
    const sortedBreaks = (schedule.breaks || [])
      .map(b => ({ start: this.timeToMinutes(b.from), end: this.timeToMinutes(b.to) }))
      .sort((a, b) => a.start - b.start);

    // Фиксированная сетка: ровный шаг от начала, без прыжков
    for (let current = startMinutes; current + slotDuration <= endMinutes; current += slotDuration) {
      const slotEnd = current + slotDuration;

      // Проверяем пересечение с любым перерывом
      const overlapsBreak = sortedBreaks.some(b => current < b.end && slotEnd > b.start);

      slots.push({
        start_time: this.minutesToTime(current),
        end_time: this.minutesToTime(slotEnd),
        is_blocked: overlapsBreak,
        block_reason: overlapsBreak ? 'break' : null,
      });
    }

    return slots;
  }

  // DEPRECATED: legacy метод для обратной совместимости
  private generateSlots(field: Field): Array<{ start_time: string; end_time: string; is_blocked: boolean; block_reason: string | null }> {
    if (!field.working_hours_from || !field.working_hours_to) {
      return [];
    }

    return this.generateSlotsFromSchedule(
      { from: field.working_hours_from, to: field.working_hours_to },
      field.slot_duration || 60
    );
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
        status: row.booking_status,
        user_name: row.user_name || null,
        user_phone: row.user_phone || null,
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

  /**
   * Auto-complete: обновляет статус confirmed → completed для прошедших бронирований
   * Вызывается автоматически при запросе списка бронирований
   * Использует таймзону площадки для корректного сравнения времени
   */
  private async autoCompleteBookings(): Promise<void> {
    await this.db.query(
      `UPDATE bookings b
       SET status = 'completed'
       FROM booking_slots s
       JOIN fields f ON s.field_id = f.id
       JOIN campaign_info c ON f.campaign_id = c.id
       WHERE b.slot_id = s.id
         AND b.status = 'confirmed'
         AND (
           s.date < (CURRENT_TIMESTAMP AT TIME ZONE c.timezone_id)::date
           OR (
             s.date = (CURRENT_TIMESTAMP AT TIME ZONE c.timezone_id)::date
             AND s.end_time < (CURRENT_TIMESTAMP AT TIME ZONE c.timezone_id)::time
           )
         )`
    );
  }

  /**
   * Auto-expire: обновляет статус pending → expired для просроченных заявок
   * (владелец не ответил до начала слота)
   * Использует таймзону площадки для корректного сравнения времени
   */
  private async autoExpireBookings(): Promise<void> {
    await this.db.query(
      `UPDATE bookings b
       SET status = 'expired'
       FROM booking_slots s
       JOIN fields f ON s.field_id = f.id
       JOIN campaign_info c ON f.campaign_id = c.id
       WHERE b.slot_id = s.id
         AND b.status = 'pending'
         AND (
           s.date < (CURRENT_TIMESTAMP AT TIME ZONE c.timezone_id)::date
           OR (
             s.date = (CURRENT_TIMESTAMP AT TIME ZONE c.timezone_id)::date
             AND s.start_time < (CURRENT_TIMESTAMP AT TIME ZONE c.timezone_id)::time
           )
         )`
    );
  }

  /**
   * Запускает все авто-обновления статусов
   */
  private async runAutoStatusUpdates(): Promise<void> {
    await Promise.all([
      this.autoCompleteBookings(),
      this.autoExpireBookings(),
    ]);
  }

  async getMyBookings(userId: string): Promise<BookingDetails[]> {
    // Auto-complete прошедших confirmed бронирований
    await this.runAutoStatusUpdates();
    const result = await this.db.query(
      `SELECT
         b.id as booking_id, b.slot_id, b.user_id, b.status as booking_status, b.comment as booking_comment, b.created_at as booking_created_at,
         s.field_id, s.date, s.start_time, s.end_time, s.is_blocked, s.block_reason, s.created_at as slot_created_at,
         f.id as field_id, f.campaign_id, f.name, f.sport_types, f.is_indoor, f.photos,
         f.price_per_hour, f.status as field_status, f.slot_duration, f.working_hours_from,
         f.working_hours_to, f.working_days, f.working_timetable, f.client_info, f.created_at as field_created_at,
         c.timezone_id as campaign_timezone_id
       FROM bookings b
       JOIN booking_slots s ON b.slot_id = s.id
       JOIN fields f ON s.field_id = f.id
       JOIN campaign_info c ON f.campaign_id = c.id
       WHERE b.user_id = $1
       ORDER BY s.date DESC, s.start_time DESC`,
      [userId]
    );

    return this.mapBookingDetails(result.rows);
  }

  async getBookingsByCampaign(
    campaignId: string,
    pagination?: PaginationParams
  ): Promise<PaginatedResult<BookingDetails>> {
    // Auto-complete прошедших confirmed бронирований
    await this.runAutoStatusUpdates();

    const page = pagination?.page || 1;
    const limit = Math.min(Math.max(pagination?.limit || 50, 1), 100);
    const offset = (page - 1) * limit;

    // Get total count
    const countResult = await this.db.query(
      `SELECT COUNT(*) as total
       FROM bookings b
       JOIN booking_slots s ON b.slot_id = s.id
       JOIN fields f ON s.field_id = f.id
       WHERE f.campaign_id = $1`,
      [campaignId]
    );
    const total = parseInt(countResult.rows[0].total, 10);

    const result = await this.db.query(
      `SELECT
         b.id as booking_id, b.slot_id, b.user_id, b.status as booking_status, b.comment as booking_comment,
         b.contact_name, b.contact_phone, b.created_at as booking_created_at,
         s.field_id, s.date, s.start_time, s.end_time, s.is_blocked, s.block_reason, s.created_at as slot_created_at,
         f.id as field_id, f.campaign_id, f.name, f.sport_types, f.is_indoor, f.photos,
         f.price_per_hour, f.status as field_status, f.slot_duration, f.working_hours_from,
         f.working_hours_to, f.working_days, f.working_timetable, f.client_info, f.created_at as field_created_at,
         COALESCE(b.contact_name, u.name) as user_name,
         COALESCE(b.contact_phone, u.phone) as user_phone,
         u.email as user_email
       FROM bookings b
       JOIN booking_slots s ON b.slot_id = s.id
       JOIN fields f ON s.field_id = f.id
       LEFT JOIN users u ON b.user_id = u.id
       WHERE f.campaign_id = $1
       ORDER BY s.date DESC, s.start_time DESC
       LIMIT $2 OFFSET $3`,
      [campaignId, limit, offset]
    );

    return {
      data: this.mapBookingDetails(result.rows),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  private mapBookingDetails(rows: any[]): BookingDetails[] {
    return rows.map(row => ({
      id: row.booking_id,
      slot_id: row.slot_id,
      user_id: row.user_id,
      status: row.booking_status,
      comment: row.booking_comment || null,
      contact_name: row.contact_name || null,
      contact_phone: row.contact_phone || null,
      created_at: row.booking_created_at,
      campaign_timezone_id: row.campaign_timezone_id || 'Europe/Moscow',
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
        working_timetable: row.working_timetable || null,
        client_info: row.client_info,
        created_at: row.field_created_at || row.created_at,
        deleted_at: row.field_deleted_at || null
      }
    }));
  }

  async createBooking(
    slotId: string,
    userId: string | null,
    comment?: string,
    contactName?: string,
    contactPhone?: string
  ): Promise<Booking> {
    // Нормализуем телефон до транзакции (чистая функция)
    const normalizedPhone = normalizePhone(contactPhone);
    if (!userId && !normalizedPhone) {
      throw new Error('Contact phone is required for guest bookings');
    }

    return this.withTransaction(async (client) => {
      // Проверяем что слот существует, не заблокирован и свободен
      const slotQuery = await client.query(
        `SELECT s.id, s.is_blocked, f.name as field_name, f.price_per_hour, f.sport_types,
                c.status as campaign_status
         FROM booking_slots s
         JOIN fields f ON s.field_id = f.id
         JOIN campaign_info c ON f.campaign_id = c.id
         WHERE s.id = $1`,
        [slotId]
      );

      if (slotQuery.rows.length === 0) {
        throw new Error('Slot not found');
      }

      const slot = slotQuery.rows[0];

      if (slot.is_blocked) {
        throw new Error('Slot is blocked');
      }

      if (slot.campaign_status !== 'published') {
        throw new Error('Campaign is not available');
      }

      const existing = await client.query(
        `SELECT id FROM bookings WHERE slot_id = $1
         AND status NOT IN ('cancelled_by_client', 'cancelled_by_facility', 'cancelled_by_admin', 'rejected', 'expired')`,
        [slotId]
      );

      if (existing.rows.length > 0) {
        throw new Error('Slot already booked');
      }

      // Денормализуем данные поля для статистики
      const fieldName = slot.field_name;
      const fieldPrice = slot.price_per_hour;
      const sportType = slot.sport_types?.[0] || null;

      const result = await client.query<Booking>(
        `INSERT INTO bookings (slot_id, user_id, status, comment, contact_name, contact_phone, field_name, field_price, sport_type)
         VALUES ($1, $2, 'pending', $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [slotId, userId, comment ?? null, contactName ?? null, normalizedPhone, fieldName, fieldPrice, sportType]
      );
      return result.rows[0];
    });
  }

  /**
   * Создание брони администратором (владельцем площадки)
   * Бронь создаётся сразу со статусом confirmed
   * user_id = NULL (клиент не в системе)
   */
  async createAdminBooking(
    slotId: string,
    contactName: string | undefined,
    contactPhone: string,
    comment?: string
  ): Promise<Booking> {
    // Нормализуем телефон до транзакции (чистая функция)
    const normalizedPhone = normalizePhone(contactPhone);
    if (!normalizedPhone) {
      throw new Error('Contact phone is required');
    }

    return this.withTransaction(async (client) => {
      // Проверяем что слот существует, не заблокирован и свободен
      const slotQuery = await client.query(
        `SELECT s.id, s.is_blocked, f.name as field_name, f.price_per_hour, f.sport_types,
                c.status as campaign_status
         FROM booking_slots s
         JOIN fields f ON s.field_id = f.id
         JOIN campaign_info c ON f.campaign_id = c.id
         WHERE s.id = $1`,
        [slotId]
      );

      if (slotQuery.rows.length === 0) {
        throw new Error('Slot not found');
      }

      const slot = slotQuery.rows[0];

      if (slot.is_blocked) {
        throw new Error('Slot is blocked');
      }

      if (slot.campaign_status !== 'published') {
        throw new Error('Campaign is not available');
      }

      const existing = await client.query(
        `SELECT id FROM bookings WHERE slot_id = $1
         AND status NOT IN ('cancelled_by_client', 'cancelled_by_facility', 'cancelled_by_admin', 'rejected', 'expired')`,
        [slotId]
      );

      if (existing.rows.length > 0) {
        throw new Error('Slot already booked');
      }

      // Денормализуем данные поля
      const fieldName = slot.field_name;
      const fieldPrice = slot.price_per_hour;
      const sportType = slot.sport_types?.[0] || null;

      const result = await client.query<Booking>(
        `INSERT INTO bookings (slot_id, user_id, status, comment, contact_name, contact_phone, field_name, field_price, sport_type)
         VALUES ($1, NULL, 'confirmed', $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [slotId, comment ?? null, contactName ?? null, normalizedPhone, fieldName, fieldPrice, sportType]
      );
      return result.rows[0];
    });
  }

  /**
   * Матрица валидных переходов между статусами
   * Ключ - текущий статус, значение - массив допустимых целевых статусов
   */
  private static readonly STATUS_TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
    pending: ['confirmed', 'rejected', 'expired', 'cancelled_by_client', 'cancelled_by_admin'],
    confirmed: ['completed', 'cancelled_by_client', 'cancelled_by_facility', 'cancelled_by_admin', 'no_show'],
    completed: ['no_show', 'cancelled_by_admin'],
    no_show: ['cancelled_by_admin'],
    rejected: ['cancelled_by_admin'],
    expired: ['cancelled_by_admin'],
    cancelled_by_client: ['cancelled_by_admin'],
    cancelled_by_facility: ['cancelled_by_admin'],
    cancelled_by_admin: [],
  };

  /**
   * Переходы, требующие проверки времени слота
   */
  private static readonly TIME_RESTRICTED_TRANSITIONS: Record<string, 'before_start' | 'after_start'> = {
    'pending->confirmed': 'before_start',
    'pending->rejected': 'before_start',
    'pending->cancelled_by_client': 'before_start',
    'confirmed->cancelled_by_client': 'before_start',
    'confirmed->cancelled_by_facility': 'before_start',
    'confirmed->no_show': 'after_start',
    'completed->no_show': 'after_start',
  };

  async updateBookingStatus(bookingId: string, newStatus: BookingStatus): Promise<Booking | null> {
    // Получаем текущее бронирование с данными слота и таймзоной площадки
    const bookingWithSlot = await this.db.query<{
      booking_status: BookingStatus;
      slot_date: string;
      start_time: string;
      end_time: string;
      timezone_id: string;
    }>(
      `SELECT b.status as booking_status, s.date as slot_date, s.start_time, s.end_time, c.timezone_id
       FROM bookings b
       JOIN booking_slots s ON b.slot_id = s.id
       JOIN fields f ON s.field_id = f.id
       JOIN campaign_info c ON f.campaign_id = c.id
       WHERE b.id = $1`,
      [bookingId]
    );

    if (bookingWithSlot.rows.length === 0) {
      return null;
    }

    const { booking_status: currentStatus, slot_date, start_time, timezone_id } = bookingWithSlot.rows[0];

    // Проверяем валидность перехода
    const allowedTransitions = BookingAPI.STATUS_TRANSITIONS[currentStatus];
    if (!allowedTransitions.includes(newStatus)) {
      throw new Error(`Invalid status transition: ${currentStatus} -> ${newStatus}`);
    }

    // Проверяем временные ограничения
    const transitionKey = `${currentStatus}->${newStatus}`;
    const timeRestriction = BookingAPI.TIME_RESTRICTED_TRANSITIONS[transitionKey];

    if (timeRestriction) {
      // Проверяем через SQL с использованием таймзоны площадки
      const timeCheckResult = await this.db.query<{ slot_started: boolean }>(
        `SELECT (
          $1::date < (CURRENT_TIMESTAMP AT TIME ZONE $3)::date
          OR (
            $1::date = (CURRENT_TIMESTAMP AT TIME ZONE $3)::date
            AND $2::time < (CURRENT_TIMESTAMP AT TIME ZONE $3)::time
          )
        ) as slot_started`,
        [slot_date, start_time, timezone_id]
      );
      const slotStarted = timeCheckResult.rows[0]?.slot_started ?? false;

      if (timeRestriction === 'before_start' && slotStarted) {
        throw new Error(`Transition ${currentStatus} -> ${newStatus} is only allowed before slot starts`);
      }
      if (timeRestriction === 'after_start' && !slotStarted) {
        throw new Error(`Transition ${currentStatus} -> ${newStatus} is only allowed after slot starts`);
      }
    }

    // Выполняем обновление
    const result = await this.db.query<Booking>(
      'UPDATE bookings SET status = $1 WHERE id = $2 RETURNING *',
      [newStatus, bookingId]
    );
    return result.rows[0] || null;
  }

  /**
   * Массовое обновление статусов бронирований (только для ADMIN)
   * Возвращает количество успешно обновлённых записей
   */
  async bulkUpdateBookingStatus(
    bookingIds: string[],
    newStatus: BookingStatus
  ): Promise<{ updated: number; failed: string[] }> {
    const updated: string[] = [];
    const failed: string[] = [];

    for (const bookingId of bookingIds) {
      try {
        const result = await this.updateBookingStatus(bookingId, newStatus);
        if (result) {
          updated.push(bookingId);
        } else {
          failed.push(bookingId);
        }
      } catch {
        failed.push(bookingId);
      }
    }

    return { updated: updated.length, failed };
  }

  async cancelBooking(bookingId: string, userId: string): Promise<boolean> {
    // Клиент может отменить только до начала слота
    // Используем таймзону площадки для корректного сравнения времени
    const result = await this.db.query(
      `UPDATE bookings b
       SET status = 'cancelled_by_client'
       FROM booking_slots s
       JOIN fields f ON s.field_id = f.id
       JOIN campaign_info c ON f.campaign_id = c.id
       WHERE b.id = $1
         AND b.user_id = $2
         AND b.slot_id = s.id
         AND b.status IN ('pending', 'confirmed')
         AND (
           s.date > (CURRENT_TIMESTAMP AT TIME ZONE c.timezone_id)::date
           OR (
             s.date = (CURRENT_TIMESTAMP AT TIME ZONE c.timezone_id)::date
             AND s.start_time > (CURRENT_TIMESTAMP AT TIME ZONE c.timezone_id)::time
           )
         )
       RETURNING b.id`,
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
    // Auto-complete если это прошедшее confirmed бронирование
    await this.runAutoStatusUpdates();

    const result = await this.db.query(
      `SELECT
         b.id as booking_id, b.slot_id, b.user_id, b.status as booking_status, b.comment as booking_comment, b.created_at as booking_created_at,
         s.field_id, s.date, s.start_time, s.end_time, s.is_blocked, s.block_reason, s.created_at as slot_created_at,
         f.id as field_id, f.campaign_id, f.name, f.sport_types, f.is_indoor, f.photos,
         f.price_per_hour, f.status as field_status, f.slot_duration, f.working_hours_from,
         f.working_hours_to, f.working_days, f.working_timetable, f.client_info, f.created_at as field_created_at,
         c.timezone_id as campaign_timezone_id
       FROM bookings b
       JOIN booking_slots s ON b.slot_id = s.id
       JOIN fields f ON s.field_id = f.id
       JOIN campaign_info c ON f.campaign_id = c.id
       WHERE b.id = $1 AND b.user_id = $2`,
      [bookingId, userId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapBookingDetails(result.rows)[0];
  }

  // ==================== RESCHEDULE ====================

  async rescheduleBooking(
    bookingId: string,
    newSlotId: string,
    rescheduledBy: string,
    reason?: string
  ): Promise<Booking | null> {
    // 1. Загружаем текущую бронь с данными слота, поля и таймзоной
    const bookingQuery = await this.db.query<{
      booking_id: string;
      booking_status: string;
      old_slot_id: string;
      slot_date: string;
      start_time: string;
      old_field_name: string;
      old_campaign_id: string;
      timezone_id: string;
    }>(
      `SELECT b.id as booking_id, b.status as booking_status, b.slot_id as old_slot_id,
              s.date as slot_date, s.start_time,
              f.name as old_field_name, f.campaign_id as old_campaign_id,
              c.timezone_id
       FROM bookings b
       JOIN booking_slots s ON b.slot_id = s.id
       JOIN fields f ON s.field_id = f.id
       JOIN campaign_info c ON f.campaign_id = c.id
       WHERE b.id = $1`,
      [bookingId]
    );

    if (bookingQuery.rows.length === 0) {
      return null;
    }

    const booking = bookingQuery.rows[0];

    // 2. Проверяем статус — только pending или confirmed
    if (!['pending', 'confirmed'].includes(booking.booking_status)) {
      throw new Error(`Cannot reschedule booking with status "${booking.booking_status}"`);
    }

    // 3. Проверяем что текущий слот не начался (timezone-aware)
    const timeCheck = await this.db.query<{ slot_started: boolean }>(
      `SELECT (
        $1::date < (CURRENT_TIMESTAMP AT TIME ZONE $3)::date
        OR (
          $1::date = (CURRENT_TIMESTAMP AT TIME ZONE $3)::date
          AND $2::time < (CURRENT_TIMESTAMP AT TIME ZONE $3)::time
        )
      ) as slot_started`,
      [booking.slot_date, booking.start_time, booking.timezone_id]
    );

    if (timeCheck.rows[0]?.slot_started) {
      throw new Error('Cannot reschedule past bookings');
    }

    // 4. Загружаем новый слот с данными поля
    const newSlotQuery = await this.db.query<{
      slot_id: string;
      slot_date: string;
      start_time: string;
      is_blocked: boolean;
      block_reason: string | null;
      field_name: string;
      field_price: number;
      sport_types: string[];
      new_campaign_id: string;
    }>(
      `SELECT s.id as slot_id, s.date as slot_date, s.start_time, s.is_blocked, s.block_reason,
              f.name as field_name, f.price_per_hour as field_price, f.sport_types,
              f.campaign_id as new_campaign_id
       FROM booking_slots s
       JOIN fields f ON s.field_id = f.id
       WHERE s.id = $1`,
      [newSlotId]
    );

    if (newSlotQuery.rows.length === 0) {
      throw new Error('New slot not found');
    }

    const newSlot = newSlotQuery.rows[0];

    // 5. Проверяем та же площадка
    if (newSlot.new_campaign_id !== booking.old_campaign_id) {
      throw new Error('Cannot reschedule to slot from different campaign');
    }

    // 6. Проверяем не заблокирован
    if (newSlot.is_blocked) {
      throw new Error(`New slot is blocked${newSlot.block_reason ? ': ' + newSlot.block_reason : ''}`);
    }

    // 7. Проверяем новый слот в будущем
    const newTimeCheck = await this.db.query<{ slot_started: boolean }>(
      `SELECT (
        $1::date < (CURRENT_TIMESTAMP AT TIME ZONE $3)::date
        OR (
          $1::date = (CURRENT_TIMESTAMP AT TIME ZONE $3)::date
          AND $2::time < (CURRENT_TIMESTAMP AT TIME ZONE $3)::time
        )
      ) as slot_started`,
      [newSlot.slot_date, newSlot.start_time, booking.timezone_id]
    );

    if (newTimeCheck.rows[0]?.slot_started) {
      throw new Error('Cannot reschedule to past slot');
    }

    // 8. Транзакция: проверка + запись истории + обновление брони
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');

      // Проверяем что новый слот свободен (нет активной брони) С БЛОКИРОВКОЙ СТРОКИ
      const existingBooking = await client.query(
        `SELECT id FROM bookings
         WHERE slot_id = $1
         AND status NOT IN ('cancelled_by_client', 'cancelled_by_facility', 'cancelled_by_admin', 'rejected', 'expired')
         FOR UPDATE`,
        [newSlotId]
      );

      if (existingBooking.rows.length > 0) {
        throw new Error('New slot is already booked');
      }

      // Запись в историю
      await client.query(
        `INSERT INTO booking_reschedules (booking_id, old_slot_id, new_slot_id, old_field_name, new_field_name, rescheduled_by, reason)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [bookingId, booking.old_slot_id, newSlotId, booking.old_field_name, newSlot.field_name, rescheduledBy, reason ?? null]
      );

      // Обновляем бронь: slot_id + денормализованные поля
      const result = await client.query<Booking>(
        `UPDATE bookings
         SET slot_id = $1, field_name = $2, field_price = $3, sport_type = $4
         WHERE id = $5
         RETURNING *`,
        [newSlotId, newSlot.field_name, newSlot.field_price, newSlot.sport_types?.[0] || null, bookingId]
      );

      await client.query('COMMIT');
      return result.rows[0] || null;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getBookingRescheduleHistory(bookingId: string): Promise<Array<{
    id: string;
    old_field_name: string;
    new_field_name: string;
    old_date: string;
    old_start_time: string;
    new_date: string;
    new_start_time: string;
    rescheduled_by_name: string | null;
    reason: string | null;
    created_at: string;
  }>> {
    const result = await this.db.query(
      `SELECT
         r.id, r.old_field_name, r.new_field_name, r.reason, r.created_at,
         os.date as old_date, os.start_time as old_start_time,
         ns.date as new_date, ns.start_time as new_start_time,
         u.name as rescheduled_by_name
       FROM booking_reschedules r
       JOIN booking_slots os ON r.old_slot_id = os.id
       JOIN booking_slots ns ON r.new_slot_id = ns.id
       LEFT JOIN users u ON r.rescheduled_by = u.id
       WHERE r.booking_id = $1
       ORDER BY r.created_at ASC`,
      [bookingId]
    );

    return result.rows.map(row => ({
      id: row.id,
      old_field_name: row.old_field_name,
      new_field_name: row.new_field_name,
      old_date: row.old_date instanceof Date ? row.old_date.toISOString().split('T')[0] : row.old_date,
      old_start_time: row.old_start_time,
      new_date: row.new_date instanceof Date ? row.new_date.toISOString().split('T')[0] : row.new_date,
      new_start_time: row.new_start_time,
      rescheduled_by_name: row.rescheduled_by_name,
      reason: row.reason,
      created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    }));
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

  /**
   * Получить все брони на платформе (только для ADMIN)
   */
  async getAllBookings(pagination?: PaginationParams): Promise<PaginatedResult<BookingDetails>> {
    // Auto-complete прошедших confirmed бронирований
    await this.runAutoStatusUpdates();

    const page = pagination?.page || 1;
    const limit = Math.min(Math.max(pagination?.limit || 50, 1), 100);
    const offset = (page - 1) * limit;

    // Get total count
    const countResult = await this.db.query(
      `SELECT COUNT(*) as total FROM bookings`
    );
    const total = parseInt(countResult.rows[0].total, 10);

    const result = await this.db.query(
      `SELECT
         b.id as booking_id, b.slot_id, b.user_id, b.status as booking_status, b.comment as booking_comment,
         b.contact_name, b.contact_phone, b.created_at as booking_created_at,
         s.field_id, s.date, s.start_time, s.end_time, s.is_blocked, s.block_reason, s.created_at as slot_created_at,
         f.id as field_id, f.campaign_id, f.name, f.sport_types, f.is_indoor, f.photos,
         f.price_per_hour, f.status as field_status, f.slot_duration, f.working_hours_from,
         f.working_hours_to, f.working_days, f.working_timetable, f.client_info, f.created_at as field_created_at,
         c.name as campaign_name,
         c.timezone_id as campaign_timezone_id,
         COALESCE(b.contact_name, u.name) as user_name,
         COALESCE(b.contact_phone, u.phone) as user_phone,
         u.email as user_email
       FROM bookings b
       JOIN booking_slots s ON b.slot_id = s.id
       JOIN fields f ON s.field_id = f.id
       JOIN campaign_info c ON f.campaign_id = c.id
       LEFT JOIN users u ON b.user_id = u.id
       ORDER BY b.created_at DESC, b.id DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    return {
      data: this.mapBookingDetailsWithCampaign(result.rows),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  private mapBookingDetailsWithCampaign(rows: any[]): BookingDetails[] {
    return rows.map(row => ({
      id: row.booking_id,
      slot_id: row.slot_id,
      user_id: row.user_id,
      status: row.booking_status,
      comment: row.booking_comment || null,
      contact_name: row.contact_name || null,
      contact_phone: row.contact_phone || null,
      created_at: row.booking_created_at,
      campaign_timezone_id: row.campaign_timezone_id || 'Europe/Moscow',
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
        working_timetable: row.working_timetable || null,
        client_info: row.client_info,
        created_at: row.field_created_at || row.created_at,
        deleted_at: row.field_deleted_at || null
      },
      campaign_name: row.campaign_name || null,
    }));
  }

  // ==================== ADMIN BOOKING BY ID ====================

  async getBookingByIdAdmin(bookingId: string): Promise<BookingDetails | null> {
    const result = await this.db.query(
      `SELECT
         b.id as booking_id, b.slot_id, b.user_id, b.status as booking_status, b.comment as booking_comment,
         b.contact_name, b.contact_phone, b.created_at as booking_created_at,
         s.field_id, s.date, s.start_time, s.end_time, s.is_blocked, s.block_reason, s.created_at as slot_created_at,
         f.id as field_id, f.campaign_id, f.name, f.sport_types, f.is_indoor, f.photos,
         f.price_per_hour, f.status as field_status, f.slot_duration, f.working_hours_from,
         f.working_hours_to, f.working_days, f.working_timetable, f.client_info, f.created_at as field_created_at,
         c.name as campaign_name,
         c.timezone_id as campaign_timezone_id,
         COALESCE(b.contact_name, u.name) as user_name,
         COALESCE(b.contact_phone, u.phone) as user_phone,
         u.email as user_email
       FROM bookings b
       JOIN booking_slots s ON b.slot_id = s.id
       JOIN fields f ON s.field_id = f.id
       JOIN campaign_info c ON f.campaign_id = c.id
       LEFT JOIN users u ON b.user_id = u.id
       WHERE b.id = $1`,
      [bookingId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapBookingDetailsWithCampaign(result.rows)[0];
  }

  // ==================== CAMPAIGN STATS ====================

  private static readonly DAYS_ORDER: DayOfWeek[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  private static readonly ACTIVE_STATUSES = `('confirmed','completed','pending')`;
  private static readonly REVENUE_STATUSES = `('confirmed','completed')`;

  private calcTrend(current: number, previous: number): number {
    if (previous === 0 && current > 0) return 100;
    if (previous === 0 && current === 0) return 0;
    return Math.round(((current - previous) / previous) * 100);
  }

  private parseTime(timeStr: string): number {
    const [h, m] = timeStr.split(':').map(Number);
    return h * 60 + m;
  }

  private getSlotsPerDay(field: Field, dayOfWeek: DayOfWeek): number {
    const timetable = field.working_timetable;
    if (!timetable) return 0;
    const daySchedule = timetable[dayOfWeek];
    if (!daySchedule) return 0;
    const fromMinutes = this.parseTime(daySchedule.from);
    const toMinutes = this.parseTime(daySchedule.to);
    let availableMinutes = toMinutes - fromMinutes;
    if (daySchedule.breaks) {
      for (const brk of daySchedule.breaks) {
        availableMinutes -= (this.parseTime(brk.to) - this.parseTime(brk.from));
      }
    }
    const duration = field.slot_duration || 60;
    return Math.floor(availableMinutes / duration);
  }

  private getWorkingHoursRange(fields: Field[]): { minHour: number; maxHour: number } {
    let minHour = 23;
    let maxHour = 0;
    for (const field of fields) {
      if (field.status !== 'active' || !field.working_timetable) continue;
      for (const day of BookingAPI.DAYS_ORDER) {
        const schedule = field.working_timetable[day];
        if (!schedule) continue;
        const fromH = parseInt(schedule.from.split(':')[0], 10);
        const toH = parseInt(schedule.to.split(':')[0], 10);
        if (fromH < minHour) minHour = fromH;
        if (toH > maxHour) maxHour = toH;
      }
    }
    return { minHour: minHour === 23 ? 8 : minHour, maxHour: maxHour === 0 ? 22 : maxHour };
  }

  async getCampaignStats(campaignId: string, timezoneId: string): Promise<CampaignStats> {
    // 1. Compute date ranges in campaign timezone
    const datesResult = await this.db.query(`
      SELECT
        (NOW() AT TIME ZONE $1)::date AS today,
        (NOW() AT TIME ZONE $1)::date - 1 AS yesterday,
        (NOW() AT TIME ZONE $1)::date - 28 AS current_start,
        (NOW() AT TIME ZONE $1)::date - 56 AS prev_start,
        (NOW() AT TIME ZONE $1)::date - 29 AS prev_end,
        ((NOW() AT TIME ZONE $1)::date - 1) - 29 AS revenue_start,
        date_trunc('week', (NOW() AT TIME ZONE $1)::date)::date AS week_start
    `, [timezoneId]);

    const d = datesResult.rows[0];
    const today = d.today as string;
    const yesterday = d.yesterday as string;
    const currentStart = d.current_start as string;
    const prevStart = d.prev_start as string;
    const prevEnd = d.prev_end as string;
    const revenueStart = d.revenue_start as string;
    const weekStart = d.week_start as string;

    // 2. Run all queries in parallel
    const [monthlyResult, newClientsResult, revenueByDayResult, heatmapResult, occupancyResult, fields] = await Promise.all([
      // Monthly stats (revenue, bookings, unique clients)
      this.db.query(`
        SELECT
          COALESCE(SUM(CASE WHEN s.date BETWEEN $2 AND $3 AND b.status IN ('confirmed','completed') THEN f.price_per_hour ELSE 0 END), 0)::numeric AS current_revenue,
          COALESCE(SUM(CASE WHEN s.date BETWEEN $4 AND $5 AND b.status IN ('confirmed','completed') THEN f.price_per_hour ELSE 0 END), 0)::numeric AS prev_revenue,
          COUNT(CASE WHEN s.date BETWEEN $2 AND $3 AND b.status IN ('confirmed','completed','pending') THEN 1 END)::int AS current_bookings,
          COUNT(CASE WHEN s.date BETWEEN $4 AND $5 AND b.status IN ('confirmed','completed','pending') THEN 1 END)::int AS prev_bookings,
          COUNT(DISTINCT CASE WHEN s.date BETWEEN $2 AND $3 AND b.status IN ('confirmed','completed','pending') AND b.user_id IS NOT NULL THEN b.user_id END)::int AS current_platform_clients,
          COUNT(DISTINCT CASE WHEN s.date BETWEEN $4 AND $5 AND b.status IN ('confirmed','completed','pending') AND b.user_id IS NOT NULL THEN b.user_id END)::int AS prev_platform_clients,
          COUNT(DISTINCT CASE WHEN s.date BETWEEN $2 AND $3 AND b.status IN ('confirmed','completed','pending') AND b.user_id IS NULL AND b.contact_phone IS NOT NULL THEN b.contact_phone END)::int AS current_manual_clients,
          COUNT(DISTINCT CASE WHEN s.date BETWEEN $4 AND $5 AND b.status IN ('confirmed','completed','pending') AND b.user_id IS NULL AND b.contact_phone IS NOT NULL THEN b.contact_phone END)::int AS prev_manual_clients
        FROM bookings b
        JOIN booking_slots s ON b.slot_id = s.id
        JOIN fields f ON s.field_id = f.id
        WHERE f.campaign_id = $1 AND f.deleted_at IS NULL
          AND s.date BETWEEN $4 AND $3
      `, [campaignId, currentStart, yesterday, prevStart, prevEnd]),

      // New clients (first booking per user_id)
      this.db.query(`
        WITH first_bookings AS (
          SELECT b.user_id, MIN(s.date) AS first_date
          FROM bookings b
          JOIN booking_slots s ON b.slot_id = s.id
          JOIN fields f ON s.field_id = f.id
          WHERE f.campaign_id = $1 AND b.user_id IS NOT NULL AND f.deleted_at IS NULL
          GROUP BY b.user_id
        )
        SELECT
          COUNT(*) FILTER (WHERE first_date BETWEEN $2 AND $3)::int AS new_current,
          COUNT(*) FILTER (WHERE first_date BETWEEN $4 AND $5)::int AS new_prev
        FROM first_bookings
      `, [campaignId, currentStart, yesterday, prevStart, prevEnd]),

      // Revenue by day (30 days)
      this.db.query(`
        SELECT s.date::text,
          COALESCE(SUM(CASE WHEN b.user_id IS NOT NULL THEN f.price_per_hour ELSE 0 END), 0)::numeric AS platform,
          COALESCE(SUM(CASE WHEN b.user_id IS NULL THEN f.price_per_hour ELSE 0 END), 0)::numeric AS manual,
          COUNT(*)::int AS bookings_count
        FROM bookings b
        JOIN booking_slots s ON b.slot_id = s.id
        JOIN fields f ON s.field_id = f.id
        WHERE f.campaign_id = $1 AND s.date BETWEEN $2 AND $3
          AND b.status IN ('confirmed','completed') AND f.deleted_at IS NULL
        GROUP BY s.date ORDER BY s.date
      `, [campaignId, revenueStart, yesterday]),

      // Heatmap (28 days, confirmed/completed)
      this.db.query(`
        SELECT
          (EXTRACT(ISODOW FROM s.date::date)::int - 1) AS dow,
          EXTRACT(HOUR FROM s.start_time::time)::int AS hour,
          COUNT(*)::int AS count
        FROM bookings b
        JOIN booking_slots s ON b.slot_id = s.id
        JOIN fields f ON s.field_id = f.id
        WHERE f.campaign_id = $1 AND s.date BETWEEN $2 AND $3
          AND b.status IN ('confirmed','completed') AND f.deleted_at IS NULL
        GROUP BY dow, hour
      `, [campaignId, currentStart, yesterday]),

      // Occupancy (booked slots this week)
      this.db.query(`
        SELECT COUNT(*)::int AS booked_slots
        FROM bookings b
        JOIN booking_slots s ON b.slot_id = s.id
        JOIN fields f ON s.field_id = f.id
        WHERE f.campaign_id = $1 AND s.date BETWEEN $2 AND $3
          AND b.status IN ('confirmed','completed','pending') AND f.deleted_at IS NULL
      `, [campaignId, weekStart, yesterday]),

      // Fields for occupancy totalSlots and working hours
      this.getFieldsByCampaign(campaignId),
    ]);

    // 3. Process monthly stats
    const m = monthlyResult.rows[0];
    const currentRevenue = Number(m.current_revenue);
    const prevRevenue = Number(m.prev_revenue);
    const currentBookings = m.current_bookings;
    const prevBookings = m.prev_bookings;
    const currentPlatformClients = m.current_platform_clients;
    const prevPlatformClients = m.prev_platform_clients;
    const currentManualClients = m.current_manual_clients;
    const prevManualClients = m.prev_manual_clients;
    const currentTotalClients = currentPlatformClients + currentManualClients;
    const prevTotalClients = prevPlatformClients + prevManualClients;

    const nc = newClientsResult.rows[0];
    const newClientsCurrent = nc.new_current;
    const newClientsPrev = nc.new_prev;

    // 4. Process revenue by day (fill gaps for empty days)
    const revenueMap = new Map<string, { platform: number; manual: number; bookingsCount: number }>();
    for (const row of revenueByDayResult.rows) {
      revenueMap.set(row.date, {
        platform: Number(row.platform),
        manual: Number(row.manual),
        bookingsCount: row.bookings_count,
      });
    }
    const revenueByDay: RevenueByDay[] = [];
    const revStartDate = new Date(revenueStart);
    const yesterdayDate = new Date(yesterday);
    for (let d = new Date(revStartDate); d <= yesterdayDate; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().slice(0, 10);
      const data = revenueMap.get(dateStr);
      revenueByDay.push({
        date: dateStr,
        platform: data?.platform ?? 0,
        manual: data?.manual ?? 0,
        bookingsCount: data?.bookingsCount ?? 0,
      });
    }

    // 5. Process heatmap
    const activeFields = fields.filter(f => f.status === 'active');
    const { minHour, maxHour } = this.getWorkingHoursRange(activeFields);

    const heatmapMap = new Map<string, number>();
    let heatmapMax = 0;
    for (const row of heatmapResult.rows) {
      const key = `${row.dow}:${row.hour}`;
      heatmapMap.set(key, row.count);
      if (row.count > heatmapMax) heatmapMax = row.count;
    }

    const heatmapData: HeatmapCell[] = [];
    for (let dow = 0; dow < 7; dow++) {
      for (let hour = minHour; hour < maxHour; hour++) {
        const count = heatmapMap.get(`${dow}:${hour}`) || 0;
        heatmapData.push({
          dayOfWeek: dow,
          hour,
          count,
          intensity: heatmapMax > 0 ? count / heatmapMax : 0,
        });
      }
    }

    // 6. Process occupancy
    const bookedSlots = occupancyResult.rows[0].booked_slots;
    let totalSlots = 0;
    const weekStartDate = new Date(weekStart);
    const todayDate = new Date(today);
    for (let d = new Date(weekStartDate); d < todayDate; d.setDate(d.getDate() + 1)) {
      const dow = (d.getDay() === 0 ? 6 : d.getDay() - 1); // 0=Mon
      for (const field of activeFields) {
        totalSlots += this.getSlotsPerDay(field, BookingAPI.DAYS_ORDER[dow]);
      }
    }

    // Compute weekEnd for display (min of yesterday, weekStart + 6)
    const weekEndDate = new Date(weekStart);
    weekEndDate.setDate(weekEndDate.getDate() + 6);
    const weekEnd = yesterdayDate < weekEndDate ? yesterday : weekEndDate.toISOString().slice(0, 10);

    return {
      monthly: {
        revenue: currentRevenue,
        revenueTrend: this.calcTrend(currentRevenue, prevRevenue),
        bookingsCount: currentBookings,
        bookingsTrend: this.calcTrend(currentBookings, prevBookings),
        uniqueClients: {
          platform: currentPlatformClients,
          manual: currentManualClients,
          total: currentTotalClients,
        },
        uniqueClientsTrend: this.calcTrend(currentTotalClients, prevTotalClients),
        newClients: newClientsCurrent,
        newClientsTrend: this.calcTrend(newClientsCurrent, newClientsPrev),
      },
      revenueByDay,
      weekOccupancy: {
        percent: totalSlots > 0 ? Math.round((bookedSlots / totalSlots) * 100) : 0,
        bookedSlots,
        totalSlots,
      },
      heatmapData,
      heatmapMinHour: minHour,
      heatmapMaxHour: maxHour,
      dateRanges: {
        currentStart,
        yesterday,
        revenueStart,
        weekStart,
        weekEnd,
      },
    };
  }
}
