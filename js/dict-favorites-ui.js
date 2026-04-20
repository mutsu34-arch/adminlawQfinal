/**
 * 찜노트 — 용어·조문·판례 탭 UI + 사전에서 찜한 목록 렌더링
 */
(function () {
  var ACTIVE = "fav-note-subtabs__btn--active";

  function $(id) {
    return document.getElementById(id);
  }

  function paidMember() {
    return typeof window.isPaidMember === "function" && window.isPaidMember();
  }

  function getFavItem(kind, id) {
    var DF = window.DictFavorites;
    if (!DF || typeof DF.getOrderedItems !== "function") return null;
    var items = DF.getOrderedItems(kind);
    var fid = String(id || "").trim();
    for (var i = 0; i < items.length; i++) {
      if (items[i].id === fid) return items[i];
    }
    return null;
  }

  function renderDictFavPreview(kind, it, container) {
    var DU = window.DictionaryUI;
    container.innerHTML = "";
    if (!DU) {
      var p0 = document.createElement("p");
      p0.className = "dict-empty";
      p0.textContent = "사전 모듈을 불러오는 중입니다.";
      container.appendChild(p0);
      return;
    }
    var q = String((it && it.searchText) || (it && it.title) || "").trim();
    if (kind === "term") {
      var term = DU.findTermForTag ? DU.findTermForTag(q) : null;
      if (!term && DU.searchTerms) {
        var tl = DU.searchTerms(q);
        term = tl.length ? tl[0] : null;
      }
      if (!term) {
        var pe = document.createElement("p");
        pe.className = "dict-empty";
        pe.textContent = "해당 용어를 찾지 못했습니다.";
        container.appendChild(pe);
        return;
      }
      DU.renderTermResults(container, [term], { skipNavBack: true, skipFavButton: true });
      return;
    }
    if (kind === "statute") {
      var st = DU.findStatuteForKey ? DU.findStatuteForKey(it.id, q) : null;
      DU.renderStatuteResults(container, st ? [st] : [], { skipNavBack: true, skipFavButton: true });
      return;
    }
    if (kind === "case") {
      var c = DU.findCaseForTag ? DU.findCaseForTag(q) : null;
      if (!c) {
        var pc = document.createElement("p");
        pc.className = "dict-empty";
        pc.textContent = "해당 판례를 찾지 못했습니다.";
        container.appendChild(pc);
        return;
      }
      DU.renderCaseResults(container, [c], "case", { skipNavBack: true, skipFavButton: true });
    }
  }

  function closeOtherPreviewsInList(listEl, exceptArticle) {
    if (!listEl) return;
    listEl.querySelectorAll(".dict-fav-card").forEach(function (card) {
      if (card === exceptArticle) return;
      var prev = card.querySelector(".dict-fav-card__preview");
      var btn = card.querySelector("[data-dict-fav-preview-toggle]");
      if (prev) {
        prev.hidden = true;
        prev.innerHTML = "";
      }
      if (btn) {
        btn.setAttribute("aria-expanded", "false");
        btn.textContent = "내용 보기";
      }
    });
  }

  function renderDictKindList(kind) {
    var UI = window.HanlawNoteQuizUi;
    var DF = window.DictFavorites;
    if (!UI || !DF || typeof UI.getDisplaySlice !== "function") return;

    var listEl = $("dict-fav-" + kind + "-list");
    var emptyEl = $("dict-fav-" + kind + "-empty");
    var bannerEl = $("dict-fav-" + kind + "-banner");
    if (!listEl || !emptyEl) return;

    var items = DF.getOrderedItems(kind);
    var ids = items.map(function (it) {
      return it.id;
    });
    var slice = UI.getDisplaySlice(ids);
    var idToItem = {};
    items.forEach(function (it) {
      idToItem[it.id] = it;
    });

    listEl.innerHTML = "";

    if (!slice.visible.length) {
      emptyEl.hidden = false;
      if (bannerEl) {
        bannerEl.hidden = true;
        bannerEl.textContent = "";
      }
      return;
    }
    emptyEl.hidden = true;

    if (bannerEl) {
      if (slice.hiddenCount <= 0) {
        bannerEl.hidden = true;
        bannerEl.textContent = "";
      } else {
        bannerEl.hidden = false;
        if (paidMember()) {
          bannerEl.textContent =
            "저장 " +
            slice.total +
            "개 중 앞쪽 " +
            slice.limit +
            "개만 이 목록에 표시됩니다.";
        } else {
          bannerEl.textContent =
            "저장 " +
            slice.total +
            "개 중 앞쪽 " +
            slice.limit +
            "개만 표시됩니다. (유료 회원은 최대 " +
            UI.DISPLAY_PAID +
            "개까지 열람 가능)";
        }
      }
    }

    for (var vi = 0; vi < slice.visible.length; vi++) {
      var id = slice.visible[vi];
      var it = idToItem[id];
      if (!it) continue;
      var article = document.createElement("article");
      article.className = "dict-fav-card";
      article.setAttribute("data-dict-fav-id", id);

      var head = document.createElement("div");
      head.className = "dict-fav-card__head";
      var title = document.createElement("div");
      title.className = "dict-fav-card__title";
      title.textContent = it.title || id;
      head.appendChild(title);
      article.appendChild(head);

      if (it.sub) {
        var sub = document.createElement("p");
        sub.className = "dict-fav-card__sub";
        sub.textContent = it.sub;
        article.appendChild(sub);
      }

      var actions = document.createElement("div");
      actions.className = "dict-fav-card__actions";
      var btnOpen = document.createElement("button");
      btnOpen.type = "button";
      btnOpen.className = "btn btn--small btn--primary";
      btnOpen.setAttribute("data-dict-fav-preview-toggle", kind);
      btnOpen.setAttribute("data-dict-fav-id", id);
      btnOpen.setAttribute("aria-expanded", "false");
      btnOpen.textContent = "내용 보기";
      var btnRm = document.createElement("button");
      btnRm.type = "button";
      btnRm.className = "btn btn--small btn--outline";
      btnRm.setAttribute("data-dict-fav-remove", kind);
      btnRm.setAttribute("data-dict-fav-id", id);
      btnRm.textContent = "찜 해제";
      actions.appendChild(btnOpen);
      actions.appendChild(btnRm);
      article.appendChild(actions);

      var preview = document.createElement("div");
      preview.className = "dict-fav-card__preview";
      preview.hidden = true;
      preview.setAttribute("data-dict-fav-preview-root", kind);
      article.appendChild(preview);

      listEl.appendChild(article);
    }
  }

  function renderAllDictPanels() {
    renderDictKindList("term");
    renderDictKindList("statute");
    renderDictKindList("case");
  }

  function setActiveTab(which) {
    document.querySelectorAll(".fav-note-subtabs__btn").forEach(function (b) {
      var on = b.getAttribute("data-fav-tab") === which;
      b.classList.toggle(ACTIVE, on);
      b.classList.toggle("btn--outline", !on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
    document.querySelectorAll(".fav-note-subpane").forEach(function (p) {
      var show = p.getAttribute("data-fav-pane") === which;
      p.hidden = !show;
    });
    if (which === "quiz") {
      try {
        window.dispatchEvent(new CustomEvent("quiz-favorites-updated"));
      } catch (e) {}
    } else {
      renderDictKindList(which);
    }
  }

  function bind() {
    var bar = document.querySelector(".fav-note-subtabs");
    if (bar && !bar._hanlawDictFavBound) {
      bar._hanlawDictFavBound = true;
      bar.addEventListener("click", function (e) {
        var t = e.target.closest("[data-fav-tab]");
        if (!t || !bar.contains(t)) return;
        var which = t.getAttribute("data-fav-tab");
        if (!which) return;
        setActiveTab(which);
      });
    }

    ["term", "statute", "case"].forEach(function (kind) {
      var clearId = "dict-fav-" + kind + "-clear";
      var c = $(clearId);
      if (c && !c._hanlawBound) {
        c._hanlawBound = true;
        c.addEventListener("click", function () {
          if (!window.DictFavorites || !window.DictFavorites.getOrderedItems(kind).length) return;
          var label = kind === "term" ? "용어" : kind === "statute" ? "조문" : "판례";
          if (window.confirm(label + " 찜을 모두 삭제할까요?")) {
            window.DictFavorites.clearKind(kind);
          }
        });
      }
    });

    var listRoot = document.getElementById("panel-fav");
    if (listRoot && !listRoot._hanlawDictFavListBound) {
      listRoot._hanlawDictFavListBound = true;
      listRoot.addEventListener("click", function (e) {
        var toggleB = e.target.closest("[data-dict-fav-preview-toggle]");
        if (toggleB && listRoot.contains(toggleB)) {
          var k = toggleB.getAttribute("data-dict-fav-preview-toggle");
          var fid = toggleB.getAttribute("data-dict-fav-id");
          var card = toggleB.closest(".dict-fav-card");
          var preview = card && card.querySelector(".dict-fav-card__preview");
          if (!k || !fid || !preview) return;
          var expanded = toggleB.getAttribute("aria-expanded") === "true";
          var listEl = card && card.parentElement;
          if (expanded) {
            preview.hidden = true;
            preview.innerHTML = "";
            toggleB.setAttribute("aria-expanded", "false");
            toggleB.textContent = "내용 보기";
          } else {
            closeOtherPreviewsInList(listEl, card);
            var it = getFavItem(k, fid);
            if (!it) return;
            renderDictFavPreview(k, it, preview);
            preview.hidden = false;
            toggleB.setAttribute("aria-expanded", "true");
            toggleB.textContent = "접기";
          }
          return;
        }
        var rm = e.target.closest("[data-dict-fav-remove]");
        if (rm && listRoot.contains(rm)) {
          var k2 = rm.getAttribute("data-dict-fav-remove");
          var id = rm.getAttribute("data-dict-fav-id");
          if (k2 && id && window.DictFavorites) window.DictFavorites.remove(k2, id);
        }
      });
    }

    window.addEventListener("dict-favorites-updated", renderAllDictPanels);
    window.addEventListener("membership-updated", renderAllDictPanels);
    window.addEventListener("app-auth", renderAllDictPanels);

    renderAllDictPanels();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }
})();
