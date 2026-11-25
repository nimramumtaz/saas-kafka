// Serverless function (Vercel: /api/invoice). Same file also runs locally via Express.
// Module scope runs ONCE per container => that is the cold-start marker.
const bootTime = Date.now();
let invocations = 0;

module.exports = async (req, res) => {
  const t0 = process.hrtime.bigint();
  const coldStart = invocations === 0;
  invocations++;
  const body = (req.body && typeof req.body === 'object') ? req.body : {};
  await new Promise((r) => setTimeout(r, 30)); // simulate invoice/PDF/email work
  const invoice = { invoiceNo: 'INV-' + Date.now(), orderId: body.orderId, tenantId: body.tenantId, total: body.total };
  res.setHeader('x-cold-start', String(coldStart));
  res.status(200).json({
    ok: true, invoice, coldStart, invocation: invocations,
    instanceAgeMs: Date.now() - bootTime,
    handlerMs: Number((Number(process.hrtime.bigint() - t0) / 1e6).toFixed(2)),
  });
};
