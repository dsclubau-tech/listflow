# Railway Workers

ListFlow uses four Railway services: one unified overflow worker plus one
store-specific worker for each store. All services use the same repository,
Docker image, Supabase database, and eBay credentials. Store workers receive a
three-second claim priority window; the unified worker then becomes eligible.
Normal and advanced Amazon imports use the same durable queue. They are claimed
first by the store-specific worker and retried once by the unified worker when
the specialist cannot return a verified result.

## Service matrix

| Railway service | Role | Store filter | Idle poll | Replicas |
| --- | --- | --- | --- | --- |
| `worker-all-stores` | `unified` | unset | `1000ms` | 1 |
| `worker-rk-ecommerce` | `store-specific` | `store-1` | `500ms` | 1 |
| `worker-aussie-walmart` | `store-specific` | `aussiewalmartonline` | `500ms` | 1 |
| `worker-oz-metro` | `store-specific` | `oz-metro` | `500ms` | 1 |

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
6. Add the role, store filter, and polling variables from the table.
7. Add the shared runtime variables listed below and deploy.

## Shared runtime variables

Copy production values securely into Railway; never commit them:

- `DATABASE_URL`
- `LISTFLOW_DB_POOL_MAX=1`
- `LISTFLOW_SUPABASE_TRANSACTION_POOLER=false`
- `LISTFLOW_WORKER_ENABLED=false` while provisioning; this value is mandatory
  on Railway and must be changed to `true` only after validation
- `LISTFLOW_WORKER_ROLE=unified` or `store-specific` as shown above
- `LISTFLOW_WORKER_CLAIM_GRACE_MS=3000`
- `LISTFLOW_USE_LOCAL_PLAYWRIGHT=true`
- `LISTFLOW_WORKER_IDLE_SLEEP_MS` as shown in the service matrix (`1000` for
  unified, `500` for each specialist)
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

Railway workers are persistent processes, so they use the Supabase session
pooler on port 5432. Vercel's short-lived serverless functions use transaction
pooling on port 6543 instead.

## Cutover

Start the three store-specific services first and verify each heartbeat. Start
`worker-all-stores` last. Each store must then show exactly two workers: its
specialist and the unified worker. Whole jobs have one owner; eBay work remains
serialized per store while non-overlapping price-check jobs can run in parallel.

The Railway image uses the Playwright 1.58.2 image to match `package-lock.json`.
Worker logs are emitted as structured JSON to Railway stdout and are also
persisted through ListFlow's existing database logger.
