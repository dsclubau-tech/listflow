import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { authConfig } from "@/auth.config";
import {
  checkLoginThrottle,
  clearFailedLogins,
  recordFailedLogin,
} from "@/lib/login-throttle";
import { hasStoreLoginIdWhitespace } from "@/lib/store-login-id";

const DUMMY_PASSWORD_HASH =
  "$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2uheWG/igi.";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      name: "Credentials",
      credentials: {
        storeId: { label: "Store ID", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, request) {
        if (!credentials?.storeId || !credentials?.password) {
          return null;
        }

        const rawLoginId =
          typeof credentials.storeId === "string" ? credentials.storeId : "";
        if (hasStoreLoginIdWhitespace(rawLoginId)) {
          return null;
        }

        const loginId = rawLoginId.toLowerCase();
        const password = credentials.password as string;

        if (!loginId || loginId.length > 128 || !password || password.length > 256) {
          return null;
        }

        const throttle = await checkLoginThrottle(loginId, request);
        if (throttle.blocked) {
          return null;
        }

        const store = await prisma.store.findUnique({
          where: { loginId },
        });

        const isPasswordValid = await bcrypt.compare(
          password,
          store?.password || DUMMY_PASSWORD_HASH
        );

        if (!store?.password || !store.isActive || !isPasswordValid) {
          await recordFailedLogin(throttle.context);
          return null;
        }

        await clearFailedLogins(throttle.context);

        return {
          id: store.id,
          name: store.name,
          email: loginId,
          role: "store",
          storeId: store.id,
          storeName: store.name,
          storeLoginId: loginId,
        };
      },
    }),
  ],
});
