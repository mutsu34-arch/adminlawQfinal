(function () {
  var usageUnsub = null;
  var lastRemain = 4;

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

  function panelIds(isReview) {
    return {
      panel: isReview ? "review-quiz-ai-panel" : "quiz-ai-panel",
      question: isReview ? "review-quiz-ai-question" : "quiz-ai-question",
      answer: isReview ? "review-quiz-ai-answer" : "quiz-ai-answer",
      loading: isReview ? "review-quiz-ai-loading" : "quiz-ai-loading",
      loadingQuote: isReview ? "review-quiz-ai-loading-quote" : "quiz-ai-loading-quote",
      error: isReview ? "review-quiz-ai-error" : "quiz-ai-error",
      toggle: isReview ? "btn-review-quiz-ai-toggle" : "btn-quiz-ai-toggle",
      send: isReview ? "btn-review-quiz-ai-send" : "btn-quiz-ai-send"
    };
  }

  function showAiLoading(isReview) {
    var ids = panelIds(isReview);
    var load = document.getElementById(ids.loading);
    var qEl = document.getElementById(ids.loadingQuote);
    var ans = document.getElementById(ids.answer);
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

  function hideAiLoading(isReview) {
    var ids = panelIds(isReview);
    var load = document.getElementById(ids.loading);
    if (load) {
      load.hidden = true;
      load.setAttribute("aria-busy", "false");
    }
  }

  function updateRemainTexts() {
    var ids = ["quiz-ai-remain", "review-quiz-ai-remain"];
    var msg;
    if (!isRealFirebaseUser()) {
      msg = "로그인 후 이용 가능 · AI 질문 한도 하루 4회(한국시간, Gemini)";
    } else {
      msg =
        "오늘 AI 질문 남은 횟수: " + lastRemain + " / 4 (한국시간 기준, Google Gemini)";
    }
    for (var i = 0; i < ids.length; i++) {
      var el = document.getElementById(ids[i]);
      if (el) el.textContent = msg;
    }
    var disSend = isRealFirebaseUser() && lastRemain <= 0;
    var s1 = document.getElementById("btn-quiz-ai-send");
    var s2 = document.getElementById("btn-review-quiz-ai-send");
    if (s1 && !s1.dataset.aiSending) s1.disabled = disSend;
    if (s2 && !s2.dataset.aiSending) s2.disabled = disSend;
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

  function resetPanel(isReview) {
    var ids = panelIds(isReview);
    var p = document.getElementById(ids.panel);
    var ta = document.getElementById(ids.question);
    var ans = document.getElementById(ids.answer);
    var err = document.getElementById(ids.error);
    var btn = document.getElementById(ids.toggle);
    var qL = document.getElementById(ids.loadingQuote);
    if (p) p.hidden = true;
    if (ta) ta.value = "";
    hideAiLoading(isReview);
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

  function togglePanel(isReview) {
    var ids = panelIds(isReview);
    var p = document.getElementById(ids.panel);
    var btn = document.getElementById(ids.toggle);
    if (!p) return;
    var open = p.hidden;
    p.hidden = !open;
    if (btn) btn.setAttribute("aria-expanded", open ? "true" : "false");
  }

  function sendAsk(isReview) {
    if (!isRealFirebaseUser()) {
      window.alert("실제 계정으로 로그인한 뒤 이용해 주세요.");
      return;
    }
    if (lastRemain <= 0) {
      window.alert("오늘 AI 질문 한도(4회)를 모두 사용했습니다.");
      return;
    }
    var ctx = window.__HANLAW_QUIZ_AI_CONTEXT;
    if (!ctx || !ctx.statement) {
      window.alert("문항 정보가 없습니다. 문제를 다시 불러온 뒤 시도해 주세요.");
      return;
    }
    var ids = panelIds(isReview);
    var ta = document.getElementById(ids.question);
    var sendBtn = document.getElementById(ids.send);
    var errEl = document.getElementById(ids.error);
    var ansEl = document.getElementById(ids.answer);
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

    showAiLoading(isReview);

    window
      .quizAskGeminiCallable({
        userQuestion: uq,
        quiz: ctx
      })
      .then(function (res) {
        hideAiLoading(isReview);
        if (ansEl) {
          var rawAns = res && res.answer ? res.answer : "";
          ansEl.innerHTML = formatAnswerHtml(rawAns);
          if (!ansEl.innerHTML.trim() && rawAns) {
            ansEl.textContent = rawAns;
          }
          ansEl.hidden = false;
        }
        if (res && typeof res.remainingToday === "number") {
          lastRemain = Math.max(0, res.remainingToday);
          updateRemainTexts();
        }
      })
      .catch(function (e) {
        hideAiLoading(isReview);
        var code = e && e.code;
        var msg = (e && e.message) ? String(e.message) : String(e);
        if (code === "functions/resource-exhausted") {
          msg = "오늘 AI 질문 한도(4회)를 모두 사용했습니다. 내일 다시 이용해 주세요.";
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

  /** Enter = 전송, Shift+Enter = 줄바꿈 */
  function bindEnterToSend(textareaId, isReview) {
    var ta = document.getElementById(textareaId);
    if (!ta) return;
    ta.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" || e.shiftKey) return;
      e.preventDefault();
      sendAsk(isReview);
    });
  }

  function bind() {
    var b1 = document.getElementById("btn-quiz-ai-toggle");
    if (b1) b1.addEventListener("click", function () { togglePanel(false); });
    var s1 = document.getElementById("btn-quiz-ai-send");
    if (s1) s1.addEventListener("click", function () { sendAsk(false); });
    bindEnterToSend("quiz-ai-question", false);

    var b2 = document.getElementById("btn-review-quiz-ai-toggle");
    if (b2) b2.addEventListener("click", function () { togglePanel(true); });
    var s2 = document.getElementById("btn-review-quiz-ai-send");
    if (s2) s2.addEventListener("click", function () { sendAsk(true); });
    bindEnterToSend("review-quiz-ai-question", true);
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
    resetMain: function () { resetPanel(false); },
    resetReview: function () { resetPanel(true); },
    syncAuth: syncUser
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
