/* ============================================
   纵横叙事引擎 — 共享 JavaScript
   公共交互逻辑 (DaisyUI 4.12.10 · Garden 亮色模式)
   最后更新: 2026-06-26
   ============================================ */

/* ---- 注意 ----
   DaisyUI 4.12.10 + @tailwindcss/browser@4 不再需要
   JavaScript 里的 tailwind.config。
   主题色值由 CSS @plugin "daisyui/theme" 注入，
   Tailwind 工具类由 @tailwindcss/browser 自动处理。
   如果你需要额外的自定义颜色工具类，
   请在 theme.css 中用 @theme { --color-xxx: ... } 定义。
   ============================================ */

// ---- 侧边栏折叠 ----
function syncSidebarToggleState() {
  var collapsed = document.body.classList.contains("sidebar-collapsed");
  document.querySelectorAll(".sidebar-toggle").forEach(function(toggle) {
    var icon = toggle.querySelector("#sidebarIcon, .sidebar-toggle-icon");
    if (icon) icon.textContent = collapsed ? "chevron_right" : "chevron_left";
    toggle.setAttribute("aria-expanded", String(!collapsed));
  });
}

window.toggleSidebar = function() {
  document.body.classList.toggle("sidebar-collapsed");
  var state = document.body.classList.contains("sidebar-collapsed") ? "collapsed" : "expanded";
  try { localStorage.setItem("sidebar-state", state); } catch(e) {}
  syncSidebarToggleState();
};

// 恢复侧边栏状态
function restoreSidebarState() {
  var state = "expanded";
  try { state = localStorage.getItem("sidebar-state") || state; } catch(e) {}
  document.body.classList.toggle("sidebar-collapsed", state === "collapsed");
  syncSidebarToggleState();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", restoreSidebarState, { once: true });
} else {
  restoreSidebarState();
}

// ---- 快速设置弹窗 ----
window.toggleQuickSettings = function(event) {
  event.stopPropagation();
  var popover = document.getElementById("quick-settings-popover");
  if (popover) popover.classList.toggle("hidden");
};

document.addEventListener("click", function(event) {
  var popover = document.getElementById("quick-settings-popover");
  var btn = document.getElementById("quick-settings-btn");
  if (popover && !popover.classList.contains("hidden")) {
    if (!popover.contains(event.target) && event.target !== btn && (!btn || !btn.contains(event.target))) {
      popover.classList.add("hidden");
    }
  }
});

// ---- Toast 通知 ----
window.showToast = function(message, type) {
  type = type || "info";
  var container = document.getElementById("toast-container");
  if (!container) return;

  var toast = document.createElement("div");
  toast.className = "toast-item toast-" + type;
  toast.textContent = message;
  container.appendChild(toast);

  requestAnimationFrame(function() {
    toast.classList.add("toast-show");
  });

  setTimeout(function() {
    toast.classList.remove("toast-show");
    setTimeout(function() { toast.remove(); }, 300);
  }, 3000);
};

// ---- 章节选择器 ----
window.toggleChapterSelect = function(event) {
  event.stopPropagation();
  var dropdown = document.getElementById("chapter-select-dropdown");
  if (dropdown) dropdown.classList.toggle("hidden");
};

document.addEventListener("click", function(event) {
  var dropdown = document.getElementById("chapter-select-dropdown");
  var btn = document.getElementById("chapter-select-btn");
  if (dropdown && !dropdown.classList.contains("hidden")) {
    if (!dropdown.contains(event.target) && event.target !== btn && (!btn || !btn.contains(event.target))) {
      dropdown.classList.add("hidden");
    }
  }
});
