require('dotenv').config();
const fs = require('fs');
const { Pool } = require('pg');
const { pool, withTenant } = require('../src/db');
const admin = new Pool({ connectionString: process.env.ADMIN_DATABASE_URL, ssl: process.env.PG_SSL === 'true' ? { rejectUnauthorized: false } : undefined });
const Q = 'SELECT * FROM orders WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 50';
let out = '# Benchmark Results\n\n';
const log = (s) => { console.log(s); out += s + '\n'; };

async function explain(tid) {
  const r = await admin.query('EXPLAIN (ANALYZE, BUFFERS) ' + Q, [tid]);
  const lines = r.rows.map((x) => x['QUERY PLAN']);
  const ms = Number(lines.find((l) => l.startsWith('Execution Time')).match(/[\d.]+/)[0]);
  return { text: lines.join('\n'), ms };
}
async function avg(fn, n = 5) { await fn(); const t = Date.now(); for (let i = 0; i < n; i++) await fn(); return (Date.now() - t) / n; }

(async () => {
  const tid = (await admin.query("SELECT id FROM tenants WHERE slug='acme'")).rows[0].id;
  const total = (await admin.query('SELECT count(*) FROM orders')).rows[0].count;
  log(`Dataset: ${total} orders total\n`);

  // 1. N+1 vs JOIN (via app pool => RLS active)
  const nPlus1 = () => withTenant(tid, async (c) => {
    const os = (await c.query('SELECT * FROM orders WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 50', [tid])).rows;
    for (const o of os) await c.query('SELECT * FROM order_items WHERE order_id=$1', [o.id]);
  });
  const join = () => withTenant(tid, (c) => c.query(
    `WITH r AS (SELECT * FROM orders WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 50)
     SELECT r.*, json_agg(oi.*) FROM r LEFT JOIN order_items oi ON oi.order_id=r.id GROUP BY r.id, r.tenant_id, r.status, r.total, r.created_at`, [tid]));
  const a = await avg(nPlus1), b = await avg(join);
  log('## N+1 vs JOIN (50 orders)\n');
  log(`| Approach | Queries | Avg latency |\n|---|---|---|\n| N+1 | 51 | ${a.toFixed(1)} ms |\n| JOIN | 1 | ${b.toFixed(1)} ms |\n`);
  log(`Speedup: ${(a / b).toFixed(1)}x\n`);

  // 2. EXPLAIN ANALYZE before/after composite index
  await admin.query('DROP INDEX IF EXISTS idx_orders_tenant_created');
  await admin.query('ANALYZE orders');
  const before = await explain(tid);
  await admin.query('CREATE INDEX idx_orders_tenant_created ON orders (tenant_id, created_at DESC)');
  await admin.query('ANALYZE orders');
  const after = await explain(tid);
  log('## EXPLAIN ANALYZE - BEFORE index\n```\n' + before.text + '\n```\n');
  log('## EXPLAIN ANALYZE - AFTER index (tenant_id, created_at DESC)\n```\n' + after.text + '\n```\n');
  log(`**Execution time: ${before.ms} ms -> ${after.ms} ms (${(before.ms / after.ms).toFixed(1)}x faster)**`);
  fs.writeFileSync('BENCHMARK_RESULTS.md', out);
  console.log('\nSaved to BENCHMARK_RESULTS.md');
  await admin.end(); await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
