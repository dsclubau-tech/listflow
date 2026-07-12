CREATE TABLE "LoginAttempt" (
    "id" TEXT NOT NULL,
    "loginHash" TEXT NOT NULL,
    "ipHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginAttempt_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LoginAttempt_loginHash_ipHash_createdAt_idx"
ON "LoginAttempt"("loginHash", "ipHash", "createdAt");

CREATE INDEX "LoginAttempt_ipHash_createdAt_idx"
ON "LoginAttempt"("ipHash", "createdAt");

CREATE INDEX "LoginAttempt_createdAt_idx"
ON "LoginAttempt"("createdAt");

-- Login throttling is server-only. Deny access through Supabase's Data API
-- when those roles exist, while keeping Prisma's database role unaffected.
ALTER TABLE "LoginAttempt" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "LoginAttempt" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE "LoginAttempt" FROM authenticated;
  END IF;
END
$$;
