import assert from "node:assert/strict";
import test from "node:test";
import {
  getUploadHistoryPagination,
  parseUploadHistoryPage,
  UPLOAD_HISTORY_PAGE_SIZE,
} from "./upload-history-pagination";

test("parses only positive upload history pages", () => {
  assert.equal(parseUploadHistoryPage("3"), 3);
  assert.equal(parseUploadHistoryPage(["2", "9"]), 2);
  assert.equal(parseUploadHistoryPage("0"), 1);
  assert.equal(parseUploadHistoryPage("not-a-page"), 1);
});

test("bounds upload history pagination to the available history", () => {
  assert.deepEqual(getUploadHistoryPagination(125, 3), {
    page: 3,
    totalPages: 3,
    skip: UPLOAD_HISTORY_PAGE_SIZE * 2,
  });
  assert.deepEqual(getUploadHistoryPagination(2, 10), {
    page: 1,
    totalPages: 1,
    skip: 0,
  });
});
