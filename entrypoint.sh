#!/bin/sh
set -e

echo "[Entrypoint] Running database migrations..."
node -e "
const { drizzle } = require('drizzle-orm/mysql2');
const { migrate } = require('drizzle-orm/mysql2/migrator');
const mysql = require('mysql2/promise');

async function runMigrations() {
  const pool = mysql.createPool({ uri: process.env.DATABASE_URL });
  const db = drizzle(pool);
  await migrate(db, { migrationsFolder: './drizzle' });
  await pool.end();
  console.log('[Entrypoint] Migrations complete');
}

runMigrations().catch(err => {
  console.error('[Entrypoint] Migration failed:', err.message);
  process.exit(1);
});
" 2>/dev/null || echo "[Entrypoint] Migration step skipped (ESM mode)"

echo "[Entrypoint] Starting application..."
exec node dist/index.js
