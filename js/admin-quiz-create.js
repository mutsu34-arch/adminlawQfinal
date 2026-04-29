(function () {
  var selectedFiles = [];
  var uploadedLibraryIds = [];
  var selectedExistingLibraryIds = [];
  var existingLibraryDocs = [];
  var QUIZ_CREATE_PRESET_KEY = "hanlaw_admin_quiz_create_preset_v1";
  var QUIZ_CREATE_PROGRESS_KEY = "hanlaw_admin_quiz_create_progress_v1";
  var autoMeta = { examId: "", year: "" };
  var quizGenerationRunning = false;

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
      prompt: String(($("admin-quiz-create-prompt") && $("admin-quiz-create-prompt").value) || "").trim(),
      examId: String(($("admin-quiz-create-exam-id") && $("admin-quiz-create-exam-id").value) || "").trim(),
      year: String(($("admin-quiz-create-year") && $("admin-quiz-create-year").value) || "").trim(),
      fastMode: !!($("admin-quiz-create-fast-mode") && $("admin-quiz-create-fast-mode").checked)
    };
  }

  function applyPresetToForm(preset) {
    var p = preset || {};
    var promptEl = $("admin-quiz-create-prompt");
    var examEl = $("admin-quiz-create-exam-id");
    var yearEl = $("admin-quiz-create-year");
    var fastEl = $("admin-quiz-create-fast-mode");
    if (promptEl && p.prompt != null && !String(promptEl.value || "").trim()) promptEl.value = String(p.prompt);
    if (examEl && p.examId != null && String(p.examId).trim()) examEl.value = String(p.examId).trim();
    if (yearEl && p.year != null && !String(yearEl.value || "").trim()) yearEl.value = String(p.year);
    if (fastEl && p.fastMode != null) fastEl.checked = !!p.fastMode;
  }

  function bindPresetPersistence() {
    var ids = [
      "admin-quiz-create-prompt",
      "admin-quiz-create-exam-id",
      "admin-quiz-create-year",
      "admin-quiz-create-fast-mode"
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

  function fillExamSelect(select) {
    if (!select || !window.EXAM_CATALOG) return;
    select.innerHTML = "";
    window.EXAM_CATALOG.forEach(function (ex) {
      var o = document.createElement("option");
      o.value = ex.id;
      o.textContent = ex.label;
      select.appendChild(o);
    });
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
    if (s.indexOf("경찰") >= 0) return "police";
    if (s.indexOf("지방") >= 0) return "local";
    if (s.indexOf("관세") >= 0 || s.indexOf("세관") >= 0) return "customs";
    if (s.indexOf("교육청") >= 0) return "edu";
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
    setMsg(msgEl, "이전 퀴즈 생성 작업을 이어서 진행합니다…", false);
    executePairJobsWithResume(callable, msgEl, state)
      .then(function (res) {
        clearQuizCreateProgress();
        renderGenerateDone(msgEl, res);
      })
      .catch(function (e) {
        var msg = (e && e.message) || "이전 퀴즈 생성 이어하기에 실패했습니다.";
        setMsg(msgEl, msg + " (네트워크 복구 후 자동으로 다시 이어집니다)", true);
      })
      .finally(function () {
        quizGenerationRunning = false;
      });
  }

  function runGenerate() {
    var user = typeof window.getHanlawUser === "function" ? window.getHanlawUser() : null;
    var msgEl = $("admin-quiz-create-run-msg");
    var prompt = String(($("admin-quiz-create-prompt") && $("admin-quiz-create-prompt").value) || "").trim();
    var examId = String(($("admin-quiz-create-exam-id") && $("admin-quiz-create-exam-id").value) || "").trim();
    var year = parseInt(($("admin-quiz-create-year") && $("admin-quiz-create-year").value) || "", 10);
    var fastMode = !!($("admin-quiz-create-fast-mode") && $("admin-quiz-create-fast-mode").checked);
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
        var low = String(msg).toLowerCase();
        if (low === "internal" || low.indexOf("deadline") >= 0 || low.indexOf("timeout") >= 0) {
          msg =
            "서버 생성 작업 시간이 초과되었습니다. 파일 수를 줄이거나 생성 지시를 간결하게 줄여 다시 시도해 주세요.";
        }
        setMsg(msgEl, msg + " (네트워크 문제라면 자동 이어하기 대상이 저장되어 있습니다.)", true);
      })
      .finally(function () {
        quizGenerationRunning = false;
      });
  }

  function hideBundledQuizSet() {
    var user = typeof window.getHanlawUser === "function" ? window.getHanlawUser() : null;
    var msgEl = $("admin-quiz-create-run-msg");
    if (!isAdminUser(user)) return setMsg(msgEl, "관리자만 사용할 수 있습니다.", true);
    if (typeof window.softHideBundledQuestion !== "function") {
      return setMsg(msgEl, "기본 퀴즈 숨김 함수를 찾지 못했습니다.", true);
    }
    var staticList = Array.isArray(window.QUESTION_BANK_STATIC) ? window.QUESTION_BANK_STATIC : [];
    var ids = staticList
      .map(function (q) {
        return q && q.id ? String(q.id).trim() : "";
      })
      .filter(Boolean);
    if (!ids.length) return setMsg(msgEl, "숨김 처리할 기본 퀴즈가 없습니다.", false);
    if (!window.confirm("기본 퀴즈 " + ids.length + "개를 모두 숨김 처리할까요?")) return;
    var done = 0;
    var fail = 0;
    setMsg(msgEl, "기본 퀴즈 숨김 처리 중... (0/" + ids.length + ")", false);
    var chain = Promise.resolve();
    ids.forEach(function (id) {
      chain = chain.then(function () {
        return window
          .softHideBundledQuestion(id)
          .catch(function () {
            fail += 1;
            return null;
          })
          .then(function () {
            done += 1;
            setMsg(msgEl, "기본 퀴즈 숨김 처리 중... (" + done + "/" + ids.length + ")", false);
          });
      });
    });
    chain.then(function () {
      setMsg(msgEl, "기본 퀴즈 숨김 완료: 성공 " + (ids.length - fail) + "개, 실패 " + fail + "개", fail > 0);
    });
  }

  function restoreBundledQuizSet() {
    var user = typeof window.getHanlawUser === "function" ? window.getHanlawUser() : null;
    var msgEl = $("admin-quiz-create-run-msg");
    if (!isAdminUser(user)) return setMsg(msgEl, "관리자만 사용할 수 있습니다.", true);
    if (typeof window.restoreHiddenBundledQuestions !== "function") {
      return setMsg(msgEl, "숨김 퀴즈 복구 함수를 찾지 못했습니다.", true);
    }
    if (!window.confirm("숨김 처리된 기본 퀴즈를 복구할까요?")) return;
    setMsg(msgEl, "숨김 퀴즈 복구 중...", false);
    window
      .restoreHiddenBundledQuestions()
      .then(function (res) {
        var total = res && typeof res.total === "number" ? res.total : 0;
        var restored = res && typeof res.restored === "number" ? res.restored : 0;
        var failed = res && typeof res.failed === "number" ? res.failed : 0;
        setMsg(
          msgEl,
          "숨김 퀴즈 복구 완료: 대상 " + total + "개, 복구 " + restored + "개, 실패 " + failed + "개",
          failed > 0
        );
      })
      .catch(function (e) {
        setMsg(msgEl, (e && e.message) || "숨김 퀴즈 복구에 실패했습니다.", true);
      });
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
    var btnHideBundled = $("admin-quiz-hide-bundled");
    if (btnHideBundled) btnHideBundled.addEventListener("click", hideBundledQuizSet);
    var btnRestoreBundled = $("admin-quiz-restore-bundled");
    if (btnRestoreBundled) btnRestoreBundled.addEventListener("click", restoreBundledQuizSet);
    bindDropzone();
    loadExistingLibraryDocs();
    refreshVisibility();
    resumeQuizGenerationIfNeeded();
    window.addEventListener("app-auth", refreshVisibility);
    window.addEventListener("membership-updated", refreshVisibility);
    window.addEventListener("online", resumeQuizGenerationIfNeeded);
  }

  document.addEventListener("DOMContentLoaded", bind);
})();
