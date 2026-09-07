import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getOrRefreshEntitlement } from "@/lib/aa-entitlement";

export async function POST() {
  try {
    let userId: string | null = null;

    // 1. Check AA Supabase Auth session
    try {
      const supabase = await createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user?.id) {
        userId = user.id;
      }
    } catch {
      // Fall through to NextAuth check
    }

    // 2. Fallback to legacy NextAuth store session
    if (!userId) {
      const session = await auth();
      const storeId = session?.user?.storeId;
      if (storeId) {
        const store = await prisma.store.findUnique({
          where: { id: storeId },
          select: { ownerUserId: true },
        });
        if (store?.ownerUserId) {
          userId = store.ownerUserId;
        }
      }
    }

    if (!userId) {
      return NextResponse.json(
        { error: "Unauthorized: No authenticated user session found." },
        { status: 401 }
      );
    }

    // Force-refresh entitlement directly from AA, bypassing the 15-minute lease
    const result = await getOrRefreshEntitlement(userId, { forceRefresh: true });

    return NextResponse.json({
      success: true,
      status: result.status,
      allowedStores: result.allowedStores,
      checkedAt: result.checkedAt,
    });
  } catch (error: any) {
    console.error(
      `[ENTITLEMENT_REFRESH_API_ERROR] Failed to refresh entitlement: ${error.message}`
    );
    return NextResponse.json(
      { error: "Failed to refresh subscription status. Please try again." },
      { status: 500 }
    );
  }
}
