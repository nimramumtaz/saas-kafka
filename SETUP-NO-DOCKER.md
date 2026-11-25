# Setup WITHOUT Docker (sab kuch cloud pe, free)

Laptop pe sirf Node.js 18+ aur VS Code chahiye.

## 1) Postgres - Neon (free)
1. https://neon.tech -> sign up -> New Project.
2. Dashboard > "Connection string" copy karo (ye ADMIN_DATABASE_URL hai).
3. Neon > **SQL Editor** kholo, `db/schema.sql` ka poora content paste karke Run karo.
   (Ye tables + RLS + `app_user` role bana dega.)
4. App ka connection string banao: admin string mein user/password ko `app_user:app_pass` se badal do. Example:
   `postgresql://app_user:app_pass@ep-xxxx.region.aws.neon.tech/neondb?sslmode=require`
   (ye DATABASE_URL hai)

## 2) Kafka - Aiven free tier (no credit card)
1. https://aiven.io -> sign up -> Create service -> **Apache Kafka** -> **Free** plan.
2. Running hone ke baad service overview se:
   - **Host:Port** (Service URI) copy karo -> KAFKA_BROKERS
   - **CA certificate, Access certificate, Access key** download karo -> `certs/` folder mein
     `ca.pem`, `service.cert`, `service.key` naam se rakho.
3. Topics tab > Add topic: name `tenant.orders`, partitions 3 (agar limit ho to 1 ya 2).

## 3) .env edit karo
```
DATABASE_URL=postgresql://app_user:app_pass@<neon-host>/<db>?sslmode=require
ADMIN_DATABASE_URL=<neon admin connection string>
PG_SSL=true
KAFKA_BROKERS=<aiven-host>:<port>
KAFKA_CA_PATH=./certs/ca.pem
KAFKA_CERT_PATH=./certs/service.cert
KAFKA_KEY_PATH=./certs/service.key
```
(Agar Aiven mein SASL username/password dikhe to cert paths khali chhor ke KAFKA_SSL=true + KAFKA_USERNAME/PASSWORD use karo.)

## 4) Run
```
npm install
npm run seed:bulk
npm run dev
```
Phir http://localhost:3000 kholo.

## Note
Agar Aiven Kafka ka free tier koi issue de, to Redpanda Cloud ya Confluent Cloud ka free trial same tarah use ho sakta hai: sirf .env ke KAFKA_* values badlo, code same rahega.
