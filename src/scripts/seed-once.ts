import * as fs from 'fs';
import * as path from 'path';
import { Pool } from 'pg';
import bcrypt from 'bcryptjs';

const DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/sport_booking';
const SEED_NAME = 'base_seed_v1';
const SEED_LOCK_KEY = 982451653;

async function seedOnce() {
  const pool = new Pool({ connectionString: DATABASE_URL });
  const client = await pool.connect();

  try {
    console.log('🌱 Starting one-time seed process...');
    console.log(`📦 Connecting to database: ${DATABASE_URL.replace(/:[^:]*@/, ':***@')}`);

    // Serialize seed runs across concurrent deploys/restarts.
    await client.query('SELECT pg_advisory_lock($1)', [SEED_LOCK_KEY]);

    await client.query(
      `CREATE TABLE IF NOT EXISTS seed_runs (
        name TEXT PRIMARY KEY,
        executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`
    );

    await client.query('BEGIN');

    const marker = await client.query<{ name: string }>(
      'INSERT INTO seed_runs(name) VALUES ($1) ON CONFLICT (name) DO NOTHING RETURNING name',
      [SEED_NAME]
    );

    if (marker.rowCount === 0) {
      await client.query('ROLLBACK');
      console.log(`⏭️ Seed "${SEED_NAME}" already executed. Skipping.`);
      return;
    }

    const passwordHash = await bcrypt.hash('test123', 12);
    console.log('🔐 Generated password hash for test users');

    const seedPath = path.join(__dirname, '../../seeds/seed.sql');
    let seedSQL = fs.readFileSync(seedPath, 'utf8');
    seedSQL = seedSQL.replace(/\$2b\$10\$rqZ1qhQX8ZQK5x9X9X9X9O5Z1qhQX8ZQK5x9X9X9X9O5Z1qhQX8ZQ/g, passwordHash);

    console.log('📄 Executing seed.sql...');
    await client.query(seedSQL);

    await client.query('COMMIT');
    console.log(`✅ One-time seed "${SEED_NAME}" completed successfully!`);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error('❌ One-time seed failed:', error);
    process.exit(1);
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [SEED_LOCK_KEY]).catch(() => undefined);
    client.release();
    await pool.end();
  }
}

seedOnce();
