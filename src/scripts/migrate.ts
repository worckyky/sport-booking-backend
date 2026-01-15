import { getDbPool } from '../config/db';
import { runMigrations } from './migrations';

async function main(): Promise<void> {
  const pool = getDbPool();

  await runMigrations(pool);
  await pool.end();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

