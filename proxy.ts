import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/auth.config";

const { auth } = NextAuth(authConfig);

export default auth((request) => {
  const headers = new Headers(request.headers);
  const requestId = headers.get("x-request-id") ?? crypto.randomUUID();

  headers.set("x-request-id", requestId);

  const response = NextResponse.next({
    request: {
      headers,
    },
  });

  response.headers.set("x-request-id", requestId);
  return response;
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
