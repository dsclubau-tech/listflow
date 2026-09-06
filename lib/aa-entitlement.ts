import { prisma } from "@/lib/prisma";

export type EntitlementStatus = "ACTIVE" | "INACTIVE" | "UNAVAILABLE";

export type EntitlementResult = {
  userId: string;
  status: EntitlementStatus;
  allowedStores: number;
  checkedAt: Date;
  source: "cache" | "live" | "fallback";
};

// 15-minute cache lease (in milliseconds)
export const ENTITLEMENT_CACHE_TTL_MS = 15 * 60 * 1000;

// In-flight request deduplication map to prevent thundering herd
const inFlightRequests = new Map<string, Promise<EntitlementResult>>();

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Executes machine-to-server entitlement check against AA edge function.
 * Implements 5,000ms timeout and 1 jittered retry on network error, 429, or 5xx.
 */
export async function fetchEntitlementFromAA(
  userId: string,
  lastKnownSnapshot?: { status: string; allowedStores: number } | null
): Promise<{ status: EntitlementStatus; allowedStores: number }> {
  const endpoint =
    process.env.AA_ENTITLEMENT_CHECK_URL ||
    "https://tdevgrwmafwrsmeymjzd.supabase.co/functions/v1/entitlement-check";
  const rawToken = process.env.AA_ENTITLEMENT_BEARER_TOKEN;
  const token = rawToken?.trim().split(/\s+/)[0];
  const productSlug = process.env.AA_PRODUCT_SLUG || "listflow";

  if (!token) {
    console.error(
      "[AA_ENTITLEMENT_CRITICAL] Missing AA_ENTITLEMENT_BEARER_TOKEN in environment. Failing safe with UNAVAILABLE."
    );
    return {
      status: "UNAVAILABLE",
      allowedStores: lastKnownSnapshot?.allowedStores ?? 0,
    };
  }

  const payload = JSON.stringify({
    user_id: userId,
    product_slug: productSlug,
  });

  let attempts = 0;
  const maxAttempts = 2; // Initial try + 1 retry

  while (attempts < maxAttempts) {
    attempts++;
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: payload,
        signal: AbortSignal.timeout(5000), // Strict 5-second timeout
      });

      // 1. Success cases
      if (response.ok) {
        const body = (await response.json()) as {
          status?: string;
          count?: number;
        };

        if (body.status === "active") {
          return {
            status: "ACTIVE",
            allowedStores: typeof body.count === "number" ? body.count : 1,
          };
        }

        if (body.status === "inactive") {
          return {
            status: "INACTIVE",
            allowedStores: 0,
          };
        }

        if (body.status === "unavailable") {
          // 200 with unavailable status: preserve last known allowedStores
          return {
            status: "UNAVAILABLE",
            allowedStores: lastKnownSnapshot?.allowedStores ?? 0,
          };
        }
      }

      // 2. HTTP 404: User not found in AA
      if (response.status === 404) {
        console.error(
          `[AA_ENTITLEMENT_ANOMALY] High-severity identity anomaly: authenticated user UUID ${userId} returned 404 user_not_found from AA.`
        );
        // Fail closed safely without showing user registration advice
        return {
          status: "INACTIVE",
          allowedStores: 0,
        };
      }

      // 3. HTTP 401 / 403: Machine token authorization failure
      if (response.status === 401 || response.status === 403) {
        console.error(
          `[AA_ENTITLEMENT_CRITICAL_AUTH] Machine bearer token rejected (HTTP ${response.status}). Check AA_ENTITLEMENT_BEARER_TOKEN configuration immediately.`
        );
        // Fail-safe: preserve last-known good snapshot (like 503) so token maintenance doesn't disrupt customers
        return {
          status: "UNAVAILABLE",
          allowedStores: lastKnownSnapshot?.allowedStores ?? 0,
        };
      }

      // 4. HTTP 429: Rate limited
      if (response.status === 429) {
        const retryAfterHeader = response.headers.get("Retry-After");
        const retryAfterSec = retryAfterHeader
          ? Number.parseInt(retryAfterHeader, 10)
          : 2;
        const waitMs = Math.min(Math.max(retryAfterSec * 1000, 1000), 5000);
        console.warn(
          `[AA_ENTITLEMENT_RATE_LIMIT] Rate limit hit. Waiting ${waitMs}ms before retry...`
        );
        if (attempts < maxAttempts) {
          await sleep(waitMs + Math.random() * 500);
          continue;
        }
      }

      // 5. HTTP 503 / 5xx: Service unavailable
      if (response.status === 503 || response.status >= 500) {
        console.warn(
          `[AA_ENTITLEMENT_UNAVAILABLE] AA service returned HTTP ${response.status}.`
        );
        if (attempts < maxAttempts) {
          // Jittered backoff (500ms - 1500ms)
          await sleep(500 + Math.random() * 1000);
          continue;
        }
        return {
          status: "UNAVAILABLE",
          allowedStores: lastKnownSnapshot?.allowedStores ?? 0,
        };
      }

      // Any other unexpected status code
      console.warn(
        `[AA_ENTITLEMENT_UNEXPECTED] Received unexpected HTTP ${response.status} from AA entitlement check.`
      );
      return {
        status: "UNAVAILABLE",
        allowedStores: lastKnownSnapshot?.allowedStores ?? 0,
      };
    } catch (err: any) {
      console.warn(
        `[AA_ENTITLEMENT_NETWORK_ERROR] Attempt ${attempts} failed: ${err.message}`
      );
      if (attempts < maxAttempts) {
        // Jittered backoff on network error / timeout
        await sleep(500 + Math.random() * 1000);
        continue;
      }

      return {
        status: "UNAVAILABLE",
        allowedStores: lastKnownSnapshot?.allowedStores ?? 0,
      };
    }
  }

  return {
    status: "UNAVAILABLE",
    allowedStores: lastKnownSnapshot?.allowedStores ?? 0,
  };
}

