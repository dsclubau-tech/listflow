export const LOGIN_THROTTLE_WINDOW_MS = 15 * 60 * 1_000;
export const LOGIN_THROTTLE_ACCOUNT_IP_LIMIT = 5;
export const LOGIN_THROTTLE_ACCOUNT_LIMIT = 10;
export const LOGIN_THROTTLE_IP_LIMIT = 25;

export function getClientIp(headers: Pick<Headers, "get">) {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const direct = headers.get("x-real-ip")?.trim();
  return forwarded || direct || "unknown";
}

export function isLoginBlocked(input: {
  accountIpFailures: number;
  accountFailures: number;
  ipFailures: number;
}) {
  return (
    input.accountIpFailures >= LOGIN_THROTTLE_ACCOUNT_IP_LIMIT ||
    input.accountFailures >= LOGIN_THROTTLE_ACCOUNT_LIMIT ||
    input.ipFailures >= LOGIN_THROTTLE_IP_LIMIT
  );
}
