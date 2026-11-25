require('dotenv').config();
const { kafka, TOPIC, ensureTopic } = require('./kafka');
const { withTenant } = require('./db');

async function processOrder(e) {
  return withTenant(e.tenantId, async (c) => {
    const ids = e.items.map((i) => i.productId);
    const prods = (await c.query('SELECT id, price, stock FROM products WHERE id = ANY($1::uuid[]) FOR UPDATE', [ids])).rows;
    const map = Object.fromEntries(prods.map((p) => [p.id, p]));
    const ok = e.items.every((i) => map[i.productId] && map[i.productId].stock >= i.qty);
    const total = ok ? e.items.reduce((s, i) => s + Number(map[i.productId].price) * i.qty, 0) : 0;
    // idempotency: Kafka is at-least-once, so duplicates are ignored via PK
    const ins = await c.query(
      `INSERT INTO orders(id, tenant_id, status, total, created_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO NOTHING RETURNING id`,
      [e.orderId, e.tenantId, ok ? 'PROCESSED' : 'REJECTED_OUT_OF_STOCK', total, e.createdAt]);
    if (!ins.rowCount) return { duplicate: true };
    if (ok) for (const i of e.items) {
      await c.query('UPDATE products SET stock = stock - $1 WHERE id=$2', [i.qty, i.productId]); // inventory update
      await c.query('INSERT INTO order_items(order_id, tenant_id, product_id, qty, price) VALUES ($1,$2,$3,$4,$5)',
        [e.orderId, e.tenantId, i.productId, i.qty, map[i.productId].price]);
    }
    return { ok, total };
  });
}

async function callInvoiceFn(e, total) {
  const url = process.env.INVOICE_FUNCTION_URL;
  if (!url) return;
  const t0 = Date.now();
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orderId: e.orderId, tenantId: e.tenantId, total }) });
    const j = await r.json();
    console.log(`[invoice-fn] ${j.coldStart ? 'COLD' : 'WARM'} start | handler=${j.handlerMs}ms | roundtrip=${Date.now() - t0}ms | instanceAge=${j.instanceAgeMs}ms`);
  } catch (err) { console.warn('[invoice-fn] failed:', err.message); }
}

async function start() {
  await ensureTopic();
  const consumer = kafka.consumer({ groupId: process.env.KAFKA_GROUP_ID || 'order-processors' });
  await consumer.connect();
  await consumer.subscribe({ topic: TOPIC, fromBeginning: false });
  await consumer.run({
    eachMessage: async ({ topic, partition, message }) => {
      const e = JSON.parse(message.value.toString());
      const res = await processOrder(e);
      console.log(`[consumer] topic=${topic} partition=${partition} offset=${message.offset} key=${message.key} order=${e.orderId} ->`, JSON.stringify(res));
      if (res.ok) await callInvoiceFn(e, res.total);
    },
  });
  console.log('[consumer] running, group =', process.env.KAFKA_GROUP_ID || 'order-processors');
}
module.exports = { start };
