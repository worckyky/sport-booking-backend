export function toJsonbValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

export function parsePgArrayLiteral(value: string): string[] {
  const trimmed = value.trim();
  if (trimmed === '{}') return [];
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return [];
  const inner = trimmed.slice(1, -1).trim();
  if (inner.length === 0) return [];
  // For enum[] we expect simple comma-separated tokens without quotes
  return inner
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function normalizeEnumArray<T extends string>(value: unknown): T[] | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value as T[];
  if (typeof value === 'string') return parsePgArrayLiteral(value) as T[];
  return null;
}

export function normalizeJsonArray<T>(value: unknown): T[] | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value as T[];
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed as T[];
      return [];
    } catch {
      return [];
    }
  }
  // If stored incorrectly as JSON object, return empty array instead of {}
  if (typeof value === 'object') return [];
  return [];
}

