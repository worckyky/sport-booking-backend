import type { Pool } from 'pg';
import type { DictionaryItem, CreateDictionaryItemRequest, UpdateDictionaryItemRequest } from '../model/dictionary.model';

type TableName = 'sport_types' | 'facilities';

export class DictionaryAPI {
  constructor(private db: Pool) {}

  // ─── Generic CRUD ───

  async getAll(table: TableName, activeOnly: boolean): Promise<DictionaryItem[]> {
    const where = activeOnly ? 'WHERE is_active = true' : '';
    const result = await this.db.query<DictionaryItem>(
      `SELECT id, code, name, is_active, sort_order, created_at, updated_at
       FROM ${table} ${where} ORDER BY sort_order, code`
    );
    return result.rows;
  }

  async create(table: TableName, data: CreateDictionaryItemRequest): Promise<DictionaryItem> {
    const code = data.code.toUpperCase().replace(/[^A-Z0-9_]/g, '_');

    // Get next sort_order
    const maxRes = await this.db.query<{ max: number }>(
      `SELECT COALESCE(MAX(sort_order), 0) as max FROM ${table}`
    );
    const sortOrder = maxRes.rows[0].max + 1;

    const result = await this.db.query<DictionaryItem>(
      `INSERT INTO ${table} (code, name, sort_order)
       VALUES ($1, $2, $3)
       RETURNING id, code, name, is_active, sort_order, created_at, updated_at`,
      [code, data.name.trim(), sortOrder]
    );
    return result.rows[0];
  }

  async update(table: TableName, id: string, data: UpdateDictionaryItemRequest): Promise<DictionaryItem | null> {
    const sets: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (data.code !== undefined) {
      sets.push(`code = $${idx++}`);
      values.push(data.code.toUpperCase().replace(/[^A-Z0-9_]/g, '_'));
    }
    if (data.name !== undefined) {
      sets.push(`name = $${idx++}`);
      values.push(data.name.trim());
    }
    if (data.is_active !== undefined) {
      sets.push(`is_active = $${idx++}`);
      values.push(data.is_active);
    }

    if (sets.length === 0) return null;

    sets.push(`updated_at = NOW()`);
    values.push(id);

    const result = await this.db.query<DictionaryItem>(
      `UPDATE ${table} SET ${sets.join(', ')} WHERE id = $${idx}
       RETURNING id, code, name, is_active, sort_order, created_at, updated_at`,
      values
    );
    return result.rows[0] ?? null;
  }

  async delete(table: TableName, id: string): Promise<{ deleted: boolean; error?: string }> {
    // Get code first
    const itemRes = await this.db.query<{ code: string }>(
      `SELECT code FROM ${table} WHERE id = $1`,
      [id]
    );
    if (itemRes.rowCount === 0) {
      return { deleted: false, error: 'Not found' };
    }
    const code = itemRes.rows[0].code;

    // Check usage
    const usageCount = await this.checkUsage(table, code);
    if (usageCount > 0) {
      const entity = table === 'sport_types' ? 'полях' : 'площадках';
      return {
        deleted: false,
        error: `Невозможно деактивировать: используется в ${usageCount} ${entity}`,
      };
    }

    // Soft-delete
    await this.db.query(
      `UPDATE ${table} SET is_active = false, updated_at = NOW() WHERE id = $1`,
      [id]
    );
    return { deleted: true };
  }

  async reorder(table: TableName, items: { id: string; sort_order: number }[]): Promise<void> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      for (const item of items) {
        await client.query(
          `UPDATE ${table} SET sort_order = $1, updated_at = NOW() WHERE id = $2`,
          [item.sort_order, item.id]
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // ─── Usage check ───

  private async checkUsage(table: TableName, code: string): Promise<number> {
    if (table === 'sport_types') {
      const res = await this.db.query<{ count: string }>(
        `SELECT COUNT(*)::int as count FROM fields
         WHERE deleted_at IS NULL AND $1 = ANY(sport_types)`,
        [code]
      );
      return parseInt(res.rows[0].count);
    } else {
      // facilities stored as JSONB array in campaign_info
      const res = await this.db.query<{ count: string }>(
        `SELECT COUNT(*)::int as count FROM campaign_info
         WHERE facilities IS NOT NULL AND facilities::jsonb @> $1::jsonb`,
        [JSON.stringify([code])]
      );
      return parseInt(res.rows[0].count);
    }
  }
}
