require('dotenv').config();
const fs = require('fs');
const { Kafka, logLevel } = require('kafkajs');

// read a PEM from a file path OR from a base64 env var (handy on Render/Railway)
const pem = (path, b64) => path ? fs.readFileSync(path, 'utf8') : (b64 ? Buffer.from(b64, 'base64').toString() : undefined);
const ca = pem(process.env.KAFKA_CA_PATH, process.env.KAFKA_CA_B64);
const cert = pem(process.env.KAFKA_CERT_PATH, process.env.KAFKA_CERT_B64);
const key = pem(process.env.KAFKA_KEY_PATH, process.env.KAFKA_KEY_B64);
const sslConfig = (ca || cert) ? { ca: ca ? [ca] : undefined, cert, key } : process.env.KAFKA_SSL === 'true';

const useSasl = !!process.env.KAFKA_USERNAME;
const kafka = new Kafka({
  clientId: 'saas-orders',
  brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
  ssl: sslConfig,
  sasl: useSasl ? {
    mechanism: process.env.KAFKA_SASL_MECHANISM || 'scram-sha-256',
    username: process.env.KAFKA_USERNAME,
    password: process.env.KAFKA_PASSWORD,
  } : undefined,
  logLevel: logLevel.WARN,
});
const TOPIC = process.env.KAFKA_TOPIC || 'tenant.orders';

async function ensureTopic() {
  const admin = kafka.admin();
  try {
    await admin.connect();
    await admin.createTopics({ topics: [{ topic: TOPIC, numPartitions: 3 }] });
  } catch (e) {
    console.warn('[kafka] createTopics skipped:', e.message, '(create topic manually on Upstash/Aiven)');
  } finally { await admin.disconnect().catch(() => {}); }
}

let producer;
async function getProducer() {
  if (!producer) { producer = kafka.producer(); await producer.connect(); }
  return producer;
}
// Message key = tenant_id => same tenant always lands on same partition => ordered per tenant
async function publishOrderCreated(event) {
  const p = await getProducer();
  const res = await p.send({
    topic: TOPIC,
    messages: [{ key: event.tenantId, value: JSON.stringify(event), headers: { type: 'OrderCreated' } }],
  });
  return res[0]; // {partition, baseOffset}
}
module.exports = { kafka, TOPIC, ensureTopic, publishOrderCreated };
