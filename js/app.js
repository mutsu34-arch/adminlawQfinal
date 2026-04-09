(function () {
  var ALL = "전체";

  function getBank() {
    return window.QUESTION_BANK || [];
  }

  var el = {
    start: document.getElementById("screen-start"),
    quiz: document.getElementById("screen-quiz"),
    result: document.getElementById("screen-result"),
    filterTopic: document.getElementById("filter-topic"),
    questionCount: document.getElementById("question-count"),
    btnStart: document.getElementById("btn-start"),
    progress: document.getElementById("quiz-progress"),
    score: document.getElementById("quiz-score"),
    qSource: document.getElementById("q-source"),
    qMeta: document.getElementById("q-meta"),
    qText: document.getElementById("q-text"),
    qActions: document.getElementById("q-actions"),
    feedback: document.getElementById("feedback"),
    feedbackResult: document.getElementById("feedback-result"),
    feedbackAnswerKey: document.getElementById("feedback-answer-key"),
    feedbackImportanceLine: document.getElementById("feedback-importance-line"),
    feedbackDifficultyLine: document.getElementById("feedback-difficulty-line"),
    feedbackExplain: document.getElementById("feedback-explain"),
    feedbackDetail: document.getElementById("feedback-detail"),
    feedbackTags: document.getElementById("feedback-tags"),
    btnQuizFavorite: document.getElementById("btn-quiz-favorite"),
    btnNext: document.getElementById("btn-next"),
    resultSummary: document.getElementById("result-summary"),
    btnRetry: document.getElementById("btn-retry"),
    btnHome: document.getElementById("btn-home"),
    feedbackMaster: document.getElementById("feedback-master"),
    feedbackAttendanceNotify: document.getElementById("feedback-attendance-notify"),
    optAutoReview: document.getElementById("opt-auto-review")
  };

  var state = {
    list: [],
    index: 0,
    correct: 0,
    lastFilterTopic: ALL,
    lastOrderMode: "random",
    lastCount: "0",
    sinceReviewCount: 0,
    reviewModalQuestion: null
  };

  function matchesScope(q) {
    var exams = window.APP_SCOPE && window.APP_SCOPE.examIds;
    var ys = window.APP_SCOPE && window.APP_SCOPE.years;
    if (!Array.isArray(exams) || exams.length === 0) return false;
    var ex = String(q.examId || "")
      .trim()
      .toLowerCase();
    if (!ex || exams.indexOf(ex) < 0) return false;
    if (!Array.isArray(ys) || ys.length === 0) return false;
    if (q.year == null || q.year === "") return false;
    var qyn =
      typeof q.year === "number" && isFinite(q.year)
        ? Math.floor(q.year)
        : parseInt(String(q.year).trim(), 10);
    if (isNaN(qyn)) return false;
    var yi;
    for (yi = 0; yi < ys.length; yi++) {
      if (Number(ys[yi]) === qyn) return true;
    }
    return false;
  }

  function uniqueSorted(values) {
    var seen = {};
    var out = [];
    for (var i = 0; i < values.length; i++) {
      var v = values[i];
      if (!seen[v]) {
        seen[v] = true;
        out.push(v);
      }
    }
    out.sort(function (a, b) {
      return a.localeCompare(b, "ko");
    });
    return out;
  }

  function fillSelect(select, options, includeAll) {
    if (!select) return;
    select.innerHTML = "";
    if (includeAll) {
      var o0 = document.createElement("option");
      o0.value = ALL;
      o0.textContent = ALL;
      select.appendChild(o0);
    }
    options.forEach(function (opt) {
      var o = document.createElement("option");
      o.value = opt;
      o.textContent = opt;
      select.appendChild(o);
    });
  }

  function scopedBank() {
    return getBank().filter(matchesScope);
  }

  function initFilters() {
    var scoped = scopedBank();
    var topics = uniqueSorted(scoped.map(function (q) { return q.topic; }));
    fillSelect(el.filterTopic, topics, true);
  }

  function filterQuestions() {
    var tp = el.filterTopic.value;
    return getBank().filter(function (q) {
      if (!matchesScope(q)) return false;
      return tp === ALL || q.topic === tp;
    });
  }

  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i];
      a[i] = a[j];
      a[j] = t;
    }
    return a;
  }

  var ORDER_MODES = {
    progress: true,
    random: true,
    importance_desc: true,
    importance_asc: true,
    difficulty_asc: true,
    difficulty_desc: true
  };

  function getOrderMode() {
    var r = document.querySelector('input[name="opt-order"]:checked');
    var v = r && r.value;
    if (v && ORDER_MODES[v]) return v;
    return "random";
  }

  /**
   * 행정법 교과서에서 흔한 편제(총론 → 행정작용 각론 → 구제·쟁송).
   * data의 topic 문자열과 정확히 일치해야 하며, 없는 주제는 목차 맨 뒤(가나다)로 둡니다.
   */
  var ADMIN_LAW_TOPIC_ORDER = [
    "행정법 일반",
    "비례원칙",
    "행정행위",
    "행정계획",
    "행정입법",
    "행정강제",
    "행정계약",
    "행정절차",
    "행정소송",
    "국가배상",
    "조세·행정"
  ];

  function topicCurriculumRank(topic) {
    var t = String(topic || "").trim();
    var idx = ADMIN_LAW_TOPIC_ORDER.indexOf(t);
    return idx >= 0 ? idx : -1;
  }

  /** 같은 단원(주제) 안에서 연도 → 시험 → 문항 ID */
  function compareProgressOrder(q1, q2) {
    var y1 = parseInt(String(q1.year != null ? q1.year : ""), 10);
    var y2 = parseInt(String(q2.year != null ? q2.year : ""), 10);
    if (isNaN(y1)) y1 = 0;
    if (isNaN(y2)) y2 = 0;
    if (y1 !== y2) return y1 - y2;
    var e1 = String(q1.examId || "");
    var e2 = String(q2.examId || "");
    if (e1 !== e2) return e1.localeCompare(e2, "ko");
    return String(q1.id || "").localeCompare(String(q2.id || ""), "ko");
  }

  /** 진도별: 먼저 교과서 단원 순, 미등록 단원은 뒤에서 주제명 순, 같은 단원이면 compareProgressOrder */
  function compareCurriculumProgress(q1, q2) {
    var r1 = topicCurriculumRank(q1.topic);
    var r2 = topicCurriculumRank(q2.topic);
    var o1 = r1 >= 0 ? r1 : 10000;
    var o2 = r2 >= 0 ? r2 : 10000;
    if (o1 !== o2) return o1 - o2;
    var t1 = String(q1.topic || "");
    var t2 = String(q2.topic || "");
    if (t1 !== t2) return t1.localeCompare(t2, "ko");
    return compareProgressOrder(q1, q2);
  }

  /** 중요도 높은 순: 유효 1~5, 없음 0(뒤로) */
  function importanceKeyDesc(q) {
    var n = q.importance;
    return typeof n === "number" && n >= 1 && n <= 5 ? n : 0;
  }

  /** 중요도 낮은 순: 유효 1~5, 없음 99(뒤로) */
  function importanceKeyAsc(q) {
    var n = q.importance;
    return typeof n === "number" && n >= 1 && n <= 5 ? n : 99;
  }

  /** 난이도 쉬운 순: 유효 1~5, 없음 99(뒤로) */
  function difficultyKeyAsc(q) {
    var n = q.difficulty;
    return typeof n === "number" && n >= 1 && n <= 5 ? n : 99;
  }

  /** 난이도 어려운 순: 유효 1~5, 없음 0(뒤로) */
  function difficultyKeyDesc(q) {
    var n = q.difficulty;
    return typeof n === "number" && n >= 1 && n <= 5 ? n : 0;
  }

  function applyQuestionOrder(filtered, mode) {
    if (mode === "importance") mode = "importance_desc";
    if (mode === "difficulty") mode = "difficulty_asc";

    var a = filtered.slice();
    if (mode === "random") return shuffle(a);
    if (mode === "progress") {
      a.sort(compareCurriculumProgress);
      return a;
    }
    if (mode === "importance_desc") {
      a.sort(function (q1, q2) {
        var i1 = importanceKeyDesc(q1);
        var i2 = importanceKeyDesc(q2);
        if (i2 !== i1) return i2 - i1;
        return compareCurriculumProgress(q1, q2);
      });
      return a;
    }
    if (mode === "importance_asc") {
      a.sort(function (q1, q2) {
        var i1 = importanceKeyAsc(q1);
        var i2 = importanceKeyAsc(q2);
        if (i1 !== i2) return i1 - i2;
        return compareCurriculumProgress(q1, q2);
      });
      return a;
    }
    if (mode === "difficulty_asc") {
      a.sort(function (q1, q2) {
        var d1 = difficultyKeyAsc(q1);
        var d2 = difficultyKeyAsc(q2);
        if (d1 !== d2) return d1 - d2;
        return compareCurriculumProgress(q1, q2);
      });
      return a;
    }
    if (mode === "difficulty_desc") {
      a.sort(function (q1, q2) {
        var d1 = difficultyKeyDesc(q1);
        var d2 = difficultyKeyDesc(q2);
        if (d2 !== d1) return d2 - d1;
        return compareCurriculumProgress(q1, q2);
      });
      return a;
    }
    return shuffle(a);
  }

  function showScreen(name) {
    el.start.classList.remove("screen--active");
    el.quiz.classList.remove("screen--active");
    el.result.classList.remove("screen--active");
    el.start.hidden = true;
    el.quiz.hidden = true;
    el.result.hidden = true;
    if (name === "start") {
      el.start.hidden = false;
      el.start.classList.add("screen--active");
    } else if (name === "quiz") {
      el.quiz.hidden = false;
      el.quiz.classList.add("screen--active");
    } else {
      el.result.hidden = false;
      el.result.classList.add("screen--active");
    }
  }

  function setOxDisabled(disabled) {
    el.qActions.querySelectorAll(".btn--ox").forEach(function (b) {
      b.disabled = disabled;
    });
  }

  function oxButtonIsTrue(btn) {
    if (btn.getAttribute("data-answer") != null) {
      return btn.getAttribute("data-answer") === "true";
    }
    if (btn.getAttribute("data-review-answer") != null) {
      return btn.getAttribute("data-review-answer") === "true";
    }
    return false;
  }

  function clearOxReveal(container) {
    if (!container) return;
    container.classList.remove("q-actions--revealed");
    container.querySelectorAll(".btn--ox").forEach(function (b) {
      b.classList.remove("btn--ox-reveal-correct", "btn--ox-reveal-wrong", "btn--ox-reveal-dim");
    });
  }

  function applyOxReveal(container, userTrue, correctTrue) {
    if (!container) return;
    container.classList.add("q-actions--revealed");
    container.querySelectorAll(".btn--ox").forEach(function (b) {
      var isTrue = oxButtonIsTrue(b);
      b.classList.remove("btn--ox-reveal-correct", "btn--ox-reveal-wrong", "btn--ox-reveal-dim");
      var isCorrectBtn = isTrue === correctTrue;
      var isUserBtn = isTrue === userTrue;
      if (isCorrectBtn) {
        b.classList.add("btn--ox-reveal-correct");
      } else if (isUserBtn) {
        b.classList.add("btn--ox-reveal-wrong");
      } else {
        b.classList.add("btn--ox-reveal-dim");
      }
    });
  }

  function starsLine(n) {
    var max = 5;
    var v = typeof n === "number" && n >= 0 ? Math.min(max, Math.floor(n)) : 0;
    var s = "";
    for (var i = 0; i < max; i++) s += i < v ? "★" : "☆";
    return s;
  }

  function formatOx(v) {
    return v ? "O" : "X";
  }

  function setImportanceLine(lineEl, q) {
    if (!lineEl) return;
    lineEl.textContent = "";
    lineEl.appendChild(document.createTextNode("중요도: "));
    var hasNum = typeof q.importance === "number" && q.importance >= 1 && q.importance <= 5;
    var stars = document.createElement("span");
    stars.className = "feedback__star-part";
    stars.textContent = hasNum ? starsLine(q.importance) : "—";
    lineEl.appendChild(stars);
    var noteRaw = q.importanceNote != null ? String(q.importanceNote).trim() : "";
    if (noteRaw) {
      lineEl.appendChild(document.createTextNode(" (" + noteRaw + ")"));
    }
  }

  function setDifficultyLine(lineEl, q) {
    if (!lineEl) return;
    lineEl.textContent = "";
    lineEl.appendChild(document.createTextNode("난이도: "));
    var stars = document.createElement("span");
    stars.className = "feedback__star-part";
    var hasNum = typeof q.difficulty === "number" && q.difficulty >= 1 && q.difficulty <= 5;
    stars.textContent = hasNum ? starsLine(q.difficulty) : "—";
    lineEl.appendChild(stars);
  }

  function populateDetailContainer(container, q) {
    if (!container) return;
    container.innerHTML = "";
    var hasDetail =
      q.detail &&
      (q.detail.legal || q.detail.trap || q.detail.precedent);
    if (!hasDetail) {
      var empty = document.createElement("p");
      empty.className = "feedback-detail__empty";
      empty.textContent = "등록된 상세 해설이 없습니다.";
      container.appendChild(empty);
      return;
    }
    if (userIsPaidMember()) {
      buildDetailBlocks(container, q.detail);
    } else {
      var lockP = document.createElement("p");
      lockP.className = "feedback-premium-lock";
      lockP.textContent =
        "법리·함정·판례 등 상세 해설은 유료회원에게 제공됩니다. 상단의 회원 표시가 무료회원이면 요금제에서 구독 후 이용할 수 있습니다.";
      container.appendChild(lockP);
    }
  }

  function fillExplainPanel(parts, q) {
    if (parts.answerKey) {
      parts.answerKey.textContent = "정답: " + formatOx(q.answer);
      parts.answerKey.hidden = false;
    }
    setImportanceLine(parts.importanceLine, q);
    setDifficultyLine(parts.difficultyLine, q);
    if (parts.explain) {
      var basic = getBasicExplain(q);
      parts.explain.textContent = basic
        ? basic
        : "등록된 기본 해설이 없습니다.";
    }
    populateDetailContainer(parts.detail, q);
    if (parts.tags) {
      parts.tags.innerHTML = "";
      if (q.tags && q.tags.length) {
        renderTags(parts.tags, q.tags);
      } else {
        var dash = document.createElement("span");
        dash.className = "feedback__tag-empty";
        dash.textContent = "—";
        parts.tags.appendChild(dash);
      }
    }
  }

  function clearFeedbackExtras() {
    if (el.feedbackAnswerKey) {
      el.feedbackAnswerKey.textContent = "";
      el.feedbackAnswerKey.hidden = true;
    }
    if (el.feedbackImportanceLine) el.feedbackImportanceLine.textContent = "";
    if (el.feedbackDifficultyLine) el.feedbackDifficultyLine.textContent = "";
    if (el.feedbackExplain) el.feedbackExplain.textContent = "";
    if (el.feedbackDetail) {
      el.feedbackDetail.innerHTML = "";
    }
    if (el.feedbackTags) {
      el.feedbackTags.innerHTML = "";
    }
    if (el.feedbackMaster) {
      el.feedbackMaster.textContent = "";
      el.feedbackMaster.hidden = true;
    }
    if (el.feedbackAttendanceNotify) {
      el.feedbackAttendanceNotify.textContent = "";
      el.feedbackAttendanceNotify.hidden = true;
    }
    window.__HANLAW_QUIZ_AI_CONTEXT = null;
    if (window.QuizAiAsk && typeof window.QuizAiAsk.resetMain === "function") {
      window.QuizAiAsk.resetMain();
    }
  }

  function getBasicExplain(q) {
    if (q.explanationBasic != null && q.explanationBasic !== "") return q.explanationBasic;
    return q.explanation != null ? q.explanation : "";
  }

  /** Gemini 퀴즈 질문용 맥락(서버에서 길이 추가 제한). */
  function buildQuizAiContext(q, userTrue) {
    if (!q) return null;
    var basic = getBasicExplain(q);
    var det = "";
    if (q.detail && typeof q.detail === "object") {
      var keys = ["legal", "trap", "precedent"];
      var titles = { legal: "법리 근거", trap: "함정 포인트", precedent: "판례" };
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        if (q.detail[k]) det += (titles[k] || k) + ": " + q.detail[k] + "\n\n";
      }
    }
    var stmt = String(q.statement || "");
    if (stmt.length > 4000) stmt = stmt.slice(0, 4000);
    var exB = String(basic || "");
    if (exB.length > 6000) exB = exB.slice(0, 6000);
    var exX = String(det || "");
    if (exX.length > 6000) exX = exX.slice(0, 6000);
    return {
      statement: stmt,
      topic: String(q.topic || "").slice(0, 200),
      correctAnswer: q.answer === true,
      userAnsweredTrue: userTrue === true,
      explanationBasic: exB,
      explanationExtra: exX
    };
  }

  function userIsPaidMember() {
    return typeof window.isPaidMember === "function" && window.isPaidMember();
  }

  /** 시행 연도 + 시험 종류 (예: 2026년도 국가직 9급). exam-catalog 의 sourceLabel·year·examId 사용. */
  function formatQuizSource(q) {
    if (!q) return "";
    var y = q.year;
    var yearPart = "";
    if (y != null && y !== "" && !isNaN(parseInt(String(y), 10))) {
      yearPart = parseInt(String(y), 10) + "년도";
    }
    var examPart = "";
    if (q.examId && typeof window.getExamById === "function") {
      var cat = window.getExamById(q.examId);
      if (cat) examPart = cat.sourceLabel || cat.label || "";
    }
    if (!examPart && q.exam) examPart = String(q.exam).trim();
    if (yearPart && examPart) return yearPart + " " + examPart;
    if (yearPart) return yearPart;
    return examPart;
  }

  function renderQuestion() {
    var q = state.list[state.index];
    var total = state.list.length;
    el.progress.textContent = state.index + 1 + " / " + total;
    el.score.textContent = "정답 " + state.correct;
    var sourceStr = formatQuizSource(q);
    if (el.qSource) {
      el.qSource.textContent = sourceStr ? "출처: " + sourceStr : "";
      el.qSource.hidden = !sourceStr;
    }
    var meta = q.topic || "—";
    if (q.importance) meta += " · 중요도 " + starsLine(q.importance);
    if (q.difficulty) meta += " · 난이도 " + starsLine(q.difficulty);
    el.qMeta.textContent = meta;
    el.qText.textContent = q.statement;
    window.__QUIZ_QUESTION_CONTEXT = {
      questionId: q.id,
      statement: q.statement,
      topic: q.topic,
      exam: q.exam,
      year: q.year,
      examId: q.examId,
      source: sourceStr,
      meta: meta
    };
    el.feedback.hidden = true;
    el.feedbackResult.classList.remove("is-correct", "is-wrong");
    clearFeedbackExtras();
    clearOxReveal(el.qActions);
    if (el.btnQuizFavorite) el.btnQuizFavorite.hidden = true;
    setOxDisabled(false);
  }

  function buildDetailBlocks(container, detail) {
    container.innerHTML = "";
    if (!detail) return;
    function stripHeadLabel(text, labels) {
      var t = String(text || "").trim();
      if (!t) return "";
      for (var i = 0; i < labels.length; i++) {
        var esc = labels[i].replace(/\s+/g, "\\s*");
        var re = new RegExp("^" + esc + "\\s*[:：-]?\\s*", "i");
        t = t.replace(re, "").trim();
      }
      return t;
    }

    function normalizedText(raw) {
      var s = String(raw || "").trim();
      if (!s) return "";
      // 라벨 표기를 통일
      s = s.replace(/법리\s*근거\s*[:：-]?\s*/gi, "법리 근거: ");
      s = s.replace(/함정\s*포인트\s*[:：-]?\s*/gi, "함정 포인트: ");
      s = s.replace(/판례\s*요지\s*[:：-]?\s*/gi, "판례: ");
      s = s.replace(/판례\s*[:：-]?\s*/gi, "판례: ");
      // 라벨 중복 제거 (예: "법리 근거: 법리 근거:")
      s = s.replace(/(법리 근거:\s*){2,}/gi, "법리 근거: ");
      s = s.replace(/(함정 포인트:\s*){2,}/gi, "함정 포인트: ");
      s = s.replace(/(판례:\s*){2,}/gi, "판례: ");
      // 각 라벨 앞에는 문단 경계를 강제
      s = s.replace(/\s*(법리 근거:\s*)/gi, "\n\n$1");
      s = s.replace(/\s*(함정 포인트:\s*)/gi, "\n\n$1");
      s = s.replace(/\s*(판례:\s*)/gi, "\n\n$1");
      return s.replace(/^\s+/, "").trim();
    }

    var merged = "";
    if (typeof detail === "string") {
      merged = normalizedText(detail);
    } else if (typeof detail === "object") {
      var parts = [];
      if (detail.legal != null && String(detail.legal).trim()) {
        parts.push(
          "법리 근거: " +
            stripHeadLabel(String(detail.legal), ["법리 근거", "법리"])
        );
      }
      if (detail.trap != null && String(detail.trap).trim()) {
        parts.push(
          "함정 포인트: " +
            stripHeadLabel(String(detail.trap), ["함정 포인트", "함정"])
        );
      }
      if (detail.precedent != null && String(detail.precedent).trim()) {
        parts.push(
          "판례: " +
            stripHeadLabel(String(detail.precedent), ["판례 요지", "판례"])
        );
      }
      merged = normalizedText(parts.join("\n\n"));
    }
    if (!merged) return;

    var wrap = document.createElement("div");
    wrap.className = "feedback-detail__block";
    var p = document.createElement("p");
    p.className = "feedback-detail__text";
    p.textContent = merged;
    wrap.appendChild(p);
    container.appendChild(wrap);
  }

  function renderTags(container, tags) {
    container.innerHTML = "";
    if (!tags || !tags.length) return;
    for (var i = 0; i < tags.length; i++) {
      var label = String(tags[i] || "").trim();
      if (!label) continue;
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "feedback-tag feedback-tag--link";
      btn.setAttribute("data-tag", label);
      btn.setAttribute("aria-label", label + " 사전에서 보기");
      btn.textContent = "#" + label;
      container.appendChild(btn);
    }
  }

  function startQuiz() {
    var filtered = filterQuestions();
    if (filtered.length === 0) {
      alert(
        "선택한 시험·연도·주제에 해당하는 문항이 없습니다. 왼쪽 사이드바에서 시험·연도를 켜 주세요. 엑셀/Firestore 문항은 examId(예: lawyer, grade9)와 year(숫자)가 여기서 선택한 범위와 같아야 퀴즈에 나옵니다."
      );
      return;
    }
    state.lastFilterTopic = el.filterTopic.value;
    state.lastOrderMode = getOrderMode();
    state.lastCount = el.questionCount.value;
    var list = applyQuestionOrder(filtered, state.lastOrderMode);
    var cap = parseInt(el.questionCount.value, 10);
    if (cap > 0 && list.length > cap) {
      list = list.slice(0, cap);
    }
    state.list = list;
    state.index = 0;
    state.correct = 0;
    state.sinceReviewCount = 0;
    state.reviewModalQuestion = null;
    showScreen("quiz");
    renderQuestion();
  }

  function onAnswer(userTrue) {
    var q = state.list[state.index];
    var ok = userTrue === q.answer;
    if (ok) state.correct++;
    el.feedback.hidden = false;
    el.feedbackResult.textContent = ok ? "정답입니다." : "오답입니다.";
    el.feedbackResult.classList.add(ok ? "is-correct" : "is-wrong");

    applyOxReveal(el.qActions, userTrue, q.answer);
    fillExplainPanel(
      {
        answerKey: el.feedbackAnswerKey,
        importanceLine: el.feedbackImportanceLine,
        difficultyLine: el.feedbackDifficultyLine,
        explain: el.feedbackExplain,
        detail: el.feedbackDetail,
        tags: el.feedbackTags
      },
      q
    );

    setOxDisabled(true);
    el.score.textContent = "정답 " + state.correct;
    if (window.LearningStats && typeof window.LearningStats.recordQuizAnswer === "function") {
      window.LearningStats.recordQuizAnswer(q.topic, ok);
    }
    if (
      q.id &&
      window.QuizReviewStore &&
      typeof window.QuizReviewStore.recordAnswer === "function"
    ) {
      var rr = window.QuizReviewStore.recordAnswer(q.id, ok, "main");
      if (rr && rr.mastered && el.feedbackMaster) {
        el.feedbackMaster.textContent = "이 문제를 마스터하셨습니다. 축하합니다!";
        el.feedbackMaster.hidden = false;
      }
    }
    if (typeof window.refreshQuizFavoriteButton === "function") {
      window.refreshQuizFavoriteButton();
    }
    window.__HANLAW_QUIZ_AI_CONTEXT = buildQuizAiContext(q, userTrue);
    afterQuizAnswerTryAttendance(false);
  }

  function setReviewOxDisabled(disabled) {
    var box = document.getElementById("review-q-actions");
    if (!box) return;
    box.querySelectorAll(".btn--ox").forEach(function (b) {
      b.disabled = disabled;
    });
  }

  function showAttendanceFeedback(data, useReviewPanel) {
    if (!data || !data.pointsAwarded) return;
    var rest = data.attendancePoints != null ? data.attendancePoints : 0;
    var msg =
      "오늘 출석이 반영되었습니다. 출석 포인트 +" +
      data.pointsAwarded +
      "점 (잔여 " +
      rest +
      "점)";
    var node = useReviewPanel
      ? document.getElementById("review-q-attendance-notify")
      : el.feedbackAttendanceNotify;
    if (node) {
      node.textContent = msg;
      node.hidden = false;
    }
  }

  function afterQuizAnswerTryAttendance(useReviewModal) {
    try {
      if (typeof firebase === "undefined" || !firebase.auth) return;
      if (!firebase.auth().currentUser) return;
      if (typeof window.recordQuizAttendanceCallable !== "function") return;
      window
        .recordQuizAttendanceCallable()
        .then(function (data) {
          if (data && data.pointsAwarded > 0) {
            showAttendanceFeedback(data, useReviewModal);
          }
        })
        .catch(function () {});
    } catch (err) {}
  }

  function findQuestionById(qid) {
    var bank = getBank();
    for (var i = 0; i < bank.length; i++) {
      if (bank[i].id === qid) return bank[i];
    }
    return null;
  }

  function openReviewQuizModal(qid) {
    var q = findQuestionById(qid);
    if (!q) {
      state.index++;
      renderQuestion();
      return;
    }
    state.reviewModalQuestion = q;
    var modal = document.getElementById("review-quiz-modal");
    var hist = document.getElementById("review-quiz-history");
    var qs = document.getElementById("review-q-source");
    var qm = document.getElementById("review-q-meta");
    var qt = document.getElementById("review-q-text");
    var fb = document.getElementById("review-q-feedback");
    var masterEl = document.getElementById("review-q-master");
    if (!modal || !qt) return;

    if (hist && window.QuizReviewStore && window.QuizReviewStore.buildHistorySummaryHtml) {
      var attempts = window.QuizReviewStore.getAttempts(q.id);
      hist.innerHTML = window.QuizReviewStore.buildHistorySummaryHtml(attempts);
    }
    var sourceStr = formatQuizSource(q);
    if (qs) {
      qs.textContent = sourceStr ? "출처: " + sourceStr : "";
      qs.hidden = !sourceStr;
    }
    var meta = q.topic || "—";
    if (q.importance) meta += " · 중요도 " + starsLine(q.importance);
    if (q.difficulty) meta += " · 난이도 " + starsLine(q.difficulty);
    if (qm) qm.textContent = meta;
    qt.textContent = q.statement;
    if (fb) {
      fb.hidden = true;
      var res = document.getElementById("review-q-result");
      var ak = document.getElementById("review-q-answer-key");
      var ex = document.getElementById("review-q-explain");
      var ril = document.getElementById("review-q-importance-line");
      var rdl = document.getElementById("review-q-difficulty-line");
      var rdet = document.getElementById("review-q-detail");
      var rtg = document.getElementById("review-q-tags");
      if (res) {
        res.textContent = "";
        res.classList.remove("is-correct", "is-wrong");
      }
      if (ak) {
        ak.textContent = "";
        ak.hidden = true;
      }
      if (ex) ex.textContent = "";
      if (ril) ril.textContent = "";
      if (rdl) rdl.textContent = "";
      if (rdet) rdet.innerHTML = "";
      if (rtg) rtg.innerHTML = "";
    }
    clearOxReveal(document.getElementById("review-q-actions"));
    if (masterEl) {
      masterEl.textContent = "";
      masterEl.hidden = true;
    }
    var attN = document.getElementById("review-q-attendance-notify");
    if (attN) {
      attN.textContent = "";
      attN.hidden = true;
    }
    if (window.QuizAiAsk && typeof window.QuizAiAsk.resetReview === "function") {
      window.QuizAiAsk.resetReview();
    }
    setReviewOxDisabled(false);
    modal.hidden = false;
    modal.setAttribute("aria-hidden", "false");
  }

  function closeReviewQuizModalAndAdvanceMain() {
    var modal = document.getElementById("review-quiz-modal");
    if (modal) {
      modal.hidden = true;
      modal.setAttribute("aria-hidden", "true");
    }
    state.reviewModalQuestion = null;
    if (state.index + 1 >= state.list.length) {
      var total = state.list.length;
      var c = state.correct;
      el.resultSummary.textContent =
        "총 " + total + "문항 중 " + c + "문항을 맞혔습니다. (" +
        Math.round((c / total) * 100) + "%)";
      showScreen("result");
      return;
    }
    state.index++;
    renderQuestion();
  }

  function onReviewModalAnswer(userTrue) {
    var q = state.reviewModalQuestion;
    if (!q) return;
    var ok = userTrue === q.answer;
    var res = document.getElementById("review-q-result");
    var ak = document.getElementById("review-q-answer-key");
    var ex = document.getElementById("review-q-explain");
    var fb = document.getElementById("review-q-feedback");
    var masterEl = document.getElementById("review-q-master");
    var hist = document.getElementById("review-quiz-history");

    if (res) {
      res.textContent = ok ? "정답입니다." : "오답입니다.";
      res.classList.remove("is-correct", "is-wrong");
      res.classList.add(ok ? "is-correct" : "is-wrong");
    }
    var reviewActions = document.getElementById("review-q-actions");
    applyOxReveal(reviewActions, userTrue, q.answer);
    fillExplainPanel(
      {
        answerKey: ak,
        importanceLine: document.getElementById("review-q-importance-line"),
        difficultyLine: document.getElementById("review-q-difficulty-line"),
        explain: ex,
        detail: document.getElementById("review-q-detail"),
        tags: document.getElementById("review-q-tags")
      },
      q
    );

    var mastered = false;
    if (window.QuizReviewStore && typeof window.QuizReviewStore.recordAnswer === "function") {
      var rr = window.QuizReviewStore.recordAnswer(q.id, ok, "review");
      mastered = rr && rr.mastered;
      if (hist && window.QuizReviewStore.buildHistorySummaryHtml) {
        var attempts = window.QuizReviewStore.getAttempts(q.id);
        hist.innerHTML = window.QuizReviewStore.buildHistorySummaryHtml(attempts);
      }
    }
    if (masterEl) {
      if (mastered) {
        masterEl.textContent = "이 문제를 마스터하셨습니다. 축하합니다!";
        masterEl.hidden = false;
      } else {
        masterEl.textContent = "";
        masterEl.hidden = true;
      }
    }
    if (window.LearningStats && typeof window.LearningStats.recordQuizAnswer === "function") {
      window.LearningStats.recordQuizAnswer(q.topic, ok);
    }
    window.__HANLAW_QUIZ_AI_CONTEXT = buildQuizAiContext(q, userTrue);
    setReviewOxDisabled(true);
    if (fb) fb.hidden = false;
    afterQuizAnswerTryAttendance(true);
  }

  function nextOrFinish() {
    if (state.index + 1 >= state.list.length) {
      var total = state.list.length;
      var c = state.correct;
      el.resultSummary.textContent =
        "총 " + total + "문항 중 " + c + "문항을 맞혔습니다. (" +
        Math.round((c / total) * 100) + "%)";
      showScreen("result");
      return;
    }

    var QRS = window.QuizReviewStore;
    if (QRS && typeof QRS.isEnabled === "function" && QRS.isEnabled()) {
      state.sinceReviewCount = (state.sinceReviewCount || 0) + 1;
      if (state.sinceReviewCount >= 5) {
        var ids = state.list.map(function (x) {
          return x.id;
        });
        var nextId =
          typeof QRS.pickNextReviewId === "function" ? QRS.pickNextReviewId(ids) : null;
        if (nextId) {
          state.sinceReviewCount = 0;
          openReviewQuizModal(nextId);
          return;
        }
        state.sinceReviewCount = 0;
      }
    }

    state.index++;
    renderQuestion();
  }

  function retrySame() {
    el.filterTopic.value = state.lastFilterTopic;
    el.questionCount.value = state.lastCount;
    var mode = state.lastOrderMode || "random";
    if (mode === "importance") mode = "importance_desc";
    if (mode === "difficulty") mode = "difficulty_asc";
    var radio = document.querySelector('input[name="opt-order"][value="' + mode + '"]');
    if (radio) radio.checked = true;
    startQuiz();
  }

  function goHome() {
    showScreen("start");
  }

  el.btnStart.addEventListener("click", startQuiz);
  el.qActions.addEventListener("click", function (e) {
    var btn = e.target.closest(".btn--ox");
    if (!btn || btn.disabled) return;
    var v = btn.getAttribute("data-answer");
    onAnswer(v === "true");
  });
  el.btnNext.addEventListener("click", nextOrFinish);
  el.btnRetry.addEventListener("click", retrySame);
  el.btnHome.addEventListener("click", goHome);

  if (el.optAutoReview && window.QuizReviewStore) {
    el.optAutoReview.checked = window.QuizReviewStore.isEnabled();
    el.optAutoReview.addEventListener("change", function () {
      window.QuizReviewStore.setEnabled(el.optAutoReview.checked);
    });
  }

  (function bindReviewModal() {
    var modal = document.getElementById("review-quiz-modal");
    var actions = document.getElementById("review-q-actions");
    var cont = document.getElementById("review-q-continue");
    var closeBtn = document.getElementById("review-quiz-modal-close");
    if (actions) {
      actions.addEventListener("click", function (e) {
        var btn = e.target.closest("[data-review-answer]");
        if (!btn || btn.disabled) return;
        var v = btn.getAttribute("data-review-answer");
        onReviewModalAnswer(v === "true");
      });
    }
    if (cont) {
      cont.addEventListener("click", function () {
        closeReviewQuizModalAndAdvanceMain();
      });
    }
    if (modal) {
      modal.addEventListener("click", function (e) {
        if (e.target === modal) {
          var fb = document.getElementById("review-q-feedback");
          if (fb && !fb.hidden) closeReviewQuizModalAndAdvanceMain();
        }
      });
    }
    if (closeBtn) {
      closeBtn.addEventListener("click", function () {
        var fb = document.getElementById("review-q-feedback");
        if (fb && !fb.hidden) {
          closeReviewQuizModalAndAdvanceMain();
        } else {
          if (modal) {
            modal.hidden = true;
            modal.setAttribute("aria-hidden", "true");
          }
          state.reviewModalQuestion = null;
          if (state.index + 1 >= state.list.length) {
            var total = state.list.length;
            var c = state.correct;
            el.resultSummary.textContent =
              "총 " + total + "문항 중 " + c + "문항을 맞혔습니다. (" +
              Math.round((c / total) * 100) + "%)";
            showScreen("result");
            return;
          }
          state.index++;
          renderQuestion();
        }
      });
    }
  })();

  window.addEventListener("study-scope-change", initFilters);

  function syncBankUi() {
    if (!getBank().length) {
      el.btnStart.disabled = true;
      el.btnStart.textContent = "문항 데이터 없음";
    } else {
      el.btnStart.disabled = false;
      el.btnStart.textContent = "퀴즈 시작";
      initFilters();
    }
  }

  window.addEventListener("question-bank-updated", syncBankUi);

  syncBankUi();
})();
