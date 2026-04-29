(function () {
  var selected = null;
  var mode = "quiz";
  var currentListItems = [];

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

  function enableMarkdownBoldShortcut(el) {
    if (!el || el._hanlawBoldBound) return;
    el._hanlawBoldBound = true;
    el.addEventListener("keydown", function (ev) {
      var isBoldHotkey = (ev.ctrlKey || ev.metaKey) && !ev.altKey && String(ev.key || "").toLowerCase() === "b";
      if (!isBoldHotkey) return;
      if (el.readOnly || el.disabled) return;
      ev.preventDefault();
      var start = typeof el.selectionStart === "number" ? el.selectionStart : 0;
      var end = typeof el.selectionEnd === "number" ? el.selectionEnd : start;
      var v = String(el.value || "");
      var picked = v.slice(start, end);
      if (picked) {
        el.value = v.slice(0, start) + "**" + picked + "**" + v.slice(end);
        el.setSelectionRange(start + 2, end + 2);
      } else {
        el.value = v.slice(0, start) + "****" + v.slice(end);
        el.setSelectionRange(start + 2, start + 2);
      }
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
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

  function countReviewStatus(items) {
    var all = Array.isArray(items) ? items : [];
    var pending = 0;
    var approved = 0;
    for (var i = 0; i < all.length; i++) {
      var st = String((all[i] && all[i].status) || "").toLowerCase();
      if (st === "approved") approved += 1;
      else pending += 1;
    }
    return { pending: pending, approved: approved, total: all.length };
  }

  function setReviewBadge(id, pendingCount, approvedCount) {
    var el = $(id);
    if (!el) return;
    var p = typeof pendingCount === "number" && pendingCount >= 0 ? pendingCount : 0;
    var a = typeof approvedCount === "number" && approvedCount >= 0 ? approvedCount : 0;
    var total = p + a;
    el.textContent = "미" + p + " / 승" + a;
    el.setAttribute("data-count", String(total));
    el.title = "미승인 " + p + "건, 승인 " + a + "건";
    el.classList.toggle("admin-review-tab__badge--empty", total === 0);
  }

  function formatQuizSource(payload) {
    var p = payload || {};
    var qNo = p.sourceQuestionNo != null ? String(p.sourceQuestionNo) : "";
    var cLabel = String(p.sourceChoiceLabel || "").trim();
    var cNo = p.sourceChoiceNo != null ? String(p.sourceChoiceNo) : "";
    if (!qNo && !cLabel && !cNo) return "";
    var tail = cLabel || cNo;
    if (!qNo) return tail ? tail + "지문" : "";
    if (!tail) return qNo + "번 문제";
    return qNo + "번-" + tail + "지문";
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
      window.adminListQuizStaging("all", 1000),
      window.adminListDictStaging("term", "all", 1000),
      window.adminListDictStaging("case", "all", 1000)
    ])
      .then(function (results) {
        var rq = results[0] && results[0].items;
        var rt = results[1] && results[1].items;
        var rc = results[2] && results[2].items;
        var cq = countReviewStatus(rq);
        var ct = countReviewStatus(rt);
        var cc = countReviewStatus(rc);
        setReviewBadge("admin-review-badge-quiz", cq.pending, cq.approved);
        setReviewBadge("admin-review-badge-term", ct.pending, ct.approved);
        setReviewBadge("admin-review-badge-case", cc.pending, cc.approved);
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
      var sourceText = it.entityType === "quiz" ? formatQuizSource(it.payload) : "";
      btn.innerHTML =
        '<span class="admin-inbox-row__type">' +
        (it.entityType === "term" ? "용어" : it.entityType === "case" ? "판례" : "퀴즈") +
        "</span>" +
        '<span class="admin-inbox-row__status">' +
        (sourceText || it.key || it.questionId || "-") +
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
    var sourceMeta = mode === "quiz" ? formatQuizSource(item.payload) : "";
    $("admin-review-meta").textContent =
      "유형: " +
      (item.entityType === "term" ? "용어사전" : item.entityType === "case" ? "판례사전" : "퀴즈") +
      " · 키: " +
      (sourceMeta || item.entryKey || item.questionId || "") +
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
        ? window.adminListQuizStaging("all", 1000)
        : window.adminListDictStaging(mode, "all", 1000);
    p
      .then(function (res) {
        var all = (res && res.items) || [];
        var items = filterPendingReviewItems(all);
        currentListItems = items.slice();
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
        currentListItems = [];
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

    var btnApproveAll = $("admin-review-approve-all");
    if (btnApproveAll) {
      btnApproveAll.addEventListener("click", function () {
        if (!currentListItems || !currentListItems.length) {
          setMsg("일괄 승인할 검수 항목이 없습니다.", true);
          return;
        }
        var targets = currentListItems.slice();
        if (
          !window.confirm(
            "현재 목록 " +
              targets.length +
              "건을 모두 승인·반영할까요? 처리 시간이 조금 걸릴 수 있습니다."
          )
        ) {
          return;
        }
        btnApproveAll.disabled = true;
        var okCount = 0;
        var failCount = 0;
        var firstErr = "";
        var chain = Promise.resolve();
        targets.forEach(function (it, i) {
          chain = chain.then(function () {
            setMsg("일괄 승인 중… (" + (i + 1) + "/" + targets.length + ")", false);
            var p =
              mode === "quiz"
                ? window.adminApproveQuizStaging(it.id, it.version)
                : window.adminApproveDictStaging(mode, it.id, it.version);
            return p
              .then(function () {
                okCount += 1;
              })
              .catch(function (e) {
                failCount += 1;
                if (!firstErr) firstErr = (e && e.message) || "승인 실패";
              });
          });
        });
        chain
          .then(function () {
            var msg = "일괄 승인 완료: " + okCount + "건";
            if (failCount) msg += ", 실패 " + failCount + "건";
            if (firstErr) msg += " (예: " + firstErr + ")";
            setMsg(msg, failCount > 0 && okCount === 0);
            if (typeof window.loadRemoteQuestions === "function") window.loadRemoteQuestions();
            try {
              window.dispatchEvent(new CustomEvent("dict-remote-updated"));
            } catch (e2) {}
            selected = null;
            fillDetail(null);
            loadList();
          })
          .catch(function (e) {
            setMsg((e && e.message) || "일괄 승인 처리 실패", true);
          })
          .then(function () {
            btnApproveAll.disabled = false;
          });
      });
    }

    var btnRejectAll = $("admin-review-reject-all");
    if (btnRejectAll) {
      btnRejectAll.addEventListener("click", function () {
        if (!currentListItems || !currentListItems.length) {
          setMsg("일괄 반려할 검수 항목이 없습니다.", true);
          return;
        }
        var reason = window.prompt("일괄 반려 사유를 입력하세요.", "일괄 검토 필요");
        if (reason == null) return;
        var targets = currentListItems.slice();
        if (
          !window.confirm(
            "현재 목록 " +
              targets.length +
              "건을 모두 반려할까요? 처리 시간이 조금 걸릴 수 있습니다."
          )
        ) {
          return;
        }
        btnRejectAll.disabled = true;
        var okCount = 0;
        var failCount = 0;
        var firstErr = "";
        var chain = Promise.resolve();
        targets.forEach(function (it, i) {
          chain = chain.then(function () {
            setMsg("일괄 반려 중… (" + (i + 1) + "/" + targets.length + ")", false);
            var p =
              mode === "quiz"
                ? window.adminRejectQuizStaging(it.id, it.version, reason)
                : window.adminRejectDictStaging(mode, it.id, it.version, reason);
            return p
              .then(function () {
                okCount += 1;
              })
              .catch(function (e) {
                failCount += 1;
                if (!firstErr) firstErr = (e && e.message) || "반려 실패";
              });
          });
        });
        chain
          .then(function () {
            var msg = "일괄 반려 완료: " + okCount + "건";
            if (failCount) msg += ", 실패 " + failCount + "건";
            if (firstErr) msg += " (예: " + firstErr + ")";
            setMsg(msg, failCount > 0 && okCount === 0);
            selected = null;
            fillDetail(null);
            loadList();
          })
          .catch(function (e) {
            setMsg((e && e.message) || "일괄 반려 처리 실패", true);
          })
          .then(function () {
            btnRejectAll.disabled = false;
          });
      });
    }

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
    [
      "admin-review-statement",
      "admin-review-explanation-basic",
      "admin-review-explanation",
      "admin-review-detail-legal",
      "admin-review-detail-trap",
      "admin-review-detail-precedent",
      "admin-review-topic",
      "admin-review-tags",
      "admin-review-term",
      "admin-review-aliases",
      "admin-review-definition",
      "admin-review-citation",
      "admin-review-case-title",
      "admin-review-facts",
      "admin-review-issues",
      "admin-review-judgment",
      "admin-review-search-keys",
      "admin-review-topic-keywords"
    ].forEach(function (id) {
      enableMarkdownBoldShortcut($(id));
    });
    setMode(mode);
    if (panel && !panel.hidden) loadList();
  }

  document.addEventListener("DOMContentLoaded", bind);

  window.loadAdminReviewQueue = loadList;
})();
