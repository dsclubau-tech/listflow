import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";

// Middleware uses the Edge-safe auth config (no Prisma, no Node.js modules)
export default NextAuth(authConfig).auth;

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
