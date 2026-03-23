import { describe, it, expect } from 'vitest';
import {
  timeToMinutes,
  minutesToTime,
  generateSlotsFromSchedule,
  getDaySchedule,
  classifyFieldChanges,
  validateFieldWorkingHours,
  validateFieldTimetableAgainstCampaign,
  validateBreaks,
  mapSlotsWithBookings,
  STATUS_TRANSITIONS,
  TIME_RESTRICTED_TRANSITIONS,
  isValidTransition,
} from './booking.helpers';
import type { Field, UpdateFieldRequest } from '../model/booking.model';

// ==================== TIME UTILS ====================

describe('timeToMinutes', () => {
  it('00:00 → 0', () => expect(timeToMinutes('00:00')).toBe(0));
  it('01:00 → 60', () => expect(timeToMinutes('01:00')).toBe(60));
  it('01:30 → 90', () => expect(timeToMinutes('01:30')).toBe(90));
  it('23:59 → 1439', () => expect(timeToMinutes('23:59')).toBe(1439));
  it('09:00 → 540', () => expect(timeToMinutes('09:00')).toBe(540));
  it('12:00 → 720', () => expect(timeToMinutes('12:00')).toBe(720));
});

describe('minutesToTime', () => {
  it('0 → 00:00', () => expect(minutesToTime(0)).toBe('00:00'));
  it('60 → 01:00', () => expect(minutesToTime(60)).toBe('01:00'));
  it('90 → 01:30', () => expect(minutesToTime(90)).toBe('01:30'));
  it('1439 → 23:59', () => expect(minutesToTime(1439)).toBe('23:59'));
  it('540 → 09:00', () => expect(minutesToTime(540)).toBe('09:00'));
});

describe('timeToMinutes ↔ minutesToTime round-trip', () => {
  const times = ['00:00', '09:00', '12:30', '14:45', '23:59'];
  for (const time of times) {
    it(`round-trip: ${time}`, () => {
      expect(minutesToTime(timeToMinutes(time))).toBe(time);
    });
  }
});

// ==================== SLOT GENERATION ====================

describe('generateSlotsFromSchedule', () => {
  it('генерирует 2 слота по 60 мин для 09:00-11:00', () => {
    const slots = generateSlotsFromSchedule({ from: '09:00', to: '11:00' }, 60);
    expect(slots).toHaveLength(2);
    expect(slots[0]).toEqual({ start_time: '09:00', end_time: '10:00', is_blocked: false, block_reason: null });
    expect(slots[1]).toEqual({ start_time: '10:00', end_time: '11:00', is_blocked: false, block_reason: null });
  });

  it('генерирует 4 слота по 30 мин для 09:00-11:00', () => {
    const slots = generateSlotsFromSchedule({ from: '09:00', to: '11:00' }, 30);
    expect(slots).toHaveLength(4);
    expect(slots[0].start_time).toBe('09:00');
    expect(slots[3].end_time).toBe('11:00');
  });

  it('не генерирует неполный слот', () => {
    const slots = generateSlotsFromSchedule({ from: '09:00', to: '10:30' }, 60);
    expect(slots).toHaveLength(1);
    expect(slots[0].end_time).toBe('10:00');
  });

  it('помечает слот в перерыве как blocked', () => {
    const slots = generateSlotsFromSchedule({
      from: '09:00',
      to: '12:00',
      breaks: [{ from: '10:00', to: '11:00' }],
    }, 60);
    expect(slots).toHaveLength(3);
    expect(slots[0].is_blocked).toBe(false);
    expect(slots[1].is_blocked).toBe(true);
    expect(slots[1].block_reason).toBe('break');
    expect(slots[2].is_blocked).toBe(false);
  });

  it('помечает слот с частичным перекрытием перерыва', () => {
    // 30-мин слот 10:00-10:30, перерыв 10:15-10:45
    const slots = generateSlotsFromSchedule({
      from: '10:00',
      to: '11:00',
      breaks: [{ from: '10:15', to: '10:45' }],
    }, 30);
    expect(slots).toHaveLength(2);
    expect(slots[0].is_blocked).toBe(true); // 10:00-10:30 пересекается с 10:15-10:45
    expect(slots[1].is_blocked).toBe(true); // 10:30-11:00 пересекается с 10:15-10:45
  });

  it('обрабатывает несколько перерывов', () => {
    const slots = generateSlotsFromSchedule({
      from: '09:00',
      to: '15:00',
      breaks: [
        { from: '10:00', to: '11:00' },
        { from: '13:00', to: '14:00' },
      ],
    }, 60);
    expect(slots).toHaveLength(6);
    expect(slots[1].is_blocked).toBe(true); // 10:00-11:00
    expect(slots[4].is_blocked).toBe(true); // 13:00-14:00
    expect(slots[0].is_blocked).toBe(false);
    expect(slots[2].is_blocked).toBe(false);
  });

  it('возвращает пустой массив если слот не влезает', () => {
    const slots = generateSlotsFromSchedule({ from: '09:00', to: '09:30' }, 60);
    expect(slots).toHaveLength(0);
  });

  it('пустые перерывы — все слоты свободны', () => {
    const slots = generateSlotsFromSchedule({ from: '09:00', to: '11:00', breaks: [] }, 60);
    expect(slots.every(s => !s.is_blocked)).toBe(true);
  });
});

