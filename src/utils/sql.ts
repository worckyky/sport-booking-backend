export function assertSafeIdentifier(value: string, name: string): void {
  // allow snake_case, camelCase, digits, and schema.table via dot
  const ok = /^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)?$/.test(value);
  if (!ok) {
    throw new Error(`Invalid ${name}`);
  }
}

export function quoteIdentifier(identifier: string): string {
  // identifiers are validated via assertSafeIdentifier beforehand
  return identifier
    .split('.')
    .map((p) => `"${p.replace(/"/g, '""')}"`)
    .join('.');
}

export function parseSelect(select: string): string[] {
  const trimmed = select.trim();
  if (trimmed === '*' || trimmed.length === 0) return ['*'];

  const parts = trimmed
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (parts.length === 0) return ['*'];
  return parts;
}

