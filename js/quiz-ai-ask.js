(function () {
  /** 화면·알림에서 통일하는 엘리 AI 기능명 */
  var HANLAW_ELLIE_AI_LABEL = "엘리(AI)에게 질문하기";
  window.HANLAW_ELLIE_AI_LABEL = HANLAW_ELLIE_AI_LABEL;

  var usageUnsub = null;
  var ellyWalletUnsub = null;
  var memberUnsub = null;
  var lastRemain = 0;
  var lastPaidDailyCap = 5;
  var lastEllyCredits = 0;
  var lastEllyUnlimitedUntilMs = 0;

  function capFromEllyDailyTier(raw) {
    var t = String(raw || "basic").toLowerCase();
    if (t === "super") return 15;
    if (t === "ultra") return 30;
    return 5;
  }

  function dailyUsageCapForViewer() {
    if (typeof window.isPaidMember === "function" && window.isPaidMember()) {
      return lastPaidDailyCap;
    }
    return 0;
  }

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
    var cap = dailyUsageCapForViewer();
    var today = kstTodayYmd();
    if (!snap || !snap.exists) return cap;
    var d = snap.data();
    if (d.ymd !== today) return cap;
    var used = Math.max(0, parseInt(d.count, 10) || 0);
    return Math.max(0, cap - used);
  }

  function sumEllyBatches(batches) {
    var now = Date.now();
    var n = 0;
    if (!batches || !batches.length) return 0;
    for (var i = 0; i < batches.length; i++) {
      var b = batches[i];
      var exp = b && b.expiresAt;
      var expMs = exp && typeof exp.toMillis === "function" ? exp.toMillis() : 0;
      if (expMs < now) continue;
      n += Math.max(0, parseInt(b.amount, 10) || 0);
    }
    return n;
  }

  function hasEllyUnlimited() {
    return lastEllyUnlimitedUntilMs > Date.now();
  }

  function hasEllyAccess() {
    return hasEllyUnlimited() || lastRemain > 0 || lastEllyCredits > 0;
  }

  var ellyLimitModalBound = false;
  function hideEllyLimitModal() {
    var modal = document.getElementById("quiz-ai-limit-modal");
    if (modal) {
      modal.hidden = true;
      modal.setAttribute("aria-hidden", "true");
    }
  }
  function bindEllyLimitModalOnce() {
    if (ellyLimitModalBound) return;
    ellyLimitModalBound = true;
    var modal = document.getElementById("quiz-ai-limit-modal");
    if (!modal) return;
    function goPricing() {
      hideEllyLimitModal();
      if (typeof window.goToQuestionPacksSection === "function") {
        window.goToQuestionPacksSection();
      } else if (typeof window.goToEllyQuestionPacksSection === "function") {
        window.goToEllyQuestionPacksSection();
      } else {
        var navBtn = document.querySelector('.nav-main__btn[data-panel="pricing"]');
        if (navBtn) navBtn.click();
        setTimeout(function () {
          var sec = document.getElementById("pricing-subscription-anchor");
          if (sec) sec.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 80);
      }
    }
    function goPointConvert() {
      hideEllyLimitModal();
      if (typeof window.goToDashboardPointConvertSection === "function") {
        window.goToDashboardPointConvertSection();
      } else {
        var navBtn = document.querySelector('.nav-main__btn[data-panel="dashboard"]');
        if (navBtn) navBtn.click();
      }
    }
    var c = document.getElementById("quiz-ai-limit-modal-close");
    var d = document.getElementById("quiz-ai-limit-modal-dismiss");
    var p = document.getElementById("quiz-ai-limit-modal-go-point-convert");
    var g = document.getElementById("quiz-ai-limit-modal-go-pricing");
    if (c) c.addEventListener("click", hideEllyLimitModal);
    if (d) d.addEventListener("click", hideEllyLimitModal);
    if (p) p.addEventListener("click", goPointConvert);
    if (g) g.addEventListener("click", goPricing);
    modal.addEventListener("click", function (e) {
      if (e.target === modal) hideEllyLimitModal();
    });
  }
  function showEllyLimitModal() {
    bindEllyLimitModalOnce();
    var modal = document.getElementById("quiz-ai-limit-modal");
    if (!modal) {
      window.alert(
        "오늘의 엘리(AI) 질문 한도를 모두 썼습니다. 내일 다시 시도하거나, 포인트로 엘리 질문권을 전환해 주세요(대시보드 > 포인트 전환). 상위 구독 플랜은 요금제 탭에서 확인할 수 있습니다."
      );
      return;
    }
    var body = document.getElementById("quiz-ai-limit-modal-body");
    if (body) {
      body.textContent =
        "오늘의 엘리(AI) 질문 한도를 모두 썼습니다. 내일 다시 시도하거나, 포인트로 엘리 질문권을 전환할 수 있습니다(대시보드 > 포인트 전환). 더 높은 일일 한도가 필요하면 요금제에서 상위 플랜을 확인해 주세요.";
      body.style.whiteSpace = "pre-line";
    }
    modal.hidden = false;
    modal.setAttribute("aria-hidden", "false");
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
      msg =
        "로그인 후 이용 · 유료 구독 회원 한정 · 플랜별 일일 한도(베이직 5·슈퍼 15·울트라 30회, 한국시간)";
    } else if (typeof window.isPaidMember === "function" && !window.isPaidMember()) {
      msg = HANLAW_ELLIE_AI_LABEL + "는 유료 구독 회원에 한해 이용할 수 있습니다.";
    } else if (hasEllyUnlimited()) {
      var end = new Date(lastEllyUnlimitedUntilMs);
      var ds = end.toLocaleDateString("ko-KR", {
        timeZone: "Asia/Seoul",
        year: "numeric",
        month: "numeric",
        day: "numeric"
      });
      msg =
        HANLAW_ELLIE_AI_LABEL +
        " 무제한 이용 중 (~ " +
        ds +
        "까지 · 한국시간 기준, Google Gemini)";
    } else {
      var credPart = lastEllyCredits > 0 ? " · 보유 엘리 질문권 " + lastEllyCredits + "건" : "";
      var cap = lastPaidDailyCap;
      msg =
        "오늘 " +
        lastRemain +
        "/" +
        cap +
        "회(구독 일일 한도)" +
        credPart +
        " · " +
        HANLAW_ELLIE_AI_LABEL +
        "(한국시간, Google Gemini)";
    }
    if (el) el.textContent = msg;
    document.querySelectorAll(".dict-panel-ai-remain").forEach(function (sub) {
      sub.textContent = msg;
    });
    var paidOk = typeof window.isPaidMember === "function" && window.isPaidMember();
    /** 한도 소진 시에도 버튼으로 안내 모달을 띄우기 위해, 유료·로그인만으로 활성화 */
    var disSend = !paidOk || !isRealFirebaseUser();
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
      lastRemain = 0;
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
        lastRemain = 0;
        updateRemainTexts();
      }
    );
  }

  function subscribeEllyWallet(uid) {
    if (ellyWalletUnsub) {
      ellyWalletUnsub();
      ellyWalletUnsub = null;
    }
    if (!uid || typeof firebase === "undefined" || !firebase.firestore) {
      lastEllyCredits = 0;
      updateRemainTexts();
      return;
    }
    var wref = firebase.firestore().collection("hanlaw_quiz_ai_wallet").doc(uid);
    ellyWalletUnsub = wref.onSnapshot(
      function (snap) {
        var b = snap && snap.exists && snap.data().batches ? snap.data().batches : [];
        lastEllyCredits = sumEllyBatches(b);
        updateRemainTexts();
      },
      function () {
        lastEllyCredits = 0;
        updateRemainTexts();
      }
    );
  }

  function subscribeMemberElly(uid) {
    if (memberUnsub) {
      memberUnsub();
      memberUnsub = null;
    }
    if (!uid || typeof firebase === "undefined" || !firebase.firestore) {
      lastEllyUnlimitedUntilMs = 0;
      updateRemainTexts();
      return;
    }
    var mref = firebase.firestore().collection("hanlaw_members").doc(uid);
    memberUnsub = mref.onSnapshot(
      function (snap) {
        lastEllyUnlimitedUntilMs = 0;
        lastPaidDailyCap = 5;
        if (snap && snap.exists) {
          var dd = snap.data();
          var eu = dd.ellyUnlimitedUntil;
          if (eu && typeof eu.toMillis === "function") {
            lastEllyUnlimitedUntilMs = eu.toMillis();
          }
          if (dd.membershipTier === "paid") {
            lastPaidDailyCap = capFromEllyDailyTier(dd.ellyDailyTier);
          }
        } else {
          var am = window.APP_MEMBERSHIP || {};
          if (am.tier === "paid" && am.ellyDailyTier) {
            lastPaidDailyCap = capFromEllyDailyTier(am.ellyDailyTier);
          }
        }
        updateRemainTexts();
      },
      function () {
        lastEllyUnlimitedUntilMs = 0;
        lastPaidDailyCap = 5;
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

  /** 패널을 펼칠 때만: 로그인·질문권 없으면 false (모달/알림 처리됨) */
  function guardEllyPanelOpen() {
    if (!isRealFirebaseUser()) {
      window.alert("실제 계정으로 로그인한 뒤 이용해 주세요.");
      return false;
    }
    if (!hasEllyAccess()) {
      showEllyLimitModal();
      return false;
    }
    return true;
  }

  function togglePanel() {
    if (typeof window.isPaidMember !== "function" || !window.isPaidMember()) {
      window.alert(HANLAW_ELLIE_AI_LABEL + "는 유료 구독 회원에 한해 이용할 수 있습니다.");
      return;
    }
    var p = document.getElementById(IDS.panel);
    var btn = document.getElementById(IDS.toggle);
    if (!p) return;
    if (p.hidden && !guardEllyPanelOpen()) return;
    var open = p.hidden;
    p.hidden = !open;
    if (btn) btn.setAttribute("aria-expanded", open ? "true" : "false");
  }

  function sendAsk() {
    if (typeof window.isPaidMember !== "function" || !window.isPaidMember()) {
      window.alert(HANLAW_ELLIE_AI_LABEL + "는 유료 구독 회원에 한해 이용할 수 있습니다.");
      return;
    }
    if (!isRealFirebaseUser()) {
      window.alert("실제 계정으로 로그인한 뒤 이용해 주세요.");
      return;
    }
    if (!hasEllyAccess()) {
      showEllyLimitModal();
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
        }
        if (res && typeof res.ellyCreditsRemaining === "number") {
          lastEllyCredits = Math.max(0, res.ellyCreditsRemaining);
        }
        updateRemainTexts();
      })
      .catch(function (e) {
        hideAiLoading();
        var code = e && e.code;
        var msg = e && e.message ? String(e.message) : String(e);
        if (code === "functions/resource-exhausted") {
          showEllyLimitModal();
        } else if (code === "functions/failed-precondition" && /유료 구독/.test(msg)) {
          showEllyLimitModal();
        } else {
          if (code === "functions/failed-precondition" && /GEMINI_API_KEY/.test(msg)) {
            msg = "서버에 Gemini API 키가 설정되어 있지 않습니다. 관리자에게 문의하세요.";
          }
          if (errEl) {
            errEl.textContent = msg;
            errEl.hidden = false;
          }
        }
      })
      .then(doneEnable, doneEnable);
  }

  function sendFromNoteArticle(article) {
    if (typeof window.isPaidMember !== "function" || !window.isPaidMember()) {
      window.alert(HANLAW_ELLIE_AI_LABEL + "는 유료 구독 회원에 한해 이용할 수 있습니다.");
      return;
    }
    if (!isRealFirebaseUser()) {
      window.alert("실제 계정으로 로그인한 뒤 이용해 주세요.");
      return;
    }
    if (!hasEllyAccess()) {
      showEllyLimitModal();
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
        }
        if (res && typeof res.ellyCreditsRemaining === "number") {
          lastEllyCredits = Math.max(0, res.ellyCreditsRemaining);
        }
        updateRemainTexts();
      })
      .catch(function (e) {
        if (loadEl) {
          loadEl.hidden = true;
          loadEl.setAttribute("aria-busy", "false");
        }
        var code = e && e.code;
        var msg = e && e.message ? String(e.message) : String(e);
        if (code === "functions/resource-exhausted") {
          showEllyLimitModal();
        } else if (code === "functions/failed-precondition" && /유료 구독/.test(msg)) {
          showEllyLimitModal();
        } else {
          if (code === "functions/failed-precondition" && /GEMINI_API_KEY/.test(msg)) {
            msg = "서버에 Gemini API 키가 설정되어 있지 않습니다. 관리자에게 문의하세요.";
          }
          if (errEl) {
            errEl.textContent = msg;
            errEl.hidden = false;
          }
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
      window.alert(HANLAW_ELLIE_AI_LABEL + "는 유료 구독 회원에 한해 이용할 수 있습니다.");
      return;
    }
    if (!isRealFirebaseUser()) {
      window.alert("실제 계정으로 로그인한 뒤 이용해 주세요.");
      return;
    }
    if (!hasEllyAccess()) {
      showEllyLimitModal();
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
        }
        if (res && typeof res.ellyCreditsRemaining === "number") {
          lastEllyCredits = Math.max(0, res.ellyCreditsRemaining);
        }
        updateRemainTexts();
      })
      .catch(function (e) {
        hideDictAiLoading(pre);
        var code = e && e.code;
        var msg = e && e.message ? String(e.message) : String(e);
        if (code === "functions/resource-exhausted") {
          showEllyLimitModal();
        } else if (code === "functions/failed-precondition" && /유료 구독/.test(msg)) {
          showEllyLimitModal();
        } else {
          if (code === "functions/failed-precondition" && /GEMINI_API_KEY/.test(msg)) {
            msg = "서버에 Gemini API 키가 설정되어 있지 않습니다. 관리자에게 문의하세요.";
          }
          if (errEl) {
            errEl.textContent = msg;
            errEl.hidden = false;
          }
        }
      })
      .then(doneEnable, doneEnable);
  }

  function toggleDictionaryAiPanel(kind) {
    if (typeof window.isPaidMember !== "function" || !window.isPaidMember()) {
      window.alert(HANLAW_ELLIE_AI_LABEL + "는 유료 구독 회원에 한해 이용할 수 있습니다.");
      return;
    }
    var pre = dictionaryEliPrefix(kind);
    if (!pre) return;
    var p = document.getElementById(pre + "-panel");
    var btn = document.getElementById(pre + "-toggle");
    if (!p) return;
    if (p.hidden && !guardEllyPanelOpen()) return;
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
    subscribeEllyWallet(u);
    subscribeMemberElly(u);
    updateRemainTexts();
  }

  window.QuizAiAsk = {
    resetMain: function () {
      resetPanel();
    },
    syncAuth: syncUser,
    sendFromNoteArticle: sendFromNoteArticle,
    sendDictionaryPanelAsk: sendDictionaryPanelAsk,
    toggleDictionaryAiPanel: toggleDictionaryAiPanel,
    guardEllyPanelOpen: guardEllyPanelOpen
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
      var m = window.APP_MEMBERSHIP || {};
      if (m.tier === "paid" && m.ellyDailyTier) {
        lastPaidDailyCap = capFromEllyDailyTier(m.ellyDailyTier);
      } else {
        lastPaidDailyCap = 5;
      }
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
