import { describe, it, expect } from 'vitest';
import { isValidUUID } from './uuid';

describe('isValidUUID', () => {
  it('принимает валидный UUID v4', () => {
    expect(isValidUUID('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
  });

  it('принимает UUID в верхнем регистре', () => {
    expect(isValidUUID('550E8400-E29B-41D4-A716-446655440000')).toBe(true);
  });

  it('принимает UUID со смешанным регистром', () => {
    expect(isValidUUID('550e8400-E29B-41d4-A716-446655440000')).toBe(true);
  });

  it('отклоняет строку без дефисов', () => {
    expect(isValidUUID('550e8400e29b41d4a716446655440000')).toBe(false);
  });

  it('отклоняет пустую строку', () => {
    expect(isValidUUID('')).toBe(false);
  });

  it('отклоняет произвольную строку', () => {
    expect(isValidUUID('not-a-uuid')).toBe(false);
  });

  it('отклоняет UUID с лишними символами', () => {
    expect(isValidUUID('550e8400-e29b-41d4-a716-446655440000x')).toBe(false);
  });

  it('отклоняет UUID с недостаточной длиной секции', () => {
    expect(isValidUUID('550e840-e29b-41d4-a716-446655440000')).toBe(false);
  });
});
