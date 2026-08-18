const pageRoutes = Object.freeze([
  { id: "workbench", test: /^\/workbench\/?$/, page: "pages/workbench/index.html" },
  { id: "skill-library", test: /^\/skill_library\.html\/?$/, page: "pages/skill-library/index.html" },
  { id: "new-book", test: /^\/books\/new\/?$/, page: "pages/new-book/index.html" },
  { id: "world", test: /^\/books\/[^/]+\/world\/?$/, page: "pages/world/index.html" },
  { id: "characters", test: /^\/books\/[^/]+\/characters\/?$/, page: "pages/characters/index.html" },
  { id: "l1a", test: /^\/books\/[^/]+\/l1a\/?$/, page: "pages/l1a/index.html" },
  { id: "production", test: /^\/books\/[^/]+\/production\/?$/, page: "pages/production-stage/index.html" },
  { id: "deduction", test: /^\/books\/[^/]+\/deduction\/?$/, page: "pages/multi-agent-deduction/index.html" },
  { id: "deduction-review", test: /^\/books\/[^/]+\/deduction-review\/?$/, page: "pages/audit-review/index.html" },
  { id: "audit", test: /^\/books\/[^/]+\/audit\/?$/, page: "pages/audit-stage/index.html" },
  { id: "iteration", test: /^\/books\/[^/]+\/iteration\/?$/, page: "pages/iteration/index.html" },
]);

export { pageRoutes };

export function resolvePageRoute(pathname) {
  return pageRoutes.find((route) => route.test.test(pathname)) || null;
}
