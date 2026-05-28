/**
 * 퀴즈 관리자 인라인 편집기 — 앱 퀴즈·공개 콘텐츠 패널 공통
 */
(function () {
  var mountState = null;

  function $(id) {
    return document.getElementById(id);
  }

  function isAdminUser() {
    var u = typeof window.getHanlawUser === "function" ? window.getHanlawUser() : null;
    if (!u || !u.email) return false;
    var emails = window.ADMIN_EMAILS || [];
    var mail = String(u.email).toLowerCase();
    for (var i = 0; i < emails.length; i++) {
      if (String(emails[i]).toLowerCase() === mail) return true;
    }
    return false;
  }

  function mergeLegacyDetailToText(d) {
    if (!d || typeof d !== "object") return "";
    if (d.body != null) {
      var b = String(d.body).replace(/\r\n/g, "\n");
      if (b.trim()) return b;
    }
    return "";
  }

  function setEditorMsg(text, isError) {
    var m = $("quiz-admin-msg");
    if (!m) return;
    m.textContent = text || "";
    m.hidden = !text;
    m.style.color = isError ? "var(--danger, #b91c1c)" : "var(--muted, #64748b)";
  }

  function fillEditorFromQuestion(q) {
    if (!q) return;
    var termIn = $("quiz-admin-statement");
    if (termIn) termIn.value = q.statement || "";
    var ans = $("quiz-admin-answer");
    if (ans) ans.value = q.answer === false ? "false" : "true";
    var exp = $("quiz-admin-explanation");
    if (exp) exp.value = q.explanation || "";
    var bas = $("quiz-admin-explanation-basic");
    if (bas) bas.value = q.explanationBasic || "";
    var det = $("quiz-admin-detail-body");
    if (det) det.value = mergeLegacyDetailToText(q.detail);
    var imp = $("quiz-admin-importance");
    if (imp) imp.value = q.importance != null ? String(q.importance) : "";
    var diff = $("quiz-admin-difficulty");
    if (diff) diff.value = q.difficulty != null ? String(q.difficulty) : "";
    var tags = $("quiz-admin-tags");
    if (tags) tags.value = Array.isArray(q.tags) ? q.tags.join(", ") : "";
  }

  function ensureEditorDom(insertBeforeEl) {
    var existing = $("quiz-admin-editor");
    if (existing) {
      // 공개 패널/일반 퀴즈 패널을 오갈 때 에디터가 이전(숨김) 패널에 남지 않도록 현재 카드 앞으로 이동
      if (insertBeforeEl && insertBeforeEl.parentNode && existing.parentNode !== insertBeforeEl.parentNode) {
        insertBeforeEl.parentNode.insertBefore(existing, insertBeforeEl);
      }
      return existing;
    }
    var editor = document.createElement("section");
    editor.id = "quiz-admin-editor";
    editor.className = "quiz-admin-editor";
    editor.hidden = true;
    editor.style.display = "none";
    editor.innerHTML =
      '<div class="quiz-admin-editor__actions quiz-admin-editor__actions--sticky">' +
      '<button type="button" id="quiz-admin-save" class="btn btn--secondary btn--small">저장</button>' +
      '<button type="button" id="quiz-admin-cancel" class="btn btn--outline btn--small">닫기</button>' +
      "</div>" +
      '<p id="quiz-admin-msg" class="settings-dday-msg quiz-admin-editor__msg" hidden role="status"></p>' +
      '<div class="quiz-admin-editor__fields">' +
      '<label class="field"><span class="field__label">문제 본문</span><textarea id="quiz-admin-statement" class="input textarea" rows="5"></textarea></label>' +
      '<label class="field"><span class="field__label">정답</span><select id="quiz-admin-answer" class="select"><option value="true">O(참)</option><option value="false">X(거짓)</option></select></label>' +
      '<label class="field"><span class="field__label">해설</span><textarea id="quiz-admin-explanation" class="input textarea" rows="10"></textarea></label>' +
      '<label class="field"><span class="field__label">기본 해설 (필수)</span><textarea id="quiz-admin-explanation-basic" class="input textarea" rows="5"></textarea></label>' +
      '<label class="field"><span class="field__label">상세 해설</span><textarea id="quiz-admin-detail-body" class="input textarea" rows="14"></textarea></label>' +
      '<label class="field"><span class="field__label">중요도(1~5)</span><input id="quiz-admin-importance" type="number" min="1" max="5" class="input" /></label>' +
      '<label class="field"><span class="field__label">난이도(1~5)</span><input id="quiz-admin-difficulty" type="number" min="1" max="5" class="input" /></label>' +
      '<label class="field"><span class="field__label">태그(쉼표 구분)</span><input id="quiz-admin-tags" type="text" class="input" /></label>' +
      "</div>" +
      '<div class="quiz-admin-editor__actions quiz-admin-editor__actions--footer">' +
      '<button type="button" id="quiz-admin-save-footer" class="btn btn--secondary btn--small">저장</button>' +
      '<button type="button" id="quiz-admin-cancel-footer" class="btn btn--outline btn--small">닫기</button>' +
      "</div>";
    if (insertBeforeEl && insertBeforeEl.parentNode) {
      insertBeforeEl.parentNode.insertBefore(editor, insertBeforeEl);
    } else {
      document.body.appendChild(editor);
    }
    return editor;
  }

  function getMountState() {
    return mountState || {};
  }

  function bindEditorActions() {
    var editor = $("quiz-admin-editor");
    if (!editor || editor.dataset.hanlawQuizAdminBound === "1") return;
    editor.dataset.hanlawQuizAdminBound = "1";

    function closeEditor() {
      var state = getMountState();
      editor.hidden = true;
      editor.style.display = "none";
      if (state.hideOnOpenEl) state.hideOnOpenEl.hidden = false;
      setEditorMsg("", false);
    }

    function runSave() {
      var state = getMountState();
      if (typeof state.getQuestion !== "function") return;
      var q = state.getQuestion();
      if (!q || !isAdminUser() || state.saving) return;
      if (typeof window.saveQuestionToFirestore !== "function") {
        setEditorMsg("저장 함수를 찾지 못했습니다. Firebase 로그인·배포를 확인해 주세요.", true);
        return;
      }
      var statement = String(($("quiz-admin-statement") && $("quiz-admin-statement").value) || "").trim();
      var explanation = String(($("quiz-admin-explanation") && $("quiz-admin-explanation").value) || "").trim();
      var explanationBasic = String(
        ($("quiz-admin-explanation-basic") && $("quiz-admin-explanation-basic").value) || ""
      ).trim();
      var detailBodyRaw = String(($("quiz-admin-detail-body") && $("quiz-admin-detail-body").value) || "").replace(
        /\r\n/g,
        "\n"
      );
      var detailBodyHas = detailBodyRaw.trim().length > 0;
      if (!statement || !explanation || !explanationBasic) {
        setEditorMsg("문제 본문·해설·기본 해설은 필수입니다.", true);
        return;
      }
      var tagsRaw = String(($("quiz-admin-tags") && $("quiz-admin-tags").value) || "").trim();
      var tags = tagsRaw
        ? tagsRaw
            .split(",")
            .map(function (x) {
              return String(x || "").trim();
            })
            .filter(Boolean)
        : [];
      var impRaw = String(($("quiz-admin-importance") && $("quiz-admin-importance").value) || "").trim();
      var diffRaw = String(($("quiz-admin-difficulty") && $("quiz-admin-difficulty").value) || "").trim();
      var payload = Object.assign({}, q, {
        statement: statement,
        explanation: explanation,
        explanationBasic: explanationBasic,
        answer: $("quiz-admin-answer") && $("quiz-admin-answer").value === "true"
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
      state.saving = true;
      setEditorMsg("저장 중…", false);
      window
        .saveQuestionToFirestore(payload, saveOpts)
        .then(function () {
          setEditorMsg("저장되었습니다.", false);
          closeEditor();
          if (typeof state.onSaved === "function") state.onSaved(payload);
        })
        .catch(function (err) {
          setEditorMsg((err && err.message) || "문항 수정 실패", true);
        })
        .then(function () {
          state.saving = false;
        });
    }

    editor.addEventListener("click", function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      if (t.closest("#quiz-admin-cancel, #quiz-admin-cancel-footer")) {
        e.preventDefault();
        closeEditor();
      }
    });
    var btnSave = $("quiz-admin-save");
    var btnSaveF = $("quiz-admin-save-footer");
    if (btnSave) btnSave.addEventListener("click", runSave);
    if (btnSaveF) btnSaveF.addEventListener("click", runSave);
  }

  window.HanlawQuizAdminEditor = {
    isAdminUser: isAdminUser,
    mount: function (opts) {
      opts = opts || {};
      if (!opts.editButtonEl || typeof opts.getQuestion !== "function") return;

      mountState = {
        editButtonEl: opts.editButtonEl,
        feedbackEditButtonEl: opts.feedbackEditButtonEl,
        hideOnOpenEl: opts.hideOnOpenEl,
        insertEditorBeforeEl: opts.insertEditorBeforeEl,
        getQuestion: opts.getQuestion,
        onSaved: opts.onSaved,
        saving: false
      };

      ensureEditorDom(opts.insertEditorBeforeEl);
      bindEditorActions();

      function openEditor() {
        var q = mountState.getQuestion();
        if (!q || !isAdminUser()) return;
        fillEditorFromQuestion(q);
        if (mountState.hideOnOpenEl) mountState.hideOnOpenEl.hidden = true;
        var editor = $("quiz-admin-editor");
        editor.hidden = false;
        editor.style.display = "";
        editor.scrollIntoView({ behavior: "smooth", block: "start" });
      }

      if (!opts.editButtonEl.dataset.hanlawQuizEditBound) {
        opts.editButtonEl.dataset.hanlawQuizEditBound = "1";
        opts.editButtonEl.addEventListener("click", openEditor);
      }
      if (opts.feedbackEditButtonEl && !opts.feedbackEditButtonEl.dataset.hanlawQuizEditBound) {
        opts.feedbackEditButtonEl.dataset.hanlawQuizEditBound = "1";
        opts.feedbackEditButtonEl.addEventListener("click", openEditor);
      }

      function syncVisible() {
        var on = isAdminUser();
        opts.editButtonEl.hidden = !on;
        if (opts.feedbackEditButtonEl) opts.feedbackEditButtonEl.hidden = !on;
      }
      syncVisible();
      try {
        if (typeof firebase !== "undefined" && firebase.auth) {
          firebase.auth().onAuthStateChanged(syncVisible);
        }
      } catch (e) {}
      window.addEventListener("app-auth", syncVisible);
    }
  };
})();
