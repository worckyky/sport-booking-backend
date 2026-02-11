import { PaymentMethod, Facility, Sport } from '../campaign/model/campaign.model';

// ==================== Enum Validators ====================

const PAYMENT_METHODS = new Set(Object.values(PaymentMethod));
const FACILITIES = new Set(Object.values(Facility));
const SPORT_TYPES = new Set(Object.values(Sport));

export function validatePaymentMethods(methods: unknown): string | null {
  if (!Array.isArray(methods)) return 'payment_methods must be an array';
  for (const m of methods) {
    if (!PAYMENT_METHODS.has(m as PaymentMethod)) {
      return `Invalid payment method: "${m}". Allowed: ${[...PAYMENT_METHODS].join(', ')}`;
    }
  }
  return null;
}

export function validateFacilities(facilities: unknown): string | null {
  if (!Array.isArray(facilities)) return 'facilities must be an array';
  for (const f of facilities) {
    if (!FACILITIES.has(f as Facility)) {
      return `Invalid facility: "${f}". Allowed: ${[...FACILITIES].join(', ')}`;
    }
  }
  return null;
}

export function validateSportTypes(types: unknown): string | null {
  if (!Array.isArray(types) || types.length === 0) return 'sport_types array is required';
  for (const t of types) {
    if (!SPORT_TYPES.has(t as Sport)) {
      return `Invalid sport type: "${t}". Allowed: ${[...SPORT_TYPES].join(', ')}`;
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
