# ListFlow

ListFlow is a store-scoped eBay listing operations app built with Next.js,
Prisma, and PostgreSQL. The supported production setup is hybrid: the Next.js
UI/API can run on Vercel or locally, Supabase hosts PostgreSQL, and a trusted
Windows PC runs the manual worker for long jobs.

## Current Stack

- App runtime: Vercel or a local Windows PC running `npm.cmd run dev`/`start`
- Database: Supabase Postgres
- ORM: Prisma with `@prisma/adapter-pg`
- Auth: store ID and password through NextAuth credentials
- Long jobs: manual Windows worker connected to the same Supabase database
- Scheduled cleanup: protected Next.js cron routes

ListFlow does not require Supabase anon keys or service-role keys. Database
access stays server-side through Prisma.

## Environment

Copy `.env.example` and fill the production values.

Use `DATABASE_URL` for the running app. For local Windows, the Supabase pooler
connection string is preferred because the direct database host can be IPv6-only.

Use `DIRECT_URL` for Prisma migrations when available. If the direct Supabase
database host is not reachable from this PC, use the Supabase session pooler
connection string for `DIRECT_URL` too. Prisma commands in this repo prefer
`DIRECT_URL` and fall back to `DATABASE_URL`.

Required production values:

- `DATABASE_URL`
- `DIRECT_URL`
- `AUTH_SECRET`
- `NEXTAUTH_URL=http://localhost:3000`
- `LISTFLOW_PUBLIC_IMAGE_BASE_URL=https://your-listflow-domain.example` (required for uploaded listing images)
- `AUTH_TRUST_HOST=true`
- `CRON_SECRET`
- eBay developer credentials and store tokens
- `STORE_BOOTSTRAP_PASSWORD` or per-store seed passwords before running
  `prisma db seed`

Do not commit real `.env` files or Supabase passwords.

## Supabase Setup

1. Create a Supabase project.
2. Create or choose a dedicated database user/password for Prisma.
3. Copy the app/runtime connection string into `DATABASE_URL`.
4. Copy the direct database connection string into `DIRECT_URL`.
5. Keep Supabase client APIs disabled or unused unless row-level security
   policies are intentionally designed. ListFlow reads/writes through the server.

## Database Migration

Install dependencies:

```bash
npm install
```

Install local Chromium before running browser-backed jobs on this PC:

```bash
npm.cmd run browser:install
```

Vercel uses `@sparticuz/chromium` and does not need this local browser download.

Validate and generate Prisma:

```bash
npm.cmd exec prisma validate
npm.cmd exec prisma generate
```

Deploy migrations to Supabase:

```bash
npm.cmd exec prisma migrate deploy
```

Seed a fresh production database:

```bash
npm.cmd exec prisma db seed
```

## Local Run

Build locally:

```bash
npm.cmd run lint
npm.cmd run build
```

Start local production mode:

```bash
npm run start
```

Or use development mode:

```bash
npm.cmd run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Six-Worker Company PC Setup

When ListFlow is hosted on Vercel, a trusted Windows PC can run the manual
worker for long jobs such as price checks, eBay imports, research batches, and
bulk eBay actions. The company setup runs two isolated instances for each of
the three configured stores. All six processes use the same worker entry point,
while database leases prevent conflicting work from running twice.

One-time setup on each worker PC:

1. Copy or clone the ListFlow folder to the PC.
2. Add the real `.env` file to the ListFlow folder. Do not put secrets in the
   setup script.
3. Ensure `.env` contains `LISTFLOW_DEPLOYED_DATABASE_URL` (or the existing
   `MIGRATION_SOURCE_DATABASE_URL`) for the production Supabase database.
4. Double-click `Setup ListFlow Worker.cmd`.
5. Wait for setup to install dependencies, validate all three stores, generate
   Prisma, and create desktop shortcuts.

Daily use:

1. Open the Vercel ListFlow website in the browser.
2. Double-click `Start All 6 ListFlow Workers`.
3. Keep the controller window open while workers are needed.
4. Double-click `Stop All ListFlow Workers` to let active jobs finish before
   closing the processes.

Stable company updates are published to `master`. Use `Update ListFlow Workers`
to fetch a clean fast-forward release, install exact dependencies, validate the
database configuration, and reopen the controller. The updater refuses to
overwrite local Git changes. Commercial development happens on
`commercial-development` and is merged into `master` only after verification.

The setup writes details to `logs/setup-worker.log`. Each worker has a separate
`logs/worker-<store>-<a|b>.log` file.

## Health Check

Check database connectivity while the local app is running:

```bash
curl http://localhost:3000/api/health/db
```

Expected response:

```json
{ "ok": true }
```

## Cron Routes

All cron routes require:

```bash
Authorization: Bearer $CRON_SECRET
```

Daily price tracking while the local app is running:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  http://localhost:3000/api/cron/price-check
```

Suggested schedule:

```bash
0 6 * * *
```

Expired eBay Research cleanup:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  http://localhost:3000/api/cron/ebay-research-cleanup
```

Suggested schedule:

```bash
*/30 * * * *
```

eBay Research records expire 24 hours after a research job or batch reaches a
terminal state. Queued, running, pausing, and paused research work is preserved
for recovery.

## Hosted Runtime

Vercel hosts the UI and short API requests. Keep the manual worker running on a
trusted PC while price checks, imports, research batches, or eBay actions are in
progress. Closing the browser does not stop a queued worker job.
