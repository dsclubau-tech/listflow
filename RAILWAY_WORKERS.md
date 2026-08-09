# Railway Workers

ListFlow uses three isolated Railway services, one for each store. All three
services use the same GitHub repository, Docker image definition, Supabase
database, and eBay application credentials. The store filter is the only
runtime difference.

## Service matrix

| Railway service | `LISTFLOW_WORKER_STORE_LOGIN_ID` | `LISTFLOW_WORKER_NAME` | Replicas |
| --- | --- | --- | --- |
| `worker-rk-ecommerce` | `store-1` | `RK Ecommerce Store Railway Worker` | 1 |
| `worker-aussie-walmart` | `aussiewalmartonline` | `Aussie Walmart Railway Worker` | 1 |
| `worker-oz-metro` | `oz-metro` | `Oz Metro Railway Worker` | 1 |

Do not run more than one replica of a store service until multi-replica worker
identity and scheduling have been tested. The database leases prevent most
overlapping jobs, but one replica per store gives clearer ownership and keeps
browser memory predictable.

## Create each service

For each row above:

1. Create a Railway service from this repository.
2. In **Settings > Config as Code**, set the config file path to
   `/railway.worker.json`.
3. Do not generate a public domain.
4. Select one replica in the region closest to the Supabase database.
5. Disable Railway Serverless/app sleeping.
6. Add the two service-specific variables from the table.
7. Add the shared runtime variables listed below and deploy.

## Shared runtime variables

Copy production values securely into Railway; never commit them:

- `DATABASE_URL`
- `LISTFLOW_DB_POOL_MAX=1`
- `LISTFLOW_SUPABASE_TRANSACTION_POOLER=true`
- `LISTFLOW_USE_LOCAL_PLAYWRIGHT=true`
- `LISTFLOW_WORKER_IDLE_SLEEP_MS=1000`
- `LISTFLOW_WORKER_ERROR_SLEEP_MS=30000`
- `LISTFLOW_WORKER_LEASE_TTL_MS=90000`
- `LISTFLOW_PUBLIC_IMAGE_BASE_URL`
- `EBAY_ENVIRONMENT`
- `EBAY_APP_ID`
- `EBAY_DEV_ID`
- `EBAY_CERT_ID`
- The eBay store token variables used by the three database stores
- Existing ListFlow eBay rate-limit and price-check delay variables

`DIRECT_URL`, authentication secrets, bootstrap passwords, and `CRON_SECRET`
are not required by the worker process.

## Cutover

Start one Railway service at a time. After its worker status is online in
ListFlow, close the matching Windows worker before submitting new work for that
store. Verify one small job per queue type before moving to the next service.

The Railway image uses the Playwright 1.58.2 image to match `package-lock.json`.
Worker logs are emitted as structured JSON to Railway stdout and are also
persisted through ListFlow's existing database logger.
