(function () {
  var STORAGE_VER = "v1";
  var LS_PREFIX = "hanlaw_quiz_favorites_";
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

  function mergeFavLocalIntoUid(uid) {
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
      window.dispatchEvent(new CustomEvent("quiz-favorites-updated"));
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
    window.dispatchEvent(new CustomEvent("quiz-favorites-updated"));
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

  window.QuizFavorites = {
    has: function (questionId) {
      var want = normalizeId(questionId);
      if (!want) return false;
      var d = readRaw();
      for (var i = 0; i < d.order.length; i++) {
        if (normalizeId(d.order[i]) === want) return true;
      }
      return false;
    },
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
        if (window.QuizTrash && typeof window.QuizTrash.add === "function") {
          window.QuizTrash.add("fav", id);
        }
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
      if (window.QuizTrash && typeof window.QuizTrash.add === "function") {
        window.QuizTrash.add("fav", id);
      }
      var d = readRaw();
      d.order = d.order.filter(function (x) {
        return normalizeId(x) !== id;
      });
      writeRaw(d);
    },
    clear: function () {
      var d0 = readRaw();
      if (window.QuizTrash && typeof window.QuizTrash.add === "function") {
        d0.order.forEach(function (id) {
          var qid = normalizeId(id);
          if (qid) window.QuizTrash.add("fav", qid);
        });
      }
      writeRaw({ order: [] });
    },
    getOrderedIds: function () {
      return readRaw().order.map(normalizeId).filter(Boolean);
    }
  };

  window.refreshQuizFavoriteButton = function () {
    var btn = document.getElementById("btn-quiz-favorite");
    if (!btn) return;
    var ctx = window.__QUIZ_QUESTION_CONTEXT;
    if (!ctx || !ctx.questionId) {
      btn.hidden = true;
      return;
    }
    btn.hidden = false;
    var on = window.QuizFavorites.has(ctx.questionId);
    btn.textContent = on ? "찜함 · 취소" : "찜하기";
    btn.classList.toggle("btn--quiz-fav--on", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    if (window.HanlawNoteQuizChrome && typeof window.HanlawNoteQuizChrome.refreshAllAnsweredCards === "function") {
      window.HanlawNoteQuizChrome.refreshAllAnsweredCards();
    }
  };

  function renderFavoritesPanel() {
    var UI = window.HanlawNoteQuizUi;
    var listEl = document.getElementById("fav-note-list");
    var emptyEl = document.getElementById("fav-note-empty");
    var bannerEl = document.getElementById("fav-note-limit-banner");
    if (!listEl || !emptyEl) return;
    if (!UI || typeof UI.buildCard !== "function" || typeof UI.getDisplaySlice !== "function") {
      return;
    }

    var sortBar = document.getElementById("fav-note-sort-bar");
    var sortMode =
      typeof UI.getNoteSortMode === "function" ? UI.getNoteSortMode("fav") : "timeDesc";
    if (typeof UI.syncNoteSortBarUI === "function") {
      UI.syncNoteSortBarUI(sortBar, sortMode);
    }

    var ids = window.QuizFavorites.getOrderedIds();
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
        article.className = "fav-note-card";
        article.setAttribute("data-qid", id);
        var miss = document.createElement("p");
        miss.className = "fav-note-card__missing";
        miss.appendChild(document.createTextNode("문항 ID "));
        var code = document.createElement("code");
        code.textContent = id;
        miss.appendChild(code);
        miss.appendChild(
          document.createTextNode(" 는 현재 문항 목록에 없습니다. (삭제되었거나 아직 불러오지 못했습니다.)")
        );
        var head = document.createElement("div");
        head.className = "fav-note-card__head fav-note-card__head--indexed";
        var numEl = document.createElement("span");
        numEl.className = "note-card__index";
        numEl.setAttribute("aria-hidden", "true");
        numEl.textContent = String(idx1);
        head.appendChild(numEl);
        head.appendChild(miss);
        article.appendChild(head);
        var rmMiss = document.createElement("button");
        rmMiss.type = "button";
        rmMiss.className = "btn btn--small btn--outline fav-note-remove";
        rmMiss.setAttribute("data-qid", id);
        rmMiss.textContent = "찜 목록에서 제거";
        article.appendChild(rmMiss);
        listEl.appendChild(article);
        continue;
      }
      listEl.appendChild(UI.buildCard(q, idx1, "fav"));
    }
  }

  function onFavButtonClick() {
    var u = typeof window.getHanlawUser === "function" ? window.getHanlawUser() : null;
    if (!u || !u.email) {
      window.alert("찜하기는 로그인 후 이용할 수 있습니다.");
      return;
    }
    var ctx = window.__QUIZ_QUESTION_CONTEXT;
    if (!ctx || !ctx.questionId) return;
    window.QuizFavorites.toggle(ctx.questionId);
    window.refreshQuizFavoriteButton();
  }

  function bind() {
    var UI = window.HanlawNoteQuizUi;
    var btn = document.getElementById("btn-quiz-favorite");
    if (btn) btn.addEventListener("click", onFavButtonClick);

    var list = document.getElementById("fav-note-list");
    if (list) {
      if (UI && typeof UI.attachListInteractions === "function") {
        UI.attachListInteractions(list, {
          findQuestion: findQuestionById,
          removeSelector: ".fav-note-remove",
          onRemove: function (rid) {
            window.QuizFavorites.remove(rid);
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

    var clearBtn = document.getElementById("fav-note-clear");
    if (clearBtn) {
      clearBtn.addEventListener("click", function () {
        if (!window.QuizFavorites.getOrderedIds().length) return;
        if (window.confirm("찜한 문항을 모두 삭제할까요?")) {
          window.QuizFavorites.clear();
        }
      });
    }

    var sortBar = document.getElementById("fav-note-sort-bar");
    if (sortBar && UI && typeof UI.setNoteSortMode === "function" && !sortBar._hanlawSortBound) {
      sortBar._hanlawSortBound = true;
      sortBar.addEventListener("click", function (e) {
        var btnSort = e.target.closest("[data-note-sort]");
        if (!btnSort || !sortBar.contains(btnSort)) return;
        var mode = UI.setNoteSortMode("fav", btnSort.getAttribute("data-note-sort"));
        if (typeof UI.syncNoteSortBarUI === "function") {
          UI.syncNoteSortBarUI(sortBar, mode);
        }
        renderFavoritesPanel();
      });
    }

    window.addEventListener("hanlaw-panel-root-reset", function (ev) {
      var id = ev && ev.detail && ev.detail.panelId;
      if (id === "fav") renderFavoritesPanel();
    });
    window.addEventListener("quiz-favorites-updated", function () {
      renderFavoritesPanel();
      if (typeof window.refreshQuizFavoriteButton === "function") {
        window.refreshQuizFavoriteButton();
      }
    });

    window.addEventListener("question-bank-updated", renderFavoritesPanel);
    window.addEventListener("membership-updated", renderFavoritesPanel);
    window.addEventListener("app-auth", function (e) {
      var u = e && e.detail && e.detail.user;
      if (u && u.uid) mergeFavLocalIntoUid(u.uid);
      renderFavoritesPanel();
      if (typeof window.refreshQuizFavoriteButton === "function") {
        window.refreshQuizFavoriteButton();
      }
    });

    try {
      if (typeof firebase !== "undefined" && firebase.auth) {
        firebase.auth().onAuthStateChanged(function (user) {
          if (user && user.uid) mergeFavLocalIntoUid(user.uid);
          renderFavoritesPanel();
          if (typeof window.refreshQuizFavoriteButton === "function") {
            window.refreshQuizFavoriteButton();
          }
        });
      }
    } catch (e) {}

    renderFavoritesPanel();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }
})();