// ==================== SCHEDULE RESOLUTION ====================

function makeField(overrides: Partial<Field> = {}): Field {
  return {
    id: 'field-1',
    campaign_id: 'camp-1',
    name: 'Test Field',
    sport_types: ['football'],
    is_indoor: false,
    photos: [],
    price_per_hour: 1000,
    status: 'active',
    slot_duration: 60,
    working_hours_from: null,
    working_hours_to: null,
    working_days: [],
    working_timetable: null,
    client_info: null,
    pending_photos: null,
    created_at: '2025-01-01',
    deleted_at: null,
    ...overrides,
  };
}

describe('getDaySchedule', () => {
  // Понедельник = getDay() === 1
  const monday = new Date('2026-03-23'); // Понедельник 23.03.2026

  it('уровень 1: берёт из working_timetable поля', () => {
    const field = makeField({
      working_timetable: { monday: { from: '09:00', to: '22:00' } },
    });
    expect(getDaySchedule(field, monday)).toEqual({ from: '09:00', to: '22:00' });
  });

  it('уровень 1: null в timetable = выходной', () => {
    const field = makeField({
      working_timetable: { monday: null },
    });
    expect(getDaySchedule(field, monday)).toBeNull();
  });

  it('уровень 2: fallback на legacy working_hours', () => {
    const field = makeField({
      working_hours_from: '08:00',
      working_hours_to: '20:00',
      working_days: ['mon', 'tue', 'wed'],
    });
    expect(getDaySchedule(field, monday)).toEqual({ from: '08:00', to: '20:00' });
  });

  it('уровень 2: legacy — день не в working_days = выходной', () => {
    const field = makeField({
      working_hours_from: '08:00',
      working_hours_to: '20:00',
      working_days: ['tue', 'wed'], // нет mon
    });
    expect(getDaySchedule(field, monday)).toBeNull();
  });

  it('уровень 3: fallback на расписание кампании', () => {
    const field = makeField(); // ничего не задано
    const campaignTimetable = { monday: { from: '10:00', to: '21:00' } };
    expect(getDaySchedule(field, monday, campaignTimetable)).toEqual({ from: '10:00', to: '21:00' });
  });

  it('все уровни пусты → null', () => {
    const field = makeField();
    expect(getDaySchedule(field, monday)).toBeNull();
    expect(getDaySchedule(field, monday, null)).toBeNull();
    expect(getDaySchedule(field, monday, {})).toBeNull();
  });

  it('воскресенье (getDay() === 0) → dayNames[0] = sunday', () => {
    const sunday = new Date('2026-03-22'); // Воскресенье
    const field = makeField({
      working_timetable: { sunday: { from: '10:00', to: '18:00' } },
    });
    expect(getDaySchedule(field, sunday)).toEqual({ from: '10:00', to: '18:00' });
  });

  it('ключ отсутствует в timetable → fallback', () => {
    // working_timetable задан, но без monday → идём на fallback
    const field = makeField({
      working_timetable: { tuesday: { from: '09:00', to: '22:00' } },
    });
    const campaignTimetable = { monday: { from: '11:00', to: '20:00' } };
    expect(getDaySchedule(field, monday, campaignTimetable)).toEqual({ from: '11:00', to: '20:00' });
  });
});

// ==================== CHANGE CLASSIFICATION ====================

