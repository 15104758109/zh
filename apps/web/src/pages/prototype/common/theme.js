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
    toggle.setAttribute("aria-label", collapsed ? "展开侧栏" : "折叠侧栏");
    toggle.setAttribute("title", collapsed ? "展开侧栏" : "折叠侧栏");
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
  var btn = document.getElementById("quick-settings-btn");
  if (!popover) return;
  var open = popover.classList.toggle("hidden") === false;
  popover.setAttribute("aria-hidden", String(!open));
  btn?.setAttribute("aria-expanded", String(open));
  if (open) popover.querySelector("button, input, select, textarea, [href]")?.focus();
};

document.addEventListener("click", function(event) {
  var popover = document.getElementById("quick-settings-popover");
  var btn = document.getElementById("quick-settings-btn");
  if (popover && !popover.classList.contains("hidden")) {
    if (!popover.contains(event.target) && event.target !== btn && (!btn || !btn.contains(event.target))) {
      popover.classList.add("hidden");
      popover.setAttribute("aria-hidden", "true");
      btn?.setAttribute("aria-expanded", "false");
    }
  }
});

document.addEventListener("keydown", function(event) {
  if (event.key !== "Escape") return;
  var popover = document.getElementById("quick-settings-popover");
  if (!popover || popover.classList.contains("hidden")) return;
  popover.classList.add("hidden");
  popover.setAttribute("aria-hidden", "true");
  document.getElementById("quick-settings-btn")?.setAttribute("aria-expanded", "false");
  document.getElementById("quick-settings-btn")?.focus();
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

// ---- 原型页面的基础无障碍补全 ----
// 保留既有 DOM 与 inline handler，只为运行时新增的原型卡片补上原生控件等价物。
(function () {
  var iconLabels = {
    add: "新增",
    add_circle: "新增",
    add_link: "添加绑定",
    analytics: "分析",
    arrow_back: "返回",
    chevron_left: "折叠侧栏",
    chevron_right: "展开侧栏",
    close: "关闭",
    delete: "删除",
    edit: "编辑",
    expand_less: "收起",
    expand_more: "展开",
    forum: "打开想法收集",
    menu_book: "作品信息",
    notifications: "通知中心",
    refresh: "刷新",
    send: "发送",
    settings: "设置",
    tune: "调整设置"
  };

  function normalizedText(node) {
    return String(node && node.textContent || "").replace(/\s+/g, " ").trim();
  }

  function labelForControl(control) {
    var text = normalizedText(control);
    if (iconLabels[text]) return iconLabels[text];
    var icon = control.querySelector && control.querySelector(".material-symbols-outlined");
    var iconText = normalizedText(icon);
    if (iconLabels[iconText]) return iconLabels[iconText];
    return control.getAttribute("title") || "";
  }

  function isNativeInteractive(node) {
    return /^(a|button|input|select|textarea|summary)$/i.test(node.tagName);
  }

  function isBackdrop(node) {
    var handler = node.getAttribute("onclick") || "";
    return /event\.target\s*===\s*this/.test(handler)
      || /(modal|backdrop)/i.test(node.id || "")
      || node.classList.contains("modal-backdrop");
  }

  function enhanceClickable(node) {
    if (isBackdrop(node)) {
      // Pure overlays are visual click targets; keep nested dialog content exposed.
      if (!node.querySelector("[role=dialog], [role=alertdialog]")) node.setAttribute("aria-hidden", "true");
      return;
    }
    if (isNativeInteractive(node) || node.closest("a, button, input, select, textarea, summary")) return;
    node.setAttribute("role", "button");
    if (!node.hasAttribute("tabindex")) node.tabIndex = 0;
    if (!node.hasAttribute("aria-label")) {
      var label = node.getAttribute("title") || normalizedText(node).slice(0, 80);
      if (iconLabels[label]) label = iconLabels[label];
      if (label) node.setAttribute("aria-label", label);
    }
    if (node.dataset.prototypeA11yBound === "true") return;
    node.dataset.prototypeA11yBound = "true";
    node.addEventListener("keydown", function(event) {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      node.click();
    });
  }

  function hasAccessibleName(control) {
    return control.hasAttribute("aria-label")
      || control.hasAttribute("aria-labelledby")
      || (control.labels && control.labels.length > 0)
      || Boolean(control.closest("label"));
  }

  function enhanceFormControl(control) {
    if (hasAccessibleName(control)) return;
    var label = control.getAttribute("placeholder") || control.getAttribute("title") || control.name || control.id;
    if (label) control.setAttribute("aria-label", label.replace(/[.…]+$/u, ""));
  }

  function enhance(root) {
    var scope = root && root.querySelectorAll ? root : document;
    if (scope.nodeType === Node.ELEMENT_NODE) {
      if (scope.matches("button")) {
        if (!hasAccessibleName(scope)) {
          var scopeLabel = labelForControl(scope);
          if (scopeLabel) scope.setAttribute("aria-label", scopeLabel);
        }
      }
      if (scope.matches("[onclick]")) enhanceClickable(scope);
      if (scope.matches("input:not([type=hidden]):not([type=checkbox]):not([type=radio]), textarea, select")) enhanceFormControl(scope);
      if (scope.matches(".material-symbols-outlined:not([aria-label])")) scope.setAttribute("aria-hidden", "true");
    }
    scope.querySelectorAll("button").forEach(function(button) {
      if (hasAccessibleName(button)) return;
      var label = labelForControl(button);
      if (label) button.setAttribute("aria-label", label);
    });
    scope.querySelectorAll("[onclick]").forEach(enhanceClickable);
    scope.querySelectorAll("input:not([type=hidden]):not([type=checkbox]):not([type=radio]), textarea, select").forEach(enhanceFormControl);
    scope.querySelectorAll(".material-symbols-outlined:not([aria-label])").forEach(function(icon) {
      icon.setAttribute("aria-hidden", "true");
    });
  }

  function start() {
    enhance(document);
    if (!window.MutationObserver) return;
    new MutationObserver(function(records) {
      records.forEach(function(record) {
        record.addedNodes.forEach(function(node) {
          if (node.nodeType === Node.ELEMENT_NODE) enhance(node);
        });
      });
    }).observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
