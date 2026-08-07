const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const config = require('../config');

let activePool;
let initPromise;
let usingDevMemory = false;
let snapshotTimer;

const DEV_SNAPSHOT_FILE = path.join(__dirname, '../../dev-db-snapshot.json');
const SNAPSHOT_TABLES = [
  'settings',
  'users',
  'events',
  'user_profiles',
  'registrations',
  'team_members',
  'payments',
  'email_logs',
];

function createPostgresPool() {
  return new Pool({
    connectionString: config.databaseUrl,
    ssl: config.nodeEnv === 'production' ? { rejectUnauthorized: false } : false,
  });
}

function createMemoryPool() {
  const { newDb, DataType } = require('pg-mem');
  const db = newDb({ autoCreateForeignKeyIndices: true });

  db.public.registerFunction({
    name: 'gen_random_uuid',
    returns: DataType.uuid,
    impure: true,
    implementation: uuidv4,
  });

  const adapter = db.adapters.createPg();
  return new adapter.Pool();
}

function isMutation(text = '') {
  return /^\s*(insert|update|delete|alter|create|drop|truncate)\b/i.test(String(text));
}

async function tableExists(table) {
  try {
    await activePool.query(`SELECT 1 FROM ${table} LIMIT 1`);
    return true;
  } catch (_err) {
    return false;
  }
}

async function saveDevSnapshot() {
  if (!usingDevMemory || !activePool) return;

  const snapshot = { savedAt: new Date().toISOString(), tables: {} };
  for (const table of SNAPSHOT_TABLES) {
    if (!(await tableExists(table))) continue;
    const result = await activePool.query(`SELECT * FROM ${table}`);
    snapshot.tables[table] = result.rows;
  }

  fs.writeFileSync(DEV_SNAPSHOT_FILE, JSON.stringify(snapshot, null, 2));
}

function scheduleDevSnapshot() {
  if (!usingDevMemory) return;
  clearTimeout(snapshotTimer);
  snapshotTimer = setTimeout(() => {
    saveDevSnapshot().catch((err) => {
      console.warn('Could not save local dev database snapshot:', err.message);
    });
  }, 100);
}

async function restoreTable(table, rows) {
  if (!rows?.length) return;
  const columns = Object.keys(rows[0]);
  const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');
  const sql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`;

  for (const row of rows) {
    const values = columns.map((column) => {
      const value = row[column];
      if (value && typeof value === 'object' && !(value instanceof Date)) return JSON.stringify(value);
      return value;
    });
    await activePool.query(sql, values);
  }
}

async function restoreDevSnapshot() {
  if (!fs.existsSync(DEV_SNAPSHOT_FILE)) return;

  try {
    const snapshot = JSON.parse(fs.readFileSync(DEV_SNAPSHOT_FILE, 'utf8'));
    for (const table of SNAPSHOT_TABLES) {
      await restoreTable(table, snapshot.tables?.[table] || []);
    }
    console.log('Loaded local dev database snapshot.');
  } catch (err) {
    console.warn('Could not load local dev database snapshot:', err.message);
  }
}

async function applyMemorySchemaAndSeed() {
  await activePool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id SERIAL PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  const dir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(dir).filter((file) => file.endsWith('.sql')).sort();
  for (const file of files) {
    const applied = await activePool.query('SELECT 1 FROM _migrations WHERE name = $1', [file]);
    if (applied.rowCount > 0) continue;

    const sql = fs
      .readFileSync(path.join(dir, file), 'utf8')
      .replace(/CREATE EXTENSION IF NOT EXISTS "pgcrypto";/i, '');
    await activePool.query(sql);
    await activePool.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
  }

  await restoreDevSnapshot();

  const { seed } = require('./seed');
  await seed();
  await saveDevSnapshot();
}

async function initPool() {
  if (activePool) return activePool;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const postgresPool = createPostgresPool();
    try {
      await postgresPool.query('SELECT 1');
      activePool = postgresPool;
    } catch (err) {
      await postgresPool.end().catch(() => {});
      if (config.nodeEnv !== 'development') throw err;

      console.warn('PostgreSQL is not available. Using persistent local dev database.');
      usingDevMemory = true;
      activePool = createMemoryPool();
      await applyMemorySchemaAndSeed();
    }

    return activePool;
  })();

  return initPromise;
}

/** PostgreSQL-compatible connection pool */
const pool = {
  async connect() {
    return (await initPool()).connect();
  },
  async query(text, params) {
    const targetPool = await initPool();
    const result = await targetPool.query(text, params);
    if (isMutation(text)) scheduleDevSnapshot();
    return result;
  },
  async end() {
    if (!activePool) return;
    await saveDevSnapshot();
    clearTimeout(snapshotTimer);
    await activePool.end();
    activePool = undefined;
    initPromise = undefined;
    usingDevMemory = false;
  },
};

/**
 * Execute a parameterized query.
 * @param {string} text - SQL query
 * @param {Array} [params] - Query parameters
 * @returns {Promise<import('pg').QueryResult>}
 */
async function query(text, params) {
  return pool.query(text, params);
}

module.exports = { pool, query };
