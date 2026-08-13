const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STORAGE_PREFIX = "zh.audit.wait-route";

export class AuditWaitRouteError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "AuditWaitRouteError";
    this.code = code;
  }
}

function scopeUuid(value, label) {
  if (!UUID_PATTERN.test(String(value || ""))) {
    throw new AuditWaitRouteError("INCOMPLETE_CHAPTER_CONTEXT", `${label} scope is invalid.`);
  }
  return String(value).toLowerCase();
}

function normalizedScope(scope) {
  return {
    bookId: scopeUuid(scope?.bookId, "Book"),
    chapterId: scopeUuid(scope?.chapterId, "Chapter"),
    chapterVersionId: scopeUuid(scope?.chapterVersionId, "Chapter version"),
  };
}

export function auditWaitRouteStorageKey(scope) {
  const normalized = normalizedScope(scope);
  return `${STORAGE_PREFIX}:${normalized.bookId}:${normalized.chapterId}:${normalized.chapterVersionId}`;
}

export function validateAuditWaitRoute(value) {
  let url;
  try {
    url = new URL(String(value || ""));
  } catch {
    throw new AuditWaitRouteError("AUDIT_WAIT_ROUTE_REQUIRED", "The issued audit confirmation route is invalid.");
  }
  if (!/^https?:$/u.test(url.protocol)
    || !url.pathname.startsWith("/webhook-waiting/")
    || !url.searchParams.get("signature")) {
    throw new AuditWaitRouteError("AUDIT_WAIT_ROUTE_REQUIRED", "The issued audit confirmation route is not a signed wait webhook.");
  }
  return url.toString();
}

export function storeAuditWaitRoute(storage, scope, waitRoute) {
  if (!storage || typeof storage.setItem !== "function") {
    throw new AuditWaitRouteError("AUDIT_WAIT_STORAGE_UNAVAILABLE", "Session storage is unavailable for the audit confirmation route.");
  }
  const key = auditWaitRouteStorageKey(scope);
  const route = validateAuditWaitRoute(waitRoute);
  storage.setItem(key, route);
  return route;
}

export function readAuditWaitRoute(storage, scope) {
  if (!storage || typeof storage.getItem !== "function") return null;
  const value = storage.getItem(auditWaitRouteStorageKey(scope));
  if (!value) return null;
  try {
    return validateAuditWaitRoute(value);
  } catch {
    return null;
  }
}

export function clearAuditWaitRoute(storage, scope) {
  if (!storage || typeof storage.removeItem !== "function") return;
  storage.removeItem(auditWaitRouteStorageKey(scope));
}
