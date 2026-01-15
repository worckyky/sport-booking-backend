import { Pool, type PoolConfig } from 'pg';

let pool: Pool | null = null;

function getPoolConfig(): PoolConfig {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('Missing DATABASE_URL env var');
  }

  return {
    connectionString: databaseUrl,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined
  };
}

export function getDbPool(): Pool {
  if (pool) return pool;
  pool = new Pool(getPoolConfig());
  return pool;
}

