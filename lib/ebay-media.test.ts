import assert from "node:assert/strict";
import test from "node:test";

async function getCreateEbayImageFromUrl() {
  process.env.DATABASE_URL ??=
    "postgresql://listflow:test@127.0.0.1:5432/listflow_test";
  return (await import("@/lib/ebay-media")).createEbayImageFromUrl;
}

test("createEbayImageFromUrl follows the image resource until EPS is ready", async () => {
  const createEbayImageFromUrl = await getCreateEbayImageFromUrl();
  const requests: Array<{ url: string; method: string }> = [];
  const responses = [
    new Response("", {
      status: 201,
      headers: { Location: "/commerce/media/v1_beta/image/image-1" },
    }),
    new Response(JSON.stringify({ processStatus: "PENDING" }), { status: 200 }),
    new Response(
      JSON.stringify({
        processStatus: "COMPLETED",
        imageUrl: "https://i.ebayimg.com/images/g/ready/s-l1600.jpg",
      }),
      { status: 200 },
    ),
  ];

  const result = await createEbayImageFromUrl(
    {
      sourceUrl: "https://example.com/source.jpg",
      storeId: "store-1",
      storeNumber: 1,
    },
    {
      fetchImpl: async (url, init) => {
        requests.push({
          url: String(url),
          method: String(init?.method ?? "GET"),
        });
        const response = responses.shift();
        assert.ok(response);
        return response;
      },
      getAccessToken: async () => "access-token",
      waitForRateLimit: async () => undefined,
      recordRateLimitBackoff: async () => undefined,
      sleep: async () => undefined,
      pollDelayMs: 0,
    },
  );

  assert.equal(
    result,
    "https://i.ebayimg.com/images/g/ready/s-l1600.jpg",
  );
  assert.deepEqual(
    requests.map((request) => request.method),
    ["POST", "GET", "GET"],
  );
});

test("createEbayImageFromUrl surfaces Media API validation errors", async () => {
  const createEbayImageFromUrl = await getCreateEbayImageFromUrl();
  await assert.rejects(
    createEbayImageFromUrl(
      {
        sourceUrl: "https://example.com/small.jpg",
        storeId: "store-1",
        storeNumber: 1,
      },
      {
        fetchImpl: async () =>
          new Response(
            JSON.stringify({
              errors: [{ longMessage: "Image must be at least 500 pixels." }],
            }),
            { status: 400 },
          ),
        getAccessToken: async () => "access-token",
        waitForRateLimit: async () => undefined,
        recordRateLimitBackoff: async () => undefined,
      },
    ),
    /Image must be at least 500 pixels/,
  );
});