describe('classifyFieldChanges', () => {
  const baseField = makeField({
    slot_duration: 60,
    working_timetable: {
      monday: { from: '09:00', to: '22:00' },
    },
  });

  it('slot_duration изменился → SCHEDULE_CHANGE', () => {
    expect(classifyFieldChanges(baseField, { slot_duration: 90 })).toBe('SCHEDULE_CHANGE');
  });

  it('slot_duration не изменился → COSMETIC', () => {
    expect(classifyFieldChanges(baseField, { slot_duration: 60 })).toBe('COSMETIC');
  });

  it('часы работы изменились → SCHEDULE_CHANGE', () => {
    expect(classifyFieldChanges(baseField, {
      working_timetable: { monday: { from: '08:00', to: '22:00' } },
    })).toBe('SCHEDULE_CHANGE');
  });

  it('день включён → выключен → SCHEDULE_CHANGE', () => {
    expect(classifyFieldChanges(baseField, {
      working_timetable: { monday: null },
    })).toBe('SCHEDULE_CHANGE');
  });

  it('только перерывы изменились → BREAK_CHANGE', () => {
    expect(classifyFieldChanges(baseField, {
      working_timetable: {
        monday: { from: '09:00', to: '22:00', breaks: [{ from: '12:00', to: '13:00' }] },
      },
    })).toBe('BREAK_CHANGE');
  });

  it('ничего не передано → COSMETIC', () => {
    expect(classifyFieldChanges(baseField, { name: 'New Name' })).toBe('COSMETIC');
  });

  it('working_timetable не передан → COSMETIC', () => {
    expect(classifyFieldChanges(baseField, {})).toBe('COSMETIC');
  });
});

// ==================== VALIDATION ====================

describe('validateBreaks', () => {
  it('валидный перерыв', () => {
    expect(() => validateBreaks({
      from: '09:00', to: '18:00',
      breaks: [{ from: '12:00', to: '13:00' }],
    })).not.toThrow();
  });

  it('from >= to → ошибка', () => {
    expect(() => validateBreaks({
      from: '09:00', to: '18:00',
      breaks: [{ from: '13:00', to: '12:00' }],
    })).toThrow('раньше');
  });

  it('перерыв за пределами рабочего времени → ошибка', () => {
    expect(() => validateBreaks({
      from: '09:00', to: '18:00',
      breaks: [{ from: '08:00', to: '09:30' }],
    })).toThrow('в пределах');
  });

  it('пересечение перерывов → ошибка', () => {
    expect(() => validateBreaks({
      from: '09:00', to: '18:00',
      breaks: [
        { from: '10:00', to: '11:00' },
        { from: '10:30', to: '11:30' },
      ],
    })).toThrow('пересекаться');
  });

  it('не выровнен по сетке → ошибка', () => {
    expect(() => validateBreaks({
      from: '09:00', to: '18:00',
      breaks: [{ from: '10:15', to: '11:15' }],
    }, 60)).toThrow('сеткой');
  });

  it('выровнен по сетке → ok', () => {
    expect(() => validateBreaks({
      from: '09:00', to: '18:00',
      breaks: [{ from: '10:00', to: '11:00' }],
    }, 60)).not.toThrow();
  });

  it('без slotDuration → пропускает grid check', () => {
    expect(() => validateBreaks({
      from: '09:00', to: '18:00',
      breaks: [{ from: '10:15', to: '11:15' }],
    })).not.toThrow();
  });
});

describe('validateFieldTimetableAgainstCampaign', () => {
  const campaignTimetable = {
    monday: { from: '09:00', to: '22:00' },
    tuesday: { from: '09:00', to: '22:00' },
  };

  it('поле в рамках кампании → ok', () => {
    expect(() => validateFieldTimetableAgainstCampaign(
      { monday: { from: '10:00', to: '20:00' } },
      campaignTimetable,
    )).not.toThrow();
  });

  it('поле раньше кампании → ошибка', () => {
    expect(() => validateFieldTimetableAgainstCampaign(
      { monday: { from: '08:00', to: '20:00' } },
      campaignTimetable,
    )).toThrow('раньше');
  });

  it('поле позже кампании → ошибка', () => {
    expect(() => validateFieldTimetableAgainstCampaign(
      { monday: { from: '10:00', to: '23:00' } },
      campaignTimetable,
    )).toThrow('позже');
  });

  it('поле работает в выходной кампании → ошибка', () => {
    expect(() => validateFieldTimetableAgainstCampaign(
      { wednesday: { from: '10:00', to: '20:00' } }, // среда не в campaignTimetable
      campaignTimetable,
    )).toThrow('закрыта');
  });

  it('выходной у поля → ok', () => {
    expect(() => validateFieldTimetableAgainstCampaign(
      { monday: null },
      campaignTimetable,
    )).not.toThrow();
  });
});

describe('validateFieldWorkingHours', () => {
  const campaignTimetable = {
    monday: { from: '09:00', to: '22:00' },
    friday: { from: '10:00', to: '20:00' },
  };

  it('поле в рамках → ok', () => {
    expect(() => validateFieldWorkingHours('10:00', '20:00', campaignTimetable)).not.toThrow();
  });

  it('null поля → пропускает', () => {
    expect(() => validateFieldWorkingHours(null, null, campaignTimetable)).not.toThrow();
  });

  it('поле раньше кампании → ошибка', () => {
    expect(() => validateFieldWorkingHours('08:00', '20:00', campaignTimetable)).toThrow('раньше');
  });

  it('поле позже кампании → ошибка', () => {
    expect(() => validateFieldWorkingHours('10:00', '23:00', campaignTimetable)).toThrow('позже');
  });

  it('пустое расписание кампании → пропускает', () => {
    expect(() => validateFieldWorkingHours('08:00', '23:00', {})).not.toThrow();
  });
});

