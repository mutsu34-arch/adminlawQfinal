(function () {
  var selected = null;
  var mode = "quiz";

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

  function setMsg(text, isError) {
    var el = $("admin-review-msg");
    if (!el) return;
    el.textContent = text || "";
    el.classList.toggle("admin-msg--error", !!isError);
    el.hidden = !text;
  }

  function fmtDate(ms) {
    if (!ms) return "-";
    var d = new Date(ms);
    if (isNaN(d.getTime())) return "-";
    return d.toLocaleString("ko-KR");
  }

  function normalizeCaseIssuesText(raw) {
    var src = String(raw || "").replace(/\r\n/g, "\n");
    if (!src.trim()) return "";
    var lines = src
      .split("\n")
      .map(function (x) {
        return String(x || "").trim();
      })
      .filter(Boolean);
    if (lines.length > 1) return lines.join("\n");
    var one = lines.length ? lines[0] : "";
    if (!one || one.indexOf(",") < 0) return one;
    var parts = one
      .split(",")
      .map(function (x) {
        return String(x || "").trim();
      })
      .filter(Boolean);
    if (parts.length < 2) return one;
    var issueLikeCount = 0;
    for (var i = 0; i < parts.length; i++) {
      if (/(여부|쟁점|문제)$/.test(parts[i])) issueLikeCount += 1;
    }
    if (issueLikeCount >= Math.max(2, Math.floor(parts.length / 2))) {
      return parts.join("\n");
    }
    return one;
  }

  function normalizeText(raw) {
    return String(raw == null ? "" : raw).replace(/\r\n/g, "\n").trim();
  }

  function mergeDetailBody(mainText, legal, trap, precedent) {
    var chunks = [];
    var main = normalizeText(mainText);
    var l = normalizeText(legal);
    var t = normalizeText(trap);
    var p = normalizeText(precedent);
    if (main) chunks.push(main);
    if (l) chunks.push("법리 근거: " + l);
    if (t) chunks.push("함정 포인트: " + t);
    if (p) chunks.push("판례 요지: " + p);
    return chunks.join("\n\n").trim();
  }

  function pickDetailMainText(payload) {
    var p = payload || {};
    var d = p.detail && typeof p.detail === "object" ? p.detail : {};
    return normalizeText(d.body || p.explanation || "");
  }

  function setMode(next) {
    mode = next === "term" || next === "case" ? next : "quiz";
    var bq = $("admin-review-type-quiz");
    var bt = $("admin-review-type-term");
    var bc = $("admin-review-type-case");
    [bq, bt, bc].forEach(function (b) {
      if (!b) return;
      b.classList.remove("admin-review-tab--active");
    });
    if (bq) {
      bq.setAttribute("aria-pressed", mode === "quiz" ? "true" : "false");
      bq.setAttribute("aria-selected", mode === "quiz" ? "true" : "false");
      if (mode === "quiz") bq.classList.add("admin-review-tab--active");
    }
    if (bt) {
      bt.setAttribute("aria-pressed", mode === "term" ? "true" : "false");
      bt.setAttribute("aria-selected", mode === "term" ? "true" : "false");
      if (mode === "term") bt.classList.add("admin-review-tab--active");
    }
    if (bc) {
      bc.setAttribute("aria-pressed", mode === "case" ? "true" : "false");
      bc.setAttribute("aria-selected", mode === "case" ? "true" : "false");
      if (mode === "case") bc.classList.add("admin-review-tab--active");
    }
    var fq = $("admin-review-form-quiz");
    var ft = $("admin-review-form-term");
    var fc = $("admin-review-form-case");
    if (fq) fq.hidden = mode !== "quiz";
    if (ft) ft.hidden = mode !== "term";
    if (fc) fc.hidden = mode !== "case";
    selected = null;
    fillDetail(null);
  }

  function filterPendingReviewItems(items) {
    var all = items || [];
    var out = all.filter(function (x) {
      return x && (x.status === "reviewing" || x.status === "rejected");
    });
    if (!out.length && all.length) return all.slice();
    return out;
  }

  function setReviewBadge(id, n) {
    var el = $(id);
    if (!el) return;
    var v = typeof n === "number" && n >= 0 ? n : 0;
    el.textContent = String(v);
    el.setAttribute("data-count", String(v));
    el.classList.toggle("admin-review-tab__badge--empty", v === 0);
  }

  function refreshReviewBadgeCounts() {
    var user = typeof window.getHanlawUser === "function" ? window.getHanlawUser() : null;
    if (!isAdminUser(user)) return;
    if (
      typeof window.adminListQuizStaging !== "function" ||
      typeof window.adminListDictStaging !== "function"
    ) {
      return;
    }
    Promise.all([
      window.adminListQuizStaging("all", 100),
      window.adminListDictStaging("term", "all", 100),
      window.adminListDictStaging("case", "all", 100)
    ])
      .then(function (results) {
        var rq = results[0] && results[0].items;
        var rt = results[1] && results[1].items;
        var rc = results[2] && results[2].items;
        setReviewBadge("admin-review-badge-quiz", filterPendingReviewItems(rq).length);
        setReviewBadge("admin-review-badge-term", filterPendingReviewItems(rt).length);
        setReviewBadge("admin-review-badge-case", filterPendingReviewItems(rc).length);
      })
      .catch(function () {});
  }

  function renderList(items) {
    var wrap = $("admin-review-list");
    if (!wrap) return;
    wrap.innerHTML = "";
    if (!items || !items.length) {
      wrap.innerHTML =
        '<p class="admin-inbox-empty">검수 항목이 없습니다. 엑셀 업로드 후에도 비어 있으면 Functions 배포 상태와 관리자 계정을 확인해 주세요.</p>';
      return;
    }
    items.forEach(function (it) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "admin-inbox-row" + (selected && selected.id === it.id ? " admin-inbox-row--active" : "");
      btn.innerHTML =
        '<span class="admin-inbox-row__type">' +
        (it.entityType === "term" ? "용어" : it.entityType === "case" ? "판례" : "퀴즈") +
        "</span>" +
        '<span class="admin-inbox-row__status">' +
        (it.key || it.questionId || "-") +
        "</span>" +
        '<span class="admin-inbox-row__preview">' +
        String(it.title || it.statement || it.topic || "").slice(0, 46) +
        "</span>";
      btn.addEventListener("click", function () {
        loadDetail(it.id);
      });
      wrap.appendChild(btn);
    });
  }

  function fillDetail(item) {
    var detail = $("admin-review-detail");
    if (!detail) return;
    detail.hidden = !item;
    if (!item) return;
    $("admin-review-meta").textContent =
      "유형: " +
      (item.entityType === "term" ? "용어사전" : item.entityType === "case" ? "판례사전" : "퀴즈") +
      " · 키: " +
      (item.entryKey || item.questionId || "") +
      " · 상태: " +
      (item.status || "") +
      " · 버전: " +
      (item.version || 1);
    var p = item.payload || {};
    if (mode === "quiz") {
      $("admin-review-statement").value = p.statement || "";
      $("admin-review-explanation-basic").value = p.explanationBasic || "";
      $("admin-review-explanation").value = pickDetailMainText(p);
      var det = p.detail || {};
      $("admin-review-detail-legal").value = det.legal || "";
      $("admin-review-detail-trap").value = det.trap || "";
      $("admin-review-detail-precedent").value = det.precedent || "";
      $("admin-review-topic").value = p.topic || "";
      $("admin-review-tags").value = Array.isArray(p.tags) ? p.tags.join(", ") : "";
      $("admin-review-importance").value = p.importance != null ? String(p.importance) : "";
      $("admin-review-difficulty").value = p.difficulty != null ? String(p.difficulty) : "";
      $("admin-review-answer").value = p.answer === false ? "false" : "true";
    } else if (mode === "term") {
      $("admin-review-term").value = p.term || "";
      $("admin-review-aliases").value = Array.isArray(p.aliases) ? p.aliases.join(", ") : "";
      $("admin-review-definition").value = p.definition || "";
      if (window.CaseOxForm && typeof window.CaseOxForm.ensureBuilt === "function") {
        window.CaseOxForm.ensureBuilt("admin-review-term-ox-editor");
        window.CaseOxForm.fill("admin-review-term-ox-editor", Array.isArray(p.oxQuizzes) ? p.oxQuizzes : []);
      }
    } else {
      $("admin-review-citation").value = p.citation || "";
      $("admin-review-case-title").value = p.title || "";
      $("admin-review-facts").value = p.facts || "";
      $("admin-review-issues").value = normalizeCaseIssuesText(p.issues || "");
      $("admin-review-judgment").value = p.judgment || "";
      $("admin-review-search-keys").value = Array.isArray(p.searchKeys) ? p.searchKeys.join(", ") : "";
      $("admin-review-topic-keywords").value = Array.isArray(p.topicKeywords)
        ? p.topicKeywords.join(", ")
        : "";
      if (window.CaseOxForm && typeof window.CaseOxForm.fill === "function") {
        window.CaseOxForm.fill("admin-review-case-ox-editor", Array.isArray(p.oxQuizzes) ? p.oxQuizzes : []);
      }
    }
  }

  function loadList() {
    var user = typeof window.getHanlawUser === "function" ? window.getHanlawUser() : null;
    if (!isAdminUser(user)) return;
    var apiName = mode === "quiz" ? "adminListQuizStaging" : "adminListDictStaging";
    if (typeof window[apiName] !== "function") {
      setMsg("검수 API를 찾을 수 없습니다. 페이지를 새로고침해 주세요.", true);
      return;
    }
    var p =
      mode === "quiz"
        ? window.adminListQuizStaging("all", 100)
        : window.adminListDictStaging(mode, "all", 100);
    p
      .then(function (res) {
        var all = (res && res.items) || [];
        var items = filterPendingReviewItems(all);
        renderList(items);
        setMsg(
          "목록 " +
            items.length +
            "건 로드됨" +
            (all.length !== items.length ? " (전체 " + all.length + "건 중 검수/반려 표시)" : ""),
          false
        );
        refreshReviewBadgeCounts();
      })
      .catch(function (e) {
        var msg = (e && e.message) || "검수 목록 로드 실패";
        var wrap = $("admin-review-list");
        if (wrap) {
          wrap.innerHTML = '<p class="admin-inbox-empty" style="color:#c62828;">목록 로드 오류: ' + msg + "</p>";
        }
        setMsg(msg, true);
      });
  }

  function loadDetail(id) {
    if (!id) return;
    var p =
      mode === "quiz" ? window.adminGetQuizStaging(id) : window.adminGetDictStaging(mode, id);
    p
      .then(function (res) {
        selected = res && res.item ? res.item : null;
        fillDetail(selected);
        setMsg("", false);
        loadList();
      })
      .catch(function (e) {
        setMsg((e && e.message) || "상세 로드 실패", true);
      });
  }

  function collectPayload() {
    if (!selected || !selected.payload) return null;
    var p = Object.assign({}, selected.payload);
    if (mode === "quiz") {
      p.statement = $("admin-review-statement").value.trim();
      var detailMain = $("admin-review-explanation").value.trim();
      var basic = $("admin-review-explanation-basic").value.trim();
      if (basic) p.explanationBasic = basic;
      else delete p.explanationBasic;
      var legal = $("admin-review-detail-legal").value.trim();
      var trap = $("admin-review-detail-trap").value.trim();
      var precedent = $("admin-review-detail-precedent").value.trim();
      var mergedDetailBody = mergeDetailBody(detailMain, legal, trap, precedent);
      if (mergedDetailBody || legal || trap || precedent) {
        p.detail = {};
        if (mergedDetailBody) p.detail.body = mergedDetailBody;
        if (legal) p.detail.legal = legal;
        if (trap) p.detail.trap = trap;
        if (precedent) p.detail.precedent = precedent;
      } else {
        delete p.detail;
      }
      p.explanation = basic || detailMain || legal || trap || precedent || "";
      p.topic = $("admin-review-topic").value.trim();
      var tagsRaw = $("admin-review-tags").value.trim();
      if (tagsRaw) {
        p.tags = tagsRaw
          .split(",")
          .map(function (x) {
            return String(x || "").trim();
          })
          .filter(Boolean);
      } else {
        delete p.tags;
      }
      var importanceRaw = $("admin-review-importance").value.trim();
      if (importanceRaw) p.importance = parseInt(importanceRaw, 10);
      else delete p.importance;
      var difficultyRaw = $("admin-review-difficulty").value.trim();
      if (difficultyRaw) p.difficulty = parseInt(difficultyRaw, 10);
      else delete p.difficulty;
      p.answer = $("admin-review-answer").value === "true";
    } else if (mode === "term") {
      p.term = $("admin-review-term").value.trim();
      p.definition = $("admin-review-definition").value.trim();
      var aliasesRaw = $("admin-review-aliases").value.trim();
      p.aliases = aliasesRaw
        ? aliasesRaw
            .split(",")
            .map(function (x) {
              return String(x || "").trim();
            })
            .filter(Boolean)
        : [];
      if (window.CaseOxForm && typeof window.CaseOxForm.collect === "function") {
        window.CaseOxForm.ensureBuilt("admin-review-term-ox-editor");
        p.oxQuizzes = window.CaseOxForm.collect("admin-review-term-ox-editor");
        var oxErrTerm = window.CaseOxForm.validateForSave(p.oxQuizzes);
        if (oxErrTerm) throw new Error(oxErrTerm);
      } else if (Array.isArray(selected.payload.oxQuizzes)) {
        p.oxQuizzes = selected.payload.oxQuizzes;
      }
    } else {
      p.citation = $("admin-review-citation").value.trim();
      p.title = $("admin-review-case-title").value.trim();
      p.facts = $("admin-review-facts").value.trim();
      p.issues = normalizeCaseIssuesText($("admin-review-issues").value.trim());
      p.judgment = $("admin-review-judgment").value.trim();
      var keysRaw = $("admin-review-search-keys").value.trim();
      p.searchKeys = keysRaw
        ? keysRaw
            .split(",")
            .map(function (x) {
              return String(x || "").trim();
            })
            .filter(Boolean)
        : [];
      var tkRaw = $("admin-review-topic-keywords").value.trim();
      p.topicKeywords = tkRaw
        ? tkRaw
            .split(",")
            .map(function (x) {
              return String(x || "").trim();
            })
            .filter(Boolean)
        : [];
      if (!window.CaseOxForm || typeof window.CaseOxForm.collect !== "function") {
        throw new Error("OX 퀴즈 편집 모듈을 불러오지 못했습니다. 페이지를 새로고침해 주세요.");
      }
      p.oxQuizzes = window.CaseOxForm.collect("admin-review-case-ox-editor");
      var oxErr = window.CaseOxForm.validateForSave(p.oxQuizzes);
      if (oxErr) throw new Error(oxErr);
    }
    return p;
  }

  function bind() {
    if (window.CaseOxForm && typeof window.CaseOxForm.ensureBuilt === "function") {
      window.CaseOxForm.ensureBuilt("admin-review-case-ox-editor");
      window.CaseOxForm.ensureBuilt("admin-review-term-ox-editor");
    }
    var btnRefresh = $("admin-review-refresh");
    if (btnRefresh) btnRefresh.addEventListener("click", loadList);

    var btnSave = $("admin-review-save");
    if (btnSave) {
      btnSave.addEventListener("click", function () {
        if (!selected) return;
        var payload = null;
        try {
          payload = collectPayload();
        } catch (e0) {
          setMsg((e0 && e0.message) || "입력값 확인 중 오류가 발생했습니다.", true);
          return;
        }
        setMsg("수정 저장 중…", false);
        var p =
          mode === "quiz"
            ? window.adminUpdateQuizStaging(selected.id, selected.version, payload)
            : window.adminUpdateDictStaging(mode, selected.id, selected.version, payload);
        p
          .then(function () {
            setMsg("수정 내용을 저장했습니다.", false);
            return loadDetail(selected.id);
          })
          .catch(function (e) {
            setMsg((e && e.message) || "수정 저장 실패", true);
          });
      });
    }

    var btnApprove = $("admin-review-approve");
    if (btnApprove) {
      btnApprove.addEventListener("click", function () {
        if (!selected) return;
        setMsg("승인 반영 중…", false);
        var p =
          mode === "quiz"
            ? window.adminApproveQuizStaging(selected.id, selected.version)
            : window.adminApproveDictStaging(mode, selected.id, selected.version);
        p
          .then(function () {
            setMsg("승인되어 운영 데이터에 반영되었습니다.", false);
            if (typeof window.loadRemoteQuestions === "function") window.loadRemoteQuestions();
            try {
              window.dispatchEvent(new CustomEvent("dict-remote-updated"));
            } catch (e2) {}
            selected = null;
            fillDetail(null);
            loadList();
          })
          .catch(function (e) {
            setMsg((e && e.message) || "승인 실패", true);
          });
      });
    }

    var btnReject = $("admin-review-reject");
    if (btnReject) {
      btnReject.addEventListener("click", function () {
        if (!selected) return;
        var reason = window.prompt("반려 사유를 입력하세요.", "검토 필요");
        if (reason == null) return;
        setMsg("반려 처리 중…", false);
        var p =
          mode === "quiz"
            ? window.adminRejectQuizStaging(selected.id, selected.version, reason)
            : window.adminRejectDictStaging(mode, selected.id, selected.version, reason);
        p
          .then(function () {
            setMsg("반려 처리되었습니다.", false);
            selected = null;
            fillDetail(null);
            loadList();
          })
          .catch(function (e) {
            setMsg((e && e.message) || "반려 실패", true);
          });
      });
    }

    var tab = $("admin-tab-review");
    if (tab) {
      tab.addEventListener("click", function () {
        window.setTimeout(loadList, 0);
      });
    }
    var bq = $("admin-review-type-quiz");
    var bt = $("admin-review-type-term");
    var bc = $("admin-review-type-case");
    if (bq) bq.addEventListener("click", function () { setMode("quiz"); loadList(); });
    if (bt) bt.addEventListener("click", function () { setMode("term"); loadList(); });
    if (bc) bc.addEventListener("click", function () { setMode("case"); loadList(); });

    var panel = $("admin-panel-review");
    setMode(mode);
    if (panel && !panel.hidden) loadList();
  }

  document.addEventListener("DOMContentLoaded", bind);

  window.loadAdminReviewQueue = loadList;
})();
