import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { createRequestLogger } from "@/lib/logger";
import { getCurrentStoreSession } from "@/lib/store-session";
import {
  getWorkerStatusForStore,
  getWorkerStatusesForStore,
} from "@/lib/worker-heartbeat";

export async function GET(request: Request) {
  const session = await auth();
  const storeSession = await getCurrentStoreSession();
  const log = createRequestLogger(
    request,
    storeSession ? { storeId: storeSession.storeId } : {}
  );

  if (!session?.user || !storeSession) {
    log.warn("worker/status/GET", "Unauthorized worker status request");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [worker, workers] = await Promise.all([
    getWorkerStatusForStore(storeSession.storeId),
    getWorkerStatusesForStore(storeSession.storeId),
  ]);

  return NextResponse.json({ worker, workers });
}
