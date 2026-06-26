import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

function assertCronSecret(request: Request) {
  const configuredSecret = process.env.CRON_SECRET;

  if (!configuredSecret) {
    return false;
  }

  const headerSecret = request.headers.get("x-cron-secret");
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const urlSecret = new URL(request.url).searchParams.get("secret");

  return [headerSecret, bearer, urlSecret].some(
    (candidate) => candidate && candidate === configuredSecret,
  );
}

function daysAgo(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
}

export async function GET(request: Request) {
  if (!assertCronSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const debugCutoff = daysAgo(7);
  const infoCutoff = daysAgo(14);
  const warnCutoff = daysAgo(30);
  const errorCutoff = daysAgo(90);
  const ebayResponseCutoff = daysAgo(3);

  const [debugLogs, infoLogs, warnLogs, errorLogs, ebayResponses] =
    await prisma.$transaction([
      prisma.appLog.deleteMany({
        where: {
          level: "DEBUG",
          createdAt: { lt: debugCutoff },
        },
      }),
      prisma.appLog.deleteMany({
        where: {
          level: "INFO",
          createdAt: { lt: infoCutoff },
        },
      }),
      prisma.appLog.deleteMany({
        where: {
          level: "WARN",
          createdAt: { lt: warnCutoff },
        },
      }),
      prisma.appLog.deleteMany({
        where: {
          level: { in: ["ERROR", "CRITICAL"] },
          createdAt: { lt: errorCutoff },
        },
      }),
      prisma.appLog.deleteMany({
        where: {
          level: "EBAY_RESPONSE",
          createdAt: { lt: ebayResponseCutoff },
        },
      }),
    ]);

  return NextResponse.json({
    ok: true,
    deleted: {
      debug: debugLogs.count,
      info: infoLogs.count,
      warn: warnLogs.count,
      error: errorLogs.count,
      ebayResponse: ebayResponses.count,
      total:
        debugLogs.count +
        infoLogs.count +
        warnLogs.count +
        errorLogs.count +
        ebayResponses.count,
    },
  });
}
