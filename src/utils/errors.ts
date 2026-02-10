import { Response } from 'express';

/**
 * Standard error codes
 */
export enum ErrorCode {
  // Validation
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  INVALID_FORMAT = 'INVALID_FORMAT',
  REQUIRED_FIELD = 'REQUIRED_FIELD',

  // Auth
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  USER_NOT_FOUND = 'USER_NOT_FOUND',
  USER_BLOCKED = 'USER_BLOCKED',
  INVALID_CREDENTIALS = 'INVALID_CREDENTIALS',
  TOKEN_EXPIRED = 'TOKEN_EXPIRED',

  // Resources
  NOT_FOUND = 'NOT_FOUND',
  ALREADY_EXISTS = 'ALREADY_EXISTS',
  CONFLICT = 'CONFLICT',

  // Booking specific
  SLOT_NOT_FOUND = 'SLOT_NOT_FOUND',
  SLOT_BLOCKED = 'SLOT_BLOCKED',
  SLOT_ALREADY_BOOKED = 'SLOT_ALREADY_BOOKED',
  SLOT_OVERLAP = 'SLOT_OVERLAP',
  BOOKING_NOT_FOUND = 'BOOKING_NOT_FOUND',
  INVALID_STATUS_TRANSITION = 'INVALID_STATUS_TRANSITION',
  SCHEDULE_CONFLICT = 'SCHEDULE_CONFLICT',
  ACTIVE_BOOKINGS_EXIST = 'ACTIVE_BOOKINGS_EXIST',

  // Rate limiting
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  BOOKING_LIMIT_EXCEEDED = 'BOOKING_LIMIT_EXCEEDED',

  // Server
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}

export interface ApiError {
  code: ErrorCode | string;
  message: string;
  field?: string;
  details?: unknown;
}

export interface ApiErrorResponse {
  error: ApiError;
}

/**
 * Create standard error response
 */
export function createError(
  code: ErrorCode | string,
  message: string,
  field?: string,
  details?: unknown
): ApiErrorResponse {
  const error: ApiError = { code, message };
  if (field) {
    error.field = field;
  }
  if (details) {
    error.details = details;
  }
  return { error };
}

/**
 * Send error response with appropriate status code
 */
export function sendError(
  res: Response,
  status: number,
  code: ErrorCode | string,
  message: string,
  field?: string,
  details?: unknown
): void {
  res.status(status).json(createError(code, message, field, details));
}

/**
 * Common error responses
 */
export const Errors = {
  badRequest: (res: Response, message: string, field?: string) =>
    sendError(res, 400, ErrorCode.VALIDATION_ERROR, message, field),

  unauthorized: (res: Response, message = 'Authentication required') =>
    sendError(res, 401, ErrorCode.UNAUTHORIZED, message),

  forbidden: (res: Response, message = 'Access denied') =>
    sendError(res, 403, ErrorCode.FORBIDDEN, message),

  notFound: (res: Response, resource: string) =>
    sendError(res, 404, ErrorCode.NOT_FOUND, `${resource} not found`),

  conflict: (res: Response, code: ErrorCode | string, message: string) =>
    sendError(res, 409, code, message),

  internal: (res: Response) =>
    sendError(res, 500, ErrorCode.INTERNAL_ERROR, 'Internal server error'),
};

/**
 * Map common error messages to structured errors
 */
export function mapErrorToResponse(error: Error): { status: number; response: ApiErrorResponse } {
  const message = error.message;

  // Booking errors
  if (message === 'Slot not found') {
    return { status: 404, response: createError(ErrorCode.SLOT_NOT_FOUND, message) };
  }
  if (message === 'Slot is blocked') {
    return { status: 400, response: createError(ErrorCode.SLOT_BLOCKED, message) };
  }
  if (message === 'Slot already booked') {
    return { status: 409, response: createError(ErrorCode.SLOT_ALREADY_BOOKED, message) };
  }
  if (message.includes('overlap')) {
    return { status: 409, response: createError(ErrorCode.SLOT_OVERLAP, message) };
  }
  if (message.includes('Invalid status transition')) {
    return { status: 400, response: createError(ErrorCode.INVALID_STATUS_TRANSITION, message) };
  }
  if (message.includes('active bookings')) {
    return { status: 409, response: createError(ErrorCode.ACTIVE_BOOKINGS_EXIST, message) };
  }
  if (message.includes('расписание') || message.includes('schedule')) {
    return { status: 400, response: createError(ErrorCode.SCHEDULE_CONFLICT, message) };
  }

  // Auth errors
  if (message.includes('blocked')) {
    return { status: 403, response: createError(ErrorCode.USER_BLOCKED, message) };
  }

  // Default
  return { status: 400, response: createError(ErrorCode.VALIDATION_ERROR, message) };
}

/**
 * Handle error and send response
 */
export function handleError(res: Response, error: unknown): void {
  // PostgreSQL error codes (e.g. unique_violation from race condition)
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const pgError = error as { code?: string; constraint?: string };
    if (pgError.code === '23505') {
      if (pgError.constraint?.includes('idx_bookings_slot_active')) {
        res.status(409).json(createError(ErrorCode.SLOT_ALREADY_BOOKED, 'Slot already booked'));
        return;
      }
      res.status(409).json(createError(ErrorCode.CONFLICT, 'Resource already exists'));
      return;
    }
  }

  if (error instanceof Error) {
    const { status, response } = mapErrorToResponse(error);
    res.status(status).json(response);
  } else {
    Errors.internal(res);
  }
}
