import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import {
  hasStoreLoginIdWhitespace,
  STORE_LOGIN_ID_WHITESPACE_ERROR,
} from "@/lib/store-login-id";
import { validateStorePassword } from "@/lib/store-password-policy";
import { checkLoginThrottle, clearFailedLogins } from "@/lib/login-throttle";
import {
  RK_ECOM_30_DAY_FREE_RETURN_TEMPLATE_CONTENT,
  RK_ECOM_30_DAY_FREE_RETURN_TEMPLATE_NAME,
} from "@/lib/builtin-description-templates";

export async function POST(request: Request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const storeName = typeof body?.storeName === "string" ? body.storeName.trim() : "";
  const rawLoginId = typeof body?.loginId === "string" ? body.loginId : "";
  const loginId = rawLoginId.toLowerCase();
  const password = typeof body?.password === "string" ? body.password : "";
  const confirmPassword = typeof body?.confirmPassword === "string" ? body.confirmPassword : "";

  // 1. Validation
  if (!storeName || storeName.length > 100) {
    return NextResponse.json(
      { error: "Store Name is required (1–100 characters)." },
      { status: 400 }
    );
  }

  if (hasStoreLoginIdWhitespace(rawLoginId)) {
    return NextResponse.json(
      { error: STORE_LOGIN_ID_WHITESPACE_ERROR },
      { status: 400 },
    );
  }

  if (!loginId || loginId.length < 3 || loginId.length > 64) {
    return NextResponse.json(
      { error: "Store ID must be between 3 and 64 characters." },
      { status: 400 }
    );
  }

  if (!/^[a-z0-9-]+$/.test(loginId)) {
    return NextResponse.json(
      { error: "Store ID can only contain lowercase letters, numbers, and hyphens." },
      { status: 400 }
    );
  }

  if (!password) {
    return NextResponse.json(
      { error: "Password is required." },
      { status: 400 }
    );
  }

  if (password !== confirmPassword) {
    return NextResponse.json(
      { error: "Passwords do not match." },
      { status: 400 }
    );
  }

  const passwordPolicy = validateStorePassword(password);
  if (!passwordPolicy.valid) {
    return NextResponse.json(
      { error: passwordPolicy.errors.join(" ") },
      { status: 400 }
    );
  }

  // 2. Throttle check
  const throttle = await checkLoginThrottle(`register:${loginId}`, request);
  if (throttle.blocked) {
    return NextResponse.json(
      { error: "Too many registration attempts. Please wait a few minutes and try again." },
      { status: 429 }
    );
  }

  // 3. Unique check
  const existing = await prisma.store.findUnique({
    where: { loginId },
  });

  if (existing) {
    return NextResponse.json(
      { error: "This Store ID is already taken. Please choose another one." },
      { status: 400 }
    );
  }

  // 4. Create store & seed default template
  try {
    const hashedPassword = await bcrypt.hash(password, 12);

    const store = await prisma.store.create({
      data: {
        name: storeName,
        loginId,
        password: hashedPassword,
        isActive: true,
      },
    });

    // Seed default description template
    await prisma.descriptionTemplate.create({
      data: {
        storeId: store.id,
        name: RK_ECOM_30_DAY_FREE_RETURN_TEMPLATE_NAME,
        content: RK_ECOM_30_DAY_FREE_RETURN_TEMPLATE_CONTENT,
        isDefault: true,
      },
    });

    await clearFailedLogins(throttle.context);

    return NextResponse.json({
      ok: true,
      loginId: store.loginId,
      message: "Store created successfully.",
    });
  } catch (err) {
    console.error("[register API error]", err);
    return NextResponse.json(
      { error: "Failed to create store. Please try again." },
      { status: 500 }
    );
  }
}
