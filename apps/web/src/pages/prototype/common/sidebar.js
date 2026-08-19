/* Shared sidebar markup for prototype-based pages. */
(function () {
  const items = [
    { id: "workbench", path: "/workbench", label: "总控设置", ariaLabel: "总控设置面板", icon: "dashboard" },
    { id: "design", segment: "world", label: "设计阶段", ariaLabel: "设计阶段：世界设定、角色设定、L1A剧情段", icon: "architecture" },
    { id: "production", segment: "production", label: "生产阶段", ariaLabel: "生产阶段：章节推演、多代理执行", icon: "precision_manufacturing" },
    // Audit requires a chapter/version scope; the review entry resolves that scope before /audit.
    { id: "audit", segment: "audit", entrySegment: "deduction-review", label: "审计阶段", ariaLabel: "审计阶段：正文审计、主编裁决", icon: "fact_check" },
    { id: "iteration", segment: "iteration", label: "迭代管理", ariaLabel: "迭代管理：提示词优化、失败样本分析", icon: "history" }
  ];

  const uuidPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
  const bookSegments = new Set(["world", "characters", "l1a", "production", "deduction", "deduction-review", "audit", "iteration"]);

  function currentBookId() {
    let contextBookId = null;
    try {
      const context = JSON.parse(localStorage.getItem("current_book_context") || "null");
      contextBookId = uuidPattern.test(context?.current_book_id || "") ? context.current_book_id.toLowerCase() : null;
    } catch {
      return null;
    }
    if (!contextBookId) return null;

    const routeMatch = window.location.pathname.match(/^\/books\/([^/]+)\//);
    if (routeMatch) {
      try {
        const routeBookId = decodeURIComponent(routeMatch[1]);
        if (!uuidPattern.test(routeBookId)) return null;
        if (routeBookId.toLowerCase() !== contextBookId) return null;
      } catch {
        return null;
      }
    }
    return contextBookId;
  }

  function hydrateBookLinks(root, explicitBookId) {
    const bookId = explicitBookId || currentBookId();
    root.querySelectorAll("[data-book-segment]").forEach((link) => {
      const segment = link.dataset.bookSegment;
      const href = bookId && bookSegments.has(segment)
        ? `/books/${encodeURIComponent(bookId)}/${segment}`
        : null;
      if (href) {
        link.href = href;
        link.removeAttribute("aria-disabled");
        link.removeAttribute("title");
        link.classList.remove("opacity-40", "pointer-events-none");
        return;
      }
      link.removeAttribute("href");
      link.setAttribute("aria-disabled", "true");
      link.setAttribute("title", "请先选择作品");
      link.classList.add("opacity-40", "pointer-events-none");
    });
  }

  function mountSharedSidebar(sidebar) {
    if (!sidebar || sidebar.dataset.sharedSidebarMounted === "true") return sidebar;

    const active = sidebar.dataset.sidebarActive || "workbench";
    const bookId = currentBookId();
    const brandIcon = sidebar.dataset.sidebarBrandIcon || "deployed_code";
    const designHref = sidebar.dataset.sidebarDesignHref || null;
    const menu = items.map((item) => {
      const href = item.id === "design" && designHref
        ? designHref
        : item.id === "workbench" && bookId
          ? `/workbench?book_id=${encodeURIComponent(bookId)}`
          : item.path || (bookId && item.segment ? `/books/${encodeURIComponent(bookId)}/${item.segment}` : null);
      const hrefAttribute = href ? ` href="${href}"` : "";
      const segmentAttribute = item.segment ? ` data-book-segment="${item.entrySegment || item.segment}"` : "";
      const disabledAttributes = href ? "" : ' aria-disabled="true" title="请先选择作品"';
      const classes = [item.id === active ? "active" : "", href ? "" : "opacity-40 pointer-events-none"].filter(Boolean).join(" ");
      const classAttribute = classes ? ` class="${classes}"` : "";
      const currentAttribute = item.id === active ? ` aria-current="page"` : "";
      return `<li><a${hrefAttribute}${segmentAttribute} aria-label="${item.ariaLabel}"${disabledAttributes}${classAttribute}${currentAttribute}><span class="material-symbols-outlined" aria-hidden="true">${item.icon}</span><span class="sidebar-text">${item.label}</span></a></li>`;
    }).join("");

    sidebar.innerHTML = `
      <div class="sidebar-brand">
        <div class="brand-mark"><span class="material-symbols-outlined" aria-hidden="true">${brandIcon}</span></div>
        <div class="sidebar-text">
          <div class="brand-title">纵横</div>
          <div class="brand-subtitle sidebar-subtitle">Narrative-Engine</div>
        </div>
      </div>
      <div class="sidebar-separator" aria-hidden="true"></div>
      <ul class="menu sidebar-menu" id="sidebarMenu">${menu}</ul>
      <footer class="sidebar-footer">
        <div class="sidebar-user">
          <div class="sidebar-user-avatar">U</div>
          <span class="sidebar-text sidebar-user-name">用户</span>
        </div>
      </footer>`;

    const toggle = document.createElement("button");
    toggle.className = "sidebar-toggle";
    toggle.type = "button";
    toggle.setAttribute("aria-label", "折叠侧栏");
    toggle.setAttribute("aria-controls", "sidebarMenu");
    toggle.innerHTML = '<span class="material-symbols-outlined" id="sidebarIcon" aria-hidden="true"></span>';
    toggle.addEventListener("click", () => {
      if (typeof window.toggleSidebar === "function") window.toggleSidebar();
    });
    sidebar.insertAdjacentElement("afterend", toggle);
    sidebar.dataset.sharedSidebarMounted = "true";
    hydrateBookLinks(sidebar, bookId);
    if (typeof window.syncSidebarToggleState === "function") window.syncSidebarToggleState();
    return sidebar;
  }

  window.mountSharedSidebar = mountSharedSidebar;

  function mountSidebars() {
    if (typeof window.syncRouteBookContext === "function") window.syncRouteBookContext();
    document.querySelectorAll("[data-shared-sidebar]").forEach(mountSharedSidebar);
    hydrateBookLinks(document);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mountSidebars, { once: true });
  else mountSidebars();
})();
