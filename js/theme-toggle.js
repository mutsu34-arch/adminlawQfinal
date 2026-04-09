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
    var darkBtn = document.getElementById("theme-btn-dark");
    var lightBtn = document.getElementById("theme-btn-light");
    if (!darkBtn || !lightBtn) return;
    var onLight = isLight();
    darkBtn.setAttribute("aria-pressed", onLight ? "false" : "true");
    lightBtn.setAttribute("aria-pressed", onLight ? "true" : "false");
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

    var darkBtn = document.getElementById("theme-btn-dark");
    var lightBtn = document.getElementById("theme-btn-light");
    if (darkBtn) darkBtn.addEventListener("click", function () { setTheme("dark"); });
    if (lightBtn) lightBtn.addEventListener("click", function () { setTheme("light"); });
    syncButtons();
    updateMeta();
  });
})();
