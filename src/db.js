require('dotenv').config({ quiet: true });
const { Pool, types } = require('pg');

// Devolver NUMERIC como número y TIMESTAMP (sin zona) como texto local tal cual.
types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)));
types.setTypeParser(1114, (v) => v);
types.setTypeParser(1082, (v) => v); // DATE como 'YYYY-MM-DD'

// Todas las fechas "del día" se calculan en la zona horaria del negocio.
const TZ = (process.env.APP_TZ || 'America/Bogota').replace(/[^\w/+-]/g, '');

const pool = new Pool({
  options: `-c timezone=${TZ}`,
  connectionString: process.env.DATABASE_URL || 'postgres://postgres@localhost:5432/canchas',
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
});

async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { pool, query: (t, p) => pool.query(t, p), tx };
