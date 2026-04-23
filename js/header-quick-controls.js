(function () {
  function clampSeconds(v) {
    var n = parseInt(v, 10);
    if (!Number.isFinite(n)) return 15;
    return Math.min(600, Math.max(10, n));
  }

  function readTimerConfig() {
    if (typeof window.getHanlawQuizTimerConfig === "function") {
      try {
        var cfg = window.getHanlawQuizTimerConfig();
        if (cfg && typeof cfg === "object") {
          return { enabled: !!cfg.enabled, seconds: clampSeconds(cfg.seconds) };
        }
      } catch (e) {}
    }
    return { enabled: false, seconds: 15 };
  }

  function writeTimerConfig(cfg) {
    if (typeof window.setHanlawQuizTimerConfig === "function") {
      window.setHanlawQuizTimerConfig(cfg);
      return;
    }
    try {
      localStorage.setItem(
        "hanlaw_quiz_timer_v1",
        JSON.stringify({ e: !!cfg.enabled, s: clampSeconds(cfg.seconds) })
      );
    } catch (e2) {}
    try {
      window.dispatchEvent(
        new CustomEvent("hanlaw-quiz-timer-saved", {
          detail: { enabled: !!cfg.enabled, seconds: clampSeconds(cfg.seconds) }
        })
      );
    } catch (e3) {}
  }

  function bindQuickTimer() {
    var en = document.getElementById("header-quick-timer-enabled");
    var secWrap = document.getElementById("header-quick-timer-seconds-wrap");
    var sec = document.getElementById("header-quick-timer-seconds");
    if (!en || !secWrap || !sec) return;

    function render(cfg) {
      en.checked = !!cfg.enabled;
      secWrap.hidden = !cfg.enabled;
      sec.value = String(clampSeconds(cfg.seconds));
    }

    function syncFromStorage() {
      render(readTimerConfig());
    }

    en.addEventListener("change", function () {
      var cfg = { enabled: en.checked, seconds: clampSeconds(sec.value) };
      render(cfg);
      writeTimerConfig(cfg);
    });

    function saveSecondsIfEnabled() {
      var cfg = { enabled: en.checked, seconds: clampSeconds(sec.value) };
      sec.value = String(cfg.seconds);
      if (!cfg.enabled) return;
      writeTimerConfig(cfg);
    }

    sec.addEventListener("change", saveSecondsIfEnabled);
    sec.addEventListener("blur", saveSecondsIfEnabled);
    sec.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        sec.blur();
      }
    });

    window.addEventListener("hanlaw-quiz-timer-saved", syncFromStorage);
    syncFromStorage();
  }

  document.addEventListener("DOMContentLoaded", function () {
    bindQuickTimer();
  });
})();
