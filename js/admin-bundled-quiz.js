(function () {
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
    var el = $("admin-bundled-quiz-msg");
    if (!el) return;
    el.textContent = text || "";
    el.classList.toggle("admin-msg--error", !!isError);
    el.hidden = !text;
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function ensureAdminVisibility() {
    var box = $("admin-bundled-quiz-admin");
    var user = typeof window.getHanlawUser === "function" ? window.getHanlawUser() : null;
    if (box) box.hidden = !isAdminUser(user);
  }

  function getDb() {
    if (typeof firebase === "undefined") return null;
    if (!firebase.apps || !firebase.apps.length) return null;
    try {
      return firebase.firestore();
    } catch (e) {
      return null;
    }
  }

  function hiddenMapFromFirestore() {
    var db = getDb();
    if (!db) return Promise.resolve({});
    return db
      .collection("hanlaw_questions")
      .where("bundledShadow", "==", true)
      .get()
      .then(function (snap) {
        var map = {};
        snap.forEach(function (doc) {
          var d = doc.data() || {};
          if (d.hidden === true) map[doc.id] = true;
        });
        return map;
      })
      .catch(function () {
        return {};
      });
  }

  function renderRows(hiddenMap) {
    var host = $("admin-bundled-quiz-list");
    if (!host) return;
    var staticList = Array.isArray(window.QUESTION_BANK_STATIC) ? window.QUESTION_BANK_STATIC : [];
    if (!staticList.length) {
      host.innerHTML = '<p class="admin-library-empty">기본 퀴즈 데이터가 없습니다.</p>';
      return;
    }
    var html = [];
    html.push('<div class="admin-bundled-quiz-list__meta">총 ' + staticList.length + "개 · 숨김 " + Object.keys(hiddenMap).length + "개</div>");
    for (var i = 0; i < staticList.length; i++) {
      var q = staticList[i] || {};
      var qid = String(q.id || "").trim();
      if (!qid) continue;
      var hidden = !!hiddenMap[qid];
      var topic = escapeHtml(String(q.topic || "-"));
      var statement = escapeHtml(String(q.statement || "")).slice(0, 240);
      html.push(
        '<div class="admin-bundled-quiz-row">' +
          '<div class="admin-bundled-quiz-row__main">' +
          '<div class="admin-bundled-quiz-row__head">' +
          '<span class="admin-bundled-quiz-row__id">' + escapeHtml(qid) + "</span>" +
          '<span class="admin-bundled-quiz-row__topic">' + topic + "</span>" +
          '<span class="admin-bundled-quiz-row__state' + (hidden ? " is-hidden" : "") + '">' + (hidden ? "숨김" : "표시") + "</span>" +
          "</div>" +
          '<p class="admin-bundled-quiz-row__statement">' + statement + "</p>" +
          "</div>" +
          '<div class="admin-bundled-quiz-row__actions">' +
          '<button type="button" class="btn btn--outline btn--small" data-bundled-hide="' + escapeHtml(qid) + '"' + (hidden ? " disabled" : "") + ">숨김</button>" +
          '<button type="button" class="btn btn--outline btn--small" data-bundled-restore="' + escapeHtml(qid) + '"' + (!hidden ? " disabled" : "") + ">복구</button>" +
          "</div>" +
          "</div>"
      );
    }
    host.innerHTML = html.join("");
  }

  function loadList() {
    ensureAdminVisibility();
    var user = typeof window.getHanlawUser === "function" ? window.getHanlawUser() : null;
    if (!isAdminUser(user)) return;
    var host = $("admin-bundled-quiz-list");
    if (host) host.innerHTML = '<p class="admin-library-empty">목록을 불러오는 중…</p>';
    hiddenMapFromFirestore().then(function (hiddenMap) {
      renderRows(hiddenMap);
    });
  }

  function hideOne(id) {
    if (typeof window.softHideBundledQuestion !== "function") {
      setMsg("숨김 함수를 찾을 수 없습니다.", true);
      return;
    }
    setMsg("숨김 처리 중…", false);
    window
      .softHideBundledQuestion(id)
      .then(function () {
        setMsg("숨김 처리되었습니다.", false);
        loadList();
      })
      .catch(function (e) {
        setMsg((e && e.message) || "숨김 처리에 실패했습니다.", true);
      });
  }

  function restoreOne(id) {
    if (typeof window.restoreBundledQuestion !== "function") {
      setMsg("복구 함수를 찾을 수 없습니다.", true);
      return;
    }
    setMsg("복구 처리 중…", false);
    window
      .restoreBundledQuestion(id)
      .then(function () {
        setMsg("복구 처리되었습니다.", false);
        loadList();
      })
      .catch(function (e) {
        setMsg((e && e.message) || "복구 처리에 실패했습니다.", true);
      });
  }

  function hideAll() {
    var staticList = Array.isArray(window.QUESTION_BANK_STATIC) ? window.QUESTION_BANK_STATIC : [];
    if (!staticList.length) return setMsg("숨김 처리할 기본 퀴즈가 없습니다.", true);
    if (!window.confirm("기본 퀴즈 " + staticList.length + "개를 모두 숨김 처리할까요?")) return;
    var done = 0;
    var fail = 0;
    setMsg("전체 숨김 처리 중… (0/" + staticList.length + ")", false);
    var chain = Promise.resolve();
    staticList.forEach(function (q) {
      var qid = String((q && q.id) || "").trim();
      if (!qid) return;
      chain = chain.then(function () {
        return window
          .softHideBundledQuestion(qid)
          .then(function () {
            done += 1;
            setMsg("전체 숨김 처리 중… (" + done + "/" + staticList.length + ")", false);
          })
          .catch(function () {
            done += 1;
            fail += 1;
            setMsg("전체 숨김 처리 중… (" + done + "/" + staticList.length + ")", false);
          });
      });
    });
    chain.then(function () {
      setMsg("전체 숨김 완료: 성공 " + (staticList.length - fail) + "개, 실패 " + fail + "개", fail > 0);
      loadList();
    });
  }

  function restoreAll() {
    if (typeof window.restoreHiddenBundledQuestions !== "function") {
      setMsg("전체 복구 함수를 찾을 수 없습니다.", true);
      return;
    }
    if (!window.confirm("숨김 처리된 기본 퀴즈를 모두 복구할까요?")) return;
    setMsg("전체 복구 처리 중…", false);
    window
      .restoreHiddenBundledQuestions()
      .then(function (res) {
        var total = res && typeof res.total === "number" ? res.total : 0;
        var restored = res && typeof res.restored === "number" ? res.restored : 0;
        var failed = res && typeof res.failed === "number" ? res.failed : 0;
        setMsg(
          "전체 복구 완료: 대상 " + total + "개, 복구 " + restored + "개, 실패 " + failed + "개",
          failed > 0
        );
        loadList();
      })
      .catch(function (e) {
        setMsg((e && e.message) || "전체 복구 처리에 실패했습니다.", true);
      });
  }

  function bind() {
    var host = $("admin-bundled-quiz-list");
    if (host) {
      host.addEventListener("click", function (e) {
        var hideBtn = e.target && e.target.closest ? e.target.closest("[data-bundled-hide]") : null;
        if (hideBtn) {
          var hideId = String(hideBtn.getAttribute("data-bundled-hide") || "").trim();
          if (hideId) hideOne(hideId);
          return;
        }
        var restoreBtn = e.target && e.target.closest ? e.target.closest("[data-bundled-restore]") : null;
        if (restoreBtn) {
          var restoreId = String(restoreBtn.getAttribute("data-bundled-restore") || "").trim();
          if (restoreId) restoreOne(restoreId);
        }
      });
    }
    var btnRefresh = $("admin-bundled-quiz-refresh");
    if (btnRefresh) btnRefresh.addEventListener("click", loadList);
    var btnHideAll = $("admin-bundled-quiz-hide-all");
    if (btnHideAll) btnHideAll.addEventListener("click", hideAll);
    var btnRestoreAll = $("admin-bundled-quiz-restore-all");
    if (btnRestoreAll) btnRestoreAll.addEventListener("click", restoreAll);

    window.addEventListener("app-auth", ensureAdminVisibility);
    window.addEventListener("membership-updated", ensureAdminVisibility);
  }

  window.loadAdminBundledQuizList = loadList;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }
})();

