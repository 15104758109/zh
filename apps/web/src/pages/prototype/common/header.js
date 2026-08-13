// ============ 顶栏公共脚本 ============
// 使用方式：在 <head> 引入 <script src="../common/header.js"></script>
// 顶栏必须有以下元素：
//         <span id="header-book-name"></span>
//         <div id="sw-auto-production" class="settings-switch" data-key="auto_production"></div>
//         <div id="sw-auto-audit" class="settings-switch" data-key="auto_audit"></div>
//         <div id="sw-auto-iteration" class="settings-switch" data-key="auto_iteration"></div>
//         <button id="quick-settings-btn" onclick="toggleQuickSettings(event)"></button>
//         <div id="quick-settings-popover"></div>

(function () {
  const UUID_PATTERN = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

  // FP016-01 makes Workbench the only configuration surface. Its mounted
  // runtime replaces this handler after loading the effective projection.
  window.toggleAutoSwitch = function () {
    return false;
  };

  function routeBookId() {
    const match = window.location.pathname.match(/^\/books\/([^/]+)\//);
    if (!match) return null;
    try {
      const bookId = decodeURIComponent(match[1]);
      return UUID_PATTERN.test(bookId) ? bookId.toLowerCase() : null;
    } catch {
      return null;
    }
  }

  function syncRouteBookContext() {
    const bookId = routeBookId();
    if (!bookId) return null;
    let operatorId = "";
    try {
      operatorId = localStorage.getItem("zhreplan.local_operator_id.v1") || "";
    } catch {
      return null;
    }
    if (!UUID_PATTERN.test(operatorId)) return null;
    try {
      const current = JSON.parse(localStorage.getItem("current_book_context") || "null");
      if (current?.local_operator_id?.toLowerCase() !== operatorId.toLowerCase()
        || current?.current_book_id?.toLowerCase() !== bookId) return null;
    } catch {
      return null;
    }
    return bookId;
  }

  window.syncRouteBookContext = syncRouteBookContext;

  function initReadOnlyHeader() {
    const routeBook = syncRouteBookContext();
    const bookNameEl = document.getElementById('header-book-name');
    if (bookNameEl && !bookNameEl.textContent.trim()) {
      bookNameEl.textContent = routeBook ? `作品 ${routeBook.slice(0, 8)}` : '未选择作品';
    }

    if (window.location.pathname === '/workbench' || window.location.pathname === '/workbench/') return;
    for (const id of ['sw-auto-production', 'sw-auto-audit', 'sw-auto-iteration']) {
      const el = document.getElementById(id);
      if (!el) continue;
      el.classList.remove('on');
      el.inert = true;
      el.tabIndex = -1;
      el.style.pointerEvents = 'none';
      el.setAttribute('aria-disabled', 'true');
      el.setAttribute('title', '请在工作台统一配置');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initReadOnlyHeader);
  } else {
    initReadOnlyHeader();
  }
  window.addEventListener('load', initReadOnlyHeader, { once: true });
})();
