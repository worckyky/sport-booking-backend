import * as fs from 'fs';
import * as path from 'path';
import { Pool } from 'pg';
import bcrypt from 'bcryptjs';

const DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/sport_booking';

async function seed() {
  const pool = new Pool({ connectionString: DATABASE_URL });

  try {
    console.log('🌱 Starting seed process...');
    console.log(`📦 Connecting to database: ${DATABASE_URL.replace(/:[^:]*@/, ':***@')}`);

    // Generate real password hash for test123
    const passwordHash = await bcrypt.hash('test123', 10);
    console.log('🔐 Generated password hash for test users');

    // Read seed SQL file
    const seedPath = path.join(__dirname, '../../migrations/seed.sql');
    let seedSQL = fs.readFileSync(seedPath, 'utf8');

    // Replace placeholder hash with real bcrypt hash
    seedSQL = seedSQL.replace(/\$2b\$10\$rqZ1qhQX8ZQK5x9X9X9X9O5Z1qhQX8ZQK5x9X9X9X9O5Z1qhQX8ZQ/g, passwordHash);

    console.log('📄 Executing seed.sql...');

    // Execute seed SQL
    await pool.query(seedSQL);

    console.log('✅ Seed completed successfully!');
    console.log('');
    console.log('🔑 Test accounts:');
    console.log('   USER:     player@test.com / test123');
    console.log('   CAMPAIGN: campaign@test.com / test123');
    console.log('   CAMPAIGN: campaign2@test.com / test123');
    console.log('   ADMIN:    admin@test.com / test123');
    console.log('');
    console.log('📊 Additional test users:');
    console.log('   user2@test.com / test123');
    console.log('   user3@test.com / test123');

  } catch (error) {
    console.error('❌ Seed failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

seed();
