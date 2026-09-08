import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { getCurrentStoreSession } from "@/lib/store-session";
import { createClient } from "@/lib/supabase/server";
import {
  createStoreUnlockToken,
  PROFILE_UNLOCK_COOKIE_NAME,
} from "@/lib/profile-lock";
import {
  checkLoginThrottle,
  clearFailedLogins,
  recordFailedLogin,
} from "@/lib/login-throttle";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const storeId = typeof body?.storeId === "string" ? body.storeId.trim() : "";
    const password = typeof body?.password === "string" ? body.password : "";

    if (!storeId || !password) {
      return NextResponse.json(
        { error: "Store ID and password are required." },
        { status: 400 }
      );
    }

    // 1. Authorize caller: must be authenticated via Supabase user or active store session
    let authenticatedUserId: string | null = null;
    try {
      const supabase = await createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user?.id) {
        authenticatedUserId = user.id;
      }
    } catch {
      // Fall through to session check
    }

    const currentSession = await getCurrentStoreSession();
    if (!authenticatedUserId && currentSession?.ownerUserId) {
      authenticatedUserId = currentSession.ownerUserId;
    }

    // 2. Fetch the target store (by id or loginId)
    const store = await prisma.store.findFirst({
      where: {
        isActive: true,
        OR: [{ id: storeId }, { loginId: storeId }],
      },
      select: {
        id: true,
        name: true,
        loginId: true,
        password: true,
        isActive: true,
        ownerUserId: true,
        profileLockEnabled: true,
      },
    });

    if (!store) {
      return NextResponse.json(
        { error: "Store profile not found or inactive." },
        { status: 404 }
      );
    }

    // Check ownership if user is an AA customer
    if (authenticatedUserId && store.ownerUserId && store.ownerUserId !== authenticatedUserId) {
      return NextResponse.json(
        { error: "You do not have access to this store profile." },
        { status: 403 }
      );
    }

    // If store has no password configured, it's considered already unlocked
    if (!store.password) {
      const token = createStoreUnlockToken(store.id);
      const response = NextResponse.json({
        ok: true,
        storeId: store.id,
        message: "Store profile does not require password verification.",
      });

      response.cookies.set({
        name: PROFILE_UNLOCK_COOKIE_NAME,
        value: token,
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 7, // 7 days
      });

      return response;
    }

    // 3. Brute-force throttle check
    const throttleIdentifier = store.loginId || store.id;
    const throttle = await checkLoginThrottle(throttleIdentifier, request);
    if (throttle.blocked) {
      return NextResponse.json(
        { error: "Too many failed unlock attempts. Please wait a few minutes and try again." },
        { status: 429 }
      );
    }

    // 4. Verify password with bcrypt
    const isPasswordValid = await bcrypt.compare(password, store.password);

    if (!isPasswordValid) {
      await recordFailedLogin(throttle.context);
      return NextResponse.json(
        { error: "Incorrect password for this store profile." },
        { status: 400 }
      );
    }

    // Clear any failed attempts on success
    await clearFailedLogins(throttle.context);

    // 5. Issue HMAC-signed unlock token cookie
    const token = createStoreUnlockToken(store.id);
    const response = NextResponse.json({
      ok: true,
      storeId: store.id,
      storeName: store.name,
    });

    response.cookies.set({
      name: PROFILE_UNLOCK_COOKIE_NAME,
      value: token,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7, // 7 days
    });

    return response;
  } catch (error) {
    console.error("[PROFILE_LOCK_UNLOCK_ERROR]", error);
    return NextResponse.json(
      { error: "Failed to unlock store profile. Please try again." },
      { status: 500 }
    );
  }
}
