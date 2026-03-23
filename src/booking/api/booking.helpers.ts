/**
 * Pure business logic extracted from BookingAPI for testability.
 * No DB calls, no side effects.
 */
import {
  Field,
  UpdateFieldRequest,
  BookingStatus,
  SlotWithBooking,
  FieldDaySchedule,
  FieldWorkingTimetable,
  DayOfWeek,
} from '../model/booking.model';

// Re-exported types
export type FieldChangeType = 'COSMETIC' | 'BREAK_CHANGE' | 'SCHEDULE_CHANGE';

export interface WorkingTimetable {
  monday?: { from: string; to: string };
  tuesday?: { from: string; to: string };
  wednesday?: { from: string; to: string };
  thursday?: { from: string; to: string };
  friday?: { from: string; to: string };
  saturday?: { from: string; to: string };
  sunday?: { from: string; to: string };
}

export interface SlotGenResult {
  start_time: string;
  end_time: string;
  is_blocked: boolean;
  block_reason: string | null;
}

// ==================== TIME UTILS ====================

export function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + (minutes || 0);
}

export function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h.toString().padStart(2, '0') + ':' + m.toString().padStart(2, '0');
}

// ==================== SLOT GENERATION ====================

export function generateSlotsFromSchedule(
  schedule: FieldDaySchedule,
  slotDuration: number
): SlotGenResult[] {
  const slots: SlotGenResult[] = [];

  const startMinutes = timeToMinutes(schedule.from);
  const endMinutes = timeToMinutes(schedule.to);
  const sortedBreaks = (schedule.breaks || [])
    .map(b => ({ start: timeToMinutes(b.from), end: timeToMinutes(b.to) }))
    .sort((a, b) => a.start - b.start);

  // Фиксированная сетка: ровный шаг от начала, без прыжков
  for (let current = startMinutes; current + slotDuration <= endMinutes; current += slotDuration) {
    const slotEnd = current + slotDuration;

    // Проверяем пересечение с любым перерывом
    const overlapsBreak = sortedBreaks.some(b => current < b.end && slotEnd > b.start);

    slots.push({
      start_time: minutesToTime(current),
      end_time: minutesToTime(slotEnd),
      is_blocked: overlapsBreak,
      block_reason: overlapsBreak ? 'break' : null,
    });
  }

  return slots;
}

// ==================== SCHEDULE RESOLUTION ====================

export function getDaySchedule(
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

// ==================== CHANGE CLASSIFICATION ====================

export function classifyFieldChanges(current: Field, data: UpdateFieldRequest): FieldChangeType {
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

// ==================== VALIDATION ====================

export function validateFieldWorkingHours(
  fieldFrom: string | null | undefined,
  fieldTo: string | null | undefined,
  campaignTimetable: WorkingTimetable
): void {
  if (!fieldFrom || !fieldTo) return;

  const campaignHours: { from: string; to: string }[] = [];
  const days: (keyof WorkingTimetable)[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

  for (const day of days) {
    const schedule = campaignTimetable[day];
    if (schedule?.from && schedule?.to) {
      campaignHours.push({ from: schedule.from, to: schedule.to });
    }
  }

  if (campaignHours.length === 0) return;

  const earliestOpen = campaignHours.reduce((min, h) => h.from < min ? h.from : min, '23:59');
  const latestClose = campaignHours.reduce((max, h) => h.to > max ? h.to : max, '00:00');

  if (fieldFrom < earliestOpen) {
    throw new Error(`Время начала работы поля (${fieldFrom}) не может быть раньше открытия площадки (${earliestOpen})`);
  }
  if (fieldTo > latestClose) {
    throw new Error(`Время окончания работы поля (${fieldTo}) не может быть позже закрытия площадки (${latestClose})`);
  }
}

export function validateFieldTimetableAgainstCampaign(
  fieldTimetable: FieldWorkingTimetable,
  campaignTimetable: WorkingTimetable,
  slotDuration?: number
): void {
  const days: DayOfWeek[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

  for (const day of days) {
    const fieldDay = fieldTimetable[day];
    const campaignDay = campaignTimetable[day];

    if (!fieldDay) continue;
    if (!campaignDay) {
      throw new Error(`Поле не может работать в ${day}, когда площадка закрыта`);
    }

    if (fieldDay.from < campaignDay.from) {
      throw new Error(`Время начала работы поля (${fieldDay.from}) в ${day} не может быть раньше открытия площадки (${campaignDay.from})`);
    }
    if (fieldDay.to > campaignDay.to) {
      throw new Error(`Время окончания работы поля (${fieldDay.to}) в ${day} не может быть позже закрытия площадки (${campaignDay.to})`);
    }

    if (fieldDay.breaks) {
      validateBreaks(fieldDay, slotDuration);
    }
  }
}

export function validateBreaks(schedule: FieldDaySchedule, slotDuration?: number): void {
  const breaks = schedule.breaks || [];
  const workStart = timeToMinutes(schedule.from);
  const workEnd = timeToMinutes(schedule.to);

  for (const brk of breaks) {
    const brkStart = timeToMinutes(brk.from);
    const brkEnd = timeToMinutes(brk.to);

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
          ? minutesToTime(brkStart - startOffset)
          : brk.from;
        const nearestEnd = endOffset !== 0
          ? minutesToTime(brkEnd + (slotDuration - endOffset))
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
      const a = { start: timeToMinutes(breaks[i].from), end: timeToMinutes(breaks[i].to) };
      const b = { start: timeToMinutes(breaks[j].from), end: timeToMinutes(breaks[j].to) };
      if (a.start < b.end && a.end > b.start) {
        throw new Error(`Перерывы не должны пересекаться: ${breaks[i].from}-${breaks[i].to} и ${breaks[j].from}-${breaks[j].to}`);
      }
    }
  }
}

// ==================== DATA MAPPING ====================

export function mapSlotsWithBookings(rows: any[]): SlotWithBooking[] {
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
      is_registered: row.is_registered === true,
    } : null
  }));
}

// ==================== STATUS MACHINE ====================

export const STATUS_TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
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

export const TIME_RESTRICTED_TRANSITIONS: Record<string, 'before_start' | 'after_start'> = {
  'pending->confirmed': 'before_start',
  'pending->rejected': 'before_start',
  'pending->cancelled_by_client': 'before_start',
  'confirmed->cancelled_by_client': 'before_start',
  'confirmed->cancelled_by_facility': 'before_start',
  'confirmed->no_show': 'after_start',
  'completed->no_show': 'after_start',
};

export function isValidTransition(from: BookingStatus, to: BookingStatus): boolean {
  return STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}
