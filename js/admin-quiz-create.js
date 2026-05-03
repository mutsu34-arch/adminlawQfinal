(function () {
  var selectedFiles = [];
  var uploadedLibraryIds = [];
  var selectedExistingLibraryIds = [];
  var existingLibraryDocs = [];
  var QUIZ_CREATE_PRESET_KEY = "hanlaw_admin_quiz_create_preset_v1";
  var QUIZ_CREATE_PROGRESS_KEY = "hanlaw_admin_quiz_create_progress_v1";
  var QUIZ_PROMPT_TEMPLATES_KEY = "hanlaw_admin_quiz_prompt_templates_v1";
  var promptTemplatesCache = { past: [], expected: [] };
  var promptTemplatesCloudLoaded = false;
  var autoMeta = { examId: "", year: "" };
  var quizGenerationRunning = false;
  var quizGenerationCancelRequested = false;

  function $(id) {
    return document.getElementById(id);
  }

  function isAdminUser(user) {
    if (!user || !user.email) return false;
    var emails = window.ADMIN_EMAILS || [];
    var mail = String(user.email).toLowerCase();
    for (var i = 0; i < emails.length; i++) {
      if (String(emails[i]).toLowerCase() === mail) return true;
    }
    return false;
  }

  function setMsg(el, text, isError) {
    if (!el) return;
    el.textContent = text || "";
    el.classList.toggle("admin-msg--error", !!isError);
    el.hidden = !text;
  }

  function readPreset() {
    try {
      var raw = localStorage.getItem(QUIZ_CREATE_PRESET_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch (_) {
      return null;
    }
  }

  function writePreset(preset) {
    try {
      localStorage.setItem(QUIZ_CREATE_PRESET_KEY, JSON.stringify(preset || {}));
    } catch (_) {}
  }

  function readQuizCreateProgress() {
    try {
      var raw = localStorage.getItem(QUIZ_CREATE_PROGRESS_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch (_) {
      return null;
    }
  }

  function writeQuizCreateProgress(progress) {
    try {
      localStorage.setItem(QUIZ_CREATE_PROGRESS_KEY, JSON.stringify(progress || {}));
    } catch (_) {}
  }

  function clearQuizCreateProgress() {
    try {
      localStorage.removeItem(QUIZ_CREATE_PROGRESS_KEY);
    } catch (_) {}
  }

  function normalizePromptTemplatesStore(parsed) {
    if (!parsed || typeof parsed !== "object") return { past: [], expected: [] };
    return {
      past: Array.isArray(parsed.past) ? parsed.past : [],
      expected: Array.isArray(parsed.expected) ? parsed.expected : []
    };
  }

  function readPromptTemplatesFromLocal() {
    try {
      var raw = localStorage.getItem(QUIZ_PROMPT_TEMPLATES_KEY);
      if (!raw) return { past: [], expected: [] };
      return normalizePromptTemplatesStore(JSON.parse(raw));
    } catch (_) {
      return { past: [], expected: [] };
    }
  }

  function writePromptTemplatesToLocal(v) {
    try {
      localStorage.setItem(QUIZ_PROMPT_TEMPLATES_KEY, JSON.stringify(v || { past: [], expected: [] }));
    } catch (_) {}
  }

  function readPromptTemplates() {
    return normalizePromptTemplatesStore(promptTemplatesCache);
  }

  function getPromptTemplateCallables() {
    if (
      typeof firebase === "undefined" ||
      !firebase.apps ||
      !firebase.apps.length ||
      !firebase.functions
    ) {
      return null;
    }
    var region = window.FIREBASE_FUNCTIONS_REGION || "asia-northeast3";
    var fns = firebase.app().functions(region);
    return {
      get: fns.httpsCallable("adminGetQuizPromptTemplates"),
      save: fns.httpsCallable("adminSaveQuizPromptTemplates")
    };
  }

  function loadPromptTemplatesFromCloud() {
    var callables = getPromptTemplateCallables();
    if (!callables) return Promise.resolve(readPromptTemplates());
    return callables
      .get({})
      .then(function (res) {
        var d = (res && res.data) || {};
        if (!d || !d.ok) return readPromptTemplates();
        var normalized = normalizePromptTemplatesStore(d.templates);
        promptTemplatesCache = normalized;
        writePromptTemplatesToLocal(normalized);
        promptTemplatesCloudLoaded = true;
        return normalized;
      })
      .catch(function () {
        return readPromptTemplates();
      });
  }

  function writePromptTemplates(v) {
    var normalized = normalizePromptTemplatesStore(v);
    promptTemplatesCache = normalized;
    writePromptTemplatesToLocal(normalized);
    var callables = getPromptTemplateCallables();
    if (!callables) return Promise.resolve(normalized);
    return callables
      .save({ templates: normalized })
      .then(function () {
        promptTemplatesCloudLoaded = true;
        return normalized;
      })
      .catch(function () {
        return normalized;
      });
  }

  function isLikelyNetworkError(err) {
    var msg = String((err && (err.message || err.details)) || "").toLowerCase();
    var code = String((err && err.code) || "").toLowerCase();
    if (!msg && !code) return false;
    return (
      code.indexOf("unavailable") >= 0 ||
      code.indexOf("deadline-exceeded") >= 0 ||
      msg.indexOf("network") >= 0 ||
      msg.indexOf("failed to fetch") >= 0 ||
      msg.indexOf("timeout") >= 0 ||
      msg.indexOf("offline") >= 0 ||
      msg.indexOf("unavailable") >= 0
    );
  }

  function waitUntilOnline() {
    if (typeof navigator === "undefined" || navigator.onLine !== false) return Promise.resolve();
    return new Promise(function (resolve) {
      function onOnline() {
        window.removeEventListener("online", onOnline);
        resolve();
      }
      window.addEventListener("online", onOnline);
    });
  }

  function callWithRetry(callable, payload, msgEl, renderMsg) {
    var attempt = 0;
    function run() {
      if (quizGenerationCancelRequested) {
        return Promise.reject(new Error("퀴즈 생성이 중단되었습니다."));
      }
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        if (typeof renderMsg === "function") setMsg(msgEl, renderMsg("오프라인 감지 · 네트워크 복구 대기 중"), true);
        return waitUntilOnline().then(run);
      }
      return callable(payload).catch(function (err) {
        if (!isLikelyNetworkError(err)) throw err;
        attempt += 1;
        if (attempt > 8) throw err;
        var waitMs = Math.min(12000, 800 * Math.pow(2, attempt - 1));
        if (typeof renderMsg === "function") {
          setMsg(msgEl, renderMsg("네트워크 오류 · 자동 재시도 " + attempt + "/8 (" + Math.round(waitMs / 1000) + "초 후)"), true);
        }
        return new Promise(function (resolve) {
          setTimeout(resolve, waitMs);
        }).then(run);
      });
    }
    return run();
  }

  /** 줄이 2개 이상이면 줄 단위, 한 줄이면 쉼표로 분리(용어사전·판례 입력과 유사) */
  function splitExpectedStatementsInput(raw) {
    var s = String(raw || "").trim();
    if (!s) return [];
    var lines = s.split(/\r?\n/).map(function (x) {
      return String(x || "").trim();
    });
    var nonEmpty = lines.filter(Boolean);
    if (nonEmpty.length > 1) return nonEmpty;
    return s.split(",").map(function (x) {
      return String(x || "").trim();
    }).filter(Boolean);
  }

  function splitIntoChunks(arr, size) {
    var src = Array.isArray(arr) ? arr : [];
    var n = Math.max(1, parseInt(size, 10) || 1);
    var out = [];
    for (var i = 0; i < src.length; i += n) out.push(src.slice(i, i + n));
    return out;
  }

  function mergeUniqueQuestionNos(base, extra) {
    var map = {};
    var out = [];
    function addAll(list) {
      for (var i = 0; i < (list ? list.length : 0); i++) {
        var q = parseInt(list[i], 10);
        if (!isFinite(q)) continue;
        if (map[q]) continue;
        map[q] = true;
        out.push(q);
      }
    }
    addAll(base);
    addAll(extra);
    out.sort(function (a, b) {
      return a - b;
    });
    return out;
  }

  function mergeGenerateResult(total, piece) {
    var all = total || { okCount: 0, failRows: [], items: [], expectedCount: 0 };
    var d = piece && piece.data ? piece.data : {};
    all.okCount += parseInt(d.okCount, 10) || 0;
    all.expectedCount += parseInt(d.expectedCount, 10) || 0;
    all.failRows = all.failRows.concat(Array.isArray(d.failRows) ? d.failRows : []);
    if (Array.isArray(d.items)) all.items = all.items.concat(d.items);
    return all;
  }

  function toPositiveInt(v, fallback) {
    var n = parseInt(v, 10);
    if (!isFinite(n) || n < 1) return fallback;
    return n;
  }

  function docChunkUnits(doc) {
    var d = doc || {};
    return toPositiveInt(d.chunkCount, toPositiveInt(d.numPages, 1));
  }

  function docPages(doc) {
    return toPositiveInt(doc && doc.numPages, 0);
  }

  function buildExpectedGenerationGroups(docs) {
    var ordered = Array.isArray(docs) ? docs : [];
    var groups = [];
    var maxUnitsPerGroup = 120;
    var cur = { docs: [], fileIds: [], unitSum: 0, pageSum: 0 };
    for (var i = 0; i < ordered.length; i++) {
      var d = ordered[i] || {};
      var fileId = String(d.id || "").trim();
      if (!fileId) continue;
      var units = docChunkUnits(d);
      var pages = docPages(d);
      if (cur.docs.length && cur.unitSum + units > maxUnitsPerGroup) {
        groups.push(cur);
        cur = { docs: [], fileIds: [], unitSum: 0, pageSum: 0 };
      }
      cur.docs.push(d);
      cur.fileIds.push(fileId);
      cur.unitSum += units;
      cur.pageSum += pages;
    }
    if (cur.docs.length) groups.push(cur);
    if (!groups.length) {
      groups.push({ docs: [], fileIds: [], unitSum: 1, pageSum: 0 });
    }
    return groups;
  }

  function allocateExpectedCounts(totalCount, groups) {
    var count = Math.max(1, parseInt(totalCount, 10) || 1);
    var g = Array.isArray(groups) ? groups : [];
    var out = [];
    var i;
    if (!g.length) return [count];
    if (g.length === 1) return [count];

    var totalUnits = 0;
    for (i = 0; i < g.length; i++) totalUnits += Math.max(1, parseInt(g[i].unitSum, 10) || 1);
    if (totalUnits < 1) totalUnits = g.length;

    var used = 0;
    for (i = 0; i < g.length; i++) {
      var units = Math.max(1, parseInt(g[i].unitSum, 10) || 1);
      var base = Math.floor((count * units) / totalUnits);
      if (base < 1) base = 1;
      out.push(base);
      used += base;
    }
    while (used > count) {
      for (i = out.length - 1; i >= 0 && used > count; i--) {
        if (out[i] > 1) {
          out[i] -= 1;
          used -= 1;
        }
      }
      break;
    }
    while (used < count) {
      for (i = 0; i < out.length && used < count; i++) {
        out[i] += 1;
        used += 1;
      }
    }
    return out;
  }

  function groupUnitRange(groups, index) {
    var g = Array.isArray(groups) ? groups : [];
    var idx = parseInt(index, 10) || 0;
    var start = 1;
    for (var i = 0; i < idx; i++) start += Math.max(1, parseInt(g[i].unitSum, 10) || 1);
    var units = Math.max(1, parseInt(g[idx] && g[idx].unitSum, 10) || 1);
    return {
      start: start,
      end: start + units - 1
    };
  }

  function scanWithAutoSplit(callable, basePayload, msgEl) {
    var fileIds = Array.isArray(basePayload.fileIds) ? basePayload.fileIds : [];
    return callWithRetry(callable, Object.assign({}, basePayload, { scanOnly: true }), msgEl, function (suffix) {
      return "문항 범위 분석 중… · " + suffix;
    }).catch(function (err) {
      if (!isLikelyNetworkError(err) || fileIds.length <= 1) throw err;
      var chunks = splitIntoChunks(fileIds, 2);
      var merged = { questionNos: [], detectedChoiceCount: 4 };
      var chain = Promise.resolve();
      chunks.forEach(function (chunk, idx) {
        chain = chain.then(function () {
          setMsg(msgEl, "문항 범위 분석 자동 분할 실행 중… (" + (idx + 1) + "/" + chunks.length + ")", false);
          return callWithRetry(
            callable,
            Object.assign({}, basePayload, { scanOnly: true, fileIds: chunk }),
            msgEl,
            function (suffix) {
              return "문항 범위 분석 자동 분할 실행 중… (" + (idx + 1) + "/" + chunks.length + ") · " + suffix;
            }
          )
            .then(function (res) {
              var d = (res && res.data) || {};
              merged.questionNos = mergeUniqueQuestionNos(merged.questionNos, Array.isArray(d.questionNos) ? d.questionNos : []);
              var c = parseInt(d.detectedChoiceCount, 10);
              if (isFinite(c) && c >= 2 && c <= 5) merged.detectedChoiceCount = Math.max(merged.detectedChoiceCount, c);
            })
            .catch(function () {
              return null;
            });
        });
      });
      return chain.then(function () {
        if (!merged.questionNos.length) throw err;
        return { data: merged };
      });
    });
  }

  function generateWithAutoSplit(callable, basePayload, msgEl, choiceCount) {
    var fileIds = Array.isArray(basePayload.fileIds) ? basePayload.fileIds : [];
    return callWithRetry(
      callable,
      Object.assign({}, basePayload, { expectedCount: choiceCount }),
      msgEl,
      function (suffix) {
        return "AI 퀴즈 생성 중… · " + suffix;
      }
    ).catch(function (err) {
      if (!isLikelyNetworkError(err) || fileIds.length <= 1) throw err;
      var chunks = splitIntoChunks(fileIds, 2);
      var total = { okCount: 0, failRows: [], items: [], expectedCount: 0 };
      var chain = Promise.resolve();
      chunks.forEach(function (chunk, idx) {
        chain = chain.then(function () {
          setMsg(msgEl, "AI 퀴즈 생성 자동 분할 실행 중… (" + (idx + 1) + "/" + chunks.length + ")", false);
          return callWithRetry(
            callable,
            Object.assign({}, basePayload, { fileIds: chunk, expectedCount: choiceCount }),
            msgEl,
            function (suffix) {
              return "AI 퀴즈 생성 자동 분할 실행 중… (" + (idx + 1) + "/" + chunks.length + ") · " + suffix;
            }
          ).then(function (res) {
            total = mergeGenerateResult(total, res);
          });
        });
      });
      return chain.then(function () {
        return { data: total };
      });
    });
  }

  function collectPresetFromForm() {
    return {
      promptPast: String(($("admin-quiz-create-prompt-past") && $("admin-quiz-create-prompt-past").value) || "").trim(),
      promptExpected: String(
        ($("admin-quiz-create-prompt-expected") && $("admin-quiz-create-prompt-expected").value) || ""
      ).trim(),
      expectedStatementsPrompt: String(
        ($("admin-quiz-create-expected-statements-prompt") &&
          $("admin-quiz-create-expected-statements-prompt").value) ||
          ""
      ).trim(),
      expectedStatements: String(
        ($("admin-quiz-create-expected-statements") && $("admin-quiz-create-expected-statements").value) || ""
      ),
      expectedStatementsCount: String(
        ($("admin-quiz-create-expected-statements-count") &&
          $("admin-quiz-create-expected-statements-count").value) ||
          ""
      ).trim(),
      examId: String(($("admin-quiz-create-exam-id") && $("admin-quiz-create-exam-id").value) || "").trim(),
      year: String(($("admin-quiz-create-year") && $("admin-quiz-create-year").value) || "").trim(),
      fastModePast: !!($("admin-quiz-create-fast-mode-past") && $("admin-quiz-create-fast-mode-past").checked),
      fastModeExpected: !!(
        $("admin-quiz-create-fast-mode-expected") && $("admin-quiz-create-fast-mode-expected").checked
      ),
      expectedCount: String(($("admin-quiz-create-expected-count") && $("admin-quiz-create-expected-count").value) || "").trim()
    };
  }

  function applyPresetToForm(preset) {
    var p = preset || {};
    var promptPastEl = $("admin-quiz-create-prompt-past");
    var promptExpectedEl = $("admin-quiz-create-prompt-expected");
    var expectedStatementsPromptEl = $("admin-quiz-create-expected-statements-prompt");
    var expectedStatementsEl = $("admin-quiz-create-expected-statements");
    var expectedStatementsCountEl = $("admin-quiz-create-expected-statements-count");
    var examEl = $("admin-quiz-create-exam-id");
    var yearEl = $("admin-quiz-create-year");
    var fastPastEl = $("admin-quiz-create-fast-mode-past");
    var fastExpectedEl = $("admin-quiz-create-fast-mode-expected");
    var expectedCountEl = $("admin-quiz-create-expected-count");
    var legacyPrompt = String(p.prompt || "").trim();
    if (promptPastEl && !String(promptPastEl.value || "").trim()) {
      promptPastEl.value = String(p.promptPast || legacyPrompt);
    }
    if (promptExpectedEl && !String(promptExpectedEl.value || "").trim()) {
      promptExpectedEl.value = String(p.promptExpected || legacyPrompt);
    }
    if (expectedStatementsEl && p.expectedStatements != null && !String(expectedStatementsEl.value || "").trim()) {
      expectedStatementsEl.value = String(p.expectedStatements);
    }
    if (examEl && p.examId != null && String(p.examId).trim()) examEl.value = String(p.examId).trim();
    if (yearEl && p.year != null && !String(yearEl.value || "").trim()) yearEl.value = String(p.year);
    var legacyFastMode = p.fastMode != null ? !!p.fastMode : false;
    if (fastPastEl && (p.fastModePast != null || p.fastMode != null)) {
      fastPastEl.checked = p.fastModePast != null ? !!p.fastModePast : legacyFastMode;
    }
    if (fastExpectedEl && (p.fastModeExpected != null || p.fastMode != null)) {
      fastExpectedEl.checked = p.fastModeExpected != null ? !!p.fastModeExpected : legacyFastMode;
    }
    if (expectedCountEl && p.expectedCount != null && !String(expectedCountEl.value || "").trim()) {
      expectedCountEl.value = String(p.expectedCount);
    }
  }

  function bindPresetPersistence() {
    var ids = [
      "admin-quiz-create-prompt-past",
      "admin-quiz-create-prompt-expected",
      "admin-quiz-create-expected-statements-prompt",
      "admin-quiz-create-expected-statements",
      "admin-quiz-create-expected-statements-count",
      "admin-quiz-create-exam-id",
      "admin-quiz-create-year",
      "admin-quiz-create-fast-mode-past",
      "admin-quiz-create-fast-mode-expected",
      "admin-quiz-create-expected-count"
    ];
    for (var i = 0; i < ids.length; i++) {
      (function (id) {
        var el = $(id);
        if (!el) return;
        var evt = el.tagName === "SELECT" ? "change" : "input";
        el.addEventListener(evt, function () {
          writePreset(collectPresetFromForm());
        });
        if (evt !== "change") {
          el.addEventListener("change", function () {
            writePreset(collectPresetFromForm());
          });
        }
      })(ids[i]);
    }
  }

  function templateSelectIdByKind(kind) {
    return kind === "expected" ? "admin-quiz-prompt-expected-list" : "admin-quiz-prompt-past-list";
  }

  function templateNameInputIdByKind(kind) {
    return kind === "expected" ? "admin-quiz-prompt-expected-name" : "admin-quiz-prompt-past-name";
  }

  function templateTextareaIdByKind(kind) {
    return kind === "expected" ? "admin-quiz-create-prompt-expected" : "admin-quiz-create-prompt-past";
  }

  function renderPromptTemplateSelect(kind) {
    var sel = $(templateSelectIdByKind(kind));
    if (!sel) return;
    var store = readPromptTemplates();
    var arr = kind === "expected" ? store.expected : store.past;
    sel.innerHTML = "";
    var base = document.createElement("option");
    base.value = "";
    base.textContent = "저장된 지침 선택";
    sel.appendChild(base);
    for (var i = 0; i < arr.length; i++) {
      var it = arr[i] || {};
      var opt = document.createElement("option");
      opt.value = String(it.id || "");
      opt.textContent = String(it.name || "이름 없음");
      sel.appendChild(opt);
    }
  }

  function savePromptTemplate(kind) {
    var nameEl = $(templateNameInputIdByKind(kind));
    var textEl = $(templateTextareaIdByKind(kind));
    var msgEl = $("admin-quiz-create-run-msg");
    var name = String((nameEl && nameEl.value) || "").trim();
    var text = String((textEl && textEl.value) || "").trim();
    if (!name) return setMsg(msgEl, "템플릿 이름을 입력해 주세요.", true);
    if (!text) return setMsg(msgEl, "저장할 지침 내용을 입력해 주세요.", true);
    var store = readPromptTemplates();
    var key = kind === "expected" ? "expected" : "past";
    var arr = Array.isArray(store[key]) ? store[key].slice() : [];
    arr.unshift({
      id: Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8),
      name: name,
      text: text,
      updatedAt: Date.now()
    });
    if (arr.length > 50) arr = arr.slice(0, 50);
    store[key] = arr;
    writePromptTemplates(store).then(function () {
      renderPromptTemplateSelect(kind);
      if (nameEl) nameEl.value = "";
      setMsg(msgEl, "지침 템플릿을 저장했습니다.", false);
    });
  }

  function loadPromptTemplate(kind) {
    var sel = $(templateSelectIdByKind(kind));
    var textEl = $(templateTextareaIdByKind(kind));
    var msgEl = $("admin-quiz-create-run-msg");
    var id = String((sel && sel.value) || "").trim();
    if (!id) return setMsg(msgEl, "불러올 템플릿을 선택해 주세요.", true);
    var store = readPromptTemplates();
    var arr = kind === "expected" ? store.expected : store.past;
    for (var i = 0; i < arr.length; i++) {
      if (String(arr[i] && arr[i].id) === id) {
        if (textEl) textEl.value = String(arr[i].text || "");
        writePreset(collectPresetFromForm());
        return setMsg(msgEl, "지침 템플릿을 불러왔습니다.", false);
      }
    }
    setMsg(msgEl, "선택한 템플릿을 찾을 수 없습니다.", true);
  }

  function deletePromptTemplate(kind) {
    var sel = $(templateSelectIdByKind(kind));
    var msgEl = $("admin-quiz-create-run-msg");
    var id = String((sel && sel.value) || "").trim();
    if (!id) return setMsg(msgEl, "삭제할 템플릿을 선택해 주세요.", true);
    var store = readPromptTemplates();
    var key = kind === "expected" ? "expected" : "past";
    var arr = Array.isArray(store[key]) ? store[key] : [];
    var next = arr.filter(function (x) {
      return String((x && x.id) || "") !== id;
    });
    if (next.length === arr.length) return setMsg(msgEl, "삭제할 템플릿을 찾을 수 없습니다.", true);
    store[key] = next;
    writePromptTemplates(store).then(function () {
      renderPromptTemplateSelect(kind);
      setMsg(msgEl, "지침 템플릿을 삭제했습니다.", false);
    });
  }

  function fillExamSelect(select) {
    if (!select || !window.EXAM_CATALOG) return;
    var prev = String(select.value || "").trim();
    select.innerHTML = "";
    window.EXAM_CATALOG.forEach(function (ex) {
      var o = document.createElement("option");
      o.value = ex.id;
      o.textContent = ex.label;
      select.appendChild(o);
    });
    if (prev) {
      for (var i = 0; i < select.options.length; i++) {
        if (select.options[i].value === prev) {
          select.value = prev;
          break;
        }
      }
    }
  }

  function inferExamIdFromText(text) {
    var s = String(text || "").toLowerCase();
    if (!s) return "";
    if (s.indexOf("변호사") >= 0) return "lawyer";
    if (s.indexOf("국가직") >= 0 && s.indexOf("9급") >= 0) return "grade9";
    if (s.indexOf("국가공무원") >= 0 && s.indexOf("9급") >= 0) return "grade9";
    if (s.indexOf("9급") >= 0) return "grade9";
    if (s.indexOf("국가직") >= 0 && s.indexOf("7급") >= 0) return "grade7";
    if (s.indexOf("국가공무원") >= 0 && s.indexOf("7급") >= 0) return "grade7";
    if (s.indexOf("7급") >= 0) return "grade7";
    if (s.indexOf("국가직") >= 0 && s.indexOf("5급") >= 0) return "grade5";
    if (s.indexOf("국가공무원") >= 0 && s.indexOf("5급") >= 0) return "grade5";
    if (s.indexOf("5급") >= 0) return "grade5";
    if (s.indexOf("소방") >= 0) return "fire";
    if (s.indexOf("해경") >= 0 || s.indexOf("해양경찰") >= 0 || s.indexOf("haekyung") >= 0) {
      return "haekyung";
    }
    if (s.indexOf("경찰") >= 0) return "police";
    if (s.indexOf("지방") >= 0) return "local";
    if (s.indexOf("관세") >= 0 || s.indexOf("세관") >= 0) return "customs";
    if (s.indexOf("교육청") >= 0) return "edu";
    if (s.indexOf("행정사") >= 0 || s.indexOf("haesaeng") >= 0) return "haesaeng";
    return "";
  }

  function inferYearFromText(text) {
    var m = String(text || "").match(/(19|20)\d{2}/);
    return m && m[0] ? String(m[0]) : "";
  }

  function detectExamYearFromFiles(files, docs) {
    var examId = "";
    var year = "";
    var i;
    var src = [];
    for (i = 0; i < (files ? files.length : 0); i++) {
      var f = files[i];
      src.push(String((f && f.name) || ""));
    }
    for (i = 0; i < (docs ? docs.length : 0); i++) {
      var d = docs[i] || {};
      src.push(String(d.title || ""));
      src.push(String(d.fileName || ""));
    }
    for (i = 0; i < src.length; i++) {
      if (!examId) examId = inferExamIdFromText(src[i]);
      if (!year) year = inferYearFromText(src[i]);
      if (examId && year) break;
    }
    return { examId: examId, year: year };
  }

  function dedupeIds(arr) {
    var out = [];
    var seen = {};
    for (var i = 0; i < (arr ? arr.length : 0); i++) {
      var id = String(arr[i] || "").trim();
      if (!id || seen[id]) continue;
      seen[id] = true;
      out.push(id);
    }
    return out;
  }

  function applyAutoMeta(meta) {
    autoMeta = { examId: String(meta.examId || ""), year: String(meta.year || "") };
    var examEl = $("admin-quiz-create-exam-id");
    var yearEl = $("admin-quiz-create-year");
    if (examEl && autoMeta.examId) examEl.value = autoMeta.examId;
    if (yearEl && autoMeta.year) yearEl.value = autoMeta.year;
    writePreset(collectPresetFromForm());
  }

  function selectedDocsForGeneration() {
    var ids = dedupeIds(uploadedLibraryIds.concat(selectedExistingLibraryIds));
    var map = {};
    for (var i = 0; i < existingLibraryDocs.length; i++) {
      var d = existingLibraryDocs[i] || {};
      if (d.id) map[d.id] = d;
    }
    var out = [];
    for (var j = 0; j < ids.length; j++) {
      if (map[ids[j]]) out.push(map[ids[j]]);
    }
    return out;
  }

  function refreshAutoMetaFromSelected() {
    var docs = selectedDocsForGeneration();
    var meta = detectExamYearFromFiles(selectedFiles, docs);
    applyAutoMeta(meta);
  }

  function renderExistingLibraryList() {
    var listEl = $("admin-quiz-create-existing-list");
    var msgEl = $("admin-quiz-create-existing-msg");
    if (!listEl) return;
    listEl.innerHTML = "";
    if (!existingLibraryDocs.length) {
      listEl.innerHTML = '<p class="admin-library-empty">선택 가능한 완료 자료가 없습니다.</p>';
      if (msgEl) msgEl.hidden = true;
      return;
    }
    for (var i = 0; i < existingLibraryDocs.length; i++) {
      var d = existingLibraryDocs[i] || {};
      var id = String(d.id || "").trim();
      if (!id) continue;
      var row = document.createElement("label");
      row.className = "admin-quiz-existing__row";
      var chk = document.createElement("input");
      chk.type = "checkbox";
      chk.value = id;
      chk.checked = selectedExistingLibraryIds.indexOf(id) >= 0;
      chk.addEventListener("change", function (e) {
        var rid = String(e.target && e.target.value ? e.target.value : "").trim();
        if (!rid) return;
        if (e.target.checked) selectedExistingLibraryIds = dedupeIds(selectedExistingLibraryIds.concat([rid]));
        else {
          selectedExistingLibraryIds = selectedExistingLibraryIds.filter(function (x) {
            return x !== rid;
          });
        }
        refreshAutoMetaFromSelected();
        renderExistingLibraryList();
      });
      var txt = document.createElement("span");
      var title = String(d.title || d.fileName || id);
      var meta = (d.category || "기타") + " · " + (d.fileKind || "file");
      txt.innerHTML =
        String(title).replace(/</g, "&lt;") +
        '<br><span class="admin-quiz-existing__meta">' +
        String(meta).replace(/</g, "&lt;") +
        " · " +
        id.replace(/</g, "&lt;") +
        "</span>";
      row.appendChild(chk);
      row.appendChild(txt);
      listEl.appendChild(row);
    }
    if (msgEl) {
      msgEl.textContent =
        "선택된 기존 자료 " +
        selectedExistingLibraryIds.length +
        "건, 이번 업로드 " +
        uploadedLibraryIds.length +
        "건";
      msgEl.hidden = false;
    }
  }

  function loadExistingLibraryDocs() {
    var listEl = $("admin-quiz-create-existing-list");
    if (listEl) listEl.innerHTML = '<p class="admin-library-empty">목록 불러오는 중…</p>';
    if (typeof firebase === "undefined" || !firebase.firestore) {
      existingLibraryDocs = [];
      renderExistingLibraryList();
      return;
    }
    firebase
      .firestore()
      .collection("hanlaw_library_files")
      .orderBy("uploadedAt", "desc")
      .limit(120)
      .get()
      .then(function (snap) {
        var docs = [];
        snap.forEach(function (doc) {
          var d = doc.data() || {};
          if (String(d.status || "") !== "complete") return;
          docs.push({
            id: doc.id,
            title: d.title || "",
            fileName: d.fileName || "",
            fileKind: d.fileKind || "",
            category: d.category || ""
          });
        });
        existingLibraryDocs = docs;
        selectedExistingLibraryIds = selectedExistingLibraryIds.filter(function (id) {
          for (var i = 0; i < docs.length; i++) {
            if (docs[i].id === id) return true;
          }
          return false;
        });
        refreshAutoMetaFromSelected();
        renderExistingLibraryList();
      })
      .catch(function () {
        existingLibraryDocs = [];
        renderExistingLibraryList();
      });
  }

  function libraryFileContentType(file) {
    var n = String((file && file.name) || "").toLowerCase();
    if (n.endsWith(".xlsx")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    return "application/pdf";
  }

  function setSelectedFiles(files) {
    selectedFiles = [];
    for (var i = 0; i < (files ? files.length : 0); i++) {
      var f = files[i];
      var n = String((f && f.name) || "");
      if (!f) continue;
      if (
        f.type === "application/pdf" ||
        f.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
        /\.pdf$/i.test(n) ||
        /\.xlsx$/i.test(n)
      ) {
        selectedFiles.push(f);
      }
    }
  }

  function buildTitle(file, idx, total) {
    var base = String((file && file.name) || "")
      .replace(/\.[^.]+$/, "")
      .trim();
    if (!base) base = "기출 자료";
    if (total <= 1) return "[퀴즈생성] " + base;
    return "[퀴즈생성] " + base + " (" + (idx + 1) + ")";
  }

  function uploadFiles() {
    var user = typeof window.getHanlawUser === "function" ? window.getHanlawUser() : null;
    var msgEl = $("admin-quiz-create-upload-msg");
    var fileEl = $("admin-quiz-create-files");
    if (!isAdminUser(user)) return setMsg(msgEl, "관리자만 사용할 수 있습니다.", true);
    if (!selectedFiles.length && fileEl && fileEl.files && fileEl.files.length) {
      setSelectedFiles(fileEl.files);
    }
    if (!selectedFiles.length) return setMsg(msgEl, "PDF/.xlsx 파일을 1개 이상 선택하세요.", true);
    if (typeof firebase === "undefined" || !firebase.functions || !firebase.storage) {
      return setMsg(msgEl, "Firebase Functions·Storage를 사용할 수 없습니다.", true);
    }

    uploadedLibraryIds = [];
    var region = window.FIREBASE_FUNCTIONS_REGION || "asia-northeast3";
    var createFn = firebase.app().functions(region).httpsCallable("createLibraryDocument");
    var category = "past_exam";
    var chain = Promise.resolve();
    for (var i = 0; i < selectedFiles.length; i++) {
      (function (idx) {
        chain = chain.then(function () {
          var f = selectedFiles[idx];
          setMsg(msgEl, "업로드·학습 시작 중… (" + (idx + 1) + "/" + selectedFiles.length + ")", false);
          return createFn({
            title: buildTitle(f, idx, selectedFiles.length),
            category: category,
            description: "퀴즈 생성용 기출 업로드",
            fileName: f.name
          })
            .then(function (res) {
              var d = res && res.data ? res.data : null;
              if (!d || !d.storagePath || !d.libraryId) {
                throw new Error("업로드 준비 응답이 올바르지 않습니다.");
              }
              uploadedLibraryIds.push(String(d.libraryId));
              return firebase
                .storage()
                .ref(d.storagePath)
                .put(f, { contentType: libraryFileContentType(f) });
            });
        });
      })(i);
    }
    chain
      .then(function () {
        return fetchLibraryDocsByIds(uploadedLibraryIds).then(function (docs) {
          var meta = detectExamYearFromFiles(selectedFiles, docs || []);
          var expected = estimateExpectedCountFromDocs(docs || []);
          applyAutoMeta(meta);
          var msg =
            "총 " +
            selectedFiles.length +
            "개 업로드 완료. 자료실 학습이 완료되면 'AI 퀴즈 생성'을 실행하세요.";
          if (meta.examId || meta.year) {
            msg +=
              " (자동 인식: 시험=" +
              (meta.examId || "미인식") +
              ", 연도=" +
              (meta.year || "미인식") +
              ")";
          }
          if (expected > 0) {
            msg += " 예상 목표 생성 건수: 약 " + expected + "건(문항수×4)";
          }
          setMsg(msgEl, msg, false);
          loadExistingLibraryDocs();
          if (typeof window.loadAdminLibraryList === "function") window.loadAdminLibraryList();
        });
      })
      .catch(function (e) {
        setMsg(msgEl, (e && e.message) || "파일 업로드에 실패했습니다.", true);
      });
  }

  function fetchLibraryDocsByIds(ids) {
    if (typeof firebase === "undefined" || !firebase.firestore) return Promise.resolve([]);
    var db = firebase.firestore();
    var tasks = ids.map(function (id) {
      return db
        .collection("hanlaw_library_files")
        .doc(id)
        .get()
        .then(function (snap) {
          return snap.exists ? Object.assign({ id: id }, snap.data() || {}) : { id: id, status: "missing" };
        });
    });
    return Promise.all(tasks);
  }

  function estimateExpectedCountFromDocs(docs) {
    var text = "";
    var i;
    for (i = 0; i < (docs ? docs.length : 0); i++) {
      var d = docs[i] || {};
      text += "\n" + String(d.title || "") + "\n" + String(d.fileName || "");
    }
    var map = {};
    var re = /(?:^|\n)\s*(\d{1,3})\s*[.)]/g;
    var m;
    while ((m = re.exec(text))) {
      var n = parseInt(m[1], 10);
      if (isFinite(n) && n >= 1 && n <= 500) map[n] = true;
    }
    var qCount = Object.keys(map).length;
    return qCount > 0 ? qCount * 4 : 0;
  }

  function renderPreview(items) {
    var box = $("admin-quiz-create-preview");
    if (!box) return;
    if (!items || !items.length) {
      box.hidden = true;
      box.innerHTML = "";
      return;
    }
    var html = ['<p><strong>생성 결과 미리보기</strong> (상위 5건)</p><ul>'];
    for (var i = 0; i < Math.min(5, items.length); i++) {
      var it = items[i] || {};
      html.push(
        "<li><strong>" +
          String(it.id || "").replace(/</g, "&lt;") +
          "</strong> · " +
          String(it.topic || "").replace(/</g, "&lt;") +
          "<br>" +
          String(it.statement || "").replace(/</g, "&lt;") +
          "</li>"
      );
    }
    html.push("</ul>");
    box.innerHTML = html.join("");
    box.hidden = false;
  }

  function renderGenerateDone(msgEl, res) {
    var d = res && res.data ? res.data : {};
    var okCount = parseInt(d.okCount, 10) || 0;
    var failRows = Array.isArray(d.failRows) ? d.failRows : [];
    var expected = parseInt(d.expectedCount, 10) || 0;
    var msg = okCount + "건을 검수 대기에 등록했습니다.";
    if (expected > 0) msg += " (목표 " + expected + "건)";
    if (failRows.length) msg += " 실패 " + failRows.length + "건.";
    if (failRows.length) {
      var previewFail = failRows
        .slice(0, 3)
        .map(function (f) {
          return "#" + String(f.index || "?") + " " + String(f.reason || "형식 오류");
        })
        .join(" | ");
      msg += " 예: " + previewFail;
    }
    setMsg(msgEl, msg + " 검수·승인 탭에서 최종 승인하세요.", false);
    renderPreview(Array.isArray(d.items) ? d.items : []);
    var adminTab = $("admin-tab-review");
    if (adminTab && typeof adminTab.click === "function") adminTab.click();
    if (typeof window.loadAdminReviewQueue === "function") window.loadAdminReviewQueue();
  }

  function executePairJobsWithResume(callable, msgEl, state) {
    var safeState = state || {};
    var pairJobs = Array.isArray(safeState.pairJobs) ? safeState.pairJobs : [];
    var basePayload = safeState.basePayload || {};
    if (!pairJobs.length) return Promise.resolve({ data: safeState.all || {} });
    var nextIndex = parseInt(safeState.nextIndex, 10);
    if (!isFinite(nextIndex) || nextIndex < 0) nextIndex = 0;
    var all = safeState.all || { okCount: 0, failRows: [], items: [], expectedCount: pairJobs.length };
    var chain = Promise.resolve();
    for (var idx = nextIndex; idx < pairJobs.length; idx++) {
      (function (jobIndex) {
        chain = chain.then(function () {
          if (quizGenerationCancelRequested) throw new Error("퀴즈 생성이 중단되었습니다.");
          var job = pairJobs[jobIndex];
          var prefix =
            "AI 퀴즈 생성 중… (" +
            (jobIndex + 1) +
            "/" +
            pairJobs.length +
            ") · " +
            job.qNo +
            "번 문제의 " +
            job.cNo +
            "번 지문 퀴즈 생성 중";
          setMsg(msgEl, prefix, false);
          return callWithRetry(
            callable,
            Object.assign({}, basePayload, {
              questionOnly: job.qNo,
              choiceOnly: job.cNo,
              expectedCount: 1,
              excludeStatements: (all.items || [])
                .map(function (it) {
                  return String((it && it.statement) || "").trim();
                })
                .filter(Boolean)
                .slice(-120)
            }),
            msgEl,
            function (suffix) {
              return prefix + " · " + suffix;
            }
          ).then(function (res) {
            var d = res && res.data ? res.data : {};
            all.okCount += parseInt(d.okCount, 10) || 0;
            all.failRows = all.failRows.concat(Array.isArray(d.failRows) ? d.failRows : []);
            if (Array.isArray(d.items)) all.items = all.items.concat(d.items);
            safeState.nextIndex = jobIndex + 1;
            safeState.all = all;
            safeState.updatedAt = Date.now();
            writeQuizCreateProgress(safeState);
          });
        });
      })(idx);
    }
    return chain.then(function () {
      return { data: all };
    });
  }

  function resumeQuizGenerationIfNeeded() {
    if (quizGenerationRunning) return;
    var state = readQuizCreateProgress();
    if (!state || state.kind !== "pair-jobs") return;
    var pairJobs = Array.isArray(state.pairJobs) ? state.pairJobs : [];
    var nextIndex = parseInt(state.nextIndex, 10);
    if (!pairJobs.length || (isFinite(nextIndex) && nextIndex >= pairJobs.length)) {
      clearQuizCreateProgress();
      return;
    }
    if (typeof firebase === "undefined" || !firebase.functions) return;
    var msgEl = $("admin-quiz-create-run-msg");
    var region = window.FIREBASE_FUNCTIONS_REGION || "asia-northeast3";
    var callable = firebase.app().functions(region).httpsCallable("adminGenerateQuizFromLibrary");
    quizGenerationRunning = true;
    quizGenerationCancelRequested = false;
    setMsg(msgEl, "이전 퀴즈 생성 작업을 이어서 진행합니다…", false);
    executePairJobsWithResume(callable, msgEl, state)
      .then(function (res) {
        clearQuizCreateProgress();
        renderGenerateDone(msgEl, res);
      })
      .catch(function (e) {
        var msg = (e && e.message) || "이전 퀴즈 생성 이어하기에 실패했습니다.";
        if (msg.indexOf("중단") >= 0) {
          clearQuizCreateProgress();
          setMsg(msgEl, "퀴즈 생성이 중단되었습니다. 다시 시작하려면 'AI 퀴즈 생성·검수 대기 등록'을 누르세요.", false);
          return;
        }
        setMsg(msgEl, msg + " (네트워크 복구 후 자동으로 다시 이어집니다)", true);
      })
      .finally(function () {
        quizGenerationRunning = false;
      });
  }

  function runGenerate() {
    var user = typeof window.getHanlawUser === "function" ? window.getHanlawUser() : null;
    var msgEl = $("admin-quiz-create-run-msg");
    var prompt = String(($("admin-quiz-create-prompt-past") && $("admin-quiz-create-prompt-past").value) || "").trim();
    var examId = String(($("admin-quiz-create-exam-id") && $("admin-quiz-create-exam-id").value) || "").trim();
    var year = parseInt(($("admin-quiz-create-year") && $("admin-quiz-create-year").value) || "", 10);
    var fastMode = !!(
      $("admin-quiz-create-fast-mode-past") && $("admin-quiz-create-fast-mode-past").checked
    );
    var startNo = parseInt(($("admin-quiz-create-start-no") && $("admin-quiz-create-start-no").value) || "", 10);
    var endNo = parseInt(($("admin-quiz-create-end-no") && $("admin-quiz-create-end-no").value) || "", 10);
    if (!isFinite(startNo)) startNo = null;
    if (!isFinite(endNo)) endNo = null;
    if (startNo != null && (startNo < 1 || startNo > 500)) {
      return setMsg(msgEl, "시작 문제번호는 1~500 범위로 입력해 주세요.", true);
    }
    if (endNo != null && (endNo < 1 || endNo > 500)) {
      return setMsg(msgEl, "끝 문제번호는 1~500 범위로 입력해 주세요.", true);
    }
    if (startNo != null && endNo != null && endNo < startNo) {
      return setMsg(msgEl, "끝 문제번호는 시작 문제번호보다 크거나 같아야 합니다.", true);
    }
    if (quizGenerationRunning) return setMsg(msgEl, "이미 퀴즈 생성 작업이 진행 중입니다. 잠시만 기다려 주세요.", true);
    if (!isAdminUser(user)) return setMsg(msgEl, "관리자만 사용할 수 있습니다.", true);
    if (!prompt) return setMsg(msgEl, "생성 지시를 입력해 주세요.", true);
    var selectedIds = dedupeIds(uploadedLibraryIds.concat(selectedExistingLibraryIds));
    if (!selectedIds.length) {
      return setMsg(msgEl, "기존 자료를 1개 이상 선택하거나 새 파일을 업로드해 주세요.", true);
    }
    if (!examId) return setMsg(msgEl, "파일에서 시험 종류를 자동 인식하지 못했습니다. 파일명에 시험명을 포함해 주세요.", true);
    if (!Number.isFinite(year)) return setMsg(msgEl, "파일에서 연도를 자동 인식하지 못했습니다. 파일명에 연도(예: 2026)를 포함해 주세요.", true);
    if (typeof firebase === "undefined" || !firebase.functions) {
      return setMsg(msgEl, "Firebase Functions를 사용할 수 없습니다.", true);
    }

    quizGenerationRunning = true;
    quizGenerationCancelRequested = false;
    setMsg(msgEl, "업로드 파일 상태 확인 중…", false);
    fetchLibraryDocsByIds(selectedIds)
      .then(function (docs) {
        var expected = estimateExpectedCountFromDocs(docs || []);
        if (docs.length) {
          var pending = docs.filter(function (d) {
            return d && d.status !== "complete";
          });
          if (pending.length) {
            throw new Error(
              "업로드한 파일 중 학습이 아직 완료되지 않은 항목이 있습니다. (예: " +
                String(pending[0].title || pending[0].id || "") +
                ") 자료실에서 상태가 '완료'가 되면 다시 시도해 주세요."
            );
          }
        }
        setMsg(msgEl, "AI 퀴즈 생성 중…", false);
        var region = window.FIREBASE_FUNCTIONS_REGION || "asia-northeast3";
        var callable = firebase.app().functions(region).httpsCallable("adminGenerateQuizFromLibrary");
        var basePayload = {
          prompt: prompt,
          examId: examId,
          year: year,
          generateAll: true,
          fastMode: fastMode,
          inferredExamId: examId,
          inferredYear: year,
          expectedCount: expected || undefined,
          fileIds: selectedIds,
          questionStartNo: startNo != null ? startNo : undefined,
          questionEndNo: endNo != null ? endNo : undefined
        };
        return scanWithAutoSplit(callable, basePayload, msgEl).then(function (scanRes) {
          var scan = (scanRes && scanRes.data) || {};
          var questionNosRaw = Array.isArray(scan.questionNos) ? scan.questionNos : [];
          var questionNos = questionNosRaw.filter(function (n) {
            var q = parseInt(n, 10);
            if (!isFinite(q)) return false;
            if (startNo != null && q < startNo) return false;
            if (endNo != null && q > endNo) return false;
            return true;
          });
          // PDF/RAG 스캔이 번호를 못 잡아도, 관리자가 지정한 범위가 있으면 그 범위를 신뢰해 진행한다.
          if (!questionNos.length && (startNo != null || endNo != null)) {
            var forcedStart = startNo != null ? startNo : 1;
            var forcedEnd = endNo != null ? endNo : forcedStart;
            if (forcedEnd < forcedStart) {
              var tmp = forcedStart;
              forcedStart = forcedEnd;
              forcedEnd = tmp;
            }
            for (var fq = forcedStart; fq <= forcedEnd; fq++) questionNos.push(fq);
          }
          var choiceCount = parseInt(scan.detectedChoiceCount, 10);
          if (!isFinite(choiceCount) || choiceCount < 2 || choiceCount > 5) choiceCount = 4;
          if (!questionNos.length) {
            return generateWithAutoSplit(callable, basePayload, msgEl, choiceCount).then(function (res) {
              return { data: (res && res.data) || {} };
            });
          }
          var state = {
            kind: "pair-jobs",
            startedAt: Date.now(),
            updatedAt: Date.now(),
            basePayload: basePayload,
            pairJobs: [],
            nextIndex: 0,
            all: {
              okCount: 0,
              failRows: [],
              items: [],
              expectedCount: questionNos.length * choiceCount
            }
          };
          for (var qi = 0; qi < questionNos.length; qi++) {
            for (var ci = 1; ci <= choiceCount; ci++) {
              state.pairJobs.push({ qNo: questionNos[qi], cNo: ci });
            }
          }
          writeQuizCreateProgress(state);
          return executePairJobsWithResume(callable, msgEl, state);
        });
      })
      .then(function (res) {
        clearQuizCreateProgress();
        renderGenerateDone(msgEl, res);
      })
      .catch(function (e) {
        var msg = (e && e.message) || "AI 퀴즈 생성에 실패했습니다.";
        if (msg.indexOf("중단") >= 0) {
          clearQuizCreateProgress();
          setMsg(msgEl, "퀴즈 생성이 중단되었습니다. 설정을 확인한 뒤 다시 실행하세요.", false);
          return;
        }
        var low = String(msg).toLowerCase();
        if (low === "internal" || low.indexOf("deadline") >= 0 || low.indexOf("timeout") >= 0) {
          msg =
            "서버 생성 작업 시간이 초과되었습니다. 파일 수를 줄이거나 생성 지시를 간결하게 줄여 다시 시도해 주세요.";
        }
        setMsg(msgEl, msg + " (네트워크 문제라면 자동 이어하기 대상이 저장되어 있습니다.)", true);
      })
      .finally(function () {
        quizGenerationRunning = false;
        quizGenerationCancelRequested = false;
      });
  }

  function appendExpectedToneRule(promptText) {
    var toneRule =
      "문체 규칙: 모든 문제 문장, 선택지, 해설은 반드시 존댓말(하십시오체)로 작성합니다. 반말·구어체는 사용하지 않습니다.";
    var t = String(promptText || "").trim();
    if (!t) return t;
    if (t.indexOf("존댓말") >= 0 || t.indexOf("하십시오체") >= 0) return t;
    return t + "\n\n" + toneRule;
  }

  /** 자료실 교재 선택 필수 */
  function runExpectedLibraryGenerate() {
    var user = typeof window.getHanlawUser === "function" ? window.getHanlawUser() : null;
    var msgEl = $("admin-quiz-create-run-msg");
    var prompt = String(
      ($("admin-quiz-create-prompt-expected") && $("admin-quiz-create-prompt-expected").value) || ""
    ).trim();
    var promptFinal = appendExpectedToneRule(prompt);
    var fastMode = !!(
      $("admin-quiz-create-fast-mode-expected") && $("admin-quiz-create-fast-mode-expected").checked
    );
    var expectedCount = parseInt(($("admin-quiz-create-expected-count") && $("admin-quiz-create-expected-count").value) || "", 10);
    if (!isFinite(expectedCount)) expectedCount = 30;
    if (expectedCount < 1 || expectedCount > 200) {
      return setMsg(msgEl, "예상문제 생성 개수는 1~200 범위로 입력해 주세요.", true);
    }
    if (quizGenerationRunning) return setMsg(msgEl, "이미 퀴즈 생성 작업이 진행 중입니다. 잠시만 기다려 주세요.", true);
    if (!isAdminUser(user)) return setMsg(msgEl, "관리자만 사용할 수 있습니다.", true);
    if (!prompt) {
      return setMsg(msgEl, "교재 기반 생성은 위 칸에 생성 지시를 입력해 주세요.", true);
    }
    var selectedIds = dedupeIds(uploadedLibraryIds.concat(selectedExistingLibraryIds));
    if (!selectedIds.length) {
      return setMsg(
        msgEl,
        "교재 기반 생성이므로 자료실 교재·해설 파일을 1개 이상 선택하거나 업로드해 주세요.",
        true
      );
    }
    if (typeof firebase === "undefined" || !firebase.functions) {
      return setMsg(msgEl, "Firebase Functions를 사용할 수 없습니다.", true);
    }

    quizGenerationRunning = true;
    quizGenerationCancelRequested = false;
    setMsg(msgEl, "예상문제 생성 준비 중…", false);
    fetchLibraryDocsByIds(selectedIds)
      .then(function (docs) {
        if (docs.length) {
          var pending = docs.filter(function (d) {
            return d && d.status !== "complete";
          });
          if (pending.length) {
            throw new Error(
              "업로드한 파일 중 학습이 아직 완료되지 않은 항목이 있습니다. (예: " +
                String(pending[0].title || pending[0].id || "") +
                ") 자료실에서 상태가 '완료'가 된 뒤 다시 시도해 주세요."
            );
          }
        }
        var region = window.FIREBASE_FUNCTIONS_REGION || "asia-northeast3";
        var callable = firebase.app().functions(region).httpsCallable("adminGenerateExpectedQuizFromLibrary");
        var map = {};
        for (var di = 0; di < docs.length; di++) {
          var dd = docs[di] || {};
          if (dd.id) map[String(dd.id)] = dd;
        }
        var orderedDocs = selectedIds.map(function (id) {
          return map[id] || { id: id, title: id, chunkCount: 1, numPages: 0 };
        });
        var groups = buildExpectedGenerationGroups(orderedDocs);
        var groupCounts = allocateExpectedCounts(expectedCount, groups);
        var totalUnits = 0;
        var totalPages = 0;
        for (var gi = 0; gi < groups.length; gi++) {
          totalUnits += Math.max(1, parseInt(groups[gi].unitSum, 10) || 1);
          totalPages += Math.max(0, parseInt(groups[gi].pageSum, 10) || 0);
        }
        setMsg(
          msgEl,
          "AI 예상문제 생성 시작… 전체 약 " +
            totalUnits +
            "개 청크" +
            (totalPages > 0 ? " / 약 " + totalPages + "쪽" : "") +
            ", " +
            groups.length +
            "개 구간으로 나누어 생성합니다.",
          false
        );

        var total = { okCount: 0, failRows: [], items: [], expectedCount: 0 };
        var chain = Promise.resolve();
        for (var idx = 0; idx < groups.length; idx++) {
          (function (groupIndex) {
            chain = chain.then(function () {
              if (quizGenerationCancelRequested) throw new Error("예상문제 생성이 중단되었습니다.");
              var group = groups[groupIndex];
              var range = groupUnitRange(groups, groupIndex);
              var firstDoc = (group.docs && group.docs[0]) || {};
              var firstTitle = String(firstDoc.title || firstDoc.fileName || firstDoc.id || "자료").trim();
              var prefix =
                "AI 예상문제 생성 중… (" +
                (groupIndex + 1) +
                "/" +
                groups.length +
                ") · 청크 " +
                range.start +
                "~" +
                range.end +
                "/" +
                totalUnits +
                (group.pageSum > 0 ? " · 약 " + group.pageSum + "쪽 구간" : "") +
                " · " +
                firstTitle;
              setMsg(msgEl, prefix, false);
              return callWithRetry(
                callable,
                {
                  prompt: promptFinal,
                  count: groupCounts[groupIndex],
                  fastMode: fastMode,
                  fileIds: group.fileIds
                },
                msgEl,
                function (suffix) {
                  return prefix + " · " + suffix;
                }
              ).then(function (res) {
                total = mergeGenerateResult(total, res);
                setMsg(
                  msgEl,
                  prefix +
                    " · 완료 (누적 " +
                    (parseInt(total.okCount, 10) || 0) +
                    "건 / 목표 " +
                    expectedCount +
                    "건)",
                  false
                );
              });
            });
          })(idx);
        }
        return chain.then(function () {
          return { data: total };
        });
      })
      .then(function (res) {
        renderGenerateDone(msgEl, res);
      })
      .catch(function (e) {
        var msg = (e && e.message) || "AI 예상문제 생성에 실패했습니다.";
        if (msg.indexOf("중단") >= 0) {
          setMsg(msgEl, "예상문제 생성이 중단되었습니다. 설정을 확인한 뒤 다시 실행하세요.", false);
          return;
        }
        setMsg(msgEl, msg, true);
      })
      .finally(function () {
        quizGenerationRunning = false;
        quizGenerationCancelRequested = false;
      });
  }

  /** 교재 선택은 선택. 없으면 일반 지식 모드(useLibraryRag false) */
  function runExpectedStatementsGenerate() {
    var user = typeof window.getHanlawUser === "function" ? window.getHanlawUser() : null;
    var msgEl = $("admin-quiz-create-run-msg");
    var stmPrompt = String(
      ($("admin-quiz-create-expected-statements-prompt") &&
        $("admin-quiz-create-expected-statements-prompt").value) ||
        ""
    ).trim();
    var statementList = splitExpectedStatementsInput(
      ($("admin-quiz-create-expected-statements") && $("admin-quiz-create-expected-statements").value) || ""
    );
    var maxStmt = parseInt(
      ($("admin-quiz-create-expected-statements-count") &&
        $("admin-quiz-create-expected-statements-count").value) ||
        "",
      10
    );
    if (!isFinite(maxStmt)) maxStmt = 80;
    if (maxStmt < 1) maxStmt = 1;
    if (maxStmt > 80) maxStmt = 80;
    statementList = statementList.slice(0, maxStmt);
    var promptFinal = appendExpectedToneRule(stmPrompt);
    var fastMode = !!(
      $("admin-quiz-create-fast-mode-expected") && $("admin-quiz-create-fast-mode-expected").checked
    );
    if (quizGenerationRunning) return setMsg(msgEl, "이미 퀴즈 생성 작업이 진행 중입니다. 잠시만 기다려 주세요.", true);
    if (!isAdminUser(user)) return setMsg(msgEl, "관리자만 사용할 수 있습니다.", true);
    if (!stmPrompt) {
      return setMsg(msgEl, "문장 기반 생성은 ‘생성 지침’을 입력해 주세요.", true);
    }
    if (!statementList.length) {
      return setMsg(msgEl, "OX 판단문을 한 줄 이상 입력해 주세요.", true);
    }
    if (typeof firebase === "undefined" || !firebase.functions) {
      return setMsg(msgEl, "Firebase Functions를 사용할 수 없습니다.", true);
    }

    var selectedIds = dedupeIds(uploadedLibraryIds.concat(selectedExistingLibraryIds));
    var useLibraryRag = selectedIds.length > 0;

    quizGenerationRunning = true;
    quizGenerationCancelRequested = false;
    setMsg(msgEl, "예상문제(문장) 생성 준비 중…", false);

    var afterDocs = Promise.resolve();
    if (useLibraryRag) {
      afterDocs = fetchLibraryDocsByIds(selectedIds).then(function (docs) {
        if (docs.length) {
          var pending = docs.filter(function (d) {
            return d && d.status !== "complete";
          });
          if (pending.length) {
            throw new Error(
              "업로드한 파일 중 학습이 아직 완료되지 않은 항목이 있습니다. (예: " +
                String(pending[0].title || pending[0].id || "") +
                ") 자료실에서 상태가 '완료'가 된 뒤 다시 시도하거나, 교재 선택을 해제하세요."
            );
          }
        }
      });
    }

    afterDocs
      .then(function () {
        setMsg(
          msgEl,
          (useLibraryRag ? "자료실 근거 · " : "일반 해설 · ") +
            "문장 " +
            statementList.length +
            "개 처리 중…",
          false
        );
        var region = window.FIREBASE_FUNCTIONS_REGION || "asia-northeast3";
        var callableSt = firebase
          .app()
          .functions(region)
          .httpsCallable("adminGenerateExpectedQuizFromStatements");
        return callWithRetry(
          callableSt,
          {
            prompt: promptFinal,
            statements: statementList,
            fastMode: fastMode,
            fileIds: useLibraryRag ? selectedIds : [],
            useLibraryRag: useLibraryRag
          },
          msgEl,
          function (suffix) {
            return "문장별 예상문제 · " + suffix;
          }
        );
      })
      .then(function (res) {
        renderGenerateDone(msgEl, res);
      })
      .catch(function (e) {
        var msg = (e && e.message) || "AI 예상문제 생성에 실패했습니다.";
        if (msg.indexOf("중단") >= 0) {
          setMsg(msgEl, "예상문제 생성이 중단되었습니다. 설정을 확인한 뒤 다시 실행하세요.", false);
          return;
        }
        setMsg(msgEl, msg, true);
      })
      .finally(function () {
        quizGenerationRunning = false;
        quizGenerationCancelRequested = false;
      });
  }

  function stopGenerate() {
    var user = typeof window.getHanlawUser === "function" ? window.getHanlawUser() : null;
    var msgEl = $("admin-quiz-create-run-msg");
    if (!isAdminUser(user)) return setMsg(msgEl, "관리자만 사용할 수 있습니다.", true);
    if (!quizGenerationRunning && !readQuizCreateProgress()) {
      return setMsg(msgEl, "현재 진행 중이거나 이어하기 대상인 생성 작업이 없습니다.", true);
    }
    quizGenerationCancelRequested = true;
    clearQuizCreateProgress();
    setMsg(msgEl, "퀴즈 생성 중단 요청을 보냈습니다. 현재 호출이 끝나면 즉시 중단됩니다.", false);
  }

  function refreshVisibility() {
    var box = $("admin-quiz-create-admin");
    var user = typeof window.getHanlawUser === "function" ? window.getHanlawUser() : null;
    if (box) box.hidden = !isAdminUser(user);
  }

  function bindDropzone() {
    var dz = $("admin-quiz-create-dropzone");
    var fileEl = $("admin-quiz-create-files");
    if (!dz || !fileEl) return;
    ["dragenter", "dragover"].forEach(function (evt) {
      dz.addEventListener(evt, function (e) {
        e.preventDefault();
        e.stopPropagation();
        dz.classList.add("admin-excel-dropzone--active");
      });
    });
    ["dragleave", "drop"].forEach(function (evt) {
      dz.addEventListener(evt, function (e) {
        e.preventDefault();
        e.stopPropagation();
        dz.classList.remove("admin-excel-dropzone--active");
      });
    });
    dz.addEventListener("drop", function (e) {
      var files = (e.dataTransfer && e.dataTransfer.files) || [];
      setSelectedFiles(files);
      try {
        fileEl.files = files;
      } catch (_) {}
    });
    dz.addEventListener("click", function () {
      fileEl.click();
    });
    dz.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        fileEl.click();
      }
    });
  }

  function bind() {
    promptTemplatesCache = readPromptTemplatesFromLocal();
    fillExamSelect($("admin-quiz-create-exam-id"));
    applyPresetToForm(readPreset());
    var examEl = $("admin-quiz-create-exam-id");
    var yearEl = $("admin-quiz-create-year");
    if (examEl) examEl.disabled = true;
    if (yearEl) yearEl.readOnly = true;
    var y = $("admin-quiz-create-year");
    if (y && !y.value) y.value = String(new Date().getFullYear());
    bindPresetPersistence();
    var fileEl = $("admin-quiz-create-files");
    if (fileEl) {
      fileEl.addEventListener("change", function () {
        setSelectedFiles(fileEl.files || []);
        applyAutoMeta(detectExamYearFromFiles(selectedFiles, []));
      });
    }
    var btnExistingRefresh = $("admin-quiz-create-existing-refresh");
    if (btnExistingRefresh) btnExistingRefresh.addEventListener("click", loadExistingLibraryDocs);
    var btnUp = $("admin-quiz-create-upload");
    if (btnUp) btnUp.addEventListener("click", uploadFiles);
    var btnRun = $("admin-quiz-create-run");
    if (btnRun) btnRun.addEventListener("click", runGenerate);
    var btnExpectedLibrary = $("admin-quiz-create-expected-run-library");
    var btnExpectedStatements = $("admin-quiz-create-expected-run-statements");
    if (btnExpectedLibrary) btnExpectedLibrary.addEventListener("click", runExpectedLibraryGenerate);
    if (btnExpectedStatements) btnExpectedStatements.addEventListener("click", runExpectedStatementsGenerate);
    var btnPastSave = $("admin-quiz-prompt-past-save");
    if (btnPastSave) btnPastSave.addEventListener("click", function () { savePromptTemplate("past"); });
    var btnPastLoad = $("admin-quiz-prompt-past-load");
    if (btnPastLoad) btnPastLoad.addEventListener("click", function () { loadPromptTemplate("past"); });
    var btnPastDelete = $("admin-quiz-prompt-past-delete");
    if (btnPastDelete) btnPastDelete.addEventListener("click", function () { deletePromptTemplate("past"); });
    var btnExpectedSave = $("admin-quiz-prompt-expected-save");
    if (btnExpectedSave) btnExpectedSave.addEventListener("click", function () { savePromptTemplate("expected"); });
    var btnExpectedLoad = $("admin-quiz-prompt-expected-load");
    if (btnExpectedLoad) btnExpectedLoad.addEventListener("click", function () { loadPromptTemplate("expected"); });
    var btnExpectedDelete = $("admin-quiz-prompt-expected-delete");
    if (btnExpectedDelete) btnExpectedDelete.addEventListener("click", function () { deletePromptTemplate("expected"); });
    var btnStop = $("admin-quiz-create-stop");
    if (btnStop) btnStop.addEventListener("click", stopGenerate);
    bindDropzone();
    renderPromptTemplateSelect("past");
    renderPromptTemplateSelect("expected");
    loadPromptTemplatesFromCloud().then(function () {
      renderPromptTemplateSelect("past");
      renderPromptTemplateSelect("expected");
    });
    loadExistingLibraryDocs();
    refreshVisibility();
    resumeQuizGenerationIfNeeded();
    window.addEventListener("app-auth", refreshVisibility);
    window.addEventListener("app-auth", function () {
      if (!promptTemplatesCloudLoaded) {
        loadPromptTemplatesFromCloud().then(function () {
          renderPromptTemplateSelect("past");
          renderPromptTemplateSelect("expected");
        });
      }
    });
    window.addEventListener("membership-updated", refreshVisibility);
    window.addEventListener("online", resumeQuizGenerationIfNeeded);
    window.addEventListener("question-bank-updated", function () {
      fillExamSelect($("admin-quiz-create-exam-id"));
    });
  }

  document.addEventListener("DOMContentLoaded", bind);
})();
