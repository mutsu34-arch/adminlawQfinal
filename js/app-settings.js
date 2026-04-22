/**
 * 글자 크기 (html data-font-step, localStorage hanlaw_font_step_v2)
 * 구버전 hanlaw_font_step(0~4)은 최초 로드 시 v2로 이전합니다.
 */
(function () {
  // AdSense 심사 기간에는 비회원 콘텐츠 제한을 완화할 수 있도록 전역 플래그를 둔다.
  // 심사 종료 후 기존 제한 정책으로 복귀하려면 false로 변경하면 된다.
  window.HANLAW_ADSENSE_OPEN_MODE = true;

  var KEY = "hanlaw_font_step_v2";
  var KEY_LEGACY = "hanlaw_font_step";
  var STEP_MAX = "5";
  var MY_QUOTE_KEY_LEGACY = "hanlaw_my_quote_v1";
  var MY_QUOTES_KEY = "hanlaw_my_quotes_v2";
  var MY_QUOTES_MAX = 3;
  var DDAY_KEY_LEGACY = "hanlaw_exam_dday_v1";
  var DDAY_KEY = "hanlaw_exam_ddays_v2";
  var DDAY_MAX = 3;
  var ddayTimer = null;

  var QUIZ_TIMER_KEY = "hanlaw_quiz_timer_v1";
  /** localStorage 불가(사설 모드 등)일 때만 app.js와 공유하는 세션 폴백 */
  var QUIZ_TIMER_FALLBACK = "__HANLAW_QUIZ_TIMER_FALLBACK";

  function clampQuizTimerSeconds(n) {
    var x = parseInt(n, 10);
    if (!Number.isFinite(x)) return 15;
    return Math.min(600, Math.max(10, x));
  }

  function defaultQuizTimer() {
    return { enabled: false, seconds: 15 };
  }

  function readQuizTimerFallback() {
    try {
      var w = window[QUIZ_TIMER_FALLBACK];
      if (!w || typeof w !== "object") return null;
      return {
        enabled: !!w.enabled,
        seconds: clampQuizTimerSeconds(w.seconds != null ? w.seconds : w.s)
      };
    } catch (e) {
      return null;
    }
  }

  function writeQuizTimerFallback(cfg) {
    try {
      window[QUIZ_TIMER_FALLBACK] = {
        enabled: !!cfg.enabled,
        seconds: clampQuizTimerSeconds(cfg.seconds)
      };
    } catch (e2) {}
  }

  function loadQuizTimer() {
    try {
      var s = localStorage.getItem(QUIZ_TIMER_KEY);
      if (s) {
        var o = JSON.parse(s);
        if (o && typeof o === "object") {
          var out = {
            enabled: !!o.e,
            seconds: clampQuizTimerSeconds(o.s)
          };
          writeQuizTimerFallback(out);
          return out;
        }
      }
    } catch (e) {}
    var fb = readQuizTimerFallback();
    if (fb) return fb;
    return defaultQuizTimer();
  }

  function saveQuizTimer(cfg) {
    var out = {
      enabled: !!cfg.enabled,
      seconds: clampQuizTimerSeconds(cfg.seconds)
    };
    writeQuizTimerFallback(out);
    try {
      localStorage.setItem(
        QUIZ_TIMER_KEY,
        JSON.stringify({
          e: out.enabled,
          s: out.seconds
        })
      );
    } catch (e) {}
    try {
      window.dispatchEvent(
        new CustomEvent("hanlaw-quiz-timer-saved", {
          detail: out
        })
      );
    } catch (e3) {}
  }

  function syncQuizTimerControls() {
    var c = loadQuizTimer();
    var en = document.getElementById("settings-quiz-timer-enabled");
    var sec = document.getElementById("settings-quiz-timer-seconds");
    if (en) en.checked = !!c.enabled;
    if (sec) sec.value = String(c.seconds);
  }

  function setQuizTimerMsg(text) {
    var el = document.getElementById("settings-quiz-timer-msg");
    if (!el) return;
    el.textContent = text || "";
    el.hidden = !text;
  }

  function bindQuizTimerSettings() {
    var en = document.getElementById("settings-quiz-timer-enabled");
    var sec = document.getElementById("settings-quiz-timer-seconds");
    var btn = document.getElementById("btn-settings-quiz-timer-save");
    if (!en || !sec) return;

    function readFromForm() {
      var seconds = clampQuizTimerSeconds(sec.value);
      sec.value = String(seconds);
      return { enabled: en.checked, seconds: seconds };
    }

    function applySave() {
      var cfg = readFromForm();
      saveQuizTimer(cfg);
      setQuizTimerMsg(
        cfg.enabled
          ? "저장했습니다. 이후 퀴즈 문항마다 상단에 " +
              cfg.seconds +
              "초 타이머가 표시됩니다."
          : "저장했습니다. 퀴즈 제한 시간을 사용하지 않습니다."
      );
    }

    if (btn) {
      btn.addEventListener("click", applySave);
    }
    syncQuizTimerControls();
  }

  window.getHanlawQuizTimerConfig = loadQuizTimer;

  function migrateLegacyIfNeeded() {
    try {
      var v2 = localStorage.getItem(KEY);
      if (v2 !== null && v2 !== "") return v2;
      var leg = localStorage.getItem(KEY_LEGACY);
      if (leg === null || leg === "") return null;
      if (!/^[0-4]$/.test(leg)) return null;
      var map = { "0": "0", "1": "1", "2": "2", "3": "3", "4": "1" };
      var out = map[leg] != null ? map[leg] : "1";
      localStorage.setItem(KEY, out);
      localStorage.removeItem(KEY_LEGACY);
      return out;
    } catch (e) {
      return null;
    }
  }

  function currentStep() {
    var a = document.documentElement.getAttribute("data-font-step");
    if (a === null || a === "") return "1";
    return a;
  }

  function syncFontButtons() {
    var cur = currentStep();
    document.querySelectorAll(".font-step-switch__btn[data-font-step]").forEach(function (btn) {
      var v = btn.getAttribute("data-font-step");
      btn.setAttribute("aria-pressed", v === cur ? "true" : "false");
    });
  }

  function applyFontStep(step) {
    var s = String(step);
    if (s < "0" || s > STEP_MAX) s = "1";
    document.documentElement.setAttribute("data-font-step", s);
    try {
      localStorage.setItem(KEY, s);
    } catch (e) {}
    syncFontButtons();
  }

  function parseYmd(ymd) {
    var s = String(ymd || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    var p = s.split("-");
    var y = parseInt(p[0], 10);
    var m = parseInt(p[1], 10) - 1;
    var d = parseInt(p[2], 10);
    var dt = new Date(y, m, d);
    if (
      dt.getFullYear() !== y ||
      dt.getMonth() !== m ||
      dt.getDate() !== d
    ) {
      return null;
    }
    dt.setHours(0, 0, 0, 0);
    return dt;
  }

  function fmtKorDate(dt) {
    if (!dt || isNaN(dt.getTime())) return "";
    var y = dt.getFullYear();
    var m = dt.getMonth() + 1;
    var d = dt.getDate();
    return y + "." + m + "." + d + ".";
  }

  function daysDiffFromToday(targetDate) {
    var t = new Date(targetDate.getTime());
    t.setHours(0, 0, 0, 0);
    var n = new Date();
    n.setHours(0, 0, 0, 0);
    var dayMs = 24 * 60 * 60 * 1000;
    return Math.round((t.getTime() - n.getTime()) / dayMs);
  }

  function migrateLegacyDdayIfNeeded() {
    try {
      var v2 = localStorage.getItem(DDAY_KEY);
      if (v2) return;
      var oldYmd = String(localStorage.getItem(DDAY_KEY_LEGACY) || "").trim();
      var dt = parseYmd(oldYmd);
      if (!dt) return;
      var list = [{ id: "legacy_" + String(Date.now()), name: "시험", ymd: oldYmd }];
      localStorage.setItem(DDAY_KEY, JSON.stringify(list));
      localStorage.removeItem(DDAY_KEY_LEGACY);
    } catch (e) {}
  }

  function loadDdayList() {
    try {
      var raw = localStorage.getItem(DDAY_KEY);
      if (!raw) return [];
      var arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return [];
      var out = [];
      for (var i = 0; i < arr.length; i++) {
        var it = arr[i] || {};
        var name = String(it.name || "").trim();
        var ymd = String(it.ymd || "").trim();
        if (!name || !parseYmd(ymd)) continue;
        out.push({
          id: String(it.id || "id_" + i + "_" + Date.now()),
          name: name,
          ymd: ymd
        });
      }
      return out.slice(0, DDAY_MAX);
    } catch (e) {
      return [];
    }
  }

  function saveDdayList(list) {
    try {
      localStorage.setItem(DDAY_KEY, JSON.stringify((list || []).slice(0, DDAY_MAX)));
    } catch (e) {}
  }

  function setDdayMsg(text) {
    var msg = document.getElementById("settings-dday-msg");
    if (!msg) return;
    var t = String(text || "").trim();
    msg.textContent = t;
    msg.hidden = !t;
  }

  function ddayLabelByDiff(diff) {
    return diff === 0 ? "D-DAY" : diff > 0 ? "D-" + diff : "D+" + Math.abs(diff);
  }

  function sortDdayList(list) {
    return list.slice().sort(function (a, b) {
      var da = parseYmd(a.ymd);
      var db = parseYmd(b.ymd);
      var xa = da ? da.getTime() : 0;
      var xb = db ? db.getTime() : 0;
      return xa - xb;
    });
  }

  function renderHeaderDday() {
    var wrap = document.getElementById("header-dday-list");
    if (!wrap) return;
    var list = sortDdayList(loadDdayList());
    wrap.innerHTML = "";
    if (!list.length) {
      wrap.hidden = true;
      return;
    }
    var show = list.slice(0, 4);
    for (var i = 0; i < show.length; i++) {
      var it = show[i];
      var dt = parseYmd(it.ymd);
      if (!dt) continue;
      var diff = daysDiffFromToday(dt);
      var pill = document.createElement("span");
      pill.className = "header-dday-item";
      pill.textContent = it.name + " · " + ddayLabelByDiff(diff);
      wrap.appendChild(pill);
    }
    wrap.hidden = !wrap.children.length;
  }

  function renderSettingsDdayList() {
    var wrap = document.getElementById("settings-dday-list");
    if (!wrap) return;
    var list = sortDdayList(loadDdayList());
    wrap.innerHTML = "";
    if (!list.length) return;
    for (var i = 0; i < list.length; i++) {
      var it = list[i];
      var dt = parseYmd(it.ymd);
      if (!dt) continue;
      var diff = daysDiffFromToday(dt);
      var row = document.createElement("div");
      row.className = "settings-dday-item";
      var text = document.createElement("div");
      text.className = "settings-dday-item__text";
      var nameEl = document.createElement("span");
      nameEl.className = "settings-dday-item__name";
      nameEl.textContent = it.name;
      var metaEl = document.createElement("span");
      metaEl.className = "settings-dday-item__meta";
      metaEl.textContent = fmtKorDate(dt) + " · " + ddayLabelByDiff(diff);
      text.appendChild(nameEl);
      text.appendChild(metaEl);
      var del = document.createElement("button");
      del.type = "button";
      del.className = "settings-dday-item__delete";
      del.setAttribute("aria-label", "D-DAY 삭제");
      del.innerHTML =
        '<svg class="settings-trash-icon" xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>';
      del.setAttribute("data-dday-id", it.id);
      row.appendChild(text);
      row.appendChild(del);
      wrap.appendChild(row);
    }
  }

  function bindDdayControls() {
    var inputName = document.getElementById("settings-dday-name");
    var input = document.getElementById("settings-dday-date");
    var btnSave = document.getElementById("btn-settings-dday-save");
    var listEl = document.getElementById("settings-dday-list");
    if (!input || !inputName || !btnSave || !listEl) return;

    btnSave.addEventListener("click", function () {
      var name = String(inputName.value || "").trim();
      var raw = String(input.value || "").trim();
      var dt = parseYmd(raw);
      var list = loadDdayList();
      if (list.length >= DDAY_MAX) {
        setDdayMsg("D-DAY는 최대 " + DDAY_MAX + "개까지 저장할 수 있어요.");
        return;
      }
      if (!name) {
        setDdayMsg("시험명을 입력해 주세요.");
        return;
      }
      if (!dt) {
        setDdayMsg("시험 날짜를 선택해 주세요.");
        return;
      }
      list.unshift({
        id: "dday_" + String(Date.now()),
        name: name,
        ymd: raw
      });
      saveDdayList(list);
      inputName.value = "";
      input.value = "";
      renderSettingsDdayList();
      renderHeaderDday();
      setDdayMsg("D-DAY를 추가했어요.");
    });

    listEl.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-dday-id]");
      if (!btn) return;
      var id = String(btn.getAttribute("data-dday-id") || "").trim();
      if (!id) return;
      var list = loadDdayList().filter(function (it) {
        return String(it.id) !== id;
      });
      saveDdayList(list);
      renderSettingsDdayList();
      renderHeaderDday();
      setDdayMsg("D-DAY를 삭제했어요.");
    });
  }

  function migrateLegacyMyQuoteIfNeeded() {
    try {
      var v2 = localStorage.getItem(MY_QUOTES_KEY);
      if (v2) return;
      var old = String(localStorage.getItem(MY_QUOTE_KEY_LEGACY) || "").trim();
      if (!old) return;
      localStorage.setItem(MY_QUOTES_KEY, JSON.stringify([old]));
      localStorage.removeItem(MY_QUOTE_KEY_LEGACY);
    } catch (e) {}
  }

  function loadMyQuotes() {
    try {
      var raw = localStorage.getItem(MY_QUOTES_KEY);
      if (!raw) return [];
      var arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return [];
      return arr
        .map(function (x) {
          return String(x || "").trim();
        })
        .filter(Boolean)
        .slice(0, MY_QUOTES_MAX);
    } catch (e) {
      return [];
    }
  }

  function saveMyQuotes(list) {
    try {
      var out = (list || [])
        .map(function (x) {
          return String(x || "").trim();
        })
        .filter(Boolean)
        .slice(0, MY_QUOTES_MAX);
      if (out.length) localStorage.setItem(MY_QUOTES_KEY, JSON.stringify(out));
      else localStorage.removeItem(MY_QUOTES_KEY);
      window.dispatchEvent(
        new CustomEvent("hanlaw-custom-quote-updated", {
          detail: { quotes: out }
        })
      );
    } catch (e) {}
  }

  function setMyQuoteMsg(text) {
    var el = document.getElementById("settings-my-quote-msg");
    if (!el) return;
    var t = String(text || "").trim();
    el.textContent = t;
    el.hidden = !t;
  }

  function renderMyQuoteList() {
    var wrap = document.getElementById("settings-my-quote-list");
    if (!wrap) return;
    var list = loadMyQuotes();
    wrap.innerHTML = "";
    if (!list.length) return;
    list.forEach(function (q, idx) {
      var row = document.createElement("div");
      row.className = "settings-dday-item";
      var p = document.createElement("p");
      p.className = "settings-dday-item__text";
      p.textContent = q;
      var del = document.createElement("button");
      del.type = "button";
      del.className = "settings-dday-item__delete";
      del.setAttribute("aria-label", "명언 삭제");
      del.setAttribute("data-my-quote-idx", String(idx));
      del.innerHTML =
        '<svg class="settings-trash-icon" xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>';
      row.appendChild(p);
      row.appendChild(del);
      wrap.appendChild(row);
    });
  }

  function bindMyQuoteControls() {
    var input = document.getElementById("settings-my-quote");
    var btnSave = document.getElementById("btn-settings-my-quote-save");
    var btnClear = document.getElementById("btn-settings-my-quote-clear");
    var listEl = document.getElementById("settings-my-quote-list");
    if (!input || !btnSave || !btnClear || !listEl) return;
    input.value = "";
    renderMyQuoteList();
    btnSave.addEventListener("click", function () {
      var q = String(input.value || "").trim();
      if (!q) {
        setMyQuoteMsg("명언 문구를 입력해 주세요.");
        return;
      }
      var list = loadMyQuotes();
      list = list.filter(function (x) {
        return x !== q;
      });
      list.unshift(q);
      if (list.length > MY_QUOTES_MAX) list = list.slice(0, MY_QUOTES_MAX);
      saveMyQuotes(list);
      input.value = "";
      renderMyQuoteList();
      setMyQuoteMsg("나의 명언을 저장했어요. (" + list.length + "/" + MY_QUOTES_MAX + ")");
    });
    btnClear.addEventListener("click", function () {
      input.value = "";
      saveMyQuotes([]);
      renderMyQuoteList();
      setMyQuoteMsg("나의 명언을 모두 삭제했어요.");
    });
    listEl.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-my-quote-idx]");
      if (!btn) return;
      var idx = parseInt(btn.getAttribute("data-my-quote-idx"), 10);
      if (!Number.isFinite(idx)) return;
      var list = loadMyQuotes();
      if (idx < 0 || idx >= list.length) return;
      list.splice(idx, 1);
      saveMyQuotes(list);
      renderMyQuoteList();
      setMyQuoteMsg("명언을 삭제했어요.");
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    try {
      var saved = migrateLegacyIfNeeded();
      if (saved === null || saved === "") {
        saved = localStorage.getItem(KEY);
      }
      if (saved !== null && saved !== "") {
        applyFontStep(saved);
      } else {
        syncFontButtons();
      }
    } catch (e) {
      syncFontButtons();
    }

    document.querySelectorAll(".font-step-switch__btn[data-font-step]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        applyFontStep(btn.getAttribute("data-font-step"));
      });
    });

    migrateLegacyMyQuoteIfNeeded();
    migrateLegacyDdayIfNeeded();
    renderSettingsDdayList();
    bindDdayControls();
    bindMyQuoteControls();
    bindQuizTimerSettings();
    renderHeaderDday();
    if (ddayTimer) window.clearInterval(ddayTimer);
    ddayTimer = window.setInterval(renderHeaderDday, 60 * 1000);
  });
})();
