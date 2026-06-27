import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  cacheLife: {
    listflowFresh: {
      stale: 5,
      revalidate: 10,
      expire: 30,
    },
  },
};

export default nextConfig;
