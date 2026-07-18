import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPublicUploadedImageUrl,
  getConfiguredPublicImageBaseUrl,
  prepareEbayPictureUrls,
  rewriteListflowUploadedImageUrl,
} from "@/lib/ebay-image-urls";

test("public uploaded image URLs require a stable HTTPS origin", () => {
  assert.equal(
    getConfiguredPublicImageBaseUrl({
      LISTFLOW_PUBLIC_IMAGE_BASE_URL: "https://listflow.example/path",
      VERCEL_PROJECT_PRODUCTION_URL: undefined,
      NEXTAUTH_URL: "http://localhost:3000",
    }),
    "https://listflow.example",
  );
  assert.equal(
    buildPublicUploadedImageUrl("image-1", {
      LISTFLOW_PUBLIC_IMAGE_BASE_URL: "https://listflow.example",
      VERCEL_PROJECT_PRODUCTION_URL: undefined,
      NEXTAUTH_URL: undefined,
    }),
    "https://listflow.example/api/images/image-1",
  );
  assert.throws(
    () =>
      buildPublicUploadedImageUrl("image-1", {
        LISTFLOW_PUBLIC_IMAGE_BASE_URL: undefined,
        VERCEL_PROJECT_PRODUCTION_URL: undefined,
        NEXTAUTH_URL: "http://localhost:3000",
      }),
    /public HTTPS URL/,
  );
});

test("rewrites old localhost uploaded-image URLs to the public origin", () => {
  assert.equal(
    rewriteListflowUploadedImageUrl(
      "http://localhost:3000/api/images/image-1",
      "https://listflow.example",
    ),
    "https://listflow.example/api/images/image-1",
  );
});

test("prepares a mixed image set as one ordered eBay-hosted set", async () => {
  const stagedSources: string[] = [];
  const result = await prepareEbayPictureUrls({
    images: [
      "https://i.ebayimg.com/images/g/existing/s-l1600.jpg",
      "https://m.media-amazon.com/images/I/amazon._AC_SL1500_.jpg",
      "http://localhost:3000/api/images/uploaded-1",
      "https://i.ebayimg.com/images/g/existing/s-l1600.jpg",
    ],
    publicImageBaseUrl: "https://listflow.example",
    stageExternalImage: async (sourceUrl) => {
      stagedSources.push(sourceUrl);
      return `https://i.ebayimg.com/images/g/staged-${stagedSources.length}/s-l1600.jpg`;
    },
  });

  assert.deepEqual(stagedSources, [
    "https://m.media-amazon.com/images/I/amazon.jpg",
    "https://listflow.example/api/images/uploaded-1",
  ]);
  assert.deepEqual(result, [
    "https://i.ebayimg.com/images/g/existing/s-l1600.jpg",
    "https://i.ebayimg.com/images/g/staged-1/s-l1600.jpg",
    "https://i.ebayimg.com/images/g/staged-2/s-l1600.jpg",
  ]);
});

test("staging fails with the image position and does not continue", async () => {
  let calls = 0;
  await assert.rejects(
    prepareEbayPictureUrls({
      images: [
        "https://example.com/first.jpg",
        "https://example.com/second.jpg",
      ],
      stageExternalImage: async () => {
        calls += 1;
        throw new Error("image too small");
      },
    }),
    /Image 1 \(example\.com\).*image too small/,
  );
  assert.equal(calls, 1);
});

test("preparation rejects more than 24 images instead of truncating", async () => {
  await assert.rejects(
    prepareEbayPictureUrls({
      images: Array.from(
        { length: 25 },
        (_, index) => `https://i.ebayimg.com/images/g/${index}/s-l1600.jpg`,
      ),
      stageExternalImage: async () => {
        throw new Error("should not stage");
      },
    }),
    /up to 24 listing images/,
  );
});
