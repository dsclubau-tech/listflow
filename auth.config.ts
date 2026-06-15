import type { NextAuthConfig } from "next-auth";

// This file is Edge-compatible — no Prisma, no Node.js modules.
// It contains only the NextAuth config that can run in Edge middleware.
export const authConfig = {
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
      const protectedPaths = ["/dashboard", "/history", "/settings"];
      const isProtected = protectedPaths.some((path) =>
        nextUrl.pathname.startsWith(path)
      );
      const isLoginPage = nextUrl.pathname === "/login";

      if (isLoginPage && isStoreSession) {
        return Response.redirect(new URL("/dashboard", nextUrl));
      }

      if (isProtected && !isStoreSession) {
        const loginUrl = new URL("/login", nextUrl);
        loginUrl.searchParams.set("callbackUrl", nextUrl.pathname);
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