/**
 * Resolves entitlement for a user using local PostgreSQL EntitlementSnapshot cache.
 * If cached snapshot is fresh (< 15 min), returns cached state.
 * If stale or missing, fetches from AA, updates Postgres, and returns fresh state.
 * Uses in-memory request deduplication so concurrent calls for the same user share 1 external call.
 */
export async function getOrRefreshEntitlement(
  userId: string,
  options?: { forceRefresh?: boolean }
): Promise<EntitlementResult> {
  if (!userId) {
    return {
      userId: "",
      status: "INACTIVE",
      allowedStores: 0,
      checkedAt: new Date(),
      source: "fallback",
    };
  }

  // 1. Check local PostgreSQL cache
  const snapshot = await prisma.entitlementSnapshot.findUnique({
    where: { userId },
  });

  const now = Date.now();
  const isFresh =
    snapshot &&
    !options?.forceRefresh &&
    now - snapshot.checkedAt.getTime() < ENTITLEMENT_CACHE_TTL_MS;

  if (isFresh) {
    return {
      userId: snapshot.userId,
      status: snapshot.status as EntitlementStatus,
      allowedStores: snapshot.allowedStores,
      checkedAt: snapshot.checkedAt,
      source: "cache",
    };
  }

  // 2. Stale or missing: Deduplicate in-flight requests
  const existingFlight = inFlightRequests.get(userId);
  if (existingFlight) {
    return existingFlight;
  }

  const refreshPromise = (async () => {
    try {
      const fresh = await fetchEntitlementFromAA(userId, snapshot);
      const checkedAt = new Date();

      // Upsert into local PostgreSQL EntitlementSnapshot
      const saved = await prisma.entitlementSnapshot.upsert({
        where: { userId },
        create: {
          userId,
          status: fresh.status,
          allowedStores: fresh.allowedStores,
          checkedAt,
        },
        update: {
          status: fresh.status,
          allowedStores: fresh.allowedStores,
          checkedAt,
        },
      });

      return {
        userId: saved.userId,
        status: saved.status as EntitlementStatus,
        allowedStores: saved.allowedStores,
        checkedAt: saved.checkedAt,
        source: "live" as const,
      };
    } catch (error: any) {
      console.error(
        `[AA_ENTITLEMENT_REFRESH_FAILED] Failed to refresh entitlement for ${userId}: ${error.message}`
      );
      if (snapshot) {
        return {
          userId: snapshot.userId,
          status: snapshot.status as EntitlementStatus,
          allowedStores: snapshot.allowedStores,
          checkedAt: snapshot.checkedAt,
          source: "cache" as const,
        };
      }
      return {
        userId,
        status: "UNAVAILABLE" as EntitlementStatus,
        allowedStores: 0,
        checkedAt: new Date(),
        source: "fallback" as const,
      };
    } finally {
      inFlightRequests.delete(userId);
    }
  })();

  inFlightRequests.set(userId, refreshPromise);
  return refreshPromise;
}
