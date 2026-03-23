import { describe, it, expect } from 'vitest';
import { normalizePhone, formatPhoneForDisplay } from './phone';

describe('normalizePhone', () => {
  // Стандартные форматы → 7XXXXXXXXXX
  it('нормализует +7 с пробелами и скобками', () => {
    expect(normalizePhone('+7 (999) 123-45-67')).toBe('79991234567');
  });

  it('нормализует 8xxx → 7xxx', () => {
    expect(normalizePhone('89991234567')).toBe('79991234567');
  });

  it('нормализует 10 цифр без кода страны', () => {
    expect(normalizePhone('9991234567')).toBe('79991234567');
  });

  it('нормализует +7 без пробелов', () => {
    expect(normalizePhone('+79991234567')).toBe('79991234567');
  });

  it('нормализует с дефисами и пробелами', () => {
    expect(normalizePhone('8 999 123 45 67')).toBe('79991234567');
  });

  it('нормализует 7XXXXXXXXXX (уже нормализованный)', () => {
    expect(normalizePhone('79991234567')).toBe('79991234567');
  });

  // Edge cases: null/undefined/пустота
  it('возвращает null для null', () => {
    expect(normalizePhone(null)).toBeNull();
  });

  it('возвращает null для undefined', () => {
    expect(normalizePhone(undefined)).toBeNull();
  });

  it('возвращает null для пустой строки', () => {
    expect(normalizePhone('')).toBeNull();
  });

  it('возвращает null для строки без цифр', () => {
    expect(normalizePhone('abcdef')).toBeNull();
  });

  // Edge cases: невалидные длины
  it('возвращает null для слишком короткого номера', () => {
    expect(normalizePhone('7123')).toBeNull();
  });

  it('возвращает null для слишком длинного номера', () => {
    expect(normalizePhone('799912345678')).toBeNull();
  });

  // Edge case: 8 в начале но не 11 цифр
  it('не заменяет 8→7 если длина не 11', () => {
    expect(normalizePhone('800')).toBeNull();
  });

  // Edge case: номер начинается с 8 и 11 цифр
  it('нормализует 8-800 номер', () => {
    expect(normalizePhone('88001234567')).toBe('78001234567');
  });
});

describe('formatPhoneForDisplay', () => {
  it('форматирует нормализованный номер', () => {
    expect(formatPhoneForDisplay('79991234567')).toBe('+7 (999) 123-45-67');
  });

  it('возвращает null для null', () => {
    expect(formatPhoneForDisplay(null)).toBeNull();
  });

  it('возвращает null для undefined', () => {
    expect(formatPhoneForDisplay(undefined)).toBeNull();
  });

  it('возвращает исходную строку если формат не подходит', () => {
    expect(formatPhoneForDisplay('12345')).toBe('12345');
  });

  it('возвращает исходную строку для не-7 номера', () => {
    expect(formatPhoneForDisplay('19991234567')).toBe('19991234567');
  });
});
