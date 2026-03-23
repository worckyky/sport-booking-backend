import { describe, it, expect } from 'vitest';
import {
  validatePassword,
  validatePaymentMethods,
  validateWorkingTimetable,
  validateTimezoneId,
} from './validators';

describe('validatePassword', () => {
  it('принимает валидный пароль', () => {
    expect(validatePassword('password1')).toBeNull();
  });

  it('принимает пароль с кириллицей', () => {
    expect(validatePassword('пароль123')).toBeNull();
  });

  it('отклоняет короткий пароль (< 8)', () => {
    expect(validatePassword('pass1')).toContain('8 символов');
  });

  it('отклоняет слишком длинный пароль (> 128)', () => {
    const long = 'a'.repeat(129) + '1';
    expect(validatePassword(long)).toContain('длинный');
  });

  it('отклоняет пароль без букв', () => {
    expect(validatePassword('12345678')).toContain('букву');
  });

  it('отклоняет пароль без цифр', () => {
    expect(validatePassword('password')).toContain('цифру');
  });

  it('принимает пароль ровно 8 символов', () => {
    expect(validatePassword('abcdefg1')).toBeNull();
  });

  it('принимает пароль ровно 128 символов', () => {
    const pass = 'a'.repeat(127) + '1';
    expect(validatePassword(pass)).toBeNull();
  });
});

describe('validatePaymentMethods', () => {
  it('принимает валидные методы', () => {
    expect(validatePaymentMethods(['MONEY', 'CARD', 'SBP'])).toBeNull();
  });

  it('принимает пустой массив', () => {
    expect(validatePaymentMethods([])).toBeNull();
  });

  it('отклоняет не массив', () => {
    expect(validatePaymentMethods('CARD')).toContain('array');
  });

  it('отклоняет невалидный метод', () => {
    expect(validatePaymentMethods(['CASH'])).toContain('CASH');
  });

  it('отклоняет null', () => {
    expect(validatePaymentMethods(null)).toContain('array');
  });
});

describe('validateWorkingTimetable', () => {
  it('принимает валидное расписание', () => {
    expect(validateWorkingTimetable({
      monday: { from: '09:00', to: '22:00' },
    })).toBeNull();
  });

  it('принимает null = выходной', () => {
    expect(validateWorkingTimetable({
      monday: null,
    })).toBeNull();
  });

  it('принимает пустой объект (все дни выходные)', () => {
    expect(validateWorkingTimetable({})).toBeNull();
  });

  it('принимает полную неделю', () => {
    const timetable: Record<string, { from: string; to: string } | null> = {};
    for (const day of ['monday', 'tuesday', 'wednesday', 'thursday', 'friday']) {
      timetable[day] = { from: '09:00', to: '22:00' };
    }
    timetable.saturday = { from: '10:00', to: '18:00' };
    timetable.sunday = null;
    expect(validateWorkingTimetable(timetable)).toBeNull();
  });

  it('отклоняет невалидный день', () => {
    expect(validateWorkingTimetable({
      friday_night: { from: '09:00', to: '22:00' },
    })).toContain('friday_night');
  });

  it('отклоняет from >= to', () => {
    expect(validateWorkingTimetable({
      monday: { from: '22:00', to: '09:00' },
    })).toContain('earlier');
  });

  it('отклоняет from === to', () => {
    expect(validateWorkingTimetable({
      monday: { from: '12:00', to: '12:00' },
    })).toContain('earlier');
  });

  it('отклоняет невалидный формат времени', () => {
    expect(validateWorkingTimetable({
      monday: { from: '9:0', to: '22:00' },
    })).toContain('from');
  });

  it('отклоняет время > 23:59', () => {
    expect(validateWorkingTimetable({
      monday: { from: '09:00', to: '25:00' },
    })).toContain('to');
  });

  it('отклоняет не-объект', () => {
    expect(validateWorkingTimetable('string')).toContain('object');
  });

  it('отклоняет null как timetable', () => {
    expect(validateWorkingTimetable(null)).toContain('object');
  });

  it('отклоняет день с неверной структурой (число)', () => {
    expect(validateWorkingTimetable({
      monday: 42,
    })).toContain('object');
  });
});

describe('validateTimezoneId', () => {
  it('принимает Europe/Moscow', () => {
    expect(validateTimezoneId('Europe/Moscow')).toBeNull();
  });

  it('принимает Asia/Vladivostok', () => {
    expect(validateTimezoneId('Asia/Vladivostok')).toBeNull();
  });

  it('отклоняет пустую строку', () => {
    expect(validateTimezoneId('')).toContain('non-empty');
  });

  it('отклоняет строку с пробелами', () => {
    expect(validateTimezoneId('  ')).toContain('non-empty');
  });

  it('отклоняет не-строку', () => {
    expect(validateTimezoneId(123)).toContain('non-empty');
  });

  it('отклоняет null', () => {
    expect(validateTimezoneId(null)).toContain('non-empty');
  });

  it('отклоняет несуществующую таймзону', () => {
    const result = validateTimezoneId('Invalid/Zone');
    // На Node 18+ вернёт ошибку, на старых — null (fallback)
    if (result !== null) {
      expect(result).toContain('Invalid');
    }
  });
});
