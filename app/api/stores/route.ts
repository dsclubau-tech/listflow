import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { invalidateAllStoreCaches } from "@/lib/cache-tags";
import { getCurrentStoreSession } from "@/lib/store-session";
import { getOrCreateStoreSupplierSettings } from "@/lib/supplier-settings";
import { validateStoreDisplayName } from "@/lib/store-profile";

export async function GET() {
  const session = await auth();
  const storeSession = await getCurrentStoreSession();

  if (!session?.user || !storeSession) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const stores = await prisma.store.findMany({
    where: { id: storeSession.storeId },
    select: { id: true, name: true, loginId: true },
  });

  return NextResponse.json(stores);
}

export async function PATCH(request: Request) {
  const session = await auth();
  const storeSession = await getCurrentStoreSession();

  if (!session?.user || !storeSession) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const validation = validateStoreDisplayName(
    (body as { name?: unknown } | null)?.name,
  );
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  try {
    // Persist the legacy eBay account mapping before the editable label changes.
    await getOrCreateStoreSupplierSettings(storeSession.storeId);

    const store = await prisma.store.update({
      where: { id: storeSession.storeId },
      data: { name: validation.name },
      select: { id: true, name: true, loginId: true },
    });

    invalidateAllStoreCaches(storeSession.storeId);

    return NextResponse.json({
      store,
      message: "Store name updated.",
    });
  } catch (error) {
    console.error("Failed to update store name", error);
    return NextResponse.json(
      { error: "Unable to update the store name. Please try again." },
      { status: 500 },
    );
  }
}
