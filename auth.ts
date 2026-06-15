import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { authConfig } from "@/auth.config";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      name: "Credentials",
      credentials: {
        storeId: { label: "Store ID", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.storeId || !credentials?.password) {
          return null;
        }

        const loginId = (credentials.storeId as string).trim().toLowerCase();
        const password = credentials.password as string;

        const store = await prisma.store.findUnique({
          where: { loginId },
        });

        if (!store?.password || !store.isActive) {
          return null;
        }

        const isPasswordValid = await bcrypt.compare(password, store.password);

        if (!isPasswordValid) {
          return null;
        }

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
