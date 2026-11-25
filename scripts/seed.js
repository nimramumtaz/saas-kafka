require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const admin = new Pool({ connectionString: process.env.ADMIN_DATABASE_URL, ssl: process.env.PG_SSL === 'true' ? { rejectUnauthorized: false } : undefined });

(async () => {
  const bulkIdx = process.argv.indexOf('--bulk');
  const bulk = bulkIdx > -1 ? Number(process.argv[bulkIdx + 1] || 100000) : 0;
  await admin.query('TRUNCATE order_items, orders, products, users, tenants CASCADE');
  const hash = await bcrypt.hash('password123', 10);
  const tenants = [['acme', 'Acme Corp (Tenant A)'], ['globex', 'Globex Inc (Tenant B)']];
  for (const [slug, name] of tenants) {
    const t = (await admin.query('INSERT INTO tenants(slug,name) VALUES ($1,$2) RETURNING id', [slug, name])).rows[0];
    await admin.query('INSERT INTO users(tenant_id,email,password_hash) VALUES ($1,$2,$3)', [t.id, `admin@${slug}.com`, hash]);
    const prods = [['SKU-1', 'Widget', 10], ['SKU-2', 'Gadget', 25], ['SKU-3', 'Gizmo', 40], ['SKU-4', 'Doohickey', 15], ['SKU-5', 'Thingamajig', 60]];
    for (const [sku, n, p] of prods)
      await admin.query('INSERT INTO products(tenant_id,sku,name,price,stock) VALUES ($1,$2,$3,$4,1000)', [t.id, `${slug.toUpperCase()}-${sku}`, `${n} (${slug})`, p]);
    if (bulk) {
      console.log(`Bulk inserting ${bulk} orders for ${slug}...`);
      await admin.query(`INSERT INTO orders(id,tenant_id,status,total,created_at)
        SELECT gen_random_uuid(), $1, 'PROCESSED', round((random()*500)::numeric,2), now() - random()*365*interval '1 day'
        FROM generate_series(1,$2)`, [t.id, bulk]);
      await admin.query(`WITH p AS (SELECT array_agg(id) a FROM products WHERE tenant_id=$1)
        INSERT INTO order_items(order_id,tenant_id,product_id,qty,price)
        SELECT o.id, o.tenant_id, p.a[1+floor(random()*array_length(p.a,1))::int], 1+floor(random()*3)::int, 10
        FROM orders o CROSS JOIN p CROSS JOIN generate_series(1,3) WHERE o.tenant_id=$1`, [t.id]);
    }
  }
  await admin.query('ANALYZE');
  console.log('Seed done. Logins: admin@acme.com / admin@globex.com  password: password123');
  await admin.end();
})().catch((e) => { console.error(e); process.exit(1); });
