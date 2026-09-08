import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { getCurrentStoreSession } from "@/lib/store-session";
import {
  createStoreUnlockToken,
  PROFILE_UNLOCK_COOKIE_NAME,
} from "@/lib/profile-lock";

export async function GET() {
  const storeSession = await getCurrentStoreSession();
  if (!storeSession) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const store = await prisma.store.findUnique({
    where: { id: storeSession.storeId },
    select: {
      id: true,
      name: true,
      loginId: true,
      password: true,
      profileLockEnabled: true,
      autoLockMinutes: true,
    },
  });

  if (!store) {
    return NextResponse.json({ error: "Store not found" }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    profileLockEnabled: store.profileLockEnabled ?? true,
    autoLockMinutes: store.autoLockMinutes ?? 0,
    hasPassword: Boolean(store.password),
  });
}

export async function POST(request: Request) {
  const storeSession = await getCurrentStoreSession();
  if (!storeSession) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const currentPassword =
    typeof body?.currentPassword === "string" ? body.currentPassword : "";
  const profileLockEnabled =
    typeof body?.profileLockEnabled === "boolean"
      ? body.profileLockEnabled
      : undefined;
  const autoLockMinutes =
    typeof body?.autoLockMinutes === "number" ? body.autoLockMinutes : undefined;

  const store = await prisma.store.findUnique({
    where: { id: storeSession.storeId },
    select: {
      id: true,
      password: true,
      isActive: true,
    },
  });

  if (!store || !store.isActive) {
    return NextResponse.json({ error: "Store not found or inactive." }, { status: 404 });
  }

  if (store.password) {
    if (!currentPassword) {
      return NextResponse.json(
        { error: "Current store password is required to change profile lock settings." },
        { status: 400 }
      );
    }

    const matches = await bcrypt.compare(currentPassword, store.password);
    if (!matches) {
      return NextResponse.json(
        { error: "Current store password is incorrect." },
        { status: 400 }
      );
    }
  }

  const updateData: { profileLockEnabled?: boolean; autoLockMinutes?: number } = {};
  if (profileLockEnabled !== undefined) {
    updateData.profileLockEnabled = profileLockEnabled;
  }
  if (autoLockMinutes !== undefined) {
    updateData.autoLockMinutes = autoLockMinutes;
  }

  await prisma.store.update({
    where: { id: store.id },
    data: updateData,
  });

  const response = NextResponse.json({
    ok: true,
    message: "Profile lock settings updated successfully.",
  });

  // If profile lock is disabled, grant unlock cookie automatically
  if (profileLockEnabled === false) {
    const token = createStoreUnlockToken(store.id);
    response.cookies.set({
      name: PROFILE_UNLOCK_COOKIE_NAME,
      value: token,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });
  }

  return response;
}
