import test from "node:test";
import assert from "node:assert/strict";

function handleAuthError(error: { code?: string; message?: string } | null) {
  if (!error) {
    return { isRaceCondition: false, shouldClearCookies: false };
  }

  const isConcurrentRace = Boolean(
    error.code === "refresh_token_already_used" ||
    error.message?.includes("refresh_token_already_used") ||
    error.message?.includes("already been used")
  );

  if (isConcurrentRace) {
    // A concurrent request already rotated the token. Preserve session cookies.
    return { isRaceCondition: true, shouldClearCookies: false };
  }

  // Genuine session expiry or invalid credential.
  return { isRaceCondition: false, shouldClearCookies: true };
}

test("Token Refresh Race Exemption - detects refresh_token_already_used code and preserves cookies", () => {
  const result = handleAuthError({
    code: "refresh_token_already_used",
    message: "Invalid Refresh Token: Refresh Token Already Used",
  });

  assert.equal(result.isRaceCondition, true);
  assert.equal(result.shouldClearCookies, false);
});

test("Token Refresh Race Exemption - detects message containing 'already been used'", () => {
  const result = handleAuthError({
    code: "invalid_grant",
    message: "Refresh token has already been used in another session",
  });

  assert.equal(result.isRaceCondition, true);
  assert.equal(result.shouldClearCookies, false);
});

test("Token Refresh Race Exemption - treats expired token as normal expiry and clears cookies", () => {
  const result = handleAuthError({
    code: "session_expired",
    message: "JWT has expired",
  });

  assert.equal(result.isRaceCondition, false);
  assert.equal(result.shouldClearCookies, true);
});

test("Token Refresh Race Exemption - handles success case cleanly", () => {
  const result = handleAuthError(null);

  assert.equal(result.isRaceCondition, false);
  assert.equal(result.shouldClearCookies, false);
});
