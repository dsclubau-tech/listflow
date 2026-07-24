import type { NextAuthConfig } from "next-auth";
import {
  DEFAULT_AUTHENTICATED_PATH,
  getSafeCallbackPath,
  isPrivateAppPath,
} from "@/lib/auth-navigation";

function getBaseOrigin(nextUrl: URL) {
  if (
    nextUrl.host &&
    !nextUrl.host.includes("localhost") &&
    !nextUrl.host.includes("127.0.0.1")
  ) {
    const protocol =
      nextUrl.protocol && nextUrl.protocol.startsWith("http")
        ? nextUrl.protocol
        : "https:";
    return `${protocol}//${nextUrl.host}`;
  }

  const vercelUrl =
    process.env.LISTFLOW_PUBLIC_IMAGE_BASE_URL ||
    process.env.NEXTAUTH_URL ||
    process.env.VERCEL_PROJECT_PRODUCTION_URL ||
    process.env.VERCEL_URL;

  if (vercelUrl && !vercelUrl.includes("localhost")) {
    return vercelUrl.startsWith("http") ? vercelUrl : `https://${vercelUrl}`;
  }

  return nextUrl.origin;
}

// This file is Edge-compatible - no Prisma or Node.js-only modules.
// It contains only the NextAuth config that can run in Edge middleware.
export const authConfig = {
  trustHost: true,
  session: {
    strategy: "jwt" as const,
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = (user as { role?: string }).role;
        token.name = user.name;
        token.storeId = (user as { storeId?: string }).storeId ?? user.id;
        token.storeName = (user as { storeName?: string }).storeName ?? user.name ?? "";
        token.storeLoginId = (user as { storeLoginId?: string }).storeLoginId ?? user.email ?? "";
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = (token.storeId || token.id) as string;
        session.user.role = token.role as string;
        session.user.name = token.name as string;
        session.user.storeId = token.storeId as string;
        session.user.storeName = token.storeName as string;
        session.user.storeLoginId = token.storeLoginId as string;
        session.user.email = token.storeLoginId as string;
      }
      return session;
    },
    authorized({ auth, request: { nextUrl } }) {
      const isStoreSession = !!auth?.user?.storeId;
      const isProtected = isPrivateAppPath(nextUrl.pathname);
      const isAuthPage =
        nextUrl.pathname === "/login" || nextUrl.pathname === "/register";
      const origin = getBaseOrigin(nextUrl);

      if (isAuthPage && isStoreSession) {
        return Response.redirect(new URL(DEFAULT_AUTHENTICATED_PATH, origin));
      }

      if (isProtected && !isStoreSession) {
        const loginUrl = new URL("/login", origin);
        loginUrl.searchParams.set(
          "callbackUrl",
          getSafeCallbackPath(`${nextUrl.pathname}${nextUrl.search}`)
        );
        return Response.redirect(loginUrl);
      }

      return true;
    },
  },
  pages: {
    signIn: "/login",
  },
  providers: [], // Providers are added in auth.ts (Node.js only)
} satisfies NextAuthConfig;
