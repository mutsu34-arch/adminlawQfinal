/**
 * 앱 상단 헤더 — 수험·학습용 랜덤 명언 (격려·냉정한 조언 혼합)
 */
(function () {
  window.HANLAW_REMOTE_QUOTES = window.HANLAW_REMOTE_QUOTES || [];
  var MY_QUOTES_KEY = "hanlaw_my_quotes_v2";
  var MY_QUOTE_KEY_LEGACY = "hanlaw_my_quote_v1";
  /** 고정한 명언 본문(plain). 있으면 랜덤 대신 항상 이 문구만 표시 */
  var PINNED_QUOTE_KEY = "hanlaw_header_quote_pinned_v1";
  var timer = null;
  var currentQuoteRaw = "";
  var QUOTES = [
    "오늘의 한 문제가 내일의 합격을 만든다.",
    "반복은 비범을 만든다. 같은 문제를 다시 푸는 용기가 실력이다.",
    "망설이는 시간에 한 문제 더 풀어라.",
    "합격은 재능이 아니라 습관의 합이다.",
    "남과 비교하지 말고 어제의 나와 비교하라.",
    "집중 한 시간이 산만한 세 시간보다 낫다.",
    "법은 읽는 것이 아니라 이해하는 것이다. 천천히, 꾸준히.",
    "완벽을 기다리지 말라. 지금 할 수 있는 최선을 하라.",
    "두려움은 공부할수록 줄어든다.",
    "느려도 괜찮다. 멈추지만 않으면 된다.",
    "합격은 끝이 아니라 새로운 시작의 문이다.",
    "변명은 합격을 늦출 뿐이다. 책상 앞에 앉아라.",
    "감으로 풀면 시험장에서 감으로 떨어진다. 근거를 붙여라.",
    "스마트폰이 합격증을 대신 가져다주지는 않는다.",
    "아는 척하지 말고 모르면 인정하고 채워라.",
    "벼락치기는 운에 맡기는 것이다. 당신은 운이 아니라 실력으로 가야 한다.",
    "오늘 피한 어려운 문제는 시험날 그대로 돌아온다.",
    "불안할 때일수록 기본으로 돌아가라. 개념이 곧 힘이다.",
    "합격생은 특별한 사람이 아니라, 특별히 꾸준한 사람이다.",
    "자기 위로에만 익숙해지면 성장은 멈춘다. 오늘은 냉정하게 채점하라.",
    "시험은 친구가 아니다. 준비 없이 가면 결과도 냉정하다.",
    "읽었다고 아는 것과 풀 수 있다는 것은 다르다. 손으로 증명하라.",
    "‘나중에’는 결국 ‘안 함’과 가깝다. 지금 한 세트가 남들과 갈린다.",
    "자격증·시험은 거짓말을 하지 않는다. 쌓인 만큼만 나온다.",
    "위로만 듣고 싶으면 SNS를 켜라. 합격하려면 책을 펴라."
  ];

  function loadCustomQuotes() {
    try {
      var raw = localStorage.getItem(MY_QUOTES_KEY);
      if (raw) {
        var arr = JSON.parse(raw);
        if (Array.isArray(arr)) {
          return arr
            .map(function (x) {
              return String(x || "").trim();
            })
            .filter(Boolean)
            .slice(0, 3);
        }
      }
      var oldOne = String(localStorage.getItem(MY_QUOTE_KEY_LEGACY) || "").trim();
      return oldOne ? [oldOne] : [];
    } catch (e) {
      return [];
    }
  }

  function baseQuotePool() {
    var remote = window.HANLAW_REMOTE_QUOTES;
    if (remote && remote.length) {
      return remote.concat(QUOTES);
    }
    return QUOTES.slice();
  }

  function getPinnedQuoteRaw() {
    try {
      var s = localStorage.getItem(PINNED_QUOTE_KEY);
      return s ? String(s).trim() : "";
    } catch (e) {
      return "";
    }
  }

  function setPinnedQuoteRaw(text) {
    try {
      localStorage.setItem(PINNED_QUOTE_KEY, String(text || "").trim());
    } catch (e) {}
  }

  function clearPinnedQuote() {
    try {
      localStorage.removeItem(PINNED_QUOTE_KEY);
    } catch (e) {}
  }

  function pickQuote() {
    var pinned = getPinnedQuoteRaw();
    if (pinned) return pinned;

    var customList = loadCustomQuotes();
    var pool = baseQuotePool();
    if (!customList.length) {
      var i = Math.floor(Math.random() * pool.length);
      return pool[i];
    }
    // 나의 명언을 더 자주 노출: 약 65% 확률
    if (Math.random() < 0.65) {
      var ci = Math.floor(Math.random() * customList.length);
      return customList[ci];
    }
    var j = Math.floor(Math.random() * pool.length);
    return pool[j];
  }

  function apply() {
    var el = document.getElementById("header-quote");
    if (!el) return;
    var raw = pickQuote();
    currentQuoteRaw = raw;
    if (typeof window.formatHanlawRichParagraphsHtml === "function") {
      el.innerHTML = window.formatHanlawRichParagraphsHtml(raw);
    } else {
      el.textContent = raw;
    }
    syncPinToggle();
  }

  function syncPinToggle() {
    var btn = document.getElementById("header-quote-pin-toggle");
    if (!btn) return;
    var isPinned = !!getPinnedQuoteRaw();
    var hasText = !!String(currentQuoteRaw || "").trim();
    btn.classList.toggle("header-quote-pin-btn--pinned", isPinned);
    btn.setAttribute("aria-pressed", isPinned ? "true" : "false");
    btn.disabled = !hasText;
    if (isPinned) {
      btn.title = "고정 해제 (다시 랜덤으로 표시)";
      btn.setAttribute("aria-label", "명언 고정 해제");
    } else {
      btn.title = "이 명언만 계속 표시";
      btn.setAttribute("aria-label", "명언 고정하기");
    }
  }

  function startRotationIfNeeded() {
    if (timer) {
      window.clearInterval(timer);
      timer = null;
    }
    if (getPinnedQuoteRaw()) return;
    timer = window.setInterval(apply, 12000);
  }

  function bind() {
    apply();
    startRotationIfNeeded();
    window.addEventListener("hanlaw-custom-quote-updated", apply);
    window.addEventListener("hanlaw-remote-quotes-updated", apply);

    var toggleBtn = document.getElementById("header-quote-pin-toggle");
    if (toggleBtn) {
      toggleBtn.addEventListener("click", function () {
        if (toggleBtn.disabled) return;
        if (getPinnedQuoteRaw()) {
          clearPinnedQuote();
          apply();
          startRotationIfNeeded();
        } else {
          var t = String(currentQuoteRaw || "").trim();
          if (!t) return;
          setPinnedQuoteRaw(t);
          startRotationIfNeeded();
        }
        syncPinToggle();
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }
})();
