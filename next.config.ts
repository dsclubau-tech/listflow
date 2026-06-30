import type { NextConfig } from "next";

const chromiumBinFiles = ["./node_modules/@sparticuz/chromium/bin/**/*"];

const nextConfig: NextConfig = {
  cacheComponents: true,
  outputFileTracingIncludes: {
    "/api/scrape": chromiumBinFiles,
    "/api/price-check": chromiumBinFiles,
    "/api/price-check/jobs": chromiumBinFiles,
    "/api/ebay-research/jobs": chromiumBinFiles,
    "/api/ebay-research/jobs/batch": chromiumBinFiles,
  },
  cacheLife: {
    listflowFresh: {
      stale: 5,
      revalidate: 10,
      expire: 30,
    },
  },
};

export default nextConfig;
