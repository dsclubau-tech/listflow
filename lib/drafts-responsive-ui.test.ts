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
