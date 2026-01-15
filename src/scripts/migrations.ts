import { Umzug } from 'umzug';
import { readFile } from 'fs/promises';
import path from 'path';
import type { Pool } from 'pg';

type MigrationContext = { query: (sql: string) => Promise<unknown> };

export function createUmzug(pool: Pool): Umzug<MigrationContext> {
  return new Umzug<MigrationContext>({
    context: {
      query: async (sql: string) => pool.query(sql)
    },
    migrations: {
      glob: ['migrations/*.sql', { cwd: process.cwd() }],
      resolve: ({ name, path: filePath, context }) => {
        return {
          name,
          up: async () => {
            if (!filePath) throw new Error(`Migration file path missing for ${name}`);
            const full = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
            const sql = await readFile(full, 'utf8');
            await context.query(sql);
          },
          down: async () => {
            throw new Error('Down migrations are not supported for .sql migrations in this project');
          }
        };
      }
    },
    storage: {
      async logMigration({ name }): Promise<void> {
        await pool.query('insert into migrations (name, executed_at) values ($1, now())', [name]);
      },
      async unlogMigration({ name }): Promise<void> {
        await pool.query('delete from migrations where name = $1', [name]);
      },
      async executed(): Promise<string[]> {
        await pool.query(
          `create table if not exists migrations (
            name text primary key,
            executed_at timestamptz not null default now()
          )`
        );
        const res = await pool.query<{ name: string }>('select name from migrations order by name');
        return res.rows.map((r) => r.name);
      }
    },
    logger: console
  });
}

export async function runMigrations(pool: Pool): Promise<void> {
  const umzug = createUmzug(pool);
  await umzug.up();
}

