import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config({ quiet: true });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const migrationsDir = path.join(projectRoot, 'migrations');
const isStatusMode = process.argv.includes('--status');

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      filename VARCHAR(255) UNIQUE NOT NULL,
      applied_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

async function readMigrationFiles() {
  await fs.mkdir(migrationsDir, { recursive: true });
  const entries = await fs.readdir(migrationsDir, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

async function run() {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(72727272)');
    await ensureMigrationsTable(client);

    const files = await readMigrationFiles();
    const appliedResult = await client.query('SELECT filename FROM schema_migrations ORDER BY filename ASC');
    const appliedSet = new Set(appliedResult.rows.map((row) => row.filename));
    const pendingFiles = files.filter((file) => !appliedSet.has(file));

    if (isStatusMode) {
      console.log(`Total migrations: ${files.length}`);
      console.log(`Applied: ${appliedSet.size}`);
      console.log(`Pending: ${pendingFiles.length}`);

      if (pendingFiles.length > 0) {
        console.log('Pending migration files:');
        for (const file of pendingFiles) {
          console.log(`- ${file}`);
        }
      }
      return;
    }

    if (pendingFiles.length === 0) {
      console.log('No pending migrations. Database is up to date.');
      return;
    }

    for (const file of pendingFiles) {
      const migrationPath = path.join(migrationsDir, file);
      const sql = await fs.readFile(migrationPath, 'utf8');

      await client.query('BEGIN');
      try {
        if (sql.trim().length > 0) {
          await client.query(sql);
        }

        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`Applied migration: ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Failed migration ${file}: ${err.message}`);
      }
    }

    console.log('Migrations completed successfully.');
  } finally {
    try {
      await client.query('SELECT pg_advisory_unlock(72727272)');
    } catch (_err) {
      // ignore unlock errors to avoid masking the migration error
    }
    client.release();
  }
}

run()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
