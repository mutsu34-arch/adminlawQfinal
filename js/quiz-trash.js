/**
 * 오답노트/찜노트 휴지통 (계정별 localStorage)
 * - 해제 시 자동 저장
 * - 30일 후 자동 삭제
 * - 복원 기능
 */
(function () {
  var STORAGE_VER = "v1";
  var LS_PREFIX = "hanlaw_quiz_trash_";
  var RETAIN_MS = 30 * 24 * 60 * 60 * 1000;

  function normalizeId(id) {
    return String(id == null ? "" : id).trim();
  }

  function nowMs() {
    return Date.now();
  }

  function storageKey() {
    try {
      if (typeof window.getHanlawUser === "function") {
        var u = window.getHanlawUser();
        if (u) return LS_PREFIX + STORAGE_VER + "_" + u.uid;
      }
    } catch (e) {}
    return LS_PREFIX + STORAGE_VER + "_local";
  }

  function mergeLocalIntoUid(uid) {
    var id = normalizeId(uid);
    if (!id) return;
    var keyLocal = LS_PREFIX + STORAGE_VER + "_local";
    var keyUid = LS_PREFIX + STORAGE_VER + "_" + id;
    try {
      var rawL = localStorage.getItem(keyLocal);
      if (!rawL) return;
      var oL = JSON.parse(rawL);
      if (!oL || !Array.isArray(oL.items) || !oL.items.length) return;

      var rawU = localStorage.getItem(keyUid);
      var oU = rawU ? JSON.parse(rawU) : { items: [] };
      if (!oU || !Array.isArray(oU.items)) oU = { items: [] };

      var seen = {};
      var merged = [];
      function push(it) {
        if (!it) return;
        var qid = normalizeId(it.qid);
        var src = it.source === "wrong" ? "wrong" : "fav";
        if (!qid) return;
        var key = src + ":" + qid;
        if (seen[key]) return;
        seen[key] = true;
        merged.push({
          source: src,
          qid: qid,
          removedAt: parseInt(it.removedAt, 10) || nowMs()
        });
      }
      oL.items.forEach(push);
      oU.items.forEach(push);
      localStorage.setItem(keyUid, JSON.stringify(pruneExpired({ items: merged })));
      localStorage.removeItem(keyLocal);
    } catch (e) {}
  }

  function readRaw() {
    try {
      var s = localStorage.getItem(storageKey());
      if (!s) return { items: [] };
      var o = JSON.parse(s);
      if (!o || !Array.isArray(o.items)) return { items: [] };
      return o;
    } catch (e) {
      return { items: [] };
    }
  }

  function emit() {
    window.dispatchEvent(new CustomEvent("quiz-trash-updated"));
  }

  function writeRaw(data, silent) {
    try {
      localStorage.setItem(storageKey(), JSON.stringify(data));
    } catch (e) {}
    if (!silent) emit();
  }

  function pruneExpired(data) {
    var base = data && Array.isArray(data.items) ? data : { items: [] };
    var t = nowMs();
    base.items = base.items.filter(function (it) {
      return t - (parseInt(it.removedAt, 10) || 0) < RETAIN_MS;
    });
    return base;
  }

  function sourceLabel(source) {
    return source === "wrong" ? "오답노트" : "찜노트";
  }

  function findQuestionById(id) {
    var want = normalizeId(id);
    if (!want) return null;
    var bank = window.QUESTION_BANK || [];
    for (var i = 0; i < bank.length; i++) {
      if (normalizeId(bank[i].id) === want) return bank[i];
    }
    return null;
  }

  function add(source, questionId) {
    var qid = normalizeId(questionId);
    var src = source === "wrong" ? "wrong" : "fav";
    if (!qid) return;
    var d = pruneExpired(readRaw());
    d.items = d.items.filter(function (it) {
      return !(it && it.source === src && normalizeId(it.qid) === qid);
    });
    d.items.unshift({
      source: src,
      qid: qid,
      removedAt: nowMs()
    });
    writeRaw(d);
  }

  function removeItem(source, qid) {
    var id = normalizeId(qid);
    if (!id) return;
    var src = source === "wrong" ? "wrong" : "fav";
    var d = pruneExpired(readRaw());
    d.items = d.items.filter(function (it) {
      return !(it && it.source === src && normalizeId(it.qid) === id);
    });
    writeRaw(d);
  }

  function clearAll() {
    writeRaw({ items: [] });
  }

  function getItems() {
    var raw = readRaw();
    var beforeLen = raw && Array.isArray(raw.items) ? raw.items.length : 0;
    var d = pruneExpired(raw);
    if ((d.items || []).length !== beforeLen) {
      // 패널 렌더 중 무한 이벤트 루프를 막기 위해 조용히 정리 저장
      writeRaw(d, true);
    }
    return d.items.slice();
  }

  function restore(item) {
    if (!item) return;
    var qid = normalizeId(item.qid);
    if (!qid) return;
    if (item.source === "wrong") {
      if (window.QuizWrongNote && typeof window.QuizWrongNote.record === "function") {
        window.QuizWrongNote.record(qid);
      }
    } else {
      if (window.QuizFavorites) {
        if (typeof window.QuizFavorites.has === "function" && typeof window.QuizFavorites.toggle === "function") {
          if (!window.QuizFavorites.has(qid)) window.QuizFavorites.toggle(qid);
        } else if (typeof window.QuizFavorites.toggle === "function") {
          window.QuizFavorites.toggle(qid);
        }
      }
    }
    removeItem(item.source, qid);
  }

  function formatRemovedAt(ms) {
    var d = new Date(ms || 0);
    if (isNaN(d.getTime())) return "-";
    return d.toLocaleDateString("ko-KR");
  }

  function getRemainDaysText(removedAtMs) {
    var t = parseInt(removedAtMs, 10) || 0;
    if (!t) return "D-0";
    var due = t + RETAIN_MS;
    var remainMs = Math.max(0, due - nowMs());
    var dayMs = 24 * 60 * 60 * 1000;
    var remainDays = Math.ceil(remainMs / dayMs);
    return "D-" + String(remainDays);
  }

  function renderTrashPanel() {
    var listEl = document.getElementById("trash-note-list");
    var emptyEl = document.getElementById("trash-note-empty");
    if (!listEl || !emptyEl) return;

    var items = getItems();
    listEl.innerHTML = "";
    if (!items.length) {
      emptyEl.hidden = false;
      return;
    }
    emptyEl.hidden = true;

    items.forEach(function (it) {
      var q = findQuestionById(it.qid);
      var article = document.createElement("article");
      article.className = "trash-note-card";
      article.setAttribute("data-trash-source", it.source);
      article.setAttribute("data-trash-qid", it.qid);

      var head = document.createElement("div");
      head.className = "trash-note-card__head";
      var title = document.createElement("p");
      title.className = "trash-note-card__title";
      title.textContent = q && q.topic ? q.topic : "삭제된 문항";
      var badge = document.createElement("span");
      badge.className = "trash-note-card__badge";
      badge.textContent = sourceLabel(it.source);
      head.appendChild(title);
      head.appendChild(badge);
      article.appendChild(head);

      var stmt = document.createElement("p");
      stmt.className = "trash-note-card__stmt";
      if (q && typeof window.formatHanlawRichParagraphsHtml === "function") {
        stmt.innerHTML = window.formatHanlawRichParagraphsHtml(String(q.statement || "").trim());
      } else {
        stmt.textContent = q ? String(q.statement || "").trim() : "문항 데이터를 찾을 수 없습니다.";
      }
      article.appendChild(stmt);

      var meta = document.createElement("p");
      meta.className = "trash-note-card__meta";
      meta.textContent =
        "해제일: " + formatRemovedAt(it.removedAt) + " · 남은 기간: " + getRemainDaysText(it.removedAt);
      article.appendChild(meta);

      var actions = document.createElement("div");
      actions.className = "trash-note-card__actions";
      var btnRestore = document.createElement("button");
      btnRestore.type = "button";
      btnRestore.className = "btn btn--small btn--secondary trash-note-restore";
      btnRestore.textContent = "복원";
      btnRestore.setAttribute("data-trash-source", it.source);
      btnRestore.setAttribute("data-trash-qid", it.qid);
      var btnDelete = document.createElement("button");
      btnDelete.type = "button";
      btnDelete.className = "btn btn--small btn--outline trash-note-delete";
      btnDelete.textContent = "영구 삭제";
      btnDelete.setAttribute("data-trash-source", it.source);
      btnDelete.setAttribute("data-trash-qid", it.qid);
      actions.appendChild(btnRestore);
      actions.appendChild(btnDelete);
      article.appendChild(actions);

      listEl.appendChild(article);
    });
  }

  function bind() {
    var listEl = document.getElementById("trash-note-list");
    if (listEl) {
      listEl.addEventListener("click", function (e) {
        var br = e.target.closest(".trash-note-restore");
        if (br) {
          var src = br.getAttribute("data-trash-source");
          var qid = br.getAttribute("data-trash-qid");
          restore({ source: src, qid: qid });
          return;
        }
        var bd = e.target.closest(".trash-note-delete");
        if (bd) {
          var src2 = bd.getAttribute("data-trash-source");
          var qid2 = bd.getAttribute("data-trash-qid");
          if (window.confirm("이 항목을 휴지통에서 영구 삭제할까요?")) {
            removeItem(src2, qid2);
          }
        }
      });
    }

    var clearBtn = document.getElementById("trash-note-clear");
    if (clearBtn) {
      clearBtn.addEventListener("click", function () {
        var items = getItems();
        if (!items.length) return;
        if (window.confirm("휴지통을 모두 비울까요?")) {
          clearAll();
        }
      });
    }

    window.addEventListener("quiz-trash-updated", renderTrashPanel);
    window.addEventListener("question-bank-updated", renderTrashPanel);
    window.addEventListener("app-auth", function (e) {
      var u = e && e.detail && e.detail.user;
      if (u && u.uid) mergeLocalIntoUid(u.uid);
      renderTrashPanel();
    });
    try {
      if (typeof firebase !== "undefined" && firebase.auth) {
        firebase.auth().onAuthStateChanged(function (user) {
          if (user && user.uid) mergeLocalIntoUid(user.uid);
          renderTrashPanel();
        });
      }
    } catch (e2) {}
    renderTrashPanel();
  }

  window.QuizTrash = {
    add: add,
    remove: removeItem,
    clear: clearAll,
    getItems: getItems,
    restore: restore
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }
})();
