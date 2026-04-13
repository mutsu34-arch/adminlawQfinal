(function () {
  var usageUnsub = null;
  var lastRemain = 4;

  /** 퀴즈 AI 답변 상단 고정 안내(HTML 조각, format 결과 앞에 붙임) */
  var QUIZ_AI_ANSWER_DISCLAIMER =
    '<p class="quiz-ai-answer__disclaimer" role="note">' +
    "이 답변은 AI가 생성한 것입니다. 내용에 오류나 부정확한 정보가 포함될 수 있으니 참고용으로만 활용해 주세요." +
    "</p>";

  function formatAnswerHtml(raw) {
    if (typeof window.formatHanlawAiAnswerHtml === "function") {
      return window.formatHanlawAiAnswerHtml(raw);
    }
    return String(raw || "").replace(/</g, "&lt;");
  }

  function kstTodayYmd() {
    return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
  }

  function computeLeftFromSnap(snap) {
    var today = kstTodayYmd();
    if (!snap || !snap.exists) return 4;
    var d = snap.data();
    if (d.ymd !== today) return 4;
    return Math.max(0, 4 - (parseInt(d.count, 10) || 0));
  }

  function isRealFirebaseUser() {
    try {
      return !!(typeof firebase !== "undefined" && firebase.auth && firebase.auth().currentUser);
    } catch (e) {
      return false;
    }
  }

  var IDS = {
    panel: "quiz-ai-panel",
    question: "quiz-ai-question",
    answer: "quiz-ai-answer",
    loading: "quiz-ai-loading",
    loadingQuote: "quiz-ai-loading-quote",
    error: "quiz-ai-error",
    toggle: "btn-quiz-ai-toggle",
    send: "btn-quiz-ai-send",
    remain: "quiz-ai-remain"
  };

  function showAiLoading() {
    var load = document.getElementById(IDS.loading);
    var qEl = document.getElementById(IDS.loadingQuote);
    var ans = document.getElementById(IDS.answer);
    if (qEl) {
      qEl.textContent =
        typeof window.pickHanlawAiLoadingQuote === "function"
          ? window.pickHanlawAiLoadingQuote()
          : "";
    }
    if (load) {
      load.hidden = false;
      load.setAttribute("aria-busy", "true");
    }
    if (ans) {
      ans.hidden = true;
    }
  }

  function hideAiLoading() {
    var load = document.getElementById(IDS.loading);
    if (load) {
      load.hidden = true;
      load.setAttribute("aria-busy", "false");
    }
  }

  function updateRemainTexts() {
    var el = document.getElementById(IDS.remain);
    var msg;
    if (!isRealFirebaseUser()) {
      msg = "로그인 후 이용 · 유료 회원 한정 · 엘리에게 물어보기(AI) 한도 하루 4회(한국시간)";
    } else if (typeof window.isPaidMember === "function" && !window.isPaidMember()) {
      msg = "엘리에게 물어보기(AI)는 유료 회원에 한해 이용할 수 있습니다.";
    } else {
      msg =
        "오늘 엘리에게 물어보기(AI) 남은 횟수: " + lastRemain + " / 4 (한국시간 기준, Google Gemini)";
    }
    if (el) el.textContent = msg;
    document.querySelectorAll(".dict-panel-ai-remain").forEach(function (sub) {
      sub.textContent = msg;
    });
    var paidOk = typeof window.isPaidMember === "function" && window.isPaidMember();
    var disSend = !paidOk || !isRealFirebaseUser() || lastRemain <= 0;
    var s1 = document.getElementById(IDS.send);
    if (s1 && !s1.dataset.aiSending) s1.disabled = disSend;
    document.querySelectorAll(".note-quiz-chrome__ai-send").forEach(function (bs) {
      if (!bs.dataset.aiSending) bs.disabled = disSend;
    });
    document
      .querySelectorAll("#dict-term-eli-send, #dict-statute-eli-send, #dict-case-eli-send")
      .forEach(function (bs) {
        if (!bs.dataset.aiSending) bs.disabled = disSend;
      });
    if (typeof window.HanlawNoteQuizChromeSyncAiRemain === "function") {
      window.HanlawNoteQuizChromeSyncAiRemain();
    }
  }

  function subscribeUsage(uid) {
    if (usageUnsub) {
      usageUnsub();
      usageUnsub = null;
    }
    if (!uid || typeof firebase === "undefined" || !firebase.firestore) {
      lastRemain = 4;
      updateRemainTexts();
      return;
    }
    var ref = firebase.firestore().collection("hanlaw_quiz_ai_usage").doc(uid);
    usageUnsub = ref.onSnapshot(
      function (snap) {
        lastRemain = computeLeftFromSnap(snap);
        updateRemainTexts();
      },
      function () {
        lastRemain = 4;
        updateRemainTexts();
      }
    );
  }

  function resetPanel() {
    var p = document.getElementById(IDS.panel);
    var ta = document.getElementById(IDS.question);
    var ans = document.getElementById(IDS.answer);
    var err = document.getElementById(IDS.error);
    var btn = document.getElementById(IDS.toggle);
    var qL = document.getElementById(IDS.loadingQuote);
    if (p) p.hidden = true;
    if (ta) ta.value = "";
    hideAiLoading();
    if (qL) qL.textContent = "";
    if (ans) {
      ans.textContent = "";
      ans.innerHTML = "";
      ans.hidden = true;
    }
    if (err) {
      err.textContent = "";
      err.hidden = true;
    }
    if (btn) btn.setAttribute("aria-expanded", "false");
  }

  function togglePanel() {
    if (typeof window.isPaidMember !== "function" || !window.isPaidMember()) {
      window.alert("엘리에게 물어보기(AI)는 유료 회원에 한해 이용할 수 있습니다.");
      return;
    }
    var p = document.getElementById(IDS.panel);
    var btn = document.getElementById(IDS.toggle);
    if (!p) return;
    var open = p.hidden;
    p.hidden = !open;
    if (btn) btn.setAttribute("aria-expanded", open ? "true" : "false");
  }

  function sendAsk() {
    if (typeof window.isPaidMember !== "function" || !window.isPaidMember()) {
      window.alert("엘리에게 물어보기(AI)는 유료 회원에 한해 이용할 수 있습니다.");
      return;
    }
    if (!isRealFirebaseUser()) {
      window.alert("실제 계정으로 로그인한 뒤 이용해 주세요.");
      return;
    }
    if (lastRemain <= 0) {
      window.alert("오늘 엘리에게 물어보기(AI) 한도(4회)를 모두 사용했습니다.");
      return;
    }
    var ctx = window.__HANLAW_QUIZ_AI_CONTEXT;
    if (!ctx || !ctx.statement) {
      window.alert("문항 정보가 없습니다. 문제를 다시 불러온 뒤 시도해 주세요.");
      return;
    }
    var ta = document.getElementById(IDS.question);
    var sendBtn = document.getElementById(IDS.send);
    var errEl = document.getElementById(IDS.error);
    var ansEl = document.getElementById(IDS.answer);
    var uq = ta ? String(ta.value || "").trim() : "";
    if (errEl) {
      errEl.hidden = true;
      errEl.textContent = "";
    }
    if (sendBtn) {
      sendBtn.disabled = true;
      sendBtn.dataset.aiSending = "1";
    }

    function doneEnable() {
      if (sendBtn) delete sendBtn.dataset.aiSending;
      updateRemainTexts();
    }

    if (typeof window.quizAskGeminiCallable !== "function") {
      if (errEl) {
        errEl.textContent = "AI 호출 모듈을 불러오지 못했습니다.";
        errEl.hidden = false;
      }
      doneEnable();
      return;
    }

    showAiLoading();

    window
      .quizAskGeminiCallable({
        userQuestion: uq,
        quiz: ctx
      })
      .then(function (res) {
        hideAiLoading();
        if (ansEl) {
          var rawAns = res && res.answer ? res.answer : "";
          var bodyHtml = formatAnswerHtml(rawAns);
          if (!String(bodyHtml || "").trim() && rawAns) {
            bodyHtml = "<p>" + String(rawAns).replace(/</g, "&lt;").replace(/>/g, "&gt;") + "</p>";
          }
          ansEl.innerHTML = QUIZ_AI_ANSWER_DISCLAIMER + bodyHtml;
          ansEl.hidden = false;
        }
        if (res && typeof res.remainingToday === "number") {
          lastRemain = Math.max(0, res.remainingToday);
          updateRemainTexts();
        }
      })
      .catch(function (e) {
        hideAiLoading();
        var code = e && e.code;
        var msg = e && e.message ? String(e.message) : String(e);
        if (code === "functions/resource-exhausted") {
          msg = "오늘 엘리에게 물어보기(AI) 한도(4회)를 모두 사용했습니다. 내일 다시 이용해 주세요.";
        }
        if (code === "functions/failed-precondition" && /GEMINI_API_KEY/.test(msg)) {
          msg = "서버에 Gemini API 키가 설정되어 있지 않습니다. 관리자에게 문의하세요.";
        }
        if (errEl) {
          errEl.textContent = msg;
          errEl.hidden = false;
        }
      })
      .then(doneEnable, doneEnable);
  }

  function sendFromNoteArticle(article) {
    if (typeof window.isPaidMember !== "function" || !window.isPaidMember()) {
      window.alert("엘리에게 물어보기(AI)는 유료 회원에 한해 이용할 수 있습니다.");
      return;
    }
    if (!isRealFirebaseUser()) {
      window.alert("실제 계정으로 로그인한 뒤 이용해 주세요.");
      return;
    }
    if (lastRemain <= 0) {
      window.alert("오늘 엘리에게 물어보기(AI) 한도(4회)를 모두 사용했습니다.");
      return;
    }
    var ctx = window.__HANLAW_QUIZ_AI_CONTEXT;
    if (!ctx || !ctx.statement) {
      window.alert("문항 정보가 없습니다. 문제를 다시 불러온 뒤 시도해 주세요.");
      return;
    }
    var root = article && article.querySelector ? article.querySelector(".note-quiz-chrome") : null;
    if (!root) return;
    var ta = root.querySelector(".note-quiz-chrome__ai-question");
    var sendBtn = root.querySelector(".note-quiz-chrome__ai-send");
    var errEl = root.querySelector(".note-quiz-chrome__ai-error");
    var ansEl = root.querySelector(".note-quiz-chrome__ai-answer");
    var loadEl = root.querySelector(".note-quiz-chrome__ai-loading");
    var loadQuote = root.querySelector(".note-quiz-chrome__ai-loading-quote");
    var uq = ta ? String(ta.value || "").trim() : "";
    if (errEl) {
      errEl.hidden = true;
      errEl.textContent = "";
    }
    if (sendBtn) {
      sendBtn.disabled = true;
      sendBtn.dataset.aiSending = "1";
    }

    function doneEnable() {
      if (sendBtn) delete sendBtn.dataset.aiSending;
      updateRemainTexts();
    }

    if (typeof window.quizAskGeminiCallable !== "function") {
      if (errEl) {
        errEl.textContent = "AI 호출 모듈을 불러오지 못했습니다.";
        errEl.hidden = false;
      }
      doneEnable();
      return;
    }

    if (loadQuote) {
      loadQuote.textContent =
        typeof window.pickHanlawAiLoadingQuote === "function"
          ? window.pickHanlawAiLoadingQuote()
          : "";
    }
    if (loadEl) {
      loadEl.hidden = false;
      loadEl.setAttribute("aria-busy", "true");
    }
    if (ansEl) {
      ansEl.hidden = true;
    }

    window
      .quizAskGeminiCallable({
        userQuestion: uq,
        quiz: ctx
      })
      .then(function (res) {
        if (loadEl) {
          loadEl.hidden = true;
          loadEl.setAttribute("aria-busy", "false");
        }
        if (ansEl) {
          var rawAns = res && res.answer ? res.answer : "";
          var bodyHtml = formatAnswerHtml(rawAns);
          if (!String(bodyHtml || "").trim() && rawAns) {
            bodyHtml = "<p>" + String(rawAns).replace(/</g, "&lt;").replace(/>/g, "&gt;") + "</p>";
          }
          ansEl.innerHTML = QUIZ_AI_ANSWER_DISCLAIMER + bodyHtml;
          ansEl.hidden = false;
        }
        if (res && typeof res.remainingToday === "number") {
          lastRemain = Math.max(0, res.remainingToday);
          updateRemainTexts();
        }
      })
      .catch(function (e) {
        if (loadEl) {
          loadEl.hidden = true;
          loadEl.setAttribute("aria-busy", "false");
        }
        var code = e && e.code;
        var msg = e && e.message ? String(e.message) : String(e);
        if (code === "functions/resource-exhausted") {
          msg = "오늘 엘리에게 물어보기(AI) 한도(4회)를 모두 사용했습니다. 내일 다시 이용해 주세요.";
        }
        if (code === "functions/failed-precondition" && /GEMINI_API_KEY/.test(msg)) {
          msg = "서버에 Gemini API 키가 설정되어 있지 않습니다. 관리자에게 문의하세요.";
        }
        if (errEl) {
          errEl.textContent = msg;
          errEl.hidden = false;
        }
      })
      .then(doneEnable, doneEnable);
  }

  function dictionaryEliPrefix(kind) {
    if (kind === "term") return "dict-term-eli";
    if (kind === "statute") return "dict-statute-eli";
    if (kind === "case") return "dict-case-eli";
    return "";
  }

  function showDictAiLoading(prefix) {
    var load = document.getElementById(prefix + "-loading");
    var qEl = document.getElementById(prefix + "-loading-quote");
    var ans = document.getElementById(prefix + "-answer");
    if (qEl) {
      qEl.textContent =
        typeof window.pickHanlawAiLoadingQuote === "function"
          ? window.pickHanlawAiLoadingQuote()
          : "";
    }
    if (load) {
      load.hidden = false;
      load.setAttribute("aria-busy", "true");
    }
    if (ans) ans.hidden = true;
  }

  function hideDictAiLoading(prefix) {
    var load = document.getElementById(prefix + "-loading");
    if (load) {
      load.hidden = true;
      load.setAttribute("aria-busy", "false");
    }
  }

  function sendDictionaryPanelAsk(kind) {
    if (typeof window.isPaidMember !== "function" || !window.isPaidMember()) {
      window.alert("엘리에게 물어보기(AI)는 유료 회원에 한해 이용할 수 있습니다.");
      return;
    }
    if (!isRealFirebaseUser()) {
      window.alert("실제 계정으로 로그인한 뒤 이용해 주세요.");
      return;
    }
    if (lastRemain <= 0) {
      window.alert("오늘 엘리에게 물어보기(AI) 한도(4회)를 모두 사용했습니다.");
      return;
    }
    var ctx = window.__HANLAW_QUIZ_AI_CONTEXT;
    if (!ctx || ctx.mode !== "dictionary" || !ctx.statement) {
      window.alert(
        "표시된 사전 항목이 있을 때 이용할 수 있습니다. 검색하거나 목록에서 항목을 고른 뒤 다시 시도해 주세요."
      );
      return;
    }
    var pre = dictionaryEliPrefix(kind);
    if (!pre) return;
    var ta = document.getElementById(pre + "-question");
    var sendBtn = document.getElementById(pre + "-send");
    var errEl = document.getElementById(pre + "-error");
    var ansEl = document.getElementById(pre + "-answer");
    var uq = ta ? String(ta.value || "").trim() : "";
    if (errEl) {
      errEl.hidden = true;
      errEl.textContent = "";
    }
    if (sendBtn) {
      sendBtn.disabled = true;
      sendBtn.dataset.aiSending = "1";
    }

    function doneEnable() {
      if (sendBtn) delete sendBtn.dataset.aiSending;
      updateRemainTexts();
    }

    if (typeof window.quizAskGeminiCallable !== "function") {
      if (errEl) {
        errEl.textContent = "AI 호출 모듈을 불러오지 못했습니다.";
        errEl.hidden = false;
      }
      doneEnable();
      return;
    }

    showDictAiLoading(pre);

    window
      .quizAskGeminiCallable({
        userQuestion: uq,
        quiz: ctx
      })
      .then(function (res) {
        hideDictAiLoading(pre);
        if (ansEl) {
          var rawAns = res && res.answer ? res.answer : "";
          var bodyHtml = formatAnswerHtml(rawAns);
          if (!String(bodyHtml || "").trim() && rawAns) {
            bodyHtml = "<p>" + String(rawAns).replace(/</g, "&lt;").replace(/>/g, "&gt;") + "</p>";
          }
          ansEl.innerHTML = QUIZ_AI_ANSWER_DISCLAIMER + bodyHtml;
          ansEl.hidden = false;
        }
        if (res && typeof res.remainingToday === "number") {
          lastRemain = Math.max(0, res.remainingToday);
          updateRemainTexts();
        }
      })
      .catch(function (e) {
        hideDictAiLoading(pre);
        var code = e && e.code;
        var msg = e && e.message ? String(e.message) : String(e);
        if (code === "functions/resource-exhausted") {
          msg = "오늘 엘리에게 물어보기(AI) 한도(4회)를 모두 사용했습니다. 내일 다시 이용해 주세요.";
        }
        if (code === "functions/failed-precondition" && /GEMINI_API_KEY/.test(msg)) {
          msg = "서버에 Gemini API 키가 설정되어 있지 않습니다. 관리자에게 문의하세요.";
        }
        if (errEl) {
          errEl.textContent = msg;
          errEl.hidden = false;
        }
      })
      .then(doneEnable, doneEnable);
  }

  function toggleDictionaryAiPanel(kind) {
    if (typeof window.isPaidMember !== "function" || !window.isPaidMember()) {
      window.alert("엘리에게 물어보기(AI)는 유료 회원에 한해 이용할 수 있습니다.");
      return;
    }
    var pre = dictionaryEliPrefix(kind);
    if (!pre) return;
    var p = document.getElementById(pre + "-panel");
    var btn = document.getElementById(pre + "-toggle");
    if (!p) return;
    var open = p.hidden;
    p.hidden = !open;
    if (btn) btn.setAttribute("aria-expanded", open ? "true" : "false");
  }

  function bindEnterToSend() {
    var ta = document.getElementById(IDS.question);
    if (!ta) return;
    ta.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" || e.shiftKey) return;
      e.preventDefault();
      sendAsk();
    });
  }

  function bind() {
    var b1 = document.getElementById(IDS.toggle);
    if (b1) b1.addEventListener("click", togglePanel);
    var s1 = document.getElementById(IDS.send);
    if (s1) s1.addEventListener("click", sendAsk);
    bindEnterToSend();
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" || e.shiftKey) return;
      var ta = e.target;
      if (!ta || !ta.matches || !ta.matches(".note-quiz-chrome__ai-question")) return;
      e.preventDefault();
      var article = ta.closest("[data-note-quiz]");
      if (article && window.QuizAiAsk && typeof window.QuizAiAsk.sendFromNoteArticle === "function") {
        window.QuizAiAsk.sendFromNoteArticle(article);
      }
    });
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" || e.shiftKey) return;
      var ta = e.target;
      if (!ta || !ta.id) return;
      var id = ta.id;
      var kind = null;
      if (id === "dict-term-eli-question") kind = "term";
      else if (id === "dict-statute-eli-question") kind = "statute";
      else if (id === "dict-case-eli-question") kind = "case";
      if (!kind) return;
      e.preventDefault();
      sendDictionaryPanelAsk(kind);
    });
  }

  function syncUser() {
    var u = null;
    try {
      if (firebase.auth && firebase.auth().currentUser) u = firebase.auth().currentUser.uid;
    } catch (e) {}
    subscribeUsage(u);
    updateRemainTexts();
  }

  window.QuizAiAsk = {
    resetMain: function () {
      resetPanel();
    },
    syncAuth: syncUser,
    sendFromNoteArticle: sendFromNoteArticle,
    sendDictionaryPanelAsk: sendDictionaryPanelAsk,
    toggleDictionaryAiPanel: toggleDictionaryAiPanel
  };

  function bindAuth() {
    try {
      if (typeof firebase !== "undefined" && firebase.apps && firebase.apps.length && firebase.auth) {
        firebase.auth().onAuthStateChanged(function () {
          syncUser();
        });
      }
    } catch (e) {}
    window.addEventListener("app-auth", function () {
      syncUser();
    });
    window.addEventListener("membership-updated", function () {
      updateRemainTexts();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      bind();
      bindAuth();
      syncUser();
    });
  } else {
    bind();
    bindAuth();
    syncUser();
  }
})();
