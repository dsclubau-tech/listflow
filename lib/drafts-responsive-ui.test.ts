import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import DraftsLoading from "@/app/(app)/drafts/loading";
import ActionProgressBar from "@/components/ActionProgressBar";
import Button from "@/components/ui/Button";

test("shared button exposes a disabled busy state and pending label", () => {
  const markup = renderToStaticMarkup(
    createElement(
      Button,
      { pending: true, pendingLabel: "Saving…", variant: "primary" },
      "Save",
    ),
  );

  assert.match(markup, /aria-busy="true"/);
  assert.match(markup, /disabled=""/);
  assert.match(markup, /Saving…/);
  assert.match(markup, /role="status"/);
});

test("indeterminate progress remains accessible without a fake percentage", () => {
  const markup = renderToStaticMarkup(
    createElement(ActionProgressBar, {
      label: "Uploading to eBay",
      percent: 0,
      indeterminate: true,
    }),
  );

  assert.match(markup, /role="progressbar"/);
  assert.match(markup, /aria-label="Uploading to eBay"/);
  assert.doesNotMatch(markup, /aria-valuenow/);
  assert.match(markup, /listflow-progress-indeterminate/);
});

test("Drafts route loading screen announces itself and mirrors both layouts", () => {
  const markup = renderToStaticMarkup(createElement(DraftsLoading));

  assert.match(markup, /aria-label="Loading drafts"/);
  assert.match(markup, /xl:hidden/);
  assert.match(markup, /xl:block/);
  assert.match(markup, /motion-reduce:animate-none/);
});

test("Drafts renderer contains card and desktop table breakpoints", () => {
  const source = readFileSync("components/DraftsTable.tsx", "utf8");
  const editorSource = readFileSync("components/InlineEditForm.tsx", "utf8");

  assert.match(source, /grid-cols-\[auto_4rem_minmax\(0,1fr\)\]/);
  assert.match(source, /xl:table-row/);
  assert.match(source, /data-draft-action-menu/);
  assert.match(editorSource, /Draft editor sections/);
});

test("draft editor gallery uses a lightbox while description images remain editable", () => {
  const tableSource = readFileSync("components/DraftsTable.tsx", "utf8");
  const editorSource = readFileSync("components/InlineEditForm.tsx", "utf8");
  const richTextSource = readFileSync("components/RichTextEditor.tsx", "utf8");
  const lightboxSource = readFileSync("components/ImageLightbox.tsx", "utf8");

  assert.match(editorSource, /<ImageLightbox/);
  assert.match(editorSource, /View product image \$\{i \+ 1\} full size/);
  assert.match(editorSource, /selectableImages/);
  assert.match(richTextSource, /target\.closest\("\.ql-editor img"\)/);
  assert.match(
    richTextSource,
    /editor\.setSelection\(imageIndex, 1, "user"\)/,
  );
  assert.match(richTextSource, /data-images-selectable=/);
  assert.match(richTextSource, /aria-label="Image actions"/);
  assert.match(richTextSource, />\s*Image Properties\s*</);
  assert.match(
    richTextSource,
    /onPointerDownCapture=\{handleImagePointerDown\}/,
  );
  assert.match(
    richTextSource,
    /onPointerMoveCapture=\{handleImagePointerMove\}/,
  );
  assert.match(
    richTextSource,
    /onPointerUpCapture=\{handleImagePointerUp\}/,
  );
  assert.match(richTextSource, /setPointerCapture\(event\.pointerId\)/);
  assert.match(richTextSource, /listflow-image-drop-target/);
  assert.match(richTextSource, />\s*Move Up\s*</);
  assert.match(richTextSource, />\s*Move Down\s*</);
  assert.doesNotMatch(tableSource, /ImageLightbox/);
  assert.match(lightboxSource, /aria-modal="true"/);
  assert.match(lightboxSource, /event\.key === "Escape"/);
  assert.doesNotMatch(lightboxSource, /<a\b/);
});

test("draft editor tabs use responsive spacing and consistent padding", () => {
  const editorSource = readFileSync("components/InlineEditForm.tsx", "utf8");

  assert.match(editorSource, /gap-4 md:gap-6/);
  assert.match(editorSource, /px-1 py-3 text-sm/);
});

test("draft editor provides a contextual back-to-top control and working VeRO link", () => {
  const editorSource = readFileSync("components/InlineEditForm.tsx", "utf8");

  assert.match(editorSource, /editorBounds\.top < -200/);
  assert.match(editorSource, /editorBounds\.bottom > 0/);
  assert.match(editorSource, /scrollIntoView\(\{/);
  assert.match(editorSource, /behavior: "smooth"/);
  assert.match(editorSource, /aria-label="Back to top of product editor"/);
  assert.match(
    editorSource,
    /intellectual-property-rights-policy\?id=4349/,
  );
  assert.doesNotMatch(editorSource, /listing-policies\/vero-program/);
});

test("Draft actions use full-size delete controls and persisted import progress", () => {
  const tableSource = readFileSync("components/DraftsTable.tsx", "utf8");
  const editorSource = readFileSync("components/InlineEditForm.tsx", "utf8");

  assert.match(tableSource, /min-w-\[6\.5rem\]/);
  assert.match(tableSource, />\s*Delete\s*<\/Button>/);
  assert.match(editorSource, /\/api\/upload\/jobs\/current/);
  assert.match(editorSource, /Queueing eBay upload/);
  assert.match(editorSource, /Uploading to eBay/);
  assert.match(editorSource, /<ActionProgressBar/);
});

test("description editor normalizes image-only lists without changing text bullets", () => {
  const editorSource = readFileSync("components/RichTextEditor.tsx", "utf8");

  assert.match(editorSource, /function cleanImageOnlyLists/);
  assert.match(editorSource, /item\.querySelector\("img"\)/);
  assert.match(editorSource, /item\.textContent/);
  assert.match(editorSource, /list\.replaceWith\(fragment\)/);
});
