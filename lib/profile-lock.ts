import { createHmac } from "node:crypto";

export const PROFILE_UNLOCK_COOKIE_NAME = "listflow_profile_unlock";

function getSecret(): string {
  return (
    process.env.AUTH_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    "listflow-profile-lock-default-secret-key"
  );
}

/**
 * Creates an HMAC-signed token binding the storeId to the current timestamp.
 * Format: `${storeId}:${timestamp}:${signature}`
 */
export function createStoreUnlockToken(storeId: string): string {
  const timestamp = Date.now().toString();
  const secret = getSecret();
  const signature = createHmac("sha256", secret)
    .update(`${storeId}:${timestamp}`)
    .digest("hex");

  return `${storeId}:${timestamp}:${signature}`;
}

/**
 * Verifies that the unlock token is authentic, bound to the specified storeId,
 * and within the valid expiration window (default: 7 days).
 */
export function verifyStoreUnlockToken(
  expectedStoreId: string,
  token: string | null | undefined,
  maxAgeMs: number = 1000 * 60 * 60 * 24 * 7 // 7 days
): boolean {
  if (!token || typeof token !== "string" || !expectedStoreId) {
    return false;
  }

  const parts = token.split(":");
  if (parts.length !== 3) {
    return false;
  }

  const [tokenStoreId, timestampStr, signature] = parts;

  if (tokenStoreId !== expectedStoreId) {
    return false;
  }

  const timestamp = parseInt(timestampStr, 10);
  if (isNaN(timestamp) || timestamp <= 0) {
    return false;
  }

  // Freshness check
  const now = Date.now();
  if (now < timestamp || now - timestamp > maxAgeMs) {
    return false;
  }

  const secret = getSecret();
  const expectedSignature = createHmac("sha256", secret)
    .update(`${expectedStoreId}:${timestampStr}`)
    .digest("hex");

  return signature === expectedSignature;
}
