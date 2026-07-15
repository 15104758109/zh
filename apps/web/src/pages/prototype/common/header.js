// ============ 顶栏公共脚本 ============
// 使用方式：在 <head> 引入 <script src="../common/header.js"></script>
// 依赖：页面必须先引入 ./new_book_wizard_data.js
//       顶栏必须有以下元素：
//         <span id="header-book-name"></span>
//         <div id="sw-auto-production" class="settings-switch" data-key="auto_production"></div>
//         <div id="sw-auto-audit" class="settings-switch" data-key="auto_audit"></div>
//         <div id="sw-auto-iteration" class="settings-switch" data-key="auto_iteration"></div>
//         <button id="quick-settings-btn" onclick="toggleQuickSettings(event)"></button>
//         <div id="quick-settings-popover"></div>

(function () {
  // 快捷设置弹窗 toggle
  window.toggleQuickSettings = function (event) {
    event.stopPropagation();
    const popover = document.getElementById('quick-settings-popover');
    if (popover) popover.classList.toggle('hidden');
  };

  // 点击空白处关闭弹窗
  document.addEventListener('click', function (event) {
    const popover = document.getElementById('quick-settings-popover');
    const btn = document.getElementById('quick-settings-btn');
    if (popover && !popover.classList.contains('hidden')) {
      if (!popover.contains(event.target) && event.target !== btn && (!btn || !btn.contains(event.target))) {
        popover.classList.add('hidden');
      }
    }
  });

  // 自动化开关切换：回写到 NEW_BOOK_WIZARD_DATA.book
  window.toggleAutoSwitch = function (key, el) {
    if (!window.NEW_BOOK_WIZARD_DATA) return;
    const book = window.NEW_BOOK_WIZARD_DATA.book;
    book[key] = !book[key];
    el.classList.toggle('on', book[key]);
  };

  // 从 NEW_BOOK_WIZARD_DATA 初始化顶栏
  function initFromBookData() {
    const data = window.NEW_BOOK_WIZARD_DATA;
    if (!data) return;
    const book = data.book;
    const bookNameEl = document.getElementById('header-book-name');
    if (bookNameEl) bookNameEl.textContent = book.bookName || book.title;
    const switchMap = {
      auto_production: 'sw-auto-production',
      auto_audit: 'sw-auto-audit',
      auto_iteration: 'sw-auto-iteration'
    };
    for (const [key, id] of Object.entries(switchMap)) {
      const el = document.getElementById(id);
      if (!el) continue;
      if (book[key]) el.classList.add('on');
      else el.classList.remove('on');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initFromBookData);
  } else {
    initFromBookData();
  }
})();
