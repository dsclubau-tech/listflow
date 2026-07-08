import assert from "node:assert/strict";
import test from "node:test";
import {
  dedupeProductImages,
  normalizeProductImageUrl,
} from "@/lib/product-images";

test("normalizes Amazon resized image URLs to one canonical URL", () => {
  assert.equal(
    normalizeProductImageUrl(
      "https://m.media-amazon.com/images/I/71abc._AC_SL1500_.jpg?x=1",
    ),
    "https://m.media-amazon.com/images/I/71abc.jpg",
  );
  assert.deepEqual(
    dedupeProductImages([
      "https://m.media-amazon.com/images/I/71abc._AC_SL1500_.jpg",
      "https://m.media-amazon.com/images/I/71abc._AC_SY450_.jpg",
      "https://m.media-amazon.com/images/I/71abc.jpg",
    ]),
    ["https://m.media-amazon.com/images/I/71abc.jpg"],
  );
});

test("keeps different product images in original order", () => {
  assert.deepEqual(
    dedupeProductImages([
      "https://m.media-amazon.com/images/I/first._AC_SL1500_.jpg",
      "https://m.media-amazon.com/images/I/second._AC_SY450_.jpg",
      "https://m.media-amazon.com/images/I/first._AC_SX679_.jpg",
    ]),
    [
      "https://m.media-amazon.com/images/I/first.jpg",
      "https://m.media-amazon.com/images/I/second.jpg",
    ],
  );
});

test("drops invalid and placeholder image URLs", () => {
  assert.deepEqual(
    dedupeProductImages([
      "",
      "not a url",
      "https://m.media-amazon.com/images/G/play-button._AC_.png",
      "https://m.media-amazon.com/images/I/product-video-preview._AC_.jpg",
      "https://example.com/manual-image.jpg",
    ]),
    ["https://example.com/manual-image.jpg"],
  );
});

test("drops Amazon non-product UI image assets", () => {
  assert.equal(
    normalizeProductImageUrl("https://m.media-amazon.com/images/G/01/video/play-button.png"),
    null,
  );
  assert.equal(
    normalizeProductImageUrl("https://m.media-amazon.com/images/G/01/x-locale/common/transparent-pixel.gif"),
    null,
  );
});

test("keeps manually uploaded ListFlow image URLs", () => {
  assert.equal(
    normalizeProductImageUrl("https://listflow-pi.vercel.app/api/images/clx123abc"),
    "https://listflow-pi.vercel.app/api/images/clx123abc",
  );
});
