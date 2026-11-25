const jwt = require('jsonwebtoken');
const SECRET = process.env.JWT_SECRET || 'dev-secret';

const sign = (u) => jwt.sign({ sub: u.id, tenantId: u.tenant_id, tenantSlug: u.slug, email: u.email }, SECRET, { expiresIn: '8h' });

// Tenant Resolution Middleware: tenant comes from the signed JWT claim.
// Optional x-tenant-id header (slug or uuid) must MATCH the token, else 403 (anti-spoofing).
function tenantMiddleware(req, res, next) {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Bearer ')) return res.status(401).json({ error: 'Missing token' });
  try {
    const claims = jwt.verify(h.slice(7), SECRET);
    const hdr = req.headers['x-tenant-id'];
    if (hdr && hdr !== claims.tenantId && hdr !== claims.tenantSlug)
      return res.status(403).json({ error: 'Tenant mismatch: x-tenant-id does not match token' });
    req.tenantId = claims.tenantId;
    req.user = claims;
    next();
  } catch { return res.status(401).json({ error: 'Invalid token' }); }
}
module.exports = { sign, tenantMiddleware };
