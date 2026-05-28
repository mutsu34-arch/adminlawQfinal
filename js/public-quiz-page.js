/**
 * 공개 36문항 OX 퀴즈 — 비로그인 전체 해설(기본+상세) 열람
 */
(function () {
  var list = [];
  var index = 0;
  var answers = {};

  function isAnsweredAt(i) {
    return answers[i] != null;
  }

  var el = {};

  function stringifyDetailSegment(v) {
    if (v == null) return "";
    if (typeof v === "string") return v.replace(/\r\n/g, "\n").trim();
    if (typeof v === "object") {
      if (typeof v.text === "string" && v.text.trim()) return v.text.replace(/\r\n/g, "\n").trim();
      if (typeof v.body === "string" && v.body.trim()) return v.body.replace(/\r\n/g, "\n").trim();
    }
    return "";
  }

  function getBasicExplain(q) {
    if (!q) return "";
    var b = String(q.explanationBasic || "").trim();
    if (b) return b;
    return String(q.explanation || "").trim();
  }

  function buildDetailBlocks(container, detail, q) {
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

  function formatOx(v) {
    return v ? "O" : "X";
  }

  function starsLine(n) {
    var max = 5;
    var v = typeof n === "number" && n >= 0 ? Math.min(max, Math.floor(n)) : 0;
    var s = "";
    for (var i = 0; i < max; i++) s += i < v ? "★" : "☆";
    return s;
  }

  function oxButtonIsTrue(btn) {
    return String(btn.getAttribute("data-answer") || "").toLowerCase() === "true";
  }

  function applyOxReveal(container, userTrue, correctTrue) {
    if (!container) return;
    container.classList.add("q-actions--revealed");
    container.querySelectorAll(".btn--ox").forEach(function (b) {
      var isTrue = oxButtonIsTrue(b);
      b.classList.remove("btn--ox-reveal-correct", "btn--ox-reveal-wrong", "btn--ox-reveal-dim");
      var isCorrectBtn = isTrue === correctTrue;
      var isUserBtn = isTrue === userTrue;
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

  function setOxDisabled(disabled) {
    if (!el.actions) return;
    el.actions.querySelectorAll(".btn--ox").forEach(function (b) {
      b.disabled = !!disabled;
    });
  }

  function renderTags(container, tags) {
    container.innerHTML = "";
    if (!tags || !tags.length) {
      var dash = document.createElement("span");
      dash.className = "feedback__tag-empty";
      dash.textContent = "—";
      container.appendChild(dash);
      return;
    }
    tags.forEach(function (t) {
      var span = document.createElement("span");
      span.className = "feedback-tag";
      span.textContent = "#" + String(t || "").trim();
      container.appendChild(span);
    });
  }

  function showFeedback(q, userTrue) {
    var ok = userTrue === q.answer;
    el.feedback.hidden = false;
    el.feedbackResult.textContent = ok ? "정답입니다." : "오답입니다.";
    el.feedbackResult.classList.remove("is-correct", "is-wrong");
    el.feedbackResult.classList.add(ok ? "is-correct" : "is-wrong");
    el.feedbackAnswerKey.textContent = "정답: " + formatOx(q.answer);
    el.feedbackAnswerKey.hidden = false;
    if (el.importanceLine) {
      el.importanceLine.hidden = false;
      el.importanceLine.textContent = "중요도: " + starsLine(q.importance);
    }
    if (el.difficultyLine) {
      el.difficultyLine.hidden = false;
      el.difficultyLine.textContent = "난이도: " + starsLine(q.difficulty);
    }
    var basic = getBasicExplain(q);
    el.feedbackExplain.classList.add("quiz-ai-answer");
    if (typeof window.formatHanlawAiAnswerHtml === "function") {
      el.feedbackExplain.innerHTML = window.formatHanlawAiAnswerHtml(
        basic || "등록된 기본 해설이 없습니다."
      );
    } else {
      el.feedbackExplain.textContent = basic || "등록된 기본 해설이 없습니다.";
    }
    buildDetailBlocks(el.feedbackDetail, q.detail, q);
    renderTags(el.feedbackTags, q.tags);
    if (el.tagsSection) el.tagsSection.hidden = false;
    applyOxReveal(el.actions, userTrue, q.answer);
    setOxDisabled(true);
    if (el.btnNext) el.btnNext.disabled = false;
  }

  function hideFeedback() {
    el.feedback.hidden = true;
    el.feedbackResult.classList.remove("is-correct", "is-wrong");
    el.feedbackExplain.textContent = "";
    el.feedbackDetail.innerHTML = "";
    el.feedbackTags.innerHTML = "";
    clearOxReveal(el.actions);
    setOxDisabled(false);
  }

  function renderQuestion() {
    var q = list[index];
    if (!q) return;
    var answered = isAnsweredAt(index);
    el.progress.textContent = index + 1 + " / " + list.length;
    var src = [];
    if (q.year) src.push(String(q.year) + "년도");
    if (q.exam) src.push(String(q.exam));
    el.qSource.textContent = src.length ? "출처: " + src.join(" ") : "";
    el.qSource.hidden = !src.length;
    var meta = q.topic || "—";
    el.qMeta.textContent = meta;
    if (typeof window.formatHanlawRichParagraphsHtml === "function") {
      el.qText.innerHTML = window.formatHanlawRichParagraphsHtml(q.statement || "");
    } else {
      el.qText.textContent = q.statement || "";
    }
    if (answered) {
      showFeedback(q, answers[index].userTrue);
    } else {
      hideFeedback();
    }
    if (el.btnPrev) el.btnPrev.disabled = index <= 0;
    if (el.btnNext) {
      el.btnNext.textContent = index >= list.length - 1 ? "처음으로" : "다음 문항";
      el.btnNext.disabled = false;
    }
    try {
      var u = new URL(window.location.href);
      u.searchParams.set("n", String(index + 1));
      window.history.replaceState(null, "", u.pathname + u.search);
    } catch (e) {}
  }

  function onAnswer(userTrue) {
    if (isAnsweredAt(index)) return;
    var q = list[index];
    if (!q) return;
    answers[index] = { userTrue: userTrue };
    showFeedback(q, userTrue);
    if (el.btnNext) el.btnNext.disabled = false;
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

  function reloadBank() {
    if (typeof window.getHanlawPublicQuestionBank === "function") {
      list = window.getHanlawPublicQuestionBank();
    }
  }

  function initAdminEdit() {
    if (!window.HanlawQuizAdminEditor || typeof window.HanlawQuizAdminEditor.mount !== "function") return;
    var editBtn = document.getElementById("btn-public-quiz-admin-edit");
    var editFb = document.getElementById("btn-public-quiz-admin-edit-feedback");
    var card = document.querySelector(".public-quiz-card");
    if (!editBtn || !card) return;
    window.HanlawQuizAdminEditor.mount({
      editButtonEl: editBtn,
      feedbackEditButtonEl: editFb,
      insertEditorBeforeEl: card,
      hideOnOpenEl: card,
      getQuestion: function () {
        return list[index];
      },
      onSaved: function (updated) {
        list[index] = updated;
        if (typeof window.loadRemoteQuestions === "function") {
          window.loadRemoteQuestions().then(reloadBank).then(renderQuestion).catch(renderQuestion);
        } else {
          renderQuestion();
        }
      }
    });
  }

  function bind() {
    el.progress = document.getElementById("public-quiz-progress");
    el.qSource = document.getElementById("public-quiz-source");
    el.qMeta = document.getElementById("public-quiz-meta");
    el.qText = document.getElementById("public-quiz-text");
    el.actions = document.getElementById("public-quiz-actions");
    el.feedback = document.getElementById("public-quiz-feedback");
    el.feedbackResult = document.getElementById("public-quiz-feedback-result");
    el.feedbackAnswerKey = document.getElementById("public-quiz-answer-key");
    el.importanceLine = document.getElementById("public-quiz-importance");
    el.difficultyLine = document.getElementById("public-quiz-difficulty");
    el.feedbackExplain = document.getElementById("public-quiz-explain");
    el.feedbackDetail = document.getElementById("public-quiz-detail");
    el.feedbackTags = document.getElementById("public-quiz-tags");
    el.tagsSection = document.getElementById("public-quiz-tags-section");
    el.btnPrev = document.getElementById("public-quiz-prev");
    el.btnNext = document.getElementById("public-quiz-next");

    if (el.actions) {
      el.actions.addEventListener("click", function (e) {
        var btn = e.target.closest(".btn--ox");
        if (!btn || btn.disabled) return;
        onAnswer(oxButtonIsTrue(btn));
      });
    }
    if (el.btnPrev) el.btnPrev.addEventListener("click", goPrev);
    if (el.btnNext) el.btnNext.addEventListener("click", goNext);
  }

  function startQuiz() {
    reloadBank();
    if (!list.length) {
      var err = document.getElementById("public-quiz-error");
      if (err) {
        err.hidden = false;
        err.textContent = "공개 문항을 불러오지 못했습니다. 잠시 후 새로고침해 주세요.";
      }
      return;
    }
    try {
      var n = parseInt(new URL(window.location.href).searchParams.get("n"), 10);
      if (Number.isFinite(n) && n >= 1 && n <= list.length) index = n - 1;
    } catch (e2) {}
    renderQuestion();
    initAdminEdit();
  }

  function init() {
    bind();
    var loadP = Promise.resolve();
    if (typeof window.loadRemoteQuestions === "function") {
      loadP = window.loadRemoteQuestions().catch(function () {});
    }
    loadP.then(startQuiz);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
