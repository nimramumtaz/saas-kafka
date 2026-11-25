require('dotenv').config();
const { Pool } = require('pg');

// Connection pooling: reuse up to PG_POOL_MAX connections
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.PG_POOL_MAX || 20),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  ssl: process.env.PG_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
});

// Every tenant query MUST go through this: sets app.tenant_id for RLS (transaction-local)
async function withTenant(tenantId, fn) {
  if (!tenantId) throw new Error('tenantId required');
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}
module.exports = { pool, withTenant };
