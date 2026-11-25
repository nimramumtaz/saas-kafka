require('dotenv').config();
const express = require('express');
const path = require('path');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { pool, withTenant } = require('./db');
const { sign, tenantMiddleware } = require('./auth');
const { publishOrderCreated, ensureTopic } = require('./kafka');
const invoice = require('../api/invoice');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));
app.all('/api/invoice', (req, res) => invoice(req, res)); // same handler as Vercel serverless fn

app.get('/health', (_, res) => res.json({ ok: true }));

app.post('/api/v1/auth/login', async (req, res, next) => {
  try {
    const { tenant, email, password } = req.body || {};
    const t = await pool.query('SELECT id, slug FROM tenants WHERE slug=$1', [tenant]);
    if (!t.rowCount) return res.status(401).json({ error: 'Invalid credentials' });
    const u = await withTenant(t.rows[0].id, (c) => c.query('SELECT * FROM users WHERE email=$1', [email]));
    if (!u.rowCount || !(await bcrypt.compare(password || '', u.rows[0].password_hash)))
      return res.status(401).json({ error: 'Invalid credentials' });
    res.json({ token: sign({ ...u.rows[0], slug: t.rows[0].slug }), tenant: t.rows[0].slug });
  } catch (e) { next(e); }
});

const api = express.Router();
api.use(tenantMiddleware);
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

api.get('/products', wrap(async (req, res) => {
  const r = await withTenant(req.tenantId, (c) => c.query('SELECT id, sku, name, price, stock FROM products ORDER BY sku'));
  res.json(r.rows);
}));

// 202 Accepted + publish OrderCreated to Kafka (key = tenant_id)
api.post('/orders', wrap(async (req, res) => {
  const items = req.body && req.body.items;
  if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'items[] required' });
  const ids = items.map((i) => i.productId);
  const found = await withTenant(req.tenantId, (c) => c.query('SELECT id FROM products WHERE id = ANY($1::uuid[])', [ids]));
  if (found.rowCount !== new Set(ids).size) return res.status(400).json({ error: 'Unknown product for this tenant' });
  const event = {
    orderId: crypto.randomUUID(), tenantId: req.tenantId, userId: req.user.sub,
    items: items.map((i) => ({ productId: i.productId, qty: Math.max(1, parseInt(i.qty, 10) || 1) })),
    createdAt: new Date().toISOString(),
  };
  const meta = await publishOrderCreated(event);
  res.status(202).json({ status: 'accepted', orderId: event.orderId, kafka: { partition: meta.partition, offset: meta.baseOffset } });
}));

// ---- N+1 version (intentionally slow) ----
api.get('/orders/slow', wrap(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 500);
  const t0 = process.hrtime.bigint();
  let queries = 0;
  const data = await withTenant(req.tenantId, async (c) => {
    const orders = (await c.query('SELECT * FROM orders WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT $2', [req.tenantId, limit])).rows; queries++;
    for (const o of orders) { o.items = (await c.query('SELECT product_id, qty, price FROM order_items WHERE order_id=$1', [o.id])).rows; queries++; }
    return orders;
  });
  res.json({ mode: 'N+1', queries, ms: Number(process.hrtime.bigint() - t0) / 1e6, data });
}));

// ---- Optimized: single JOIN + json_agg ----
api.get('/orders', wrap(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 500);
  const t0 = process.hrtime.bigint();
  const r = await withTenant(req.tenantId, (c) => c.query(
    `WITH recent AS (SELECT * FROM orders WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT $2)
     SELECT r.*, COALESCE(json_agg(json_build_object('product_id',oi.product_id,'qty',oi.qty,'price',oi.price))
            FILTER (WHERE oi.id IS NOT NULL), '[]') AS items
     FROM recent r LEFT JOIN order_items oi ON oi.order_id = r.id
     GROUP BY r.id, r.tenant_id, r.status, r.total, r.created_at ORDER BY r.created_at DESC`, [req.tenantId, limit]));
  res.json({ mode: 'JOIN', queries: 1, ms: Number(process.hrtime.bigint() - t0) / 1e6, data: r.rows });
}));

api.get('/orders/:id', wrap(async (req, res) => {
  const r = await withTenant(req.tenantId, (c) => c.query('SELECT * FROM orders WHERE id=$1', [req.params.id]));
  if (!r.rowCount) return res.status(404).json({ error: 'Not found (still processing, or belongs to another tenant)' });
  res.json(r.rows[0]);
}));
app.use('/api/v1', api);

app.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: 'Internal error' }); });

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`API on :${PORT}`);
  await ensureTopic();
  if (process.env.RUN_CONSUMER === 'true') require('./consumer').start().catch((e) => console.error('[consumer]', e));
});
