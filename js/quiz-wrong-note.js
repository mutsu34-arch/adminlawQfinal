/**
 * 오답노트 — 틀린 문항 ID 목록 (계정별 localStorage, 찜노트와 동일 패턴)
 * 목록 UI·O/X·해설은 js/quiz-note-panel.js (HanlawNoteQuizUi)와 연동합니다.
 */
(function () {
  var STORAGE_VER = "v1";
  var LS_PREFIX = "hanlaw_quiz_wrong_";
  var MAX_STORE = 1000;

  function normalizeId(id) {
    return String(id == null ? "" : id).trim();
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

  function mergeWrongNoteLocalIntoUid(uid) {
    var id = normalizeId(uid);
    if (!id) return;
    var keyLocal = LS_PREFIX + STORAGE_VER + "_local";
    var keyUid = LS_PREFIX + STORAGE_VER + "_" + id;
    try {
      var rawL = localStorage.getItem(keyLocal);
      if (!rawL) return;
      var oL = JSON.parse(rawL);
      if (!oL || !Array.isArray(oL.order) || !oL.order.length) return;

      var rawU = localStorage.getItem(keyUid);
      var oU = rawU ? JSON.parse(rawU) : { order: [] };
      if (!oU || !Array.isArray(oU.order)) oU = { order: [] };

      var seen = {};
      var merged = [];
      function push(x) {
        var qid = normalizeId(x);
        if (!qid || seen[qid]) return;
        seen[qid] = true;
        merged.push(qid);
      }
      oL.order.forEach(push);
      oU.order.forEach(push);
      if (merged.length > MAX_STORE) merged = merged.slice(0, MAX_STORE);

      localStorage.setItem(keyUid, JSON.stringify({ order: merged }));
      localStorage.removeItem(keyLocal);
    } catch (e) {}
    try {
      window.dispatchEvent(new CustomEvent("quiz-wrong-note-updated"));
    } catch (e2) {}
  }

  function readRaw() {
    try {
      var s = localStorage.getItem(storageKey());
      if (!s) return { order: [] };
      var o = JSON.parse(s);
      if (!o || !Array.isArray(o.order)) return { order: [] };
      return o;
    } catch (e) {
      return { order: [] };
    }
  }

  function writeRaw(data) {
    try {
      localStorage.setItem(storageKey(), JSON.stringify(data));
    } catch (e) {}
    window.dispatchEvent(new CustomEvent("quiz-wrong-note-updated"));
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

  window.QuizWrongNote = {
    record: function (questionId) {
      var qid = normalizeId(questionId);
      if (!qid) return;
      var d = readRaw();
      d.order = d.order.filter(function (x) {
        return normalizeId(x) !== qid;
      });
      d.order.unshift(qid);
      if (d.order.length > MAX_STORE) d.order.length = MAX_STORE;
      writeRaw(d);
    },
    remove: function (questionId) {
      var qid = normalizeId(questionId);
      if (!qid) return;
      if (window.QuizTrash && typeof window.QuizTrash.add === "function") {
        window.QuizTrash.add("wrong", qid);
      }
      var d = readRaw();
      d.order = d.order.filter(function (x) {
        return normalizeId(x) !== qid;
      });
      writeRaw(d);
    },
    clear: function () {
      var d0 = readRaw();
      if (window.QuizTrash && typeof window.QuizTrash.add === "function") {
        d0.order.forEach(function (id) {
          var qid = normalizeId(id);
          if (qid) window.QuizTrash.add("wrong", qid);
        });
      }
      writeRaw({ order: [] });
    },
    getOrderedIds: function () {
      return readRaw().order.map(normalizeId).filter(Boolean);
    },
    has: function (questionId) {
      var want = normalizeId(questionId);
      if (!want) return false;
      var d = readRaw();
      var hi;
      for (hi = 0; hi < d.order.length; hi++) {
        if (normalizeId(d.order[hi]) === want) return true;
      }
      return false;
    }
  };

  /** 오답 제출 시 record()가 곧바로 목록을 갈아엎어, 방금 연 해설 DOM이 사라지는 것을 막기 위한 복원용 */
  var pendingRevealAfterRender = null;

  function renderWrongPanel() {
    var UI = window.HanlawNoteQuizUi;
    var listEl = document.getElementById("wrong-note-list");
    var emptyEl = document.getElementById("wrong-note-empty");
    var bannerEl = document.getElementById("wrong-note-limit-banner");
    if (!listEl || !emptyEl) return;
    if (!UI || typeof UI.buildCard !== "function" || typeof UI.getDisplaySlice !== "function") {
      return;
    }

    var sortBar = document.getElementById("wrong-note-sort-bar");
    var sortMode =
      typeof UI.getNoteSortMode === "function" ? UI.getNoteSortMode("wrong") : "timeDesc";
    if (typeof UI.syncNoteSortBarUI === "function") {
      UI.syncNoteSortBarUI(sortBar, sortMode);
    }

    var ids = window.QuizWrongNote.getOrderedIds();
    if (typeof UI.sortNoteIds === "function") {
      ids = UI.sortNoteIds(ids, sortMode, findQuestionById);
    }
    listEl.innerHTML = "";

    if (!ids.length) {
      pendingRevealAfterRender = null;
      emptyEl.hidden = false;
      if (bannerEl) {
        bannerEl.hidden = true;
        bannerEl.textContent = "";
      }
      return;
    }
    emptyEl.hidden = true;

    var slice = UI.getDisplaySlice(ids);
    UI.updateLimitBanner(bannerEl, slice, sortMode);

    for (var vi = 0; vi < slice.visible.length; vi++) {
      var id = slice.visible[vi];
      var idx1 = vi + 1;
      var q = findQuestionById(id);
      if (!q) {
        var article = document.createElement("article");
        article.className = "wrong-note-card";
        article.setAttribute("data-qid", id);
        var miss = document.createElement("p");
        miss.className = "wrong-note-card__missing";
        miss.appendChild(document.createTextNode("문항 ID "));
        var code = document.createElement("code");
        code.textContent = id;
        miss.appendChild(code);
        miss.appendChild(
          document.createTextNode(" 는 현재 문항 목록에 없습니다. (삭제되었거나 아직 불러오지 못했습니다.)")
        );
        var head = document.createElement("div");
        head.className = "wrong-note-card__head wrong-note-card__head--indexed";
        var numEl = document.createElement("span");
        numEl.className = "note-card__index";
        numEl.setAttribute("aria-hidden", "true");
        numEl.textContent = String(idx1);
        head.appendChild(numEl);
        head.appendChild(miss);
        article.appendChild(head);
        var rmMiss = document.createElement("button");
        rmMiss.type = "button";
        rmMiss.className = "btn btn--small btn--outline wrong-note-remove";
        rmMiss.setAttribute("data-qid", id);
        rmMiss.textContent = "목록에서 제거";
        article.appendChild(rmMiss);
        listEl.appendChild(article);
        continue;
      }
      listEl.appendChild(UI.buildCard(q, idx1, "wrong"));
    }

    if (pendingRevealAfterRender && UI && typeof UI.revealCardAnswer === "function") {
      var pr = pendingRevealAfterRender;
      pendingRevealAfterRender = null;
      var want = normalizeId(pr.qid);
      if (want) {
        var cards = listEl.querySelectorAll("[data-note-quiz]");
        var ci;
        for (ci = 0; ci < cards.length; ci++) {
          if (normalizeId(cards[ci].getAttribute("data-qid")) !== want) continue;
          var qR = findQuestionById(want);
          if (qR) {
            try {
              UI.revealCardAnswer(cards[ci], qR, pr.userTrue === true);
            } catch (eReveal) {}
          }
          break;
        }
      }
    }
  }

  function bind() {
    var UI = window.HanlawNoteQuizUi;
    var list = document.getElementById("wrong-note-list");
    if (list) {
      if (UI && typeof UI.attachListInteractions === "function") {
        UI.attachListInteractions(list, {
          findQuestion: findQuestionById,
          removeSelector: ".wrong-note-remove",
          onRemove: function (rid) {
            window.QuizWrongNote.remove(rid);
          },
          onAnswered: function (q, userTrue, ok) {
            if (window.LearningStats && typeof window.LearningStats.recordQuizAnswer === "function") {
              window.LearningStats.recordQuizAnswer(q.topic, ok);
            }
            if (
              !ok &&
              String(q.id != null ? q.id : "").trim() &&
              window.QuizWrongNote &&
              typeof window.QuizWrongNote.record === "function"
            ) {
              pendingRevealAfterRender = { qid: q.id, userTrue: userTrue === true };
              window.QuizWrongNote.record(q.id);
            }
          }
        });
      }
    }

    var clearBtn = document.getElementById("wrong-note-clear");
    if (clearBtn) {
      clearBtn.addEventListener("click", function () {
        if (!window.QuizWrongNote.getOrderedIds().length) return;
        if (window.confirm("오답노트를 모두 비울까요?")) {
          window.QuizWrongNote.clear();
        }
      });
    }

    var sortBar = document.getElementById("wrong-note-sort-bar");
    if (sortBar && UI && typeof UI.setNoteSortMode === "function" && !sortBar._hanlawSortBound) {
      sortBar._hanlawSortBound = true;
      sortBar.addEventListener("click", function (e) {
        var btn = e.target.closest("[data-note-sort]");
        if (!btn || !sortBar.contains(btn)) return;
        var mode = UI.setNoteSortMode("wrong", btn.getAttribute("data-note-sort"));
        if (typeof UI.syncNoteSortBarUI === "function") {
          UI.syncNoteSortBarUI(sortBar, mode);
        }
        renderWrongPanel();
      });
    }

    window.addEventListener("hanlaw-panel-root-reset", function (ev) {
      var id = ev && ev.detail && ev.detail.panelId;
      if (id === "wrong") renderWrongPanel();
    });
    window.addEventListener("quiz-wrong-note-updated", renderWrongPanel);
    window.addEventListener("question-bank-updated", renderWrongPanel);
    window.addEventListener("membership-updated", renderWrongPanel);
    window.addEventListener("app-auth", function (e) {
      var u = e && e.detail && e.detail.user;
      if (u && u.uid) mergeWrongNoteLocalIntoUid(u.uid);
      renderWrongPanel();
    });

    try {
      if (typeof firebase !== "undefined" && firebase.auth) {
        firebase.auth().onAuthStateChanged(function (user) {
          if (user && user.uid) mergeWrongNoteLocalIntoUid(user.uid);
          renderWrongPanel();
        });
      }
    } catch (e) {}

    renderWrongPanel();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }
})();
