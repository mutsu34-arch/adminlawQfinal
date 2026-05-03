(function () {
  var STORAGE_VER = "v1";
  var LS_PREFIX = "hanlaw_quiz_master_";
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

  function mergeMasterLocalIntoUid(uid) {
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
      window.dispatchEvent(new CustomEvent("quiz-master-updated"));
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
    try {
      window.dispatchEvent(new CustomEvent("quiz-master-updated"));
    } catch (e2) {}
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

  window.QuizMaster = {
    has: function (questionId) {
      var want = normalizeId(questionId);
      if (!want) return false;
      var d = readRaw();
      for (var i = 0; i < d.order.length; i++) {
        if (normalizeId(d.order[i]) === want) return true;
      }
      return false;
    },
    /** 이미 마스터면 제거, 아니면 추가 (퀴즈 일반 세트에서 제외) */
    toggle: function (questionId) {
      var id = normalizeId(questionId);
      if (!id) return false;
      var d = readRaw();
      var idx = -1;
      for (var j = 0; j < d.order.length; j++) {
        if (normalizeId(d.order[j]) === id) {
          idx = j;
          break;
        }
      }
      if (idx >= 0) {
        d.order.splice(idx, 1);
        writeRaw(d);
        return false;
      }
      d.order.unshift(id);
      if (d.order.length > MAX_STORE) d.order.length = MAX_STORE;
      writeRaw(d);
      return true;
    },
    remove: function (questionId) {
      var id = normalizeId(questionId);
      if (!id) return;
      var d = readRaw();
      d.order = d.order.filter(function (x) {
        return normalizeId(x) !== id;
      });
      writeRaw(d);
    },
    clear: function () {
      writeRaw({ order: [] });
    },
    getOrderedIds: function () {
      return readRaw().order.map(normalizeId).filter(Boolean);
    }
  };

  window.refreshQuizMasterButton = function () {
    var btn = document.getElementById("btn-quiz-master");
    if (!btn) return;
    var ctx = window.__QUIZ_QUESTION_CONTEXT;
    if (!ctx || !ctx.questionId) {
      btn.hidden = true;
      return;
    }
    btn.hidden = false;
    var on = window.QuizMaster.has(ctx.questionId);
    btn.textContent = on ? "마스터됨 · 취소" : "마스터";
    btn.classList.toggle("btn--quiz-master--on", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    if (window.HanlawNoteQuizChrome && typeof window.HanlawNoteQuizChrome.refreshAllAnsweredCards === "function") {
      window.HanlawNoteQuizChrome.refreshAllAnsweredCards();
    }
  };

  function renderMasterPanel() {
    var UI = window.HanlawNoteQuizUi;
    var listEl = document.getElementById("master-note-list");
    var emptyEl = document.getElementById("master-note-empty");
    var bannerEl = document.getElementById("master-note-limit-banner");
    if (!listEl || !emptyEl) return;
    if (!UI || typeof UI.buildCard !== "function" || typeof UI.getDisplaySlice !== "function") {
      return;
    }

    var sortBar = document.getElementById("master-note-sort-bar");
    var sortMode =
      typeof UI.getNoteSortMode === "function" ? UI.getNoteSortMode("master") : "timeDesc";
    if (typeof UI.syncNoteSortBarUI === "function") {
      UI.syncNoteSortBarUI(sortBar, sortMode);
    }

    var ids = window.QuizMaster.getOrderedIds();
    if (typeof UI.sortNoteIds === "function") {
      ids = UI.sortNoteIds(ids, sortMode, findQuestionById);
    }
    listEl.innerHTML = "";

    if (!ids.length) {
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
        article.className = "master-note-card";
        article.setAttribute("data-qid", id);
        var miss = document.createElement("p");
        miss.className = "master-note-card__missing";
        miss.appendChild(document.createTextNode("문항 ID "));
        var code = document.createElement("code");
        code.textContent = id;
        miss.appendChild(code);
        miss.appendChild(
          document.createTextNode(" 는 현재 문항 목록에 없습니다. (삭제되었거나 아직 불러오지 못했습니다.)")
        );
        var head = document.createElement("div");
        head.className = "master-note-card__head master-note-card__head--indexed";
        var numEl = document.createElement("span");
        numEl.className = "note-card__index";
        numEl.setAttribute("aria-hidden", "true");
        numEl.textContent = String(idx1);
        head.appendChild(numEl);
        head.appendChild(miss);
        article.appendChild(head);
        var rmMiss = document.createElement("button");
        rmMiss.type = "button";
        rmMiss.className = "btn btn--small btn--outline master-note-remove";
        rmMiss.setAttribute("data-qid", id);
        rmMiss.textContent = "마스터 목록에서 제거";
        article.appendChild(rmMiss);
        listEl.appendChild(article);
        continue;
      }
      listEl.appendChild(UI.buildCard(q, idx1, "master"));
    }
  }

  function onMasterButtonClick() {
    var u = typeof window.getHanlawUser === "function" ? window.getHanlawUser() : null;
    if (!u || !u.email) {
      window.alert("마스터는 로그인 후 이용할 수 있습니다.");
      return;
    }
    var ctx = window.__QUIZ_QUESTION_CONTEXT;
    if (!ctx || !ctx.questionId) return;
    window.QuizMaster.toggle(ctx.questionId);
    window.refreshQuizMasterButton();
  }

  function bind() {
    var UI = window.HanlawNoteQuizUi;
    var btn = document.getElementById("btn-quiz-master");
    if (btn) btn.addEventListener("click", onMasterButtonClick);

    var list = document.getElementById("master-note-list");
    if (list) {
      if (UI && typeof UI.attachListInteractions === "function") {
        UI.attachListInteractions(list, {
          findQuestion: findQuestionById,
          removeSelector: ".master-note-remove",
          onRemove: function (rid) {
            window.QuizMaster.remove(rid);
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
              window.QuizWrongNote.record(q.id);
            }
          }
        });
      }
    }

    var clearBtn = document.getElementById("master-note-clear");
    if (clearBtn) {
      clearBtn.addEventListener("click", function () {
        if (!window.QuizMaster.getOrderedIds().length) return;
        if (window.confirm("마스터로 표시한 문항을 모두 해제할까요? 일반 퀴즈 범위에 다시 나올 수 있습니다.")) {
          window.QuizMaster.clear();
        }
      });
    }

    var sortBar = document.getElementById("master-note-sort-bar");
    if (sortBar && UI && typeof UI.setNoteSortMode === "function" && !sortBar._hanlawSortBound) {
      sortBar._hanlawSortBound = true;
      sortBar.addEventListener("click", function (e) {
        var btnSort = e.target.closest("[data-note-sort]");
        if (!btnSort || !sortBar.contains(btnSort)) return;
        var mode = UI.setNoteSortMode("master", btnSort.getAttribute("data-note-sort"));
        if (typeof UI.syncNoteSortBarUI === "function") {
          UI.syncNoteSortBarUI(sortBar, mode);
        }
        renderMasterPanel();
      });
    }

    window.addEventListener("quiz-master-updated", function () {
      renderMasterPanel();
      if (typeof window.refreshQuizMasterButton === "function") {
        window.refreshQuizMasterButton();
      }
      try {
        window.dispatchEvent(new CustomEvent("study-scope-change"));
      } catch (e) {}
    });

    window.addEventListener("hanlaw-panel-root-reset", function (ev) {
      var id = ev && ev.detail && ev.detail.panelId;
      if (id === "master") renderMasterPanel();
    });
    window.addEventListener("question-bank-updated", renderMasterPanel);
    window.addEventListener("membership-updated", renderMasterPanel);
    window.addEventListener("app-auth", function (e) {
      var u = e && e.detail && e.detail.user;
      if (u && u.uid) mergeMasterLocalIntoUid(u.uid);
      renderMasterPanel();
      if (typeof window.refreshQuizMasterButton === "function") {
        window.refreshQuizMasterButton();
      }
    });

    try {
      if (typeof firebase !== "undefined" && firebase.auth) {
        firebase.auth().onAuthStateChanged(function (user) {
          if (user && user.uid) mergeMasterLocalIntoUid(user.uid);
          renderMasterPanel();
          if (typeof window.refreshQuizMasterButton === "function") {
            window.refreshQuizMasterButton();
          }
        });
      }
    } catch (e) {}

    renderMasterPanel();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }
})();
