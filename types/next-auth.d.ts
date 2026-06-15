import "next-auth";

declare module "next-auth" {
  interface User {
    role?: string;
    storeId?: string;
    storeName?: string;
    storeLoginId?: string;
  }

  interface Session {
    user: {
      id: string;
      name: string;
      email: string;
      role: string;
      storeId: string;
      storeName: string;
      storeLoginId: string;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: string;
    storeId: string;
    storeName: string;
    storeLoginId: string;
  }
}