// ==================== DATA MAPPING ====================

describe('mapSlotsWithBookings', () => {
  it('маппит строку без бронирования', () => {
    const rows = [{
      id: 'slot-1',
      field_id: 'field-1',
      date: '2026-03-23',
      start_time: '09:00',
      end_time: '10:00',
      is_blocked: false,
      block_reason: null,
      created_at: '2026-01-01',
      booking_id: null,
    }];
    const result = mapSlotsWithBookings(rows);
    expect(result).toHaveLength(1);
    expect(result[0].booking).toBeNull();
    expect(result[0].start_time).toBe('09:00');
  });

  it('маппит строку с бронированием', () => {
    const rows = [{
      id: 'slot-1',
      field_id: 'field-1',
      date: '2026-03-23',
      start_time: '09:00',
      end_time: '10:00',
      is_blocked: false,
      block_reason: null,
      created_at: '2026-01-01',
      booking_id: 'book-1',
      booking_user_id: 'user-1',
      booking_status: 'confirmed',
      user_name: 'Иван',
      user_phone: '79991234567',
      is_registered: true,
    }];
    const result = mapSlotsWithBookings(rows);
    expect(result[0].booking).toEqual({
      id: 'book-1',
      user_id: 'user-1',
      status: 'confirmed',
      user_name: 'Иван',
      user_phone: '79991234567',
      is_registered: true,
    });
  });

  it('конвертирует Date object в строку YYYY-MM-DD', () => {
    const rows = [{
      id: 'slot-1',
      field_id: 'field-1',
      date: new Date('2026-03-23T00:00:00Z'),
      start_time: '09:00',
      end_time: '10:00',
      is_blocked: false,
      block_reason: null,
      created_at: '2026-01-01',
      booking_id: null,
    }];
    const result = mapSlotsWithBookings(rows);
    expect(result[0].date).toBe('2026-03-23');
  });

  it('is_registered: false если не true', () => {
    const rows = [{
      id: 'slot-1', field_id: 'f', date: '2026-03-23',
      start_time: '09:00', end_time: '10:00',
      is_blocked: false, block_reason: null, created_at: '',
      booking_id: 'b-1', booking_user_id: 'u-1',
      booking_status: 'confirmed',
      user_name: null, user_phone: null,
      is_registered: false,
    }];
    expect(mapSlotsWithBookings(rows)[0].booking!.is_registered).toBe(false);
  });
});

// ==================== STATUS MACHINE ====================

describe('STATUS_TRANSITIONS', () => {
  it('pending может перейти в confirmed', () => {
    expect(STATUS_TRANSITIONS.pending).toContain('confirmed');
  });

  it('cancelled_by_admin — терминальный (пустой массив)', () => {
    expect(STATUS_TRANSITIONS.cancelled_by_admin).toEqual([]);
  });

  it('confirmed может перейти в completed и no_show', () => {
    expect(STATUS_TRANSITIONS.confirmed).toContain('completed');
    expect(STATUS_TRANSITIONS.confirmed).toContain('no_show');
  });

  it('все терминальные статусы ведут только в cancelled_by_admin', () => {
    const terminal = ['no_show', 'rejected', 'expired', 'cancelled_by_client', 'cancelled_by_facility'] as const;
    for (const status of terminal) {
      expect(STATUS_TRANSITIONS[status]).toEqual(['cancelled_by_admin']);
    }
  });
});

describe('TIME_RESTRICTED_TRANSITIONS', () => {
  it('pending->confirmed требует before_start', () => {
    expect(TIME_RESTRICTED_TRANSITIONS['pending->confirmed']).toBe('before_start');
  });

  it('confirmed->no_show требует after_start', () => {
    expect(TIME_RESTRICTED_TRANSITIONS['confirmed->no_show']).toBe('after_start');
  });

  it('completed->no_show требует after_start', () => {
    expect(TIME_RESTRICTED_TRANSITIONS['completed->no_show']).toBe('after_start');
  });
});

describe('isValidTransition', () => {
  it('pending → confirmed = true', () => {
    expect(isValidTransition('pending', 'confirmed')).toBe(true);
  });

  it('pending → completed = false', () => {
    expect(isValidTransition('pending', 'completed')).toBe(false);
  });

  it('cancelled_by_admin → pending = false', () => {
    expect(isValidTransition('cancelled_by_admin', 'pending')).toBe(false);
  });
});
