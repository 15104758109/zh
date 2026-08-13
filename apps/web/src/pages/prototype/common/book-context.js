/* Read-only book scope shared by every persisted page. */
(function (scope) {
  const storageKey = "current_book_context";
  const uuidPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

  function normalizeUuid(value) {
    return typeof value === "string" && uuidPattern.test(value) ? value.toLowerCase() : null;
  }

  function routeBookId(locationLike = scope.location) {
    const match = locationLike?.pathname?.match(/^\/books\/([^/]+)\//);
    if (!match) return { present: false, bookId: null };
    try {
      return { present: true, bookId: normalizeUuid(decodeURIComponent(match[1])) };
    } catch {
      return { present: true, bookId: null };
    }
  }

  function readMatchingBookContext({
    storage = scope.localStorage,
    locationLike = scope.location,
    routeBookId: explicitRouteBookId,
    requireRoute = false,
  } = {}) {
    let stored;
    try {
      stored = JSON.parse(storage?.getItem(storageKey) || "null");
    } catch {
      return null;
    }
    const bookId = normalizeUuid(stored?.current_book_id);
    const localOperatorId = normalizeUuid(stored?.local_operator_id);
    if (!bookId || !localOperatorId) return null;

    const route = explicitRouteBookId === undefined
      ? routeBookId(locationLike)
      : { present: true, bookId: normalizeUuid(explicitRouteBookId) };
    if (requireRoute && !route.present) return null;
    if (route.present && route.bookId !== bookId) return null;
    return { bookId, localOperatorId };
  }

  scope.ZHBookContext = Object.freeze({ readMatchingBookContext });
})(globalThis);
