(function () {
  var ALL = "전체";
  var GUEST_PUBLIC_LIMIT = 5;
  function isAdsenseOpenMode() {
    return !!window.HANLAW_ADSENSE_OPEN_MODE;
  }

  function guestQuizLimit() {
    return isAdsenseOpenMode() ? Number.MAX_SAFE_INTEGER : GUEST_PUBLIC_LIMIT;
  }


  function getBank() {
    return window.QUESTION_BANK || [];
  }

  /** Firebase User에 email이 비어 있는 경우(providerData)까지 확인 */
  function getHanlawUserEmailForAdmin() {
    var u = typeof window.getHanlawUser === "function" ? window.getHanlawUser() : null;
    if (u && u.email) return String(u.email).toLowerCase().trim();
    try {
      if (typeof firebase !== "undefined" && firebase.auth && firebase.auth().currentUser) {
        var cu = firebase.auth().currentUser;
        if (cu.email) return String(cu.email).toLowerCase().trim();
        if (cu.providerData && cu.providerData.length) {
          for (var i = 0; i < cu.providerData.length; i++) {
            var em = cu.providerData[i] && cu.providerData[i].email;
            if (em) return String(em).toLowerCase().trim();
          }
        }
      }
    } catch (e) {}
    return "";
  }

  function isAdminUser() {
    var mail = getHanlawUserEmailForAdmin();
    if (!mail) return false;
    var emails = window.ADMIN_EMAILS || [];
    for (var i = 0; i < emails.length; i++) {
      if (String(emails[i]).toLowerCase() === mail) return true;
    }
    return false;
  }

  function syncQuizAdminEditVisibility() {
    if (!el.quiz || el.quiz.hidden) return;
    var adminEditBtn = ensureQuizAdminEditButton();
    var adminOn = isAdminUser();
    if (adminEditBtn) adminEditBtn.hidden = !adminOn;
    if (el.btnQuizAdminEditFeedback) el.btnQuizAdminEditFeedback.hidden = !adminOn;
    if (el.quizAdminEditor && !adminOn) el.quizAdminEditor.hidden = true;
  }

  /** 이메일 로그인(또는 동일한 수준의 식별) — 익명 세션은 비로그인 UI */
  function isViewerLoggedIn() {
    var u = typeof window.getHanlawUser === "function" ? window.getHanlawUser() : null;
    return !!(u && u.email);
  }

  function isGuestFullQuizPreview() {
    return !isViewerLoggedIn() && state && typeof state.index === "number" && state.index < guestQuizLimit();
  }

  var el = {
    start: document.getElementById("screen-start"),
    quiz: document.getElementById("screen-quiz"),
    result: document.getElementById("screen-result"),
    filterTopicL1: document.getElementById("filter-topic-l1"),
    filterTopicL2: document.getElementById("filter-topic-l2"),
    filterTopic: document.getElementById("filter-topic"),
    filterTopicSearch: document.getElementById("filter-topic-search"),
    questionCount: document.getElementById("question-count"),
    questionCountCustom: document.getElementById("question-count-custom"),
    btnStart: document.getElementById("btn-start"),
    btnStartFull: document.getElementById("btn-start-full"),
    btnStartFullBottom: document.getElementById("btn-start-full-bottom"),
    btnOpenSetup: document.getElementById("btn-open-setup"),
    btnOpenSetupBottom: document.getElementById("btn-open-setup-bottom"),
    setupAnchorTop: document.getElementById("setup-anchor-top"),
    setupAnchorBottom: document.getElementById("setup-anchor-bottom"),
    setupConfigWrap: document.getElementById("setup-config-wrap"),
    progress: document.getElementById("quiz-progress"),
    quizTimerPanel: document.getElementById("quiz-timer-panel"),
    quizTimerArcadeFill: document.getElementById("quiz-timer-arcade-fill"),
    quizTimerBarTrack: document.getElementById("quiz-timer-bar-track"),
    quizTimerMeta: document.getElementById("quiz-timer-meta"),
    score: document.getElementById("quiz-score"),
    quizGuestHintTop: document.getElementById("quiz-guest-hint-top"),
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
    btnQuizMaster: document.getElementById("btn-quiz-master"),
    btnNext: document.getElementById("btn-next"),
    quizNavBottomRow: document.querySelector("#screen-quiz .quiz-nav-bottom-row"),
    btnQuizPrevBottom: document.getElementById("btn-quiz-prev-bottom"),
    btnQuizNavPrev: document.getElementById("btn-quiz-nav-prev"),
    btnQuizNavNext: document.getElementById("btn-quiz-nav-next"),
    resultSummary: document.getElementById("result-summary"),
    btnRetry: document.getElementById("btn-retry"),
    btnHome: document.getElementById("btn-home"),
    feedbackMaster: document.getElementById("feedback-master"),
    feedbackAttendanceNotify: document.getElementById("feedback-attendance-notify"),
    feedbackGuestHint: document.getElementById("feedback-guest-hint"),
    feedbackTagsSection: document.getElementById("feedback-tags-section"),
    btnQuizAdminEdit: document.getElementById("btn-quiz-admin-edit"),
    btnQuizAdminEditFeedback: document.getElementById("btn-quiz-admin-edit-feedback"),
    quizAdminEditor: null,
    quizMemoSection: document.getElementById("quiz-memo-section"),
    quizMemoBody: document.getElementById("quiz-memo-body"),
    quizMemoPanelToggle: document.getElementById("quiz-memo-panel-toggle"),
    quizMemoText: document.getElementById("quiz-memo-text"),
    quizMemoCanvas: document.getElementById("quiz-memo-canvas"),
    quizMemoTextWrap: document.getElementById("quiz-memo-text-wrap"),
    quizMemoDrawWrap: document.getElementById("quiz-memo-draw-wrap"),
    quizMemoSave: document.getElementById("quiz-memo-save"),
    quizMemoMsg: document.getElementById("quiz-memo-msg"),
    quizMemoClearCanvas: document.getElementById("quiz-memo-clear-canvas"),
    quizMemoPanToggle: document.getElementById("quiz-memo-pan-toggle"),
    quizMemoEditDraw: document.getElementById("quiz-memo-edit-draw")
  };

  var quizMemoCanvasCtl = null;
  var quizMemoPanMode = false;
  var quizQuestionTimerId = null;
  var quizTimerTotalMs = 0;

  /** 상세 해설: detail.body 우선, 없으면 구버전 legal/trap/precedent를 한 덩어리로 편집용 병합 */
  function mergeLegacyDetailToText(d) {
    if (!d || typeof d !== "object") return "";
    if (d.body != null) {
      var b = String(d.body).replace(/\r\n/g, "\n");
      if (b.trim()) return b;
    }
    var parts = [];
    if (String(d.legal || "").trim()) parts.push("법리 근거: " + String(d.legal).trim());
    if (String(d.trap || "").trim()) parts.push("함정 포인트: " + String(d.trap).trim());
    if (String(d.precedent || "").trim()) parts.push("판례: " + String(d.precedent).trim());
    return parts.join("\n\n");
  }

  var QUIZ_ADMIN_EDITOR_VER = 4;

  function ensureQuizAdminEditButton() {
    if (
      window.__hanlawQuizAdminEditInited &&
      window.__hanlawQuizAdminEditorVer === QUIZ_ADMIN_EDITOR_VER
    ) {
      return el.btnQuizAdminEdit;
    }
    if (window.__hanlawQuizAdminEditInited) {
      var oldEd = document.getElementById("quiz-admin-editor");
      if (oldEd && oldEd.parentNode) oldEd.parentNode.removeChild(oldEd);
      window.__hanlawQuizAdminEditInited = false;
    }
    var btn = el.btnQuizAdminEdit || document.getElementById("btn-quiz-admin-edit");
    if (!btn || !el.qMeta || !el.qMeta.parentNode) return null;
    el.btnQuizAdminEdit = btn;
    var editor = document.createElement("section");
    editor.id = "quiz-admin-editor";
    editor.className = "quiz-admin-editor";
    editor.hidden = true;
    editor.innerHTML =
      '<label class="field"><span class="field__label">문제 본문</span><textarea id="quiz-admin-statement" class="input textarea" rows="3"></textarea></label>' +
      '<label class="field"><span class="field__label">정답</span><select id="quiz-admin-answer" class="select"><option value="true">O(참)</option><option value="false">X(거짓)</option></select></label>' +
      '<label class="field"><span class="field__label">해설</span><textarea id="quiz-admin-explanation" class="input textarea" rows="3"></textarea></label>' +
      '<label class="field"><span class="field__label">기본 해설 (필수)</span><textarea id="quiz-admin-explanation-basic" class="input textarea" rows="3"></textarea></label>' +
      '<label class="field"><span class="field__label">상세 해설 (선택 · 자유 형식)</span><textarea id="quiz-admin-detail-body" class="input textarea" rows="6" placeholder="법리·함정·판례 등 형식 제한 없이 작성"></textarea></label>' +
      '<label class="field"><span class="field__label">중요도(1~5)</span><input id="quiz-admin-importance" type="number" min="1" max="5" class="input" /></label>' +
      '<label class="field"><span class="field__label">난이도(1~5)</span><input id="quiz-admin-difficulty" type="number" min="1" max="5" class="input" /></label>' +
      '<label class="field"><span class="field__label">태그(쉼표 구분)</span><input id="quiz-admin-tags" type="text" class="input" /></label>' +
      '<div class="quiz-admin-editor__actions"><button type="button" id="quiz-admin-save" class="btn btn--secondary btn--small">저장</button><button type="button" id="quiz-admin-cancel" class="btn btn--outline btn--small">닫기</button></div>' +
      '<p id="quiz-admin-msg" class="settings-dday-msg" hidden role="status"></p>';
    var insertAnchor =
      btn.parentNode &&
      btn.parentNode.classList &&
      btn.parentNode.classList.contains("quiz-admin-edit-toolbar")
        ? btn.parentNode
        : btn;
    el.qMeta.parentNode.insertBefore(editor, insertAnchor.nextSibling);
    el.quizAdminEditor = editor;
    window.__hanlawQuizAdminEditInited = true;
    window.__hanlawQuizAdminEditorVer = QUIZ_ADMIN_EDITOR_VER;

    function setEditorMsg(text, isError) {
      var m = document.getElementById("quiz-admin-msg");
      if (!m) return;
      m.textContent = text || "";
      m.hidden = !text;
      m.style.color = isError ? "var(--danger)" : "var(--muted)";
    }

    function fillEditorFromQuestion(q) {
      if (!q) return;
      document.getElementById("quiz-admin-statement").value = q.statement || "";
      document.getElementById("quiz-admin-answer").value = q.answer === false ? "false" : "true";
      document.getElementById("quiz-admin-explanation").value = q.explanation || "";
      document.getElementById("quiz-admin-explanation-basic").value = q.explanationBasic || "";
      var d = q.detail || {};
      document.getElementById("quiz-admin-detail-body").value = mergeLegacyDetailToText(d);
      document.getElementById("quiz-admin-importance").value =
        q.importance != null ? String(q.importance) : "";
      document.getElementById("quiz-admin-difficulty").value =
        q.difficulty != null ? String(q.difficulty) : "";
      document.getElementById("quiz-admin-tags").value =
        Array.isArray(q.tags) ? q.tags.join(", ") : "";
      setEditorMsg("", false);
    }

    function openQuizAdminEditor() {
      var q = state.list[state.index];
      if (!q || !isAdminUser()) return;
      fillEditorFromQuestion(q);
      editor.hidden = false;
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          try {
            editor.scrollIntoView({ behavior: "smooth", block: "start", inline: "nearest" });
          } catch (err) {
            editor.scrollIntoView(true);
          }
        });
      });
    }
    btn.addEventListener("click", openQuizAdminEditor);
    if (el.btnQuizAdminEditFeedback) {
      el.btnQuizAdminEditFeedback.addEventListener("click", openQuizAdminEditor);
    }
    var btnCancel = document.getElementById("quiz-admin-cancel");
    if (btnCancel) {
      btnCancel.addEventListener("click", function () {
        editor.hidden = true;
      });
    }
    var btnSave = document.getElementById("quiz-admin-save");
    if (btnSave) {
      btnSave.addEventListener("click", function () {
        var q = state.list[state.index];
        if (!q || !isAdminUser()) return;
        if (typeof window.saveQuestionToFirestore !== "function") {
          setEditorMsg("저장 함수를 찾지 못했습니다.", true);
          return;
        }
        var statement = String(document.getElementById("quiz-admin-statement").value || "").trim();
        var explanation = String(document.getElementById("quiz-admin-explanation").value || "").trim();
        var explanationBasic = String(
          document.getElementById("quiz-admin-explanation-basic").value || ""
        )
          .replace(/\r\n/g, "\n")
          .trim();
        var detailBodyRaw = String(
          document.getElementById("quiz-admin-detail-body").value || ""
        ).replace(/\r\n/g, "\n");
        var detailBodyHas = detailBodyRaw.trim().length > 0;
        if (!statement || !explanation) {
          setEditorMsg("문제 본문과 해설은 필수입니다.", true);
          return;
        }
        if (!explanationBasic) {
          setEditorMsg("기본 해설은 필수입니다.", true);
          return;
        }
        var tagsRaw = String(document.getElementById("quiz-admin-tags").value || "").trim();
        var tags = tagsRaw
          ? tagsRaw
              .split(",")
              .map(function (x) {
                return String(x || "").trim();
              })
              .filter(Boolean)
          : [];
        var impRaw = String(document.getElementById("quiz-admin-importance").value || "").trim();
        var diffRaw = String(document.getElementById("quiz-admin-difficulty").value || "").trim();
        var payload = Object.assign({}, q, {
          statement: statement,
          explanation: explanation,
          explanationBasic: explanationBasic,
          answer: document.getElementById("quiz-admin-answer").value === "true"
        });
        delete payload.detail;
        if (detailBodyHas) payload.detail = { body: detailBodyRaw };
        var saveOpts = { clearDetail: !detailBodyHas };
        if (impRaw) payload.importance = parseInt(impRaw, 10);
        else delete payload.importance;
        if (diffRaw) payload.difficulty = parseInt(diffRaw, 10);
        else delete payload.difficulty;
        if (tags.length) payload.tags = tags;
        else delete payload.tags;
        setEditorMsg("저장 중…", false);
        window
          .saveQuestionToFirestore(payload, saveOpts)
          .then(function () {
            resyncCurrentQuestionRefFromBank();
            setEditorMsg("저장되었습니다.", false);
            editor.hidden = true;
            renderQuestion();
          })
          .catch(function (e) {
            setEditorMsg((e && e.message) || "문항 수정 실패", true);
          });
      });
    }
    return el.btnQuizAdminEdit;
  }

  var state = {
    list: [],
    index: 0,
    correct: 0,
    lastFilterTopicL1: ALL,
    lastFilterTopicL2: ALL,
    lastFilterTopic: ALL,
    lastFilterTopicSearch: "",
    lastSequenceMode: "random",
    lastNotebookScope: { wrong: false, fav: false, master: false },
    lastCount: "0",
    lastQuestionCountCustom: "",
    /** index → { userTrue } — 뒤로 가기 시 해설 복원용 */
    sessionAnswers: {},
    suppressQuizUrlSync: false
  };
  var SEO_DEFAULT_TITLE = "행정법Q";
  var SEO_DEFAULT_DESC =
    "변호사가 직접 만든 행정법 학습 앱. 실전형 OX 퀴즈, 핵심 해설, 판례·조문·용어사전을 제공합니다.";

  function appOrigin() {
    return window.location.origin || "https://adminlawq-b9dad.web.app";
  }

  function ensureHeadMetaByName(name) {
    var selector = 'meta[name="' + name + '"]';
    var m = document.head.querySelector(selector);
    if (!m) {
      m = document.createElement("meta");
      m.setAttribute("name", name);
      document.head.appendChild(m);
    }
    return m;
  }

  function ensureCanonicalLink() {
    var c = document.head.querySelector('link[rel="canonical"]');
    if (!c) {
      c = document.createElement("link");
      c.setAttribute("rel", "canonical");
      document.head.appendChild(c);
    }
    return c;
  }

  function updateSeoForQuizQuestion(q) {
    if (!q) return;
    var qid = normalizeQuestionId(q.id);
    if (!qid) return;
    var topic = String(q.topic || "행정법 퀴즈").trim();
    var statement = String(q.statement || "").replace(/\s+/g, " ").trim();
    var shortStmt = statement.length > 90 ? statement.slice(0, 90) + "…" : statement;
    document.title = topic + " 퀴즈 | 행정법Q";
    ensureHeadMetaByName("description").setAttribute(
      "content",
      "행정법Q " + topic + " 문제: " + shortStmt
    );
    ensureCanonicalLink().setAttribute("href", appOrigin() + "/quiz/" + encodeURIComponent(qid));
  }

  function resetSeoToDefault() {
    document.title = SEO_DEFAULT_TITLE;
    ensureHeadMetaByName("description").setAttribute("content", SEO_DEFAULT_DESC);
    ensureCanonicalLink().setAttribute("href", appOrigin() + "/");
  }

  function normalizeQuestionId(raw) {
    return String(raw == null ? "" : raw).trim();
  }

  function normalizeExplainText(raw) {
    return String(raw == null ? "" : raw).replace(/\r\n/g, "\n").trim();
  }

  function sentenceWithPeriod(text) {
    var s = normalizeExplainText(text);
    if (!s) return "";
    if (/[.!?]$/.test(s) || /[다요]$/.test(s)) return s;
    return s + ".";
  }

  function pickDefaultImportance(q) {
    var topic = normalizeExplainText(q && q.topic);
    if (!topic) return 3;
    if (topic.indexOf("행정소송") >= 0 || topic.indexOf("행정행위") >= 0) return 4;
    return 3;
  }

  function pickDefaultDifficulty(q) {
    var stmt = normalizeExplainText(q && q.statement);
    if (!stmt) return 3;
    if (/항상|반드시|전혀|언제나/.test(stmt)) return 3;
    return 2;
  }

  function hasDetailContent(detail) {
    if (!detail) return false;
    if (typeof detail === "string") return normalizeExplainText(detail).length > 0;
    if (typeof detail !== "object") return false;
    if (normalizeExplainText(detail.body).length > 0) return true;
    if (normalizeExplainText(detail.legal).length > 0) return true;
    if (normalizeExplainText(detail.trap).length > 0) return true;
    if (normalizeExplainText(detail.precedent).length > 0) return true;
    return false;
  }

  function buildAutoDetailBody(q) {
    var statement = normalizeExplainText(q && q.statement);
    var explanation = sentenceWithPeriod(q && q.explanation);
    var topic = normalizeExplainText(q && q.topic) || "행정법 일반";
    var answerText = q && q.answer === true ? "O(참)" : "X(거짓)";
    var lines = [];
    lines.push("정답 판단");
    lines.push("이 문항의 정답은 " + answerText + "입니다.");
    if (explanation) {
      lines.push("기본 법리");
      lines.push(explanation);
    } else if (statement) {
      lines.push("기본 법리");
      lines.push("지문의 표현을 법령 체계와 판례 기준에 비추어 해석하면 정답을 도출할 수 있습니다.");
    } else {
      lines.push("기본 법리");
      lines.push("해당 문항은 행정법 기본 원리에 따라 정답을 판단해야 합니다.");
    }
    lines.push("답안 작성 포인트");
    lines.push(
      topic +
        " 영역에서는 결론만 암기하기보다 적용 요건, 예외, 관련 판례 태도를 함께 정리해 두는 것이 안전합니다."
    );
    lines.push("오답 방지 포인트");
    if (q && q.answer === false) {
      lines.push("지문에 절대적 표현(항상, 반드시, 전혀, 언제나)이 포함된 경우에는 예외 규정 존재 여부를 먼저 확인하시기 바랍니다.");
    } else {
      lines.push("정답 지문이라도 적용 요건과 한계를 함께 정리해 두어야 사례형 문제에서 결론을 안정적으로 도출할 수 있습니다.");
    }
    return lines.join("\n\n");
  }

  function buildAutoBasicExplain(q) {
    var topic = normalizeExplainText(q && q.topic) || "행정법 일반";
    var explanation = sentenceWithPeriod(q && q.explanation);
    if (explanation && explanation.length >= 25) return explanation;
    var answerText = q && q.answer === true ? "옳은 설명" : "틀린 설명";
    return (
      "이 문항은 " +
      topic +
      " 쟁점에서 " +
      answerText +
      "에 해당합니다. 결론만 암기하기보다 적용 요건과 예외를 함께 정리해 두셔야 변형 문제에도 안정적으로 대응할 수 있습니다."
    );
  }

  function enrichQuestionForDisplay(raw) {
    if (!raw || typeof raw !== "object") return raw;
    var explanation = normalizeExplainText(raw.explanation);
    var explanationBasic = normalizeExplainText(raw.explanationBasic);
    var needBasic = !explanationBasic;
    var shortBasic = explanationBasic.length > 0 && explanationBasic.length < 25;
    var needDetail = !hasDetailContent(raw.detail);
    if (!needBasic && !shortBasic && !needDetail) return raw;
    var q = {};
    var k;
    for (k in raw) {
      if (Object.prototype.hasOwnProperty.call(raw, k)) q[k] = raw[k];
    }
    if (needBasic || shortBasic) q.explanationBasic = buildAutoBasicExplain(q);
    if (needDetail) {
      q.detail = { body: buildAutoDetailBody(q) };
    }
    if (q.importance == null || q.importance === "") q.importance = pickDefaultImportance(q);
    if (q.difficulty == null || q.difficulty === "") q.difficulty = pickDefaultDifficulty(q);
    return q;
  }

  function findQuestionInBankById(qid) {
    var id = normalizeQuestionId(qid);
    if (!id) return null;
    var bank = getBank();
    for (var i = 0; i < bank.length; i++) {
      if (normalizeQuestionId(bank[i] && bank[i].id) === id) return enrichQuestionForDisplay(bank[i]);
    }
    return null;
  }

  function parseQuizIdFromPath(pathname) {
    var m = String(pathname || "").match(/^\/quiz\/([^/?#]+)$/);
    if (!m || !m[1]) return "";
    try {
      return normalizeQuestionId(decodeURIComponent(m[1]));
    } catch (e) {
      return normalizeQuestionId(m[1]);
    }
  }

  function quizUrlForQuestion(q) {
    var qid = normalizeQuestionId(q && q.id);
    if (!qid) return "";
    return "/quiz/" + encodeURIComponent(qid);
  }

  function syncQuizUrl(replace) {
    if (state.suppressQuizUrlSync) return;
    var q = state.list && state.list[state.index];
    var nextPath = quizUrlForQuestion(q);
    if (!nextPath || window.location.pathname === nextPath) return;
    var fn = replace ? "replaceState" : "pushState";
    window.history[fn]({ hanlawQuizId: normalizeQuestionId(q.id) }, "", nextPath);
  }

  function resetQuizUrlIfNeeded() {
    if (!parseQuizIdFromPath(window.location.pathname)) return;
    window.history.replaceState({}, "", "/");
    resetSeoToDefault();
  }

  function openQuizFromUrl(qid) {
    var q = findQuestionInBankById(qid);
    if (!q) return false;
    state.list = [q];
    state.index = 0;
    state.correct = 0;
    state.sessionAnswers = {};
    if (typeof window.hanlawNavigateToPanel === "function") {
      window.hanlawNavigateToPanel("quiz");
    }
    showScreen("quiz");
    state.suppressQuizUrlSync = true;
    renderQuestion();
    state.suppressQuizUrlSync = false;
    syncQuizUrl(true);
    return true;
  }

  function bindQuizUrlRouting() {
    var initialQid = parseQuizIdFromPath(window.location.pathname);
    if (initialQid) {
      if (!openQuizFromUrl(initialQid)) {
        resetQuizUrlIfNeeded();
      }
    } else {
      resetSeoToDefault();
    }
    window.addEventListener("popstate", function () {
      var qid = parseQuizIdFromPath(window.location.pathname);
      if (!qid) return;
      var i;
      for (i = 0; i < state.list.length; i++) {
        if (normalizeQuestionId(state.list[i] && state.list[i].id) === qid) {
          state.index = i;
          state.suppressQuizUrlSync = true;
          renderQuestion();
          state.suppressQuizUrlSync = false;
          return;
        }
      }
      openQuizFromUrl(qid);
    });
  }

  /** 저장 후 mergeBanks로 QUESTION_BANK가 바뀌면 state.list 참조가 옛 객체를 가리킬 수 있음 → 동기 id로 교체 */
  function resyncCurrentQuestionRefFromBank() {
    var cur = state.list[state.index];
    if (!cur || cur.id == null || String(cur.id).trim() === "") return;
    var id = cur.id;
    var bank = getBank();
    for (var i = 0; i < bank.length; i++) {
      if (bank[i].id === id) {
        state.list[state.index] = enrichQuestionForDisplay(bank[i]);
        return;
      }
    }
  }

  function matchesScope(q) {
    var ex = String(q.examId || "")
      .trim()
      .toLowerCase();
    var sourceMode =
      typeof window.getStudyQuestionSource === "function"
        ? window.getStudyQuestionSource()
        : "past_only";
    if (sourceMode === "include_expected" && ex === "expected") {
      return true;
    }
    var exams = window.APP_SCOPE && window.APP_SCOPE.examIds;
    var ys = window.APP_SCOPE && window.APP_SCOPE.years;
    if (!Array.isArray(exams) || exams.length === 0) return false;
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

  function sortL1WithPriority(values) {
    var list = uniqueSorted(values);
    var top = "행정법총론(일반행정법)";
    list.sort(function (a, b) {
      if (a === top && b !== top) return -1;
      if (b === top && a !== top) return 1;
      return a.localeCompare(b, "ko");
    });
    return list;
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

  function isExcludedByMaster(q) {
    try {
      if (window.QuizMaster && typeof window.QuizMaster.has === "function") {
        return window.QuizMaster.has(q.id);
      }
    } catch (e) {}
    return false;
  }

  function getNotebookScopeSelections() {
    var w = document.getElementById("scope-note-wrong");
    var f = document.getElementById("scope-note-fav");
    var m = document.getElementById("scope-note-master");
    return {
      wrong: !!(w && w.checked),
      fav: !!(f && f.checked),
      master: !!(m && m.checked)
    };
  }

  function anyNotebookScopeActive(sel) {
    sel = sel || getNotebookScopeSelections();
    return !!(sel.wrong || sel.fav || sel.master);
  }

  function normalizeNotebookQid(id) {
    return String(id == null ? "" : id).trim();
  }

  /**
   * 오답·찜·마스터 노트 패널과 동일: 무료는 최신 저장 앞쪽 100개만, 유료는 1000개까지 열람 한도.
   * 퀴즈 "노트 범위" 필터는 저장소 전체가 아니라 이 한도 안의 ID만 사용합니다.
   */
  function applyNotebookQuizScopeLimit(ids) {
    if (!Array.isArray(ids) || !ids.length) return [];
    var lim = 1000;
    try {
      if (window.HanlawNoteQuizUi && typeof window.HanlawNoteQuizUi.getDisplayLimit === "function") {
        lim = window.HanlawNoteQuizUi.getDisplayLimit();
      } else if (typeof window.isPaidMember === "function") {
        lim = window.isPaidMember() ? 1000 : 100;
      }
    } catch (e) {
      lim = typeof window.isPaidMember === "function" && window.isPaidMember() ? 1000 : 100;
    }
    return ids.slice(0, lim);
  }

  function idMapFromIdList(ids) {
    var out = {};
    var i;
    for (i = 0; i < ids.length; i++) {
      var id = normalizeNotebookQid(ids[i]);
      if (id) out[id] = true;
    }
    return out;
  }

  /** 노트별 퀴즈에 쓸 ID 집합(무료=최신순 앞 100개만). 한 번 필터링할 때마다 동일 maps를 넘겨 재계산을 줄입니다. */
  function buildNotebookQuizMaps() {
    var wrongRaw = [];
    var favRaw = [];
    var masterRaw = [];
    try {
      if (window.QuizWrongNote && typeof window.QuizWrongNote.getOrderedIds === "function") {
        wrongRaw = window.QuizWrongNote.getOrderedIds();
      }
    } catch (e) {}
    try {
      if (window.QuizFavorites && typeof window.QuizFavorites.getOrderedIds === "function") {
        favRaw = window.QuizFavorites.getOrderedIds();
      }
    } catch (e) {}
    try {
      if (window.QuizMaster && typeof window.QuizMaster.getOrderedIds === "function") {
        masterRaw = window.QuizMaster.getOrderedIds();
      }
    } catch (e) {}
    return {
      wrong: idMapFromIdList(applyNotebookQuizScopeLimit(wrongRaw)),
      fav: idMapFromIdList(applyNotebookQuizScopeLimit(favRaw)),
      master: idMapFromIdList(applyNotebookQuizScopeLimit(masterRaw))
    };
  }

  /** 노트 범위 미선택: 마스터 제외(기존 동작). 하나 이상 선택: 해당 노트(들)에 속한 문항만(합집합). */
  function passesScopeNotebook(q, sel, quizMaps) {
    sel = sel || getNotebookScopeSelections();
    if (!anyNotebookScopeActive(sel)) {
      return !isExcludedByMaster(q);
    }
    var id = normalizeNotebookQid(q.id);
    if (!id) return false;
    var maps = quizMaps || buildNotebookQuizMaps();
    var ok = false;
    if (sel.wrong && maps.wrong[id]) ok = true;
    if (sel.fav && maps.fav[id]) ok = true;
    if (sel.master && maps.master[id]) ok = true;
    return ok;
  }

  function scopedBank() {
    var maps = buildNotebookQuizMaps();
    return getBank().filter(function (q) {
      return matchesScope(q) && passesScopeNotebook(q, null, maps);
    });
  }

  /**
   * 홍정선 기본행정법 기준 목차(요약 단원명).
   * 데이터에 없는 주제도 선택 드롭다운에 노출해, 단원 중심으로 학습 경로를 먼저 고를 수 있게 합니다.
   */
  var ADMIN_LAW_TOPIC_TREE = [
    {
      l1: "행정법총론(일반행정법)",
      groups: [
        {
          l2: "행정법의 기초",
          topics: [
            "행정법의 의의",
            "행정법의 법원",
            "행정법상 법 원칙",
            "법치행정의 원칙",
            "평등의 원칙",
            "비례의 원칙",
            "신뢰보호의 원칙",
            "부당결부금지의 원칙"
          ]
        },
        {
          l2: "행정법관계",
          topics: ["행정법관계", "개인적 공권", "행정개입청구권"]
        },
        {
          l2: "행정의 행위형식",
          topics: [
            "행정입법",
            "법규명령",
            "행정규칙",
            "행정계획",
            "행정행위",
            "기속행위·재량행위",
            "행정행위의 하자",
            "행정행위의 효력",
            "행정행위의 취소·철회",
            "행정계약",
            "행정지도",
            "행정상 사실행위"
          ]
        },
        {
          l2: "행정절차·실효성 확보·국가책임",
          topics: [
            "행정절차",
            "행정정보공개",
            "행정조사",
            "행정벌",
            "행정강제",
            "즉시강제",
            "국가배상",
            "손실보상"
          ]
        }
      ]
    },
    {
      l1: "행정쟁송법",
      groups: [
        {
          l2: "행정심판법",
          topics: ["행정심판"]
        },
        {
          l2: "행정소송법",
          topics: ["행정소송", "취소소송", "무효등확인소송", "부작위위법확인소송", "당사자소송", "객관적 소송"]
        }
      ]
    },
    {
      l1: "특별행정법(행정법각론)",
      groups: [
        {
          l2: "행정조직법·지방자치법",
          topics: ["지방자치법", "지방자치단체의 조직", "지방자치단체의 사무", "지방자치단체의 통제"]
        },
        {
          l2: "공무원법·경찰법",
          topics: ["공무원법", "공무원의 권리·의무·책임", "경찰법", "경찰조직법", "경찰작용법", "경찰책임"]
        },
        {
          l2: "공적 시설법·공용부담법·토지행정법",
          topics: ["공물법", "영조물법", "공기업법", "공용부담법", "토지행정법"]
        },
        {
          l2: "기타 특별행정법",
          topics: ["경제행정법", "환경행정법", "재무행정법"]
        }
      ]
    }
  ];

  var LEGACY_TOPIC_ALIAS = {
    "행정법 일반": "행정법의 의의",
    "비례원칙": "비례의 원칙",
    "조세·행정": "재무행정법"
  };

  var ADMIN_LAW_TOPIC_ORDER = [];
  var TOPIC_PATH_BY_LABEL = {};
  (function buildTopicIndexes() {
    ADMIN_LAW_TOPIC_TREE.forEach(function (sec) {
      (sec.groups || []).forEach(function (g) {
        (g.topics || []).forEach(function (t) {
          if (ADMIN_LAW_TOPIC_ORDER.indexOf(t) < 0) ADMIN_LAW_TOPIC_ORDER.push(t);
          if (!TOPIC_PATH_BY_LABEL[t]) TOPIC_PATH_BY_LABEL[t] = { l1: sec.l1, l2: g.l2, l3: t };
        });
      });
    });
  })();
  window.HANLAW_ADMIN_LAW_TOPIC_ORDER = ADMIN_LAW_TOPIC_ORDER;

  function normalizeTopicLabel(topic) {
    var t = String(topic || "").trim();
    return LEGACY_TOPIC_ALIAS[t] || t;
  }

  function pathForTopic(topic) {
    var t = normalizeTopicLabel(topic);
    return TOPIC_PATH_BY_LABEL[t] || null;
  }

  function optionsForL2(l1) {
    var out = [];
    ADMIN_LAW_TOPIC_TREE.forEach(function (sec) {
      if (l1 !== ALL && sec.l1 !== l1) return;
      (sec.groups || []).forEach(function (g) {
        if (out.indexOf(g.l2) < 0) out.push(g.l2);
      });
    });
    return out;
  }

  function optionsForL3(l1, l2, bankTopics) {
    var out = [];
    ADMIN_LAW_TOPIC_TREE.forEach(function (sec) {
      if (l1 !== ALL && sec.l1 !== l1) return;
      (sec.groups || []).forEach(function (g) {
        if (l2 !== ALL && g.l2 !== l2) return;
        (g.topics || []).forEach(function (t) {
          if (out.indexOf(t) < 0) out.push(t);
        });
      });
    });
    (bankTopics || []).forEach(function (raw) {
      var t = normalizeTopicLabel(raw);
      if (!t || out.indexOf(t) >= 0) return;
      var p = pathForTopic(t);
      if (!p) {
        if (l1 === ALL && l2 === ALL) out.push(t);
        return;
      }
      if (l1 !== ALL && p.l1 !== l1) return;
      if (l2 !== ALL && p.l2 !== l2) return;
      out.push(t);
    });
    return out;
  }

  function ensureFilterTopicOption(value) {
    if (!el.filterTopic || !value || value === ALL) return;
    var i;
    for (i = 0; i < el.filterTopic.options.length; i++) {
      if (el.filterTopic.options[i].value === value) return;
    }
    var o = document.createElement("option");
    o.value = value;
    o.textContent = value;
    el.filterTopic.appendChild(o);
  }

  function initFilters() {
    syncQuestionSourceScopeUi();
    var scoped = scopedBank();
    var bankTopics = uniqueSorted(scoped.map(function (q) { return normalizeTopicLabel(q.topic); }));
    var prevL1 = el.filterTopicL1 ? String(el.filterTopicL1.value || ALL) : ALL;
    var prevL2 = el.filterTopicL2 ? String(el.filterTopicL2.value || ALL) : ALL;
    var prev = el.filterTopic ? String(el.filterTopic.value || ALL) : ALL;
    var prevSearch = el.filterTopicSearch ? String(el.filterTopicSearch.value || "") : "";
    fillSelect(el.filterTopicL1, sortL1WithPriority(ADMIN_LAW_TOPIC_TREE.map(function (x) { return x.l1; })), true);
    if (el.filterTopicL1) el.filterTopicL1.value = prevL1 || ALL;
    var l1 = el.filterTopicL1 ? String(el.filterTopicL1.value || ALL) : ALL;
    fillSelect(el.filterTopicL2, optionsForL2(l1), true);
    if (el.filterTopicL2) {
      var okL2 = prevL2 === ALL || optionsForL2(l1).indexOf(prevL2) >= 0;
      el.filterTopicL2.value = okL2 ? prevL2 : ALL;
    }
    var l2 = el.filterTopicL2 ? String(el.filterTopicL2.value || ALL) : ALL;
    fillSelect(el.filterTopic, optionsForL3(l1, l2, bankTopics), true);
    if (prev && prev !== ALL) {
      var ok = false;
      var j;
      for (j = 0; j < el.filterTopic.options.length; j++) {
        if (el.filterTopic.options[j].value === normalizeTopicLabel(prev)) {
          ok = true;
          break;
        }
      }
      if (ok) {
        el.filterTopic.value = normalizeTopicLabel(prev);
      } else {
        ensureFilterTopicOption(normalizeTopicLabel(prev));
        el.filterTopic.value = normalizeTopicLabel(prev);
      }
    } else {
      el.filterTopic.value = ALL;
    }
    if (el.filterTopicSearch) el.filterTopicSearch.value = prevSearch;
  }

  function syncQuestionSourceScopeUi() {
    var pastOnly = document.getElementById("scope-source-past-only");
    var includeExpected = document.getElementById("scope-source-include-expected");
    var mode =
      typeof window.getStudyQuestionSource === "function"
        ? window.getStudyQuestionSource()
        : "past_only";
    if (pastOnly) pastOnly.checked = mode !== "include_expected";
    if (includeExpected) includeExpected.checked = mode === "include_expected";
  }

  function topicCurriculumRank(topic) {
    var t = normalizeTopicLabel(topic);
    var idx = ADMIN_LAW_TOPIC_ORDER.indexOf(t);
    return idx >= 0 ? idx : -1;
  }

  function filterQuestions() {
    var l1 = el.filterTopicL1 ? String(el.filterTopicL1.value || ALL) : ALL;
    var l2 = el.filterTopicL2 ? String(el.filterTopicL2.value || ALL) : ALL;
    var tp = el.filterTopic ? el.filterTopic.value : ALL;
    var search =
      el.filterTopicSearch && String(el.filterTopicSearch.value || "").trim();
    var notebookMaps = buildNotebookQuizMaps();
    return getBank().filter(function (q) {
      if (!matchesScope(q) || !passesScopeNotebook(q, null, notebookMaps)) return false;
      var topicNorm = normalizeTopicLabel(q.topic);
      var p = pathForTopic(topicNorm);
      if (l1 !== ALL) {
        if (!p || p.l1 !== l1) return false;
      }
      if (l2 !== ALL) {
        if (!p || p.l2 !== l2) return false;
      }
      if (search) {
        var subj = String(topicNorm || "");
        if (subj.indexOf(search) === -1) return false;
      } else {
        if (tp !== ALL && topicNorm !== tp) return false;
      }
      return true;
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
    random: true
  };

  function getSequenceMode() {
    var r = document.querySelector('input[name="opt-sequence"]:checked');
    var v = r && r.value;
    if (v && ORDER_MODES[v]) return v;
    return "random";
  }

  /** 직접 입력이 유효하면 그 값, 아니면 셀렉트(0이면 전체). */
  function getEffectiveQuestionCountCap() {
    if (el.questionCountCustom && el.questionCount) {
      var raw = String(el.questionCountCustom.value || "").trim();
      if (raw !== "") {
        var n = parseInt(raw, 10);
        if (n >= 1 && n <= 9999) return n;
      }
    }
    if (!el.questionCount) return 0;
    var sel = parseInt(String(el.questionCount.value || "0"), 10);
    return isNaN(sel) ? 0 : sel;
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

  function applyQuestionOrder(filtered, sequenceMode) {
    sequenceMode = sequenceMode === "progress" ? "progress" : "random";
    var a = filtered.slice();
    if (sequenceMode === "progress") {
      a.sort(function (q1, q2) {
        var r1 = topicCurriculumRank(q1.topic);
        var r2 = topicCurriculumRank(q2.topic);
        var o1 = r1 >= 0 ? r1 : 10000;
        var o2 = r2 >= 0 ? r2 : 10000;
        if (o1 !== o2) return o1 - o2;
        var t1 = String(q1.topic || "");
        var t2 = String(q2.topic || "");
        if (t1 !== t2) return t1.localeCompare(t2, "ko");
        return compareProgressOrder(q1, q2);
      });
      return a;
    }
    return shuffle(a);
  }

  function showScreen(name) {
    if (name !== "quiz") {
      clearQuizQuestionTimer();
    }
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
    return false;
  }

  function clearOxReveal(container) {
    if (!container) return;
    container.classList.remove("q-actions--revealed");
    container.querySelectorAll(".btn--ox").forEach(function (b) {
      b.classList.remove("btn--ox-reveal-correct", "btn--ox-reveal-wrong", "btn--ox-reveal-dim");
    });
  }

  function applyOxReveal(container, userTrue, correctTrue, revealOpts) {
    revealOpts = revealOpts || {};
    var timeout = revealOpts.timeout === true;
    if (!container) return;
    container.classList.add("q-actions--revealed");
    container.querySelectorAll(".btn--ox").forEach(function (b) {
      var isTrue = oxButtonIsTrue(b);
      b.classList.remove("btn--ox-reveal-correct", "btn--ox-reveal-wrong", "btn--ox-reveal-dim");
      var isCorrectBtn = isTrue === correctTrue;
      var isUserBtn = isTrue === userTrue;
      if (isCorrectBtn) {
        b.classList.add("btn--ox-reveal-correct");
      } else if (!timeout && isUserBtn) {
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
      ((q.detail.body && String(q.detail.body).trim()) ||
        q.detail.legal ||
        q.detail.trap ||
        q.detail.precedent);
    if (!hasDetail) {
      var empty = document.createElement("p");
      empty.className = "feedback-detail__empty";
      empty.textContent = "등록된 상세 해설이 없습니다.";
      container.appendChild(empty);
      return;
    }
    if (!isViewerLoggedIn()) {
      if (isGuestFullQuizPreview()) {
        buildDetailBlocks(container, q.detail);
      } else {
        var lockGuest = document.createElement("p");
        lockGuest.className = "feedback-premium-lock";
        lockGuest.textContent =
          "비회원은 퀴즈 상세 해설을 5문항까지 체험할 수 있습니다. 계속 보려면 회원가입 후 이용해 주세요.";
        container.appendChild(lockGuest);
      }
      return;
    }
    if (
      typeof window.HanlawDetailUnlock === "object" &&
      typeof window.HanlawDetailUnlock.render === "function"
    ) {
      window.HanlawDetailUnlock.render(container, q, buildDetailBlocks);
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

  function fillExplainPanel(parts, q, opts) {
    opts = opts || {};
    var guest = !isViewerLoggedIn();
    var guestLocked = guest && !isGuestFullQuizPreview();
    var rootFB = opts.feedbackRoot || el.feedback;
    var hintEl = opts.hintEl !== undefined ? opts.hintEl : el.feedbackGuestHint;
    var tagsSec = opts.tagsSection !== undefined ? opts.tagsSection : el.feedbackTagsSection;
    if (rootFB) rootFB.classList.toggle("feedback--guest-lock", guestLocked);
    if (hintEl) {
      hintEl.hidden = true;
      hintEl.textContent = "";
    }

    if (parts.answerKey) {
      if (guestLocked) {
        parts.answerKey.textContent = "";
        parts.answerKey.hidden = true;
      } else {
        parts.answerKey.textContent = "정답: " + formatOx(q.answer);
        parts.answerKey.hidden = false;
      }
    }
    if (parts.importanceLine) parts.importanceLine.hidden = guestLocked;
    if (parts.difficultyLine) parts.difficultyLine.hidden = guestLocked;
    if (!guestLocked) {
      setImportanceLine(parts.importanceLine, q);
      setDifficultyLine(parts.difficultyLine, q);
    } else {
      if (parts.importanceLine) parts.importanceLine.textContent = "";
      if (parts.difficultyLine) parts.difficultyLine.textContent = "";
    }
    if (parts.explain) {
      var basic = getBasicExplain(q);
      var explainText = basic ? basic : "등록된 기본 해설이 없습니다.";
      parts.explain.classList.add("quiz-ai-answer");
      if (typeof window.formatHanlawAiAnswerHtml === "function") {
        parts.explain.innerHTML = window.formatHanlawAiAnswerHtml(explainText);
      } else {
        parts.explain.textContent = explainText;
      }
    }
    populateDetailContainer(parts.detail, q);
    if (parts.tags) {
      parts.tags.innerHTML = "";
      if (guestLocked) {
        if (tagsSec) tagsSec.hidden = true;
      } else {
        if (tagsSec) tagsSec.hidden = false;
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
    syncQuizMemoLoginState(guest);
  }

  /** 피드백 영역의 「나의 메모」 — 게스트는 패널만 닫아 두고, 클릭 시 안내는 별도 처리 */
  function syncQuizMemoLoginState(guest) {
    if (guest === undefined) guest = !isViewerLoggedIn();
    if (!el.quizMemoPanelToggle || !el.quizMemoSection) return;
    if (guest) {
      el.quizMemoSection.classList.add("quiz-memo--need-login");
      setQuizMemoPanelOpen(false);
      el.quizMemoPanelToggle.disabled = true;
      el.quizMemoPanelToggle.setAttribute("title", "메모는 로그인 후 이용할 수 있습니다.");
      el.quizMemoPanelToggle.removeAttribute("aria-label");
      if (el.quizMemoText) el.quizMemoText.disabled = true;
      if (el.quizMemoSave) el.quizMemoSave.disabled = true;
    } else {
      el.quizMemoSection.classList.remove("quiz-memo--need-login");
      el.quizMemoPanelToggle.disabled = false;
      el.quizMemoPanelToggle.removeAttribute("title");
      el.quizMemoPanelToggle.removeAttribute("aria-label");
      if (el.quizMemoText) el.quizMemoText.disabled = false;
      if (el.quizMemoSave) el.quizMemoSave.disabled = false;
    }
  }

  function clearFeedbackExtras() {
    if (el.feedback) el.feedback.classList.remove("feedback--guest-lock");
    if (el.feedbackGuestHint) el.feedbackGuestHint.hidden = true;
    if (el.feedbackTagsSection) el.feedbackTagsSection.hidden = false;
    if (el.feedbackAnswerKey) {
      el.feedbackAnswerKey.textContent = "";
      el.feedbackAnswerKey.hidden = true;
    }
    if (el.feedbackImportanceLine) {
      el.feedbackImportanceLine.textContent = "";
      el.feedbackImportanceLine.hidden = false;
    }
    if (el.feedbackDifficultyLine) {
      el.feedbackDifficultyLine.textContent = "";
      el.feedbackDifficultyLine.hidden = false;
    }
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
    clearQuizMemoDraft();
  }

  function setQuizMemoMsg(text, isError) {
    if (!el.quizMemoMsg) return;
    el.quizMemoMsg.textContent = text || "";
    el.quizMemoMsg.hidden = !text;
    el.quizMemoMsg.classList.toggle("quiz-memo__msg--error", !!isError);
  }

  function applyQuizMemoPanMode(on) {
    quizMemoPanMode = !!on;
    if (!el.quizMemoCanvas) return;
    var scrollWrap = document.getElementById("quiz-memo-canvas-scroll");
    if (scrollWrap) {
      scrollWrap.classList.toggle("quiz-memo__canvas-scroll--pan", quizMemoPanMode);
    }
    el.quizMemoCanvas.classList.toggle("quiz-memo__canvas--pan", quizMemoPanMode);
    if (el.quizMemoPanToggle) {
      el.quizMemoPanToggle.setAttribute("aria-pressed", quizMemoPanMode ? "true" : "false");
      el.quizMemoPanToggle.classList.toggle("quiz-memo__split-actions-btn--active", quizMemoPanMode);
      el.quizMemoPanToggle.textContent = quizMemoPanMode ? "그리기" : "이동";
    }
    if (quizMemoCanvasCtl && typeof quizMemoCanvasCtl.setDrawingEnabled === "function") {
      var locked = el.quizMemoCanvas.classList.contains("quiz-memo__canvas--locked");
      quizMemoCanvasCtl.setDrawingEnabled(!quizMemoPanMode && !locked);
    }
  }

  function applyQuizMemoDrawingLock(locked) {
    if (!el.quizMemoCanvas || !quizMemoCanvasCtl) return;
    el.quizMemoCanvas.classList.toggle("quiz-memo__canvas--locked", !!locked);
    if (el.quizMemoEditDraw) {
      el.quizMemoEditDraw.hidden = !locked;
    }
    var toolIds = [
      "quiz-memo-draw-settings-toggle",
      "quiz-memo-clear-canvas",
      "quiz-memo-tool-pen",
      "quiz-memo-tool-eraser",
      "quiz-memo-pen-color",
      "quiz-memo-pen-width"
    ];
    var ti;
    for (ti = 0; ti < toolIds.length; ti++) {
      var node = document.getElementById(toolIds[ti]);
      if (node) node.disabled = !!locked;
    }
    if (locked) {
      var settingsPanel = document.getElementById("quiz-memo-draw-settings");
      var settingsToggle = document.getElementById("quiz-memo-draw-settings-toggle");
      if (settingsPanel) settingsPanel.hidden = true;
      if (settingsToggle) settingsToggle.setAttribute("aria-expanded", "false");
    } else {
      updateQuizMemoToolUi();
    }
    applyQuizMemoPanMode(quizMemoPanMode);
  }

  function clearQuizMemoDraft() {
    if (el.quizMemoText) el.quizMemoText.value = "";
    if (quizMemoCanvasCtl && typeof quizMemoCanvasCtl.clear === "function") quizMemoCanvasCtl.clear();
    if (quizMemoCanvasCtl && typeof quizMemoCanvasCtl.setEraser === "function") {
      quizMemoCanvasCtl.setEraser(false);
    }
    setQuizMemoMsg("", false);
    applyQuizMemoPanMode(false);
    applyQuizMemoDrawingLock(false);
  }

  function setQuizMemoPanelOpen(open) {
    if (!el.quizMemoBody || !el.quizMemoPanelToggle) return;
    el.quizMemoBody.hidden = !open;
    el.quizMemoPanelToggle.setAttribute("aria-expanded", open ? "true" : "false");
    el.quizMemoPanelToggle.textContent = open
      ? "나의 메모 (암기·팁) 접기"
      : "나의 메모 (암기·팁) 펼치기";
  }

  function syncQuizMemoForQuestion(q) {
    if (!el.quizMemoSection) return;
    if (!isViewerLoggedIn()) {
      clearQuizMemoDraft();
      setQuizMemoPanelOpen(false);
      return;
    }
    if (!window.QuizQuestionMemo) return;
    var qid = q && q.id != null ? String(q.id).trim() : "";
    if (!qid) return;
    var m = window.QuizQuestionMemo.get(qid);
    if (el.quizMemoText) el.quizMemoText.value = m && m.text ? m.text : "";
    var hasDrawing = false;
    if (quizMemoCanvasCtl) {
      if (typeof quizMemoCanvasCtl.setEraser === "function") {
        quizMemoCanvasCtl.setEraser(false);
      }
      if (m && m.drawing && String(m.drawing).indexOf("data:image") === 0) {
        hasDrawing = true;
        quizMemoCanvasCtl.loadDataUrl(m.drawing);
      } else if (typeof quizMemoCanvasCtl.clear === "function") {
        quizMemoCanvasCtl.clear();
      }
    }
    setQuizMemoMsg("", false);
    updateQuizMemoToolUi();
    applyQuizMemoDrawingLock(hasDrawing);
    setQuizMemoPanelOpen(false);
  }

  function updateQuizMemoToolUi() {
    if (!quizMemoCanvasCtl) return;
    var isEr =
      typeof quizMemoCanvasCtl.isEraser === "function" && quizMemoCanvasCtl.isEraser();
    var penB = document.getElementById("quiz-memo-tool-pen");
    var erB = document.getElementById("quiz-memo-tool-eraser");
    var colorIn = document.getElementById("quiz-memo-pen-color");
    var widthSel = document.getElementById("quiz-memo-pen-width");
    if (penB) {
      penB.classList.toggle("quiz-memo__tool-btn--active", !isEr);
      penB.setAttribute("aria-pressed", !isEr ? "true" : "false");
    }
    if (erB) {
      erB.classList.toggle("quiz-memo__tool-btn--active", !!isEr);
      erB.setAttribute("aria-pressed", isEr ? "true" : "false");
    }
    if (colorIn) {
      colorIn.disabled = !!isEr;
      if (typeof quizMemoCanvasCtl.getPenColor === "function") {
        var pc = quizMemoCanvasCtl.getPenColor();
        if (pc && pc.indexOf("#") === 0) colorIn.value = pc;
      }
    }
    if (widthSel && typeof quizMemoCanvasCtl.getLineWidth === "function") {
      var w = String(quizMemoCanvasCtl.getLineWidth());
      var opts = widthSel.querySelectorAll("option");
      var oi;
      for (oi = 0; oi < opts.length; oi++) {
        if (opts[oi].value === w) {
          widthSel.value = w;
          break;
        }
      }
    }
  }

  function bindQuizMemoPanelOnce() {
    if (window.__hanlawQuizMemoBound) return;
    window.__hanlawQuizMemoBound = true;
    if (el.quizMemoPanelToggle && el.quizMemoBody) {
      el.quizMemoPanelToggle.addEventListener("click", function () {
        if (!isViewerLoggedIn()) {
          window.alert("나의 메모(암기·팁)는 로그인 후 이용할 수 있습니다.");
          return;
        }
        var nextOpen = !!el.quizMemoBody.hidden;
        setQuizMemoPanelOpen(nextOpen);
        if (nextOpen && el.quizMemoText) {
          try {
            el.quizMemoText.focus();
          } catch (e) {}
        }
      });
    }
    if (
      el.quizMemoCanvas &&
      window.QuizQuestionMemo &&
      typeof window.QuizQuestionMemo.attachDrawingCanvas === "function"
    ) {
      quizMemoCanvasCtl = window.QuizQuestionMemo.attachDrawingCanvas(el.quizMemoCanvas, {
        onChange: function () {}
      });
      var colorIn0 = document.getElementById("quiz-memo-pen-color");
      var widthSel0 = document.getElementById("quiz-memo-pen-width");
      if (colorIn0 && quizMemoCanvasCtl.setPenColor) {
        quizMemoCanvasCtl.setPenColor(colorIn0.value);
      }
      if (widthSel0 && quizMemoCanvasCtl.setLineWidth) {
        quizMemoCanvasCtl.setLineWidth(widthSel0.value);
      }
      if (quizMemoCanvasCtl.setEraser) quizMemoCanvasCtl.setEraser(false);
      updateQuizMemoToolUi();
    }

    var settingsToggle = document.getElementById("quiz-memo-draw-settings-toggle");
    var settingsPanel = document.getElementById("quiz-memo-draw-settings");
    if (settingsToggle && settingsPanel) {
      settingsToggle.addEventListener("click", function () {
        var open = !!settingsPanel.hidden;
        settingsPanel.hidden = !open;
        settingsToggle.setAttribute("aria-expanded", open ? "true" : "false");
      });
    }

    var penBtn = document.getElementById("quiz-memo-tool-pen");
    var eraserBtn = document.getElementById("quiz-memo-tool-eraser");
    if (penBtn) {
      penBtn.addEventListener("click", function () {
        if (quizMemoCanvasCtl && quizMemoCanvasCtl.setEraser) {
          quizMemoCanvasCtl.setEraser(false);
          updateQuizMemoToolUi();
        }
      });
    }
    if (eraserBtn) {
      eraserBtn.addEventListener("click", function () {
        if (quizMemoCanvasCtl && quizMemoCanvasCtl.setEraser) {
          quizMemoCanvasCtl.setEraser(true);
          updateQuizMemoToolUi();
        }
      });
    }
    var colorIn = document.getElementById("quiz-memo-pen-color");
    if (colorIn) {
      colorIn.addEventListener("input", function () {
        if (quizMemoCanvasCtl && quizMemoCanvasCtl.setPenColor) {
          quizMemoCanvasCtl.setPenColor(colorIn.value);
        }
      });
    }
    var widthSel = document.getElementById("quiz-memo-pen-width");
    if (widthSel) {
      widthSel.addEventListener("change", function () {
        if (quizMemoCanvasCtl && quizMemoCanvasCtl.setLineWidth) {
          quizMemoCanvasCtl.setLineWidth(widthSel.value);
        }
      });
    }

    if (el.quizMemoClearCanvas) {
      el.quizMemoClearCanvas.addEventListener("click", function () {
        if (quizMemoCanvasCtl && typeof quizMemoCanvasCtl.clear === "function") quizMemoCanvasCtl.clear();
      });
    }
    if (el.quizMemoSave) {
      el.quizMemoSave.addEventListener("click", function () {
        if (!isViewerLoggedIn()) {
          setQuizMemoMsg("로그인 후 이용할 수 있습니다.", true);
          return;
        }
        if (!window.QuizQuestionMemo || typeof window.QuizQuestionMemo.set !== "function") {
          setQuizMemoMsg("메모 저장을 사용할 수 없습니다.", true);
          return;
        }
        var q = state.list[state.index];
        if (!q || !String(q.id != null ? q.id : "").trim()) {
          setQuizMemoMsg("문항 정보가 없습니다.", true);
          return;
        }
        var qid = String(q.id).trim();
        var txt = el.quizMemoText ? String(el.quizMemoText.value || "").trim() : "";
        var drawing = "";
        if (quizMemoCanvasCtl && typeof quizMemoCanvasCtl.hasInk === "function" && quizMemoCanvasCtl.hasInk()) {
          try {
            drawing = el.quizMemoCanvas.toDataURL("image/jpeg", 0.88);
          } catch (e) {
            drawing = "";
          }
        }
        if (!txt && !drawing) {
          window.QuizQuestionMemo.remove(qid);
          setQuizMemoMsg("메모를 비웠습니다.", false);
          applyQuizMemoDrawingLock(false);
          return;
        }
        window.QuizQuestionMemo.set(qid, { text: txt, drawing: drawing });
        setQuizMemoMsg("저장했습니다.", false);
        if (drawing) {
          applyQuizMemoDrawingLock(true);
        } else {
          applyQuizMemoDrawingLock(false);
        }
      });
    }
    if (el.quizMemoEditDraw) {
      el.quizMemoEditDraw.addEventListener("click", function () {
        applyQuizMemoDrawingLock(false);
      });
    }
    if (el.quizMemoPanToggle) {
      el.quizMemoPanToggle.addEventListener("click", function () {
        applyQuizMemoPanMode(!quizMemoPanMode);
      });
      applyQuizMemoPanMode(false);
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
      if (q.detail.body != null && String(q.detail.body).trim()) {
        det = String(q.detail.body).replace(/\r\n/g, "\n") + "\n\n";
      } else {
        var keys = ["legal", "trap", "precedent"];
        var titles = { legal: "법리 근거", trap: "함정 포인트", precedent: "판례" };
        for (var i = 0; i < keys.length; i++) {
          var k = keys[i];
          if (q.detail[k]) det += (titles[k] || k) + ": " + q.detail[k] + "\n\n";
        }
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
      questionId: q.id != null && String(q.id).trim() ? String(q.id).trim().slice(0, 120) : "",
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

  function clearQuizQuestionTimer() {
    if (quizQuestionTimerId != null) {
      window.clearInterval(quizQuestionTimerId);
      quizQuestionTimerId = null;
    }
    quizTimerTotalMs = 0;
    if (el.quizTimerPanel) {
      el.quizTimerPanel.hidden = true;
      el.quizTimerPanel.setAttribute("aria-hidden", "true");
      el.quizTimerPanel.classList.remove("quiz-timer-panel--warn");
    }
    if (el.quizTimerArcadeFill) el.quizTimerArcadeFill.style.clipPath = "inset(0 0 0 0)";
    if (el.quizTimerMeta) el.quizTimerMeta.textContent = "—";
    if (el.quizTimerBarTrack) el.quizTimerBarTrack.setAttribute("aria-valuenow", "100");
  }

  function getQuizTimerCfg() {
    if (typeof window.getHanlawQuizTimerConfig === "function") {
      try {
        var c = window.getHanlawQuizTimerConfig();
        if (c && typeof c === "object") {
          var sec = parseInt(c.seconds, 10);
          if (!Number.isFinite(sec)) sec = 15;
          sec = Math.min(600, Math.max(10, sec));
          return { enabled: !!c.enabled, seconds: sec };
        }
      } catch (e1) {}
    }
    try {
      var raw = localStorage.getItem("hanlaw_quiz_timer_v1");
      if (raw) {
        var o = JSON.parse(raw);
        if (o && typeof o === "object") {
          var s2 = parseInt(o.s, 10);
          if (!Number.isFinite(s2)) s2 = 15;
          s2 = Math.min(600, Math.max(10, s2));
          return { enabled: !!o.e, seconds: s2 };
        }
      }
    } catch (e2) {}
    return { enabled: false, seconds: 15 };
  }

  function updateQuizTimerUi(msLeft, totalMs, remainingSec) {
    var pct = totalMs > 0 ? Math.max(0, Math.min(100, (msLeft / totalMs) * 100)) : 0;
    if (el.quizTimerArcadeFill) {
      el.quizTimerArcadeFill.style.clipPath = "inset(0 0 0 " + (100 - pct) + "%)";
    }
    if (el.quizTimerBarTrack) {
      var maxSec = Math.max(1, Math.round(totalMs / 1000));
      el.quizTimerBarTrack.setAttribute("aria-valuemax", String(maxSec));
      el.quizTimerBarTrack.setAttribute("aria-valuenow", String(Math.max(0, remainingSec)));
    }
    if (el.quizTimerMeta) {
      el.quizTimerMeta.textContent =
        "제한 시간 · 남은 " + remainingSec + "초 (문항당 " + Math.round(totalMs / 1000) + "초)";
    }
    if (el.quizTimerPanel) {
      el.quizTimerPanel.classList.toggle("quiz-timer-panel--warn", remainingSec <= 10);
    }
  }

  function startQuizQuestionTimerIfNeeded() {
    clearQuizQuestionTimer();
    var cfg = getQuizTimerCfg();
    if (!cfg.enabled || !(cfg.seconds > 0)) return;
    quizTimerTotalMs = cfg.seconds * 1000;
    var totalMs = quizTimerTotalMs;
    var deadline = Date.now() + totalMs;
    if (el.quizTimerPanel) {
      el.quizTimerPanel.hidden = false;
      el.quizTimerPanel.setAttribute("aria-hidden", "false");
    }
    updateQuizTimerUi(totalMs, totalMs, Math.ceil(totalMs / 1000));
    quizQuestionTimerId = window.setInterval(function () {
      var ms = deadline - Date.now();
      if (ms <= 0) {
        clearQuizQuestionTimer();
        onAnswerTimeout();
        return;
      }
      var rs = Math.ceil(ms / 1000);
      updateQuizTimerUi(ms, totalMs, rs);
    }, 120);
  }

  function scheduleQuizQuestionTimerIfNeeded() {
    window.requestAnimationFrame(function () {
      window.requestAnimationFrame(function () {
        startQuizQuestionTimerIfNeeded();
      });
    });
  }

  function onAnswerTimeout() {
    var q = state.list[state.index];
    if (!q) return;
    if (state.sessionAnswers[state.index] != null) return;
    var userTrue = !q.answer;
    state.sessionAnswers[state.index] = { userTrue: userTrue, timeout: true };
    paintAnsweredFeedback(q, userTrue, { timeout: true });
    el.score.textContent = "정답 " + state.correct;
    if (window.LearningStats && typeof window.LearningStats.recordQuizAnswer === "function") {
      window.LearningStats.recordQuizAnswer(q.topic, false);
    }
    if (!isViewerLoggedIn()) {
      if (el.feedbackMaster) el.feedbackMaster.hidden = true;
      if (el.feedbackAttendanceNotify) el.feedbackAttendanceNotify.hidden = true;
    }
    if (
      String(q.id != null ? q.id : "").trim() &&
      window.QuizWrongNote &&
      typeof window.QuizWrongNote.record === "function"
    ) {
      window.QuizWrongNote.record(q.id);
    }
    updateQuizNavButtons();
    afterQuizAnswerTryAttendance();
  }

  function paintAnsweredFeedback(q, userTrue, fbOpts) {
    fbOpts = fbOpts || {};
    var timeout = fbOpts.timeout === true;
    var ok = userTrue === q.answer;
    el.feedback.hidden = false;
    el.feedbackResult.textContent = timeout
      ? "시간이 초과되어 오답 처리되었습니다."
      : ok
        ? "정답입니다."
        : "오답입니다.";
    el.feedbackResult.classList.remove("is-correct", "is-wrong");
    el.feedbackResult.classList.add(ok ? "is-correct" : "is-wrong");
    applyOxReveal(el.qActions, userTrue, q.answer, { timeout: timeout });
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
    if (el.btnQuizFavorite) el.btnQuizFavorite.hidden = false;
    if (el.btnQuizMaster) el.btnQuizMaster.hidden = false;
    if (typeof window.refreshQuizFavoriteButton === "function") {
      window.refreshQuizFavoriteButton();
    }
    if (typeof window.refreshQuizMasterButton === "function") {
      window.refreshQuizMasterButton();
    }
    syncQuizMemoForQuestion(q);
    window.__HANLAW_QUIZ_AI_CONTEXT = buildQuizAiContext(q, userTrue);
  }

  function updateQuizNavButtons() {
    var answered = state.sessionAnswers[state.index] != null;
    var canPrev = state.index > 0;
    if (el.quizNavBottomRow) el.quizNavBottomRow.hidden = !answered;
    var prevBtns = [el.btnQuizPrevBottom, el.btnQuizNavPrev];
    var pi;
    for (pi = 0; pi < prevBtns.length; pi++) {
      if (prevBtns[pi]) prevBtns[pi].disabled = !canPrev;
    }
    if (el.btnQuizNavNext) el.btnQuizNavNext.hidden = !answered;
  }

  function previousQuestion() {
    if (state.index <= 0) return;
    state.index--;
    renderQuestion();
  }

  function renderQuestion() {
    if (window.QuizAiAsk && typeof window.QuizAiAsk.resetMain === "function") {
      window.QuizAiAsk.resetMain();
    }
    var q = state.list[state.index];
    updateSeoForQuizQuestion(q);
    var total = state.list.length;
    el.progress.textContent = state.index + 1 + " / " + total;
    el.score.textContent = "정답 " + state.correct;
    if (el.quizGuestHintTop) {
      if (!isViewerLoggedIn() && !isAdsenseOpenMode()) {
        el.quizGuestHintTop.hidden = false;
        if (state.index < guestQuizLimit()) {
          var remaining = Math.max(0, guestQuizLimit() - (state.index + 1));
          el.quizGuestHintTop.textContent =
            "[무료 체험 중] 비회원은 퀴즈 5문항까지 상세 해설을 포함해 볼 수 있습니다. 현재 " +
            remaining +
            "회 남았습니다.";
        } else {
          el.quizGuestHintTop.textContent =
            "[무료 체험 안내] 무료 체험 5회를 모두 사용했습니다. 6번째 문항부터는 상세 해설이 제한됩니다. 회원가입 후 전체 이용이 가능합니다.";
        }
      } else {
        el.quizGuestHintTop.hidden = true;
        el.quizGuestHintTop.textContent = "";
      }
    }
    var sourceStr = formatQuizSource(q);
    if (el.qSource) {
      el.qSource.textContent = sourceStr ? "출처: " + sourceStr : "";
      el.qSource.hidden = !sourceStr;
    }
    var meta = q.topic || "—";
    if (q.importance) meta += " · 중요도 " + starsLine(q.importance);
    if (q.difficulty) meta += " · 난이도 " + starsLine(q.difficulty);
    el.qMeta.textContent = meta;
    if (typeof window.formatHanlawRichParagraphsHtml === "function") {
      el.qText.innerHTML = window.formatHanlawRichParagraphsHtml(q.statement || "");
    } else {
      el.qText.textContent = q.statement || "";
    }
    ensureQuizAdminEditButton();
    syncQuizAdminEditVisibility();
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

    var saved = state.sessionAnswers[state.index];
    if (saved != null) {
      clearQuizQuestionTimer();
      paintAnsweredFeedback(q, saved.userTrue, { timeout: saved.timeout === true });
      if (el.feedbackMaster) {
        el.feedbackMaster.textContent = "";
        el.feedbackMaster.hidden = true;
      }
      if (el.feedbackAttendanceNotify) {
        el.feedbackAttendanceNotify.textContent = "";
        el.feedbackAttendanceNotify.hidden = true;
      }
    } else {
      el.feedback.hidden = true;
      el.feedbackResult.classList.remove("is-correct", "is-wrong");
      clearFeedbackExtras();
      syncQuizMemoForQuestion(q);
      clearOxReveal(el.qActions);
      if (el.btnQuizFavorite) el.btnQuizFavorite.hidden = true;
      if (el.btnQuizMaster) el.btnQuizMaster.hidden = true;
      setOxDisabled(false);
      scheduleQuizQuestionTimerIfNeeded();
    }
    updateQuizNavButtons();
    syncQuizUrl(false);
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

    /** 상세 본문(detail.body): 줄바꿈·빈 줄을 그대로 둠(구버전 normalizedText의 \s*가 빈 줄을 삼켰음) */
    function normalizeDetailBodyRaw(raw) {
      return String(raw || "").replace(/\r\n/g, "\n");
    }

    /** 구버전 legal/trap/precedent만 합친 문자열용(간단 정리) */
    function normalizedText(raw) {
      return String(raw || "").replace(/\r\n/g, "\n").trim();
    }

    var merged = "";
    if (typeof detail === "string") {
      merged = normalizeDetailBodyRaw(detail);
    } else if (typeof detail === "object") {
      if (detail.body != null && String(detail.body).trim()) {
        merged = normalizeDetailBodyRaw(String(detail.body));
      } else {
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
    }
    if (!merged) return;

    /* <p> 안에 불릿용 <div>가 들어가면 HTML이 깨져 스타일·줄간격이 무너짐 → div 루트만 사용, quiz-ai-answer 박스 미적용 */
    var root = document.createElement("div");
    root.className = "feedback-detail__rich-html";
    if (typeof window.formatHanlawAiAnswerHtml === "function") {
      root.innerHTML = window.formatHanlawAiAnswerHtml(merged);
    } else {
      root.textContent = merged;
    }
    container.appendChild(root);
  }

  function renderTags(container, tags) {
    container.innerHTML = "";
    if (!tags || !tags.length) return;
    for (var i = 0; i < tags.length; i++) {
      var label = String(tags[i] || "").trim();
      if (!label) continue;
      var state =
        typeof window.getTagDictionaryState === "function"
          ? window.getTagDictionaryState(label)
          : { active: true, kind: "unknown" };
      var linked = !!(state && state.active);
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "feedback-tag feedback-tag--link";
      btn.classList.add(linked ? "feedback-tag--active" : "feedback-tag--inactive");
      btn.setAttribute("data-tag", label);
      btn.setAttribute("data-tag-linked", linked ? "1" : "0");
      btn.setAttribute("aria-label", label + " 사전에서 보기 (" + (linked ? "연결됨" : "미연결") + ")");
      btn.textContent = "#" + label;
      container.appendChild(btn);
    }
  }

  function refreshRenderedTagStates() {
    if (!el.feedbackTags) return;
    var nodes = el.feedbackTags.querySelectorAll(".feedback-tag--link[data-tag]");
    for (var i = 0; i < nodes.length; i++) {
      var btn = nodes[i];
      var label = String(btn.getAttribute("data-tag") || "").trim();
      if (!label) continue;
      var state =
        typeof window.getTagDictionaryState === "function"
          ? window.getTagDictionaryState(label)
          : { active: true, kind: "unknown" };
      var linked = !!(state && state.active);
      btn.classList.remove("feedback-tag--active", "feedback-tag--inactive");
      btn.classList.add(linked ? "feedback-tag--active" : "feedback-tag--inactive");
      btn.setAttribute("data-tag-linked", linked ? "1" : "0");
      btn.setAttribute("aria-label", label + " 사전에서 보기 (" + (linked ? "연결됨" : "미연결") + ")");
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
    state.lastFilterTopicL1 = el.filterTopicL1 ? String(el.filterTopicL1.value || ALL) : ALL;
    state.lastFilterTopicL2 = el.filterTopicL2 ? String(el.filterTopicL2.value || ALL) : ALL;
    state.lastFilterTopic = el.filterTopic.value;
    state.lastFilterTopicSearch =
      el.filterTopicSearch && el.filterTopicSearch.value != null
        ? String(el.filterTopicSearch.value)
        : "";
    state.lastSequenceMode = getSequenceMode();
    state.lastNotebookScope = getNotebookScopeSelections();
    state.lastCount = el.questionCount ? String(el.questionCount.value || "0") : "0";
    state.lastQuestionCountCustom =
      el.questionCountCustom && el.questionCountCustom.value != null
        ? String(el.questionCountCustom.value).trim()
        : "";
    var list = applyQuestionOrder(filtered, state.lastSequenceMode);
    var cap = getEffectiveQuestionCountCap();
    if (cap > 0 && list.length > cap) {
      list = list.slice(0, cap);
    }
    state.list = list.map(enrichQuestionForDisplay);
    state.index = 0;
    state.correct = 0;
    state.sessionAnswers = {};
    showScreen("quiz");
    renderQuestion();
  }

  function moveSetupConfigTo(anchor) {
    if (!el.setupConfigWrap || !anchor || !anchor.parentNode) return;
    if (el.setupConfigWrap.previousElementSibling === anchor) return;
    anchor.parentNode.insertBefore(el.setupConfigWrap, anchor.nextSibling);
  }

  function openSetupConfig(source) {
    if (!el.setupConfigWrap) return;
    if (source === "bottom") moveSetupConfigTo(el.setupAnchorBottom);
    else moveSetupConfigTo(el.setupAnchorTop);
    el.setupConfigWrap.hidden = false;
    if (source === "bottom") {
      if (el.btnOpenSetupBottom) el.btnOpenSetupBottom.hidden = true;
      if (el.btnOpenSetup) el.btnOpenSetup.hidden = false;
    } else {
      if (el.btnOpenSetup) el.btnOpenSetup.hidden = true;
      if (el.btnOpenSetupBottom) el.btnOpenSetupBottom.hidden = false;
    }
  }

  function startQuizFullScope() {
    try {
      if (typeof window.applyStudyScopeFromObject === "function") {
        var allExamIds = (window.EXAM_CATALOG || []).map(function (x) { return x.id; });
        var allYearsSet = {};
        (window.EXAM_CATALOG || []).forEach(function (ex) {
          (ex.years || []).forEach(function (y) { allYearsSet[y] = true; });
        });
        var allYears = Object.keys(allYearsSet).map(Number).sort(function (a, b) { return b - a; });
        window.applyStudyScopeFromObject({ examIds: allExamIds, years: allYears });
      }
    } catch (e) {}
    if (el.filterTopic) el.filterTopic.value = ALL;
    if (el.filterTopicL1) el.filterTopicL1.value = ALL;
    if (el.filterTopicL2) el.filterTopicL2.value = ALL;
    if (el.filterTopicSearch) el.filterTopicSearch.value = "";
    if (el.questionCount) el.questionCount.value = "0";
    if (el.questionCountCustom) el.questionCountCustom.value = "";
    var ordRandom = document.querySelector('input[name="opt-sequence"][value="random"]');
    if (ordRandom) ordRandom.checked = true;
    var nw = document.getElementById("scope-note-wrong");
    var nf = document.getElementById("scope-note-fav");
    var nm = document.getElementById("scope-note-master");
    if (nw) nw.checked = false;
    if (nf) nf.checked = false;
    if (nm) nm.checked = false;
    openSetupConfig("top");
    startQuiz();
  }

  function onAnswer(userTrue) {
    clearQuizQuestionTimer();
    var q = state.list[state.index];
    state.sessionAnswers[state.index] = { userTrue: userTrue };
    var ok = userTrue === q.answer;
    if (ok) state.correct++;
    paintAnsweredFeedback(q, userTrue);
    el.score.textContent = "정답 " + state.correct;
    if (window.LearningStats && typeof window.LearningStats.recordQuizAnswer === "function") {
      window.LearningStats.recordQuizAnswer(q.topic, ok);
    }
    if (!isViewerLoggedIn()) {
      if (el.feedbackMaster) el.feedbackMaster.hidden = true;
      if (el.feedbackAttendanceNotify) el.feedbackAttendanceNotify.hidden = true;
    }
    if (
      !ok &&
      String(q.id != null ? q.id : "").trim() &&
      window.QuizWrongNote &&
      typeof window.QuizWrongNote.record === "function"
    ) {
      window.QuizWrongNote.record(q.id);
    }
    updateQuizNavButtons();
    afterQuizAnswerTryAttendance();
  }

  function showAttendanceFeedback(data) {
    if (!data || !data.pointsAwarded) return;
    var rest = data.attendancePoints != null ? data.attendancePoints : 0;
    var msg =
      "오늘 출석이 반영되었습니다. 포인트 +" +
      data.pointsAwarded +
      "점 (잔여 " +
      rest +
      "점)";
    if (el.feedbackAttendanceNotify) {
      el.feedbackAttendanceNotify.textContent = msg;
      el.feedbackAttendanceNotify.hidden = false;
    }
  }

  function afterQuizAnswerTryAttendance() {
    try {
      if (typeof firebase === "undefined" || !firebase.auth) return;
      if (!firebase.auth().currentUser) return;
      if (typeof window.recordQuizAttendanceCallable !== "function") return;
      window
        .recordQuizAttendanceCallable()
        .then(function (data) {
          if (data && data.pointsAwarded > 0) {
            showAttendanceFeedback(data);
          }
        })
        .catch(function () {});
    } catch (err) {}
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

    state.index++;
    renderQuestion();
  }

  function retrySame() {
    if (el.filterTopicL1) el.filterTopicL1.value = state.lastFilterTopicL1 || ALL;
    if (el.filterTopicL2) el.filterTopicL2.value = state.lastFilterTopicL2 || ALL;
    initFilters();
    el.filterTopic.value = state.lastFilterTopic;
    if (el.filterTopicSearch) {
      el.filterTopicSearch.value =
        state.lastFilterTopicSearch != null ? String(state.lastFilterTopicSearch) : "";
    }
    if (el.questionCount) el.questionCount.value = state.lastCount || "0";
    if (el.questionCountCustom) {
      el.questionCountCustom.value =
        state.lastQuestionCountCustom != null ? String(state.lastQuestionCountCustom) : "";
    }
    var sequence = state.lastSequenceMode || "random";
    var seqRadio = document.querySelector('input[name="opt-sequence"][value="' + sequence + '"]');
    if (seqRadio) seqRadio.checked = true;
    else {
      var seqFallback = document.querySelector('input[name="opt-sequence"][value="random"]');
      if (seqFallback) seqFallback.checked = true;
    }
    var ns = state.lastNotebookScope || { wrong: false, fav: false, master: false };
    var cw = document.getElementById("scope-note-wrong");
    var cf = document.getElementById("scope-note-fav");
    var cm = document.getElementById("scope-note-master");
    if (cw) cw.checked = !!ns.wrong;
    if (cf) cf.checked = !!ns.fav;
    if (cm) cm.checked = !!ns.master;
    startQuiz();
  }

  function goHome() {
    if (el.setupConfigWrap) el.setupConfigWrap.hidden = true;
    if (el.btnOpenSetup) el.btnOpenSetup.hidden = false;
    if (el.btnOpenSetupBottom) el.btnOpenSetupBottom.hidden = false;
    showScreen("start");
    resetQuizUrlIfNeeded();
    resetSeoToDefault();
  }

  (function bindAppTitleReload() {
    var btn = document.getElementById("btn-app-title-reload");
    if (!btn) return;
    btn.addEventListener("click", function () {
      window.location.reload();
    });
  })();

  if (el.btnStart) el.btnStart.addEventListener("click", startQuiz);
  if (el.btnStartFull) el.btnStartFull.addEventListener("click", startQuizFullScope);
  if (el.btnStartFullBottom) el.btnStartFullBottom.addEventListener("click", startQuizFullScope);
  if (el.btnOpenSetup) el.btnOpenSetup.addEventListener("click", function () { openSetupConfig("top"); });
  if (el.btnOpenSetupBottom) el.btnOpenSetupBottom.addEventListener("click", function () { openSetupConfig("bottom"); });
  if (el.qActions) {
    el.qActions.addEventListener("click", function (e) {
      var btn = e.target.closest(".btn--ox");
      if (!btn || btn.disabled) return;
      var v = btn.getAttribute("data-answer");
      onAnswer(v === "true");
    });
  }
  function bindNav(btn, handler) {
    if (btn) btn.addEventListener("click", handler);
  }
  bindNav(el.btnNext, nextOrFinish);
  bindNav(el.btnQuizPrevBottom, previousQuestion);
  bindNav(el.btnQuizNavPrev, previousQuestion);
  bindNav(el.btnQuizNavNext, nextOrFinish);
  if (el.btnRetry) el.btnRetry.addEventListener("click", retrySame);
  if (el.btnHome) el.btnHome.addEventListener("click", goHome);
  bindQuizUrlRouting();

  function syncQuizMemoAfterAuthChange() {
    if (!el.feedback || el.feedback.hidden || !el.quiz || el.quiz.hidden) return;
    syncQuizMemoLoginState();
    var q = state.list[state.index];
    if (q) syncQuizMemoForQuestion(q);
  }

  window.addEventListener("app-auth", function () {
    syncQuizAdminEditVisibility();
    syncQuizMemoAfterAuthChange();
    refreshRenderedTagStates();
  });
  try {
    if (typeof firebase !== "undefined" && firebase.auth) {
      firebase.auth().onAuthStateChanged(function () {
        syncQuizAdminEditVisibility();
        syncQuizMemoAfterAuthChange();
      });
    }
  } catch (e) {}

  window.addEventListener("study-scope-change", initFilters);

  ["quiz-favorites-updated", "quiz-wrong-note-updated", "quiz-master-updated"].forEach(function (ev) {
    window.addEventListener(ev, initFilters);
  });

  if (el.start) {
    el.start.addEventListener("change", function (e) {
      var t = e.target;
      if (t && t.id && String(t.id).indexOf("scope-note-") === 0) {
        initFilters();
      }
      if (t && (t.id === "scope-source-past-only" || t.id === "scope-source-include-expected")) {
        if (typeof window.setStudyQuestionSource === "function") {
          window.setStudyQuestionSource(t.value === "include_expected" ? "include_expected" : "past_only");
        } else {
          initFilters();
        }
      }
      if (t && (t.id === "filter-topic-l1" || t.id === "filter-topic-l2")) {
        initFilters();
      }
    });
  }

  function syncBankUi() {
    if (!el.btnStart) return;
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

  function refreshFeedbackDetailIfOpen() {
    try {
      if (!el.feedback || el.feedback.hidden) return;
      if (!state.list || !state.list[state.index]) return;
      populateDetailContainer(el.feedbackDetail, state.list[state.index]);
    } catch (e) {}
  }
  window.addEventListener("hanlaw-detail-unlocked", refreshFeedbackDetailIfOpen);
  window.addEventListener("membership-updated", refreshFeedbackDetailIfOpen);
  window.addEventListener("dict-remote-updated", refreshRenderedTagStates);

  function bindMemoryContrastAnimation() {
    var root = document.querySelector(".memory-contrast");
    if (!root) return;
    var bars = root.querySelectorAll(".memory-contrast__bar");
    if (!bars.length) return;

    function startBars() {
      for (var i = 0; i < bars.length; i++) {
        bars[i].classList.add("is-animated");
      }
    }

    if (typeof window.IntersectionObserver !== "function") {
      startBars();
      return;
    }

    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          startBars();
          io.disconnect();
        });
      },
      { threshold: 0.35 }
    );

    io.observe(root);
  }

  syncBankUi();
  bindMemoryContrastAnimation();

  /** 범위 즐겨찾기 등 외부에서 현재 폼 기준으로 퀴즈를 시작할 때 */
  window.startHanlawQuizFromSetup = startQuiz;
  window.initHanlawQuizFilters = initFilters;
  window.syncHanlawQuizSetupPartTopic = function () {};
  window.ensureHanlawFilterTopicOption = ensureFilterTopicOption;

  window.hanlawAfterLogout = function () {
    try {
      showScreen("start");
    } catch (e) {}
  };

  bindQuizMemoPanelOnce();
})();
