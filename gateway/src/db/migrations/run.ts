import { config as dotenvConfig } from 'dotenv';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env from monorepo root (gateway/src/db/migrations -> root = 4 levels)
// In production (dist/db/migrations), it's also 3 levels up from dist
const envPath = resolve(__dirname, '../../../../.env');
if (existsSync(envPath)) {
  dotenvConfig({ path: envPath });
}

// Import after dotenv loads
const { platformDb } = await import('../platform.js');

export async function runMigrations(): Promise<void> {
  console.log('Running platform database migrations...');

  // Create migrations tracking table
  await platformDb.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL UNIQUE,
      executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // Get already executed migrations
  const executed = await platformDb.query<{ name: string }>(
    'SELECT name FROM _migrations ORDER BY id'
  );
  const executedNames = new Set(executed.rows.map((r) => r.name));

  // Migration files in order
  const migrations = [
    '001_initial.sql',
    '002_auth.sql',
    '003_audit_user_id.sql',
    '004_cron_and_backups.sql',
  ];

  for (const migration of migrations) {
    if (executedNames.has(migration)) {
      console.log(`  Skipping ${migration} (already executed)`);
      continue;
    }

    console.log(`  Running ${migration}...`);
    const sql = readFileSync(join(__dirname, migration), 'utf-8');

    await platformDb.transaction(async (client) => {
      await client.query(sql);
      await client.query('INSERT INTO _migrations (name) VALUES ($1)', [migration]);
    });

    console.log(`  Completed ${migration}`);
  }

  console.log('Migrations complete.');
}

// Only close pool if running as standalone script
// Run if executed directly (works on Windows and Unix, handles URL encoding)
const normalizedUrl = decodeURIComponent(import.meta.url);
const normalizedArgv = `file:///${process.argv[1].replace(/\\/g, '/')}`;
const isMain = normalizedUrl === normalizedArgv;

if (isMain) {
  runMigrations()
    .then(async () => {
      await platformDb.end();
      process.exit(0);
    })
    .catch((err) => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}
