import type { Pool } from 'pg';
import { PaymentMethod } from '../campaign/model/campaign.model';

// ==================== Password Validator ====================

export function validatePassword(password: string): string | null {
  if (password.length < 8) return 'Пароль должен содержать минимум 8 символов';
  if (password.length > 128) return 'Пароль слишком длинный';
  if (!/[a-zA-Zа-яА-ЯёЁ]/.test(password)) return 'Пароль должен содержать хотя бы одну букву';
  if (!/\d/.test(password)) return 'Пароль должен содержать хотя бы одну цифру';
  return null;
}

// ==================== Enum Validators ====================

const PAYMENT_METHODS = new Set(Object.values(PaymentMethod));

export function validatePaymentMethods(methods: unknown): string | null {
  if (!Array.isArray(methods)) return 'payment_methods must be an array';
  for (const m of methods) {
    if (!PAYMENT_METHODS.has(m as PaymentMethod)) {
      return `Invalid payment method: "${m}". Allowed: ${[...PAYMENT_METHODS].join(', ')}`;
    }
  }
  return null;
}

// ==================== Dynamic Dictionary Validators ====================

export async function validateFacilities(db: Pool, facilities: unknown): Promise<string | null> {
  if (!Array.isArray(facilities)) return 'facilities must be an array';
  const result = await db.query<{ code: string }>('SELECT code FROM facilities WHERE is_active = true');
  const valid = new Set(result.rows.map(r => r.code));
  for (const f of facilities) {
    if (!valid.has(f as string)) {
      return `Invalid facility: "${f}"`;
    }
  }
  return null;
}

export async function validateSportTypes(db: Pool, types: unknown): Promise<string | null> {
  if (!Array.isArray(types) || types.length === 0) return 'sport_types array is required';
  const result = await db.query<{ code: string }>('SELECT code FROM sport_types WHERE is_active = true');
  const valid = new Set(result.rows.map(r => r.code));
  for (const t of types) {
    if (!valid.has(t as string)) {
      return `Invalid sport type: "${t}"`;
    }
  }
  return null;
}

// ==================== Working Timetable Validator ====================

const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;
const VALID_DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

export function validateWorkingTimetable(timetable: unknown): string | null {
  if (!timetable || typeof timetable !== 'object') return 'working_timetable must be an object';

  const tt = timetable as Record<string, unknown>;

  for (const key of Object.keys(tt)) {
    if (!VALID_DAYS.includes(key)) {
      return `Invalid day in timetable: "${key}"`;
    }

    const day = tt[key];
    if (day === null) continue; // null = выходной

    if (typeof day !== 'object' || !day) {
      return `Day "${key}" must be an object with {from, to} or null`;
    }

    const { from, to } = day as Record<string, unknown>;

    if (typeof from !== 'string' || !TIME_REGEX.test(from)) {
      return `Invalid "from" time for ${key}: "${from}". Expected HH:mm`;
    }
    if (typeof to !== 'string' || !TIME_REGEX.test(to)) {
      return `Invalid "to" time for ${key}: "${to}". Expected HH:mm`;
    }
    if (from >= to) {
      return `"from" (${from}) must be earlier than "to" (${to}) for ${key}`;
    }
  }

  return null;
}

// ==================== Timezone Validator ====================

// Cache supported timezones (available in Node.js 18+)
let supportedTimezones: Set<string> | null = null;

function getSupportedTimezones(): Set<string> {
  if (!supportedTimezones) {
    try {
      // Intl.supportedValuesOf available in Node 18+
      supportedTimezones = new Set((Intl as any).supportedValuesOf('timeZone'));
    } catch {
      // Fallback for older Node.js — accept any non-empty string
      supportedTimezones = new Set();
    }
  }
  return supportedTimezones;
}

export function validateTimezoneId(tz: unknown): string | null {
  if (typeof tz !== 'string' || !tz.trim()) {
    return 'timezone_id must be a non-empty string';
  }
  const supported = getSupportedTimezones();
  // If we have a list and the TZ isn't in it — reject
  if (supported.size > 0 && !supported.has(tz)) {
    return `Invalid timezone: "${tz}". Example: "Europe/Moscow"`;
  }
  return null;
}
