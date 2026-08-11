const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

export const DATABASE_HEALTH_PATH = "/api/health/db";

export function isMaintenanceModeEnabled(
  value = process.env.LISTFLOW_MAINTENANCE_MODE
) {
  return TRUE_VALUES.has(value?.trim().toLowerCase() ?? "");
}

export function isMaintenanceBypassPath(pathname: string) {
  return pathname === DATABASE_HEALTH_PATH;
}

export function isApiPath(pathname: string) {
  return pathname === "/api" || pathname.startsWith("/api/");
}

export function getMaintenanceHtml(requestId: string) {
  const safeRequestId = requestId.replace(/[^a-zA-Z0-9_-]/g, "");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex,nofollow" />
    <title>ListFlow maintenance</title>
    <style>
      :root { color-scheme: light; font-family: Arial, Helvetica, sans-serif; }
      * { box-sizing: border-box; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px; background: #e3f2fd; color: #0d47a1; }
      main { width: min(560px, 100%); border: 1px solid #90caf9; border-radius: 18px; padding: 36px; background: #fff; box-shadow: 0 16px 48px rgba(13, 71, 161, .16); }
      .badge { display: inline-block; margin-bottom: 18px; border-radius: 999px; padding: 8px 12px; background: #e03f4f; color: #fff; font-size: 13px; font-weight: 700; letter-spacing: .03em; }
      h1 { margin: 0 0 14px; font-size: clamp(28px, 6vw, 42px); line-height: 1.1; }
      p { margin: 0; color: #285f9f; font-size: 17px; line-height: 1.6; }
      small { display: block; margin-top: 24px; color: #5c7fa8; }
    </style>
  </head>
  <body>
    <main>
      <span class="badge">Scheduled maintenance</span>
      <h1>ListFlow will be back shortly.</h1>
      <p>We are safely moving ListFlow to its final database. Please wait a few minutes before trying again.</p>
      <small>Request ID: ${safeRequestId}</small>
    </main>
  </body>
</html>`;
}

export function getMaintenanceResponse(pathname: string, requestId: string) {
  const headers = {
    "cache-control": "no-store",
    "retry-after": "300",
    "x-request-id": requestId,
  };

  if (isApiPath(pathname)) {
    return Response.json(
      {
        error: "ListFlow is temporarily unavailable for scheduled maintenance.",
        requestId,
      },
      { status: 503, headers }
    );
  }

  return new Response(getMaintenanceHtml(requestId), {
    status: 503,
    headers: {
      ...headers,
      "content-type": "text/html; charset=utf-8",
    },
  });
}
