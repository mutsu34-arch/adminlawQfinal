(function () {
  var STORAGE_VER = "v1";
  var LS_PREFIX = "hanlaw_quiz_favorites_";

  function storageKey() {
    try {
      if (typeof window.getHanlawUser === "function") {
        var u = window.getHanlawUser();
        if (u) return LS_PREFIX + STORAGE_VER + "_" + u.uid;
      }
    } catch (e) {}
    return LS_PREFIX + STORAGE_VER + "_local";
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

  function notify() {
    window.dispatchEvent(new CustomEvent("quiz-favorites-updated"));
  }

  function findQuestionById(id) {
    var bank = window.QUESTION_BANK || [];
    for (var i = 0; i < bank.length; i++) {
      if (bank[i].id === id) return bank[i];
    }
    return null;
  }

  function formatSource(q) {
    if (!q) return "";
    var y = q.year;
    var yearPart = "";
    if (y != null && y !== "" && !isNaN(parseInt(String(y), 10))) {
      yearPart = parseInt(String(y), 10) + "년도";
    }
    var examPart = "";
    if (q.examId && typeof window.getExamById === "function") {
      var cat = window.getExamById(q.examId);
      if (cat) examPart = cat.sourceLabel || cat.label || "";
    }
    if (!examPart && q.exam) examPart = String(q.exam).trim();
    if (yearPart && examPart) return yearPart + " " + examPart;
    if (yearPart) return yearPart;
    return examPart;
  }

  function getBasicExplain(q) {
    if (!q) return "";
    if (q.explanationBasic != null && q.explanationBasic !== "") return q.explanationBasic;
    return q.explanation != null ? q.explanation : "";
  }

  window.QuizFavorites = {
    has: function (questionId) {
      var d = readRaw();
      return d.order.indexOf(questionId) >= 0;
    },
    toggle: function (questionId) {
      if (!questionId) return false;
      var d = readRaw();
      var idx = d.order.indexOf(questionId);
      if (idx >= 0) {
        d.order.splice(idx, 1);
        writeRaw(d);
        return false;
      }
      d.order.unshift(questionId);
      writeRaw(d);
      return true;
    },
    remove: function (questionId) {
      var d = readRaw();
      var idx = d.order.indexOf(questionId);
      if (idx < 0) return;
      d.order.splice(idx, 1);
      writeRaw(d);
    },
    clear: function () {
      writeRaw({ order: [] });
    },
    getOrderedIds: function () {
      return readRaw().order.slice();
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
  };

  function renderFavoritesPanel() {
    var listEl = document.getElementById("fav-note-list");
    var emptyEl = document.getElementById("fav-note-empty");
    if (!listEl || !emptyEl) return;

    var ids = window.QuizFavorites.getOrderedIds();
    listEl.innerHTML = "";

    if (!ids.length) {
      emptyEl.hidden = false;
      return;
    }
    emptyEl.hidden = true;

    for (var i = 0; i < ids.length; i++) {
      var id = ids[i];
      var q = findQuestionById(id);
      var article = document.createElement("article");
      article.className = "fav-note-card";
      article.setAttribute("data-qid", id);

      if (!q) {
        var miss = document.createElement("p");
        miss.className = "fav-note-card__missing";
        miss.appendChild(document.createTextNode("문항 ID "));
        var code = document.createElement("code");
        code.textContent = id;
        miss.appendChild(code);
        miss.appendChild(
          document.createTextNode(" 는 현재 문항 목록에 없습니다. (삭제되었거나 아직 불러오지 못했습니다.)")
        );
        var rmMiss = document.createElement("button");
        rmMiss.type = "button";
        rmMiss.className = "btn btn--small btn--outline fav-note-remove";
        rmMiss.setAttribute("data-qid", id);
        rmMiss.textContent = "찜 목록에서 제거";
        article.appendChild(miss);
        article.appendChild(rmMiss);
        listEl.appendChild(article);
        continue;
      }

      var src = formatSource(q);
      var head = document.createElement("div");
      head.className = "fav-note-card__head";
      var title = document.createElement("h3");
      title.className = "fav-note-card__title";
      title.textContent = (src ? src + " · " : "") + (q.topic || "주제 없음");
      head.appendChild(title);

      var stmt = document.createElement("p");
      stmt.className = "fav-note-card__stmt";
      stmt.textContent = q.statement || "";

      var ans = document.createElement("p");
      ans.className = "fav-note-card__ans";
      ans.textContent = "정답: " + (q.answer ? "O" : "X");

      var ex = document.createElement("div");
      ex.className = "fav-note-card__explain";
      ex.textContent = getBasicExplain(q);

      var actions = document.createElement("div");
      actions.className = "fav-note-card__actions";
      var rm = document.createElement("button");
      rm.type = "button";
      rm.className = "btn btn--small btn--outline fav-note-remove";
      rm.setAttribute("data-qid", id);
      rm.textContent = "찜 해제";
      actions.appendChild(rm);

      article.appendChild(head);
      article.appendChild(stmt);
      article.appendChild(ans);
      article.appendChild(ex);
      article.appendChild(actions);
      listEl.appendChild(article);
    }
  }

  function onFavButtonClick() {
    var ctx = window.__QUIZ_QUESTION_CONTEXT;
    if (!ctx || !ctx.questionId) return;
    window.QuizFavorites.toggle(ctx.questionId);
    window.refreshQuizFavoriteButton();
  }

  function onPanelClick(e) {
    var rm = e.target.closest(".fav-note-remove");
    if (!rm) return;
    var id = rm.getAttribute("data-qid");
    if (id) window.QuizFavorites.remove(id);
  }

  function bind() {
    var btn = document.getElementById("btn-quiz-favorite");
    if (btn) btn.addEventListener("click", onFavButtonClick);

    var list = document.getElementById("fav-note-list");
    if (list) list.addEventListener("click", onPanelClick);

    var clearBtn = document.getElementById("fav-note-clear");
    if (clearBtn) {
      clearBtn.addEventListener("click", function () {
        if (!window.QuizFavorites.getOrderedIds().length) return;
        if (window.confirm("찜한 문항을 모두 삭제할까요?")) {
          window.QuizFavorites.clear();
        }
      });
    }

    window.addEventListener("quiz-favorites-updated", function () {
      renderFavoritesPanel();
      if (typeof window.refreshQuizFavoriteButton === "function") {
        window.refreshQuizFavoriteButton();
      }
    });

    window.addEventListener("question-bank-updated", renderFavoritesPanel);
    window.addEventListener("app-auth", function () {
      renderFavoritesPanel();
      if (typeof window.refreshQuizFavoriteButton === "function") {
        window.refreshQuizFavoriteButton();
      }
    });

    renderFavoritesPanel();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }
})();
