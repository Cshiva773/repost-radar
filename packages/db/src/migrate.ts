import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { listMigrationFiles, selectPendingMigrations, type MigrationFileDetails } from './migrationPlan.js';

const MIGRATIONS_DIRECTORY = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const CREATE_LEDGER_SQL = `CREATE TABLE IF NOT EXISTS schema_migrations (
  migration_name TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`;

async function readAppliedMigrationNames(client: pg.PoolClient): Promise<string[]> {
  try {
    const queryResult = await client.query<{ migration_name: string }>('SELECT migration_name FROM schema_migrations');
    return queryResult.rows.map((row) => row.migration_name);
  } catch (error) {
    console.error('Step 2: failed to read schema_migrations', error);
    return [];
  }
}

async function applyMigration(client: pg.PoolClient, migrationFile: MigrationFileDetails): Promise<void> {
  const migrationSql = await readFile(join(MIGRATIONS_DIRECTORY, migrationFile.fileName), 'utf8');
  await client.query('BEGIN');
  try {
    await client.query(migrationSql);
    await client.query('INSERT INTO schema_migrations (migration_name) VALUES ($1)', [migrationFile.migrationName]);
    await client.query('COMMIT');
    console.log(`Step 3: applied migration ${migrationFile.migrationName}`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function runMigrations(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is not set');
  const pool = new pg.Pool({ connectionString: databaseUrl });
  const client = await pool.connect();
  try {
    console.log('Step 1: ensuring schema_migrations ledger exists');
    await client.query(CREATE_LEDGER_SQL);
    const migrationFileList = listMigrationFiles(await readdir(MIGRATIONS_DIRECTORY));
    const pendingMigrationList = selectPendingMigrations(migrationFileList, await readAppliedMigrationNames(client));
    for (const migrationFile of pendingMigrationList) await applyMigration(client, migrationFile);
    console.log(`Step 4: done, ${pendingMigrationList.length} migration(s) applied`);
  } finally {
    client.release();
    await pool.end();
  }
}

runMigrations().catch((error) => {
  console.error('Migration failed', error);
  process.exit(1);
});
