import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";

import { prisma } from "@/lib/prisma";
import { getCurrentStoreSession } from "@/lib/store-session";
import { validateStorePassword } from "@/lib/store-password-policy";

export async function POST(request: Request) {
  const storeSession = await getCurrentStoreSession();

  if (!storeSession) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const currentPassword =
    typeof body?.currentPassword === "string" ? body.currentPassword : "";
  const newPassword = typeof body?.newPassword === "string" ? body.newPassword : "";
  const confirmPassword =
    typeof body?.confirmPassword === "string" ? body.confirmPassword : "";

  if (!currentPassword || !newPassword || !confirmPassword) {
    return NextResponse.json(
      { error: "Current password, new password, and confirmation are required." },
      { status: 400 },
    );
  }

  if (newPassword !== confirmPassword) {
    return NextResponse.json(
      { error: "New password and confirmation do not match." },
      { status: 400 },
    );
  }

  if (currentPassword === newPassword) {
    return NextResponse.json(
      { error: "New password must be different from the current password." },
      { status: 400 },
    );
  }

  const store = await prisma.store.findUnique({
    where: { id: storeSession.storeId },
    select: {
      id: true,
      name: true,
      loginId: true,
      password: true,
      isActive: true,
    },
  });

  if (!store?.password || !store.isActive) {
    return NextResponse.json({ error: "Store login is not active." }, { status: 403 });
  }

  const currentPasswordMatches = await bcrypt.compare(currentPassword, store.password);

  if (!currentPasswordMatches) {
    return NextResponse.json(
      { error: "Current password is incorrect." },
      { status: 400 },
    );
  }

  const passwordPolicy = validateStorePassword(newPassword);

  if (!passwordPolicy.valid) {
    return NextResponse.json(
      { error: passwordPolicy.errors.join(" ") },
      { status: 400 },
    );
  }

  const hashedPassword = await bcrypt.hash(newPassword, 12);

  await prisma.store.update({
    where: { id: store.id },
    data: { password: hashedPassword },
  });

  return NextResponse.json({
    ok: true,
    message: "Password changed. Sign in again with the new password.",
  });
}
