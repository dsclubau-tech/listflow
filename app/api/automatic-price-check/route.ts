import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { getCurrentStoreSession } from "@/lib/store-session";
import {
  getAutomaticPriceCheckStatus,
  startAutomaticPriceCheck,
  stopAutomaticPriceCheck,
} from "@/lib/automatic-price-check";

export async function GET(request: Request) {
  const session = await auth();
  const storeSession = await getCurrentStoreSession();
  if (!session?.user || !storeSession) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const storeId = searchParams.get("storeId") || undefined;

  try {
    const status = await getAutomaticPriceCheckStatus(storeId);
    return NextResponse.json(status);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch status";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const session = await auth();
  const storeSession = await getCurrentStoreSession();
  if (!session?.user || !storeSession) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { storeId?: string } = {};
  try {
    body = await request.json();
  } catch {
    // Body is optional
  }

  try {
    const starterIdentifier =
      storeSession.storeName ||
      session.user.name ||
      storeSession.storeLoginId ||
      "Store Session";

    const status = await startAutomaticPriceCheck({
      userId: starterIdentifier,
      storeId: body.storeId,
    });
    return NextResponse.json(status);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to start automatic checks";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const session = await auth();
  const storeSession = await getCurrentStoreSession();
  if (!session?.user || !storeSession) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { storeId?: string } = {};
  try {
    body = await request.json();
  } catch {
    // Body is optional
  }

  try {
    const status = await stopAutomaticPriceCheck({
      storeId: body.storeId,
    });
    return NextResponse.json(status);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to stop automatic checks";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
