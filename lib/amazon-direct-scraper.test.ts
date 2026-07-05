import assert from "node:assert/strict";
import test from "node:test";
import { load } from "cheerio";
import {
  extractAmazonPostcodeToken,
  extractAmazonProductTitle,
  parseAmazonPostcodeResponse,
} from "@/lib/amazon-direct-parse";

test("extractAmazonProductTitle reads meta content when text title is missing", () => {
  const $ = load(`
    <html>
      <head>
        <meta property="og:title" content="SoundPEATS Air5 Pro Cancelling Earbuds : Amazon.com.au: Electronics" />
      </head>
      <body></body>
    </html>
  `);

  assert.equal(
    extractAmazonProductTitle($),
    "SoundPEATS Air5 Pro Cancelling Earbuds"
  );
});

test("extractAmazonProductTitle reads product JSON-LD title", () => {
  const $ = load(`
    <script type="application/ld+json">
      {"@context":"https://schema.org","@type":"Product","name":"Wireless Earbuds with Case"}
    </script>
  `);

  assert.equal(extractAmazonProductTitle($), "Wireless Earbuds with Case");
});

test("parseAmazonPostcodeResponse accepts JSON and text success shapes", () => {
  assert.equal(
    parseAmazonPostcodeResponse('{"isValidAddress":"1"}', "2217"),
    true
  );
  assert.equal(
    parseAmazonPostcodeResponse('{"address":{"postalCode":"2217"}}', "2217"),
    true
  );
  assert.equal(parseAmazonPostcodeResponse('{"isValidAddress":0}', "2217"), false);
});

test("extractAmazonPostcodeToken reads hidden and scripted csrf tokens", () => {
  const hidden = load(
    '<input name="anti-csrftoken-a2z" value="hidden-token" />'
  );
  const scripted = load("<html></html>");

  assert.equal(extractAmazonPostcodeToken(hidden), "hidden-token");
  assert.equal(
    extractAmazonPostcodeToken(
      scripted,
      'window.csrfToken = "script-token";'
    ),
    "script-token"
  );
});
