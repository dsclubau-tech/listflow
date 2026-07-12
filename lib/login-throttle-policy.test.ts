import assert from "node:assert/strict";
import test from "node:test";
import {
  getClientIp,
  isLoginBlocked,
  LOGIN_THROTTLE_ACCOUNT_LIMIT,
  LOGIN_THROTTLE_ACCOUNT_IP_LIMIT,
  LOGIN_THROTTLE_IP_LIMIT,
} from "./login-throttle-policy";

test("getClientIp prefers the first forwarded address", () => {
  const headers = new Headers({
    "x-forwarded-for": "203.0.113.10, 10.0.0.1",
    "x-real-ip": "198.51.100.5",
  });

  assert.equal(getClientIp(headers), "203.0.113.10");
});

test("getClientIp falls back without throwing", () => {
  assert.equal(getClientIp(new Headers({ "x-real-ip": "198.51.100.5" })), "198.51.100.5");
  assert.equal(getClientIp(new Headers()), "unknown");
});

test("isLoginBlocked enforces account/IP and wider IP limits", () => {
  assert.equal(
    isLoginBlocked({
      accountIpFailures: LOGIN_THROTTLE_ACCOUNT_IP_LIMIT - 1,
      accountFailures: LOGIN_THROTTLE_ACCOUNT_LIMIT - 1,
      ipFailures: LOGIN_THROTTLE_IP_LIMIT - 1,
    }),
    false
  );
  assert.equal(
    isLoginBlocked({
      accountIpFailures: LOGIN_THROTTLE_ACCOUNT_IP_LIMIT,
      accountFailures: 0,
      ipFailures: 0,
    }),
    true
  );
  assert.equal(
    isLoginBlocked({
      accountIpFailures: 0,
      accountFailures: LOGIN_THROTTLE_ACCOUNT_LIMIT,
      ipFailures: 0,
    }),
    true
  );
  assert.equal(
    isLoginBlocked({
      accountIpFailures: 0,
      accountFailures: 0,
      ipFailures: LOGIN_THROTTLE_IP_LIMIT,
    }),
    true
  );
});
