(function () {
  var KEY = "hanlaw_theme";
  var root = document.documentElement;

  function isLight() {
    return root.getAttribute("data-theme") === "light";
  }

  function setTheme(mode) {
    if (mode === "light") {
      root.setAttribute("data-theme", "light");
    } else {
      root.removeAttribute("data-theme");
    }
    try {
      localStorage.setItem(KEY, mode);
    } catch (e) {}
    syncButtons();
    updateMeta();
  }

  function syncButtons() {
    var onLight = isLight();
    document.querySelectorAll('[data-theme-mode="dark"]').forEach(function (btn) {
      btn.setAttribute("aria-pressed", onLight ? "false" : "true");
    });
    document.querySelectorAll('[data-theme-mode="light"]').forEach(function (btn) {
      btn.setAttribute("aria-pressed", onLight ? "true" : "false");
    });
    var toggle = document.getElementById("header-theme-toggle");
    if (toggle) {
      toggle.setAttribute("data-theme", onLight ? "light" : "dark");
      toggle.setAttribute("aria-label", onLight ? "라이트 모드 사용 중, 다크 모드로 전환" : "다크 모드 사용 중, 라이트 모드로 전환");
      toggle.title = onLight ? "라이트 모드 (클릭 시 다크 모드)" : "다크 모드 (클릭 시 라이트 모드)";
    }
  }

  function updateMeta() {
    var meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.setAttribute("name", "theme-color");
      document.head.appendChild(meta);
    }
    meta.setAttribute("content", isLight() ? "#eef2f8" : "#0f1419");
  }

  document.addEventListener("DOMContentLoaded", function () {
    try {
      var saved = localStorage.getItem(KEY);
      if (saved === "light") root.setAttribute("data-theme", "light");
      else if (saved === "dark") root.removeAttribute("data-theme");
    } catch (e) {}

    document.querySelectorAll("[data-theme-mode]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var mode = btn.getAttribute("data-theme-mode");
        setTheme(mode === "light" ? "light" : "dark");
      });
    });
    var toggle = document.getElementById("header-theme-toggle");
    if (toggle) {
      toggle.addEventListener("click", function () {
        setTheme(isLight() ? "dark" : "light");
      });
    }
    syncButtons();
    updateMeta();
  });
})();
