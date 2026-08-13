import assert from "node:assert/strict";
import test from "node:test";

import "../src/pages/prototype/common/book-context.js";

const BOOK = "11111111-1111-4111-8111-111111111111";
const OPERATOR = "22222222-2222-4222-8222-222222222222";

function storage(initial) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) { return values.get(key) || null; },
    setItem() { throw new Error("book context reader must not write storage"); },
  };
}

test("book context accepts only a saved B1 context matching the dynamic route", () => {
  const value = storage({ current_book_context: JSON.stringify({ current_book_id: BOOK.toUpperCase(), local_operator_id: OPERATOR.toUpperCase() }) });
  const context = globalThis.ZHBookContext.readMatchingBookContext({ storage: value, locationLike: { pathname: `/books/${BOOK}/world` } });
  assert.deepEqual(context, { bookId: BOOK, localOperatorId: OPERATOR });
});

test("book context rejects a bare, invalid, or mismatched route without writing a replacement", () => {
  const value = storage({ current_book_context: JSON.stringify({ current_book_id: BOOK, local_operator_id: OPERATOR }) });
  assert.equal(globalThis.ZHBookContext.readMatchingBookContext({ storage: value, locationLike: { pathname: "/books/33333333-3333-4333-8333-333333333333/world" } }), null);
  assert.equal(globalThis.ZHBookContext.readMatchingBookContext({ storage: value, locationLike: { pathname: "/books/not-a-book/world" } }), null);
  assert.equal(globalThis.ZHBookContext.readMatchingBookContext({ storage: storage({}), locationLike: { pathname: `/books/${BOOK}/world` } }), null);
});

test("a book-scoped page requires its dynamic route even when B1 context exists", () => {
  const value = storage({ current_book_context: JSON.stringify({ current_book_id: BOOK, local_operator_id: OPERATOR }) });
  assert.equal(
    globalThis.ZHBookContext.readMatchingBookContext({
      storage: value,
      locationLike: { pathname: "/workbench" },
      requireRoute: true,
    }),
    null,
  );
});
