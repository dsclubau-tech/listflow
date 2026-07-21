import assert from "node:assert/strict";
import test from "node:test";
import {
  dedupeProductImages,
  normalizeProductImageUrl,
  removeKnownUndersizedEbayPictures,
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

test("keeps up to 24 listing images by default", () => {
  const images = Array.from(
    { length: 30 },
    (_, index) => `https://example.com/${index}.jpg`,
  );

  assert.equal(dedupeProductImages(images).length, 24);
});

test("removes known eBay pictures below the 500-pixel policy minimum", () => {
  const large =
    "https://i.ebayimg.com/00/s/MTUwMFgxNTAw/z/example/$_1.JPG?set_id=8800005007";
  const minimum =
    "https://i.ebayimg.com/00/s/NTAwWDQwMA==/z/example/$_1.JPG?set_id=8800005007";
  const thumbnail =
    "https://i.ebayimg.com/00/s/NDBYNDA=/z/example/$_1.JPG?set_id=8800005007";

  assert.deepEqual(removeKnownUndersizedEbayPictures([large, minimum, thumbnail]), [
    "https://i.ebayimg.com/00/s/MTUwMFgxNTAw/z/example/$_1.JPG",
    "https://i.ebayimg.com/00/s/NTAwWDQwMA==/z/example/$_1.JPG",
  ]);
});

test("keeps pictures whose dimensions are not encoded in an eBay URL", () => {
  assert.deepEqual(
    removeKnownUndersizedEbayPictures([
      "https://i.ebayimg.com/images/g/example/s-l1600.jpg",
      "https://example.com/product.jpg",
    ]),
    [
      "https://i.ebayimg.com/images/g/example/s-l1600.jpg",
      "https://example.com/product.jpg",
    ],
  );
});
