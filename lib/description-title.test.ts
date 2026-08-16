import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  buildTitleHtml,
  hasTitleInDescription,
  prependTitleToDescription,
  updateDescriptionTitle,
} from "./description-title";

describe("description-title utility", () => {
  test("buildTitleHtml builds correct red bold 24px title paragraph", () => {
    assert.equal(
      buildTitleHtml("  Test Product Title  "),
      '<p><strong style="color: #e60000; font-size: 24px;">Test Product Title</strong></p>'
    );
    assert.equal(buildTitleHtml(""), "");
  });

  test("hasTitleInDescription detects styled title paragraph", () => {
    assert.equal(
      hasTitleInDescription(
        '<p><strong style="color: #e60000; font-size: 24px;">Product Title</strong></p>\n<p>Some desc</p>'
      ),
      true
    );

    assert.equal(
      hasTitleInDescription(
        '<p><span style="color: rgb(230, 0, 0);"><strong>Product Title</strong></span></p>'
      ),
      true
    );

    assert.equal(
      hasTitleInDescription(
        '<p><span style="color: rgb(13, 71, 161);"><strong>Product Title</strong></span></p>'
      ),
      true
    );

    assert.equal(
      hasTitleInDescription('<p>Just regular text</p>'),
      false
    );
  });

  test("prependTitleToDescription prepends title if not present", () => {
    const title = "My Product";
    const desc = "<p>Description body</p>";
    const result = prependTitleToDescription(title, desc);
    assert.equal(
      result,
      '<p><strong style="color: #e60000; font-size: 24px;">My Product</strong></p>\n<p>Description body</p>'
    );

    // Should not double prepend if title already present
    const doubleResult = prependTitleToDescription(title, result);
    assert.equal(doubleResult, result);
  });

  test("updateDescriptionTitle updates existing title or prepends if missing", () => {
    const initial = prependTitleToDescription("Old Title", "<p>Body</p>");
    const updated = updateDescriptionTitle("New Title", initial);
    assert.equal(
      updated,
      '<p><strong style="color: #e60000; font-size: 24px;">New Title</strong></p>\n<p>Body</p>'
    );

    const fromPlain = updateDescriptionTitle("New Title", "<p>Body only</p>");
    assert.equal(
      fromPlain,
      '<p><strong style="color: #e60000; font-size: 24px;">New Title</strong></p>\n<p>Body only</p>'
    );

    const fromLegacyBlue = updateDescriptionTitle(
      "Updated Legacy Title",
      '<p><strong style="color: #0D47A1; font-size: 24px;">Legacy Title</strong></p>\n<p>Legacy body</p>'
    );
    assert.equal(
      fromLegacyBlue,
      '<p><strong style="color: #e60000; font-size: 24px;">Updated Legacy Title</strong></p>\n<p>Legacy body</p>'
    );
  });
});
