import { NextResponse } from "next/server";
import { PROFILE_UNLOCK_COOKIE_NAME } from "@/lib/profile-lock";

export async function POST() {
  const response = NextResponse.json({ ok: true, locked: true });

  response.cookies.set({
    name: PROFILE_UNLOCK_COOKIE_NAME,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });

  return response;
}
