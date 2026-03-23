import { describe, it, expect } from 'vitest';
import { createError, mapErrorToResponse, ErrorCode } from './errors';

describe('createError', () => {
  it('создаёт ошибку с code и message', () => {
    const result = createError(ErrorCode.VALIDATION_ERROR, 'Bad input');
    expect(result).toEqual({
      error: { code: 'VALIDATION_ERROR', message: 'Bad input' },
    });
  });

  it('включает field если передан', () => {
    const result = createError(ErrorCode.REQUIRED_FIELD, 'Required', 'email');
    expect(result.error.field).toBe('email');
  });

  it('не включает field если не передан', () => {
    const result = createError(ErrorCode.VALIDATION_ERROR, 'Bad');
    expect(result.error.field).toBeUndefined();
  });

  it('включает details если переданы', () => {
    const result = createError(ErrorCode.VALIDATION_ERROR, 'Bad', undefined, { min: 8 });
    expect(result.error.details).toEqual({ min: 8 });
  });

  it('не включает details если не переданы', () => {
    const result = createError(ErrorCode.VALIDATION_ERROR, 'Bad');
    expect(result.error.details).toBeUndefined();
  });

  it('принимает строковый код', () => {
    const result = createError('CUSTOM_CODE', 'Custom error');
    expect(result.error.code).toBe('CUSTOM_CODE');
  });
});

describe('mapErrorToResponse', () => {
  it('маппит "Slot not found" → 404', () => {
    const { status, response } = mapErrorToResponse(new Error('Slot not found'));
    expect(status).toBe(404);
    expect(response.error.code).toBe(ErrorCode.SLOT_NOT_FOUND);
  });

  it('маппит "Slot is blocked" → 400', () => {
    const { status, response } = mapErrorToResponse(new Error('Slot is blocked'));
    expect(status).toBe(400);
    expect(response.error.code).toBe(ErrorCode.SLOT_BLOCKED);
  });

  it('маппит "Slot already booked" → 409', () => {
    const { status, response } = mapErrorToResponse(new Error('Slot already booked'));
    expect(status).toBe(409);
    expect(response.error.code).toBe(ErrorCode.SLOT_ALREADY_BOOKED);
  });

  it('маппит overlap → 409', () => {
    const { status, response } = mapErrorToResponse(new Error('Time overlap detected'));
    expect(status).toBe(409);
    expect(response.error.code).toBe(ErrorCode.SLOT_OVERLAP);
  });

  it('маппит "Invalid status transition" → 400', () => {
    const { status, response } = mapErrorToResponse(
      new Error('Invalid status transition: pending -> completed')
    );
    expect(status).toBe(400);
    expect(response.error.code).toBe(ErrorCode.INVALID_STATUS_TRANSITION);
  });

  it('маппит "active bookings" → 409', () => {
    const { status, response } = mapErrorToResponse(new Error('Field has active bookings'));
    expect(status).toBe(409);
    expect(response.error.code).toBe(ErrorCode.ACTIVE_BOOKINGS_EXIST);
  });

  it('маппит "расписание" (русский) → 400 SCHEDULE_CONFLICT', () => {
    const { status, response } = mapErrorToResponse(new Error('Конфликт расписание'));
    expect(status).toBe(400);
    expect(response.error.code).toBe(ErrorCode.SCHEDULE_CONFLICT);
  });

  it('маппит "schedule" (английский) → 400 SCHEDULE_CONFLICT', () => {
    const { status, response } = mapErrorToResponse(new Error('schedule conflict'));
    expect(status).toBe(400);
    expect(response.error.code).toBe(ErrorCode.SCHEDULE_CONFLICT);
  });

  it('маппит "blocked" → 403 USER_BLOCKED', () => {
    const { status, response } = mapErrorToResponse(new Error('User is blocked'));
    expect(status).toBe(403);
    expect(response.error.code).toBe(ErrorCode.USER_BLOCKED);
  });

  it('маппит неизвестную ошибку → 400 VALIDATION_ERROR', () => {
    const { status, response } = mapErrorToResponse(new Error('Something unknown'));
    expect(status).toBe(400);
    expect(response.error.code).toBe(ErrorCode.VALIDATION_ERROR);
  });
});
