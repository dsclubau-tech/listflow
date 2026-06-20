# ListFlow

ListFlow is a store-scoped eBay listing operations app built with Next.js,
Prisma, and PostgreSQL. The current production-ready setup is local-first:
ListFlow runs on this PC and stores data in Supabase Postgres.

## Current Stack

- App runtime: local Windows PC running `npm.cmd run dev` or `npm.cmd run start`
- Database: Supabase Postgres
- ORM: Prisma with `@prisma/adapter-pg`
- Auth: store ID and password through NextAuth credentials
- Scheduled work: protected Next.js cron routes called manually or by a local scheduler

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

eBay Research records expire two hours after a research job or batch reaches a
terminal state. Queued, running, pausing, and paused research work is preserved
for recovery.

## Hosting Later

If you later want ListFlow available 24/7, the app can be moved to a host such
as Railway or another Node.js host. Vercel is possible for the UI/API, but the
long-running price-check and queue workers need extra care on serverless hosting.
