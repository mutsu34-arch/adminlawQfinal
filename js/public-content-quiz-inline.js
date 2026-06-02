/**
 * 공개 콘텐츠 패널 내 인라인 퀴즈(5문항) — 앱 퀴즈와 동일한 관리자 수정 모달
 */
(function () {
  var list = [];
  var index = 0;
  var answers = {};
  var el = {};
  var hostEl = null;

  function isAnsweredAt(i) {
    return answers[i] != null;
  }

  function reloadBank() {
    var cfg = typeof window.getHanlawPublicContentConfig === "function" ? window.getHanlawPublicContentConfig() : null;
    if (
      cfg &&
      cfg.weeklySnapshot &&
      Array.isArray(cfg.weeklySnapshot.quiz) &&
      cfg.weeklySnapshot.quiz.length
    ) {
      list = cfg.weeklySnapshot.quiz.slice();
      return;
    }
    if (typeof window.getHanlawPublicQuestionBank === "function") {
      list = window.getHanlawPublicQuestionBank();
    }
  }

  function stringifyDetailSegment(v) {
    if (v == null) return "";
    if (typeof v === "string") return v.trim();
    if (typeof v === "object" && v.text != null) return String(v.text).trim();
    return String(v).trim();
  }

  function formatOx(v) {
    return v ? "O" : "X";
  }

  function applyOxReveal(container, userTrue, correctTrue) {
    if (!container) return;
    container.classList.add("q-actions--revealed");
    container.querySelectorAll(".btn--ox").forEach(function (b) {
      var isTrue = String(b.getAttribute("data-answer") || "").toLowerCase() === "true";
      var isCorrectBtn = isTrue === correctTrue;
      var isUserBtn = isTrue === userTrue;
      b.classList.remove("btn--ox-reveal-correct", "btn--ox-reveal-wrong", "btn--ox-reveal-dim");
      if (isCorrectBtn) b.classList.add("btn--ox-reveal-correct");
      else if (isUserBtn) b.classList.add("btn--ox-reveal-wrong");
      else b.classList.add("btn--ox-reveal-dim");
    });
  }

  function clearOxReveal(container) {
    if (!container) return;
    container.classList.remove("q-actions--revealed");
    container.querySelectorAll(".btn--ox").forEach(function (b) {
      b.classList.remove("btn--ox-reveal-correct", "btn--ox-reveal-wrong", "btn--ox-reveal-dim");
    });
  }

  function getBasicExplain(q) {
    if (!q) return "";
    var b = String(q.explanationBasic || "").trim();
    if (b) return b;
    return String(q.explanation || "").trim();
  }

  function buildDetailBlocks(container, detail) {
    if (!container) return;
    container.innerHTML = "";
    var d = detail != null && typeof detail === "object" ? detail : {};
    var parts = [];
    var leg = stringifyDetailSegment(d.legal);
    var trap = stringifyDetailSegment(d.trap);
    var prec = stringifyDetailSegment(d.precedent);
    var memo = stringifyDetailSegment(d.memoTip);
    if (d.body && String(d.body).trim()) {
      parts.push(String(d.body).replace(/\r\n/g, "\n").trim());
    } else {
      if (leg) parts.push("법리 근거\n" + leg);
      if (trap) parts.push("함정 포인트\n" + trap);
      if (prec) parts.push("판례·실무\n" + prec);
      if (memo) parts.push("암기 팁\n" + memo);
    }
    var out = parts.join("\n\n").trim();
    if (!out) {
      var p = document.createElement("p");
      p.className = "feedback-detail__empty";
      p.textContent = "등록된 상세 해설이 없습니다.";
      container.appendChild(p);
      return;
    }
    var root = document.createElement("div");
    root.className = "feedback-detail__rich-html";
    if (typeof window.formatHanlawAiAnswerHtml === "function") {
      root.innerHTML = window.formatHanlawAiAnswerHtml(out);
    } else {
      root.textContent = out;
    }
    container.appendChild(root);
  }

  function showFeedback(q, userTrue) {
    var ok = userTrue === q.answer;
    el.feedback.hidden = false;
    el.feedbackResult.textContent = ok ? "정답입니다." : "오답입니다.";
    el.feedbackResult.classList.toggle("is-correct", ok);
    el.feedbackResult.classList.toggle("is-wrong", !ok);
    if (typeof window.formatHanlawAiAnswerHtml === "function") {
      el.feedbackExplain.innerHTML = window.formatHanlawAiAnswerHtml(
        getBasicExplain(q) || "등록된 기본 해설이 없습니다."
      );
    } else {
      el.feedbackExplain.textContent = getBasicExplain(q) || "등록된 기본 해설이 없습니다.";
    }
    buildDetailBlocks(el.feedbackDetail, q.detail);
    applyOxReveal(el.actions, userTrue, q.answer);
    el.actions.querySelectorAll(".btn--ox").forEach(function (b) {
      b.disabled = true;
    });
  }

  function hideFeedback() {
    el.feedback.hidden = true;
    clearOxReveal(el.actions);
    el.actions.querySelectorAll(".btn--ox").forEach(function (b) {
      b.disabled = false;
    });
  }

  function renderQuestion() {
    reloadBank();
    var q = list[index];
    if (!q) return;
    el.progress.textContent = index + 1 + " / " + list.length;
    if (typeof window.formatHanlawRichParagraphsHtml === "function") {
      el.qText.innerHTML = window.formatHanlawRichParagraphsHtml(q.statement || "");
    } else {
      el.qText.textContent = q.statement || "";
    }
    if (isAnsweredAt(index)) {
      showFeedback(q, answers[index].userTrue);
    } else {
      hideFeedback();
    }
    el.btnPrev.disabled = index <= 0;
    el.btnNext.textContent = index >= list.length - 1 ? "처음으로" : "다음 문항";
  }

  function onAnswer(userTrue) {
    if (isAnsweredAt(index)) return;
    var q = list[index];
    if (!q) return;
    answers[index] = { userTrue: userTrue };
    showFeedback(q, userTrue);
  }

  function goNext() {
    if (index >= list.length - 1) {
      index = 0;
      answers = {};
    } else {
      index++;
    }
    renderQuestion();
  }

  function goPrev() {
    if (index <= 0) return;
    index--;
    renderQuestion();
  }

  function bindAdminEdit() {
    if (!window.HanlawQuizAdminEditor || typeof window.HanlawQuizAdminEditor.mount !== "function") return;
    window.HanlawQuizAdminEditor.mount({
      editButtonEl: el.btnEdit,
      feedbackEditButtonEl: el.btnEditFb,
      insertEditorBeforeEl: el.card,
      hideOnOpenEl: el.card,
      getQuestion: function () {
        return list[index];
      },
      onSaved: function (updated) {
        list[index] = updated;
        var p = Promise.resolve();
        if (typeof window.loadRemoteQuestions === "function") {
          p = window.loadRemoteQuestions();
        }
        p.then(function () {
          reloadBank();
          renderQuestion();
        });
      }
    });
  }

  function mount(host) {
    hostEl = host;
    if (!host) return;
    host.innerHTML =
      '<p class="public-quiz-progress" id="public-inline-quiz-progress">1 / 5</p>' +
      '<div class="quiz-admin-edit-toolbar" id="public-inline-quiz-admin-toolbar">' +
      '<button type="button" id="public-inline-quiz-admin-edit" class="btn btn--small btn--outline btn--quiz-admin-edit" hidden>관리자 수정</button>' +
      "</div>" +
      '<article class="card card--question public-quiz-card" id="public-inline-quiz-card">' +
      '<p class="q-text" id="public-inline-quiz-text"></p>' +
      '<div class="q-actions" id="public-inline-quiz-actions">' +
      '<button type="button" class="btn btn--ox btn--o" data-answer="true">O</button>' +
      '<button type="button" class="btn btn--ox btn--x" data-answer="false">X</button>' +
      "</div></article>" +
      '<div class="feedback" id="public-inline-quiz-feedback" hidden>' +
      '<p id="public-inline-quiz-feedback-result" class="feedback__result"></p>' +
      '<p class="feedback__block-label">기본 해설</p>' +
      '<div id="public-inline-quiz-explain" class="feedback__block-body"></div>' +
      '<p class="feedback__block-label">상세 해설</p>' +
      '<div id="public-inline-quiz-detail" class="feedback-detail feedback__block-body"></div>' +
      '<div class="quiz-admin-edit-toolbar quiz-admin-edit-toolbar--feedback">' +
      '<button type="button" id="public-inline-quiz-admin-edit-fb" class="btn btn--small btn--outline btn--quiz-admin-edit" hidden>관리자 수정</button>' +
      "</div></div>" +
      '<div class="public-quiz-nav">' +
      '<button type="button" class="btn btn--outline" id="public-inline-quiz-prev">이전</button>' +
      '<button type="button" class="btn btn--primary" id="public-inline-quiz-next">다음 문항</button>' +
      "</div>";

    el.progress = document.getElementById("public-inline-quiz-progress");
    el.qText = document.getElementById("public-inline-quiz-text");
    el.actions = document.getElementById("public-inline-quiz-actions");
    el.feedback = document.getElementById("public-inline-quiz-feedback");
    el.feedbackResult = document.getElementById("public-inline-quiz-feedback-result");
    el.feedbackExplain = document.getElementById("public-inline-quiz-explain");
    el.feedbackDetail = document.getElementById("public-inline-quiz-detail");
    el.btnPrev = document.getElementById("public-inline-quiz-prev");
    el.btnNext = document.getElementById("public-inline-quiz-next");
    el.btnEdit = document.getElementById("public-inline-quiz-admin-edit");
    el.btnEditFb = document.getElementById("public-inline-quiz-admin-edit-fb");
    el.card = document.getElementById("public-inline-quiz-card");

    el.actions.addEventListener("click", function (e) {
      var btn = e.target.closest(".btn--ox");
      if (!btn || btn.disabled) return;
      onAnswer(String(btn.getAttribute("data-answer") || "").toLowerCase() === "true");
    });
    el.btnPrev.addEventListener("click", goPrev);
    el.btnNext.addEventListener("click", goNext);

    index = 0;
    answers = {};

    function finishMount() {
      reloadBank();
      if (!list.length) {
        host.innerHTML =
          '<p class="dict-empty">공개 퀴즈 문항을 불러오지 못했습니다. 페이지를 새로고침해 주세요. (questions.js)</p>';
        return;
      }
      renderQuestion();
      bindAdminEdit();
    }

    reloadBank();
    if (list.length) {
      finishMount();
      return;
    }

    var loadP = Promise.resolve();
    if (typeof window.refreshHanlawPublicContentConfig === "function") {
      loadP = window.refreshHanlawPublicContentConfig().catch(function () {});
    } else if (typeof window.loadRemoteQuestions === "function") {
      loadP = window.loadRemoteQuestions().catch(function () {});
    }
    loadP.then(finishMount);
  }

  function unmount() {
    hostEl = null;
    list = [];
    index = 0;
    answers = {};
  }

  window.HanlawPublicQuizInline = {
    mount: mount,
    unmount: unmount
  };
})();
