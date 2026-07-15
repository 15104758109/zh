const routes = [
  { id: "workbench", test: /^\/workbench\/?$/, module: "/pages/workbench/index.mjs", label: "总控设置" },
  { id: "new-book", test: /^\/books\/new\/?$/, module: "/pages/new-book/index.mjs", label: "新建作品" },
  { id: "world", test: /^\/books\/([^/]+)\/world\/?$/, module: "/pages/world/index.mjs", label: "世界设定" },
  { id: "characters", test: /^\/books\/([^/]+)\/characters\/?$/, module: "/pages/characters/index.mjs", label: "角色设定" },
  { id: "l1a", test: /^\/books\/([^/]+)\/l1a\/?$/, module: "/pages/l1a/index.mjs", label: "L1A 剧情段" },
  { id: "production", test: /^\/books\/([^/]+)\/production\/?$/, module: "/pages/production-stage/index.mjs", label: "生产阶段" },
  { id: "deduction", test: /^\/books\/([^/]+)\/deduction\/?$/, module: "/pages/multi-agent-deduction/index.mjs", label: "多代理推演" },
  { id: "deduction-review", test: /^\/books\/([^/]+)\/deduction-review\/?$/, module: "/pages/audit-review/index.mjs", label: "推演复核" },
  { id: "audit", test: /^\/books\/([^/]+)\/audit\/?$/, module: "/pages/audit-stage/index.mjs", label: "审计阶段" },
];

function resolveRoute(pathname = location.pathname) {
  for (const route of routes) {
    const match = pathname.match(route.test);
    if (match) return { ...route, bookId: match[1] || new URLSearchParams(location.search).get("bookId") || "book-ashfall" };
  }
  return { ...routes[0], bookId: "book-ashfall" };
}

function bookPath(bookId, segment) { return `/books/${encodeURIComponent(bookId)}/${segment}`; }

function shell(route) {
  const active = route.id;
  const bookId = route.bookId;
  const link = (id, href, icon, label) => `<a class="shell-nav__link ${active === id ? "is-active" : ""}" href="${href}"><span class="shell-icon">${icon}</span><span class="shell-nav__text">${label}</span></a>`;
  return `<aside class="sidebar-glass" aria-label="主菜单">
    <div class="sidebar-brand"><div class="brand-mark">ZH</div><div class="sidebar-text"><strong>纵横</strong><small>Narrative-Engine</small></div></div>
    <div class="sidebar-separator"></div>
    <nav class="shell-nav">
      ${link("workbench", "/workbench", "▦", "总控设置")}
      ${link("world", bookPath(bookId, "world"), "◇", "设计阶段")}
      ${link("production", bookPath(bookId, "production"), "▸", "生产阶段")}
      ${link("audit", bookPath(bookId, "audit"), "✓", "审计阶段")}
    </nav>
    <div class="sidebar-footer"><span class="sidebar-user-avatar">U</span><span class="sidebar-text">本地用户</span></div>
  </aside>
  <button class="sidebar-toggle" type="button" aria-label="折叠侧栏" title="折叠侧栏">‹</button>
  <div class="main-content"><header class="header-glass"><div class="header-tabs"><a href="/workbench">作品工作台</a><span>${route.label}</span></div><div class="header-context"><span class="status-dot"></span><span>余烬航线</span><code>${bookId}</code></div></header><main id="page-content" class="page-content"></main></div>`;
}

function stateControl(route, rerender) {
  const holder = document.createElement("label");
  holder.className = "state-control";
  holder.innerHTML = "<span>静态状态</span><select aria-label=\"静态状态\"><option value=\"normal\">正常</option><option value=\"empty\">空</option><option value=\"loading\">加载中</option><option value=\"error\">错误</option></select>";
  const select = holder.querySelector("select");
  select.value = new URLSearchParams(location.search).get("state") || "normal";
  select.addEventListener("change", () => { const url = new URL(location.href); url.searchParams.set("state", select.value); history.replaceState({}, "", url); rerender(); });
  return holder;
}

async function render() {
  const route = resolveRoute();
  document.title = `${route.label} - 纵横 Narrative-Engine`;
  document.body.classList.remove("sidebar-collapsed");
  document.querySelector("#app").innerHTML = shell(route);
  const page = document.querySelector("#page-content");
  const control = stateControl(route, render);
  document.querySelector(".header-glass").prepend(control);
  document.querySelector(".sidebar-toggle").addEventListener("click", () => document.body.classList.toggle("sidebar-collapsed"));
  try {
    const module = await import(route.module);
    await module.renderPage({ content: page, route, state: new URLSearchParams(location.search).get("state") || "normal", navigate: (to) => { history.pushState({}, "", to); render(); } });
  } catch (error) {
    console.error(error);
    page.innerHTML = `<section class="page-state page-state--error"><h1>页面暂不可用</h1><p>${error.message}</p></section>`;
  }
}

window.addEventListener("popstate", render);
document.addEventListener("click", (event) => { const anchor = event.target.closest("a[href^='/']"); if (anchor && !event.metaKey && !event.ctrlKey) { event.preventDefault(); history.pushState({}, "", anchor.href); render(); } });
render();
