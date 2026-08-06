const fs = require('fs');
const path = require('path');
const { pool } = require('./pool');

/**
 * Run SQL migration files in order.
 * @returns {Promise<void>}
 */
async function migrate() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id SERIAL PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        applied_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    const dir = path.join(__dirname, 'migrations');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

    for (const file of files) {
      const applied = await client.query('SELECT 1 FROM _migrations WHERE name = $1', [file]);
      if (applied.rowCount > 0) continue;

      const sql = fs.readFileSync(path.join(dir, file), 'utf8');
      console.log(`Applying migration: ${file}`);
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`✓ ${file}`);
    }
    console.log('Migrations complete.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) migrate();

module.exports = { migrate };
