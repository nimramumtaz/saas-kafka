// Proves Tenant A can never see Tenant B. Run with the API up: npm run isolation
const B = process.env.BASE || 'http://localhost:3000';
const login = async (tenant) => (await (await fetch(B + '/api/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ tenant, email: `admin@${tenant}.com`, password: 'password123' }) })).json()).token;
(async () => {
  const [ta, tb] = [await login('acme'), await login('globex')];
  const get = (p, t, h = {}) => fetch(B + p, { headers: { authorization: 'Bearer ' + t, ...h } });
  const pa = await (await get('/api/v1/products', ta)).json();
  const pb = await (await get('/api/v1/products', tb)).json();
  console.log('A sees only A products :', pa.every((p) => p.sku.startsWith('ACME')));
  console.log('B sees only B products :', pb.every((p) => p.sku.startsWith('GLOBEX')));
  const spoof = await get('/api/v1/products', ta, { 'x-tenant-id': 'globex' });
  console.log('Spoofed header blocked (403):', spoof.status === 403);
  const bad = await fetch(B + '/api/v1/orders', { method: 'POST', headers: { authorization: 'Bearer ' + ta, 'content-type': 'application/json' },
    body: JSON.stringify({ items: [{ productId: pb[0].id, qty: 1 }] }) });
  console.log("A ordering B's product rejected (400):", bad.status === 400);
})();
