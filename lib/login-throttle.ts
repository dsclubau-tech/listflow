import { createHmac } from "node:crypto";
import { prisma } from "@/lib/prisma";
import {
  getClientIp,
  isLoginBlocked,
  LOGIN_THROTTLE_WINDOW_MS,
} from "@/lib/login-throttle-policy";

type LoginThrottleContext = {
  loginHash: string;
  ipHash: string;
};

let warnedAboutUnavailableStorage = false;

function warnUnavailableStorage(error: unknown) {
  if (warnedAboutUnavailableStorage) return;
  warnedAboutUnavailableStorage = true;
  const message = error instanceof Error ? error.message : String(error);
  console.warn(`[login-throttle] Storage unavailable; allowing login attempt: ${message}`);
}

function hashIdentifier(value: string) {
  const secret =
    process.env.AUTH_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    "listflow-login-throttle";
  return createHmac("sha256", secret).update(value).digest("hex");
}

function createContext(loginId: string, request: Request): LoginThrottleContext {
  return {
    loginHash: hashIdentifier(loginId),
    ipHash: hashIdentifier(getClientIp(request.headers)),
  };
}

export async function checkLoginThrottle(loginId: string, request: Request) {
  const context = createContext(loginId, request);
  const cutoff = new Date(Date.now() - LOGIN_THROTTLE_WINDOW_MS);

  try {
    const [accountIpFailures, accountFailures, ipFailures] = await Promise.all([
      prisma.loginAttempt.count({
        where: {
          loginHash: context.loginHash,
          ipHash: context.ipHash,
          createdAt: { gte: cutoff },
        },
      }),
      prisma.loginAttempt.count({
        where: {
          loginHash: context.loginHash,
          createdAt: { gte: cutoff },
        },
      }),
      prisma.loginAttempt.count({
        where: {
          ipHash: context.ipHash,
          createdAt: { gte: cutoff },
        },
      }),
    ]);

    return {
      blocked: isLoginBlocked({
        accountIpFailures,
        accountFailures,
        ipFailures,
      }),
      context,
    };
  } catch (error) {
    warnUnavailableStorage(error);
    return { blocked: false, context };
  }
}

export async function recordFailedLogin(context: LoginThrottleContext) {
  const cutoff = new Date(Date.now() - LOGIN_THROTTLE_WINDOW_MS);

  try {
    await prisma.$transaction([
      prisma.loginAttempt.create({ data: context }),
      prisma.loginAttempt.deleteMany({ where: { createdAt: { lt: cutoff } } }),
    ]);
  } catch (error) {
    warnUnavailableStorage(error);
  }
}

export async function clearFailedLogins(context: LoginThrottleContext) {
  try {
    await prisma.loginAttempt.deleteMany({
      where: {
        loginHash: context.loginHash,
      },
    });
  } catch (error) {
    warnUnavailableStorage(error);
  }
}
