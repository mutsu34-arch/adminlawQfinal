/**
 * 노트 해설 형광펜 — web-highlighter + 해설 버전(explainVerBasic/Detail) 기반 복원
 */
(function () {
  var STORAGE_VER = "v2";
  var LS_PREFIX = "hanlaw_explain_hl_";
  var COLOR_LS_KEY = "hanlaw_explain_hl_color_v1";
  var STALE_MSG = "해설이 수정되어 이전 하이라이트를 불러올 수 없습니다.";

  var HIGHLIGHT_COLORS = [
    { id: "yellow", label: "노랑" },
    { id: "green", label: "연두" },
    { id: "pink", label: "분홍" },
    { id: "blue", label: "하늘" },
    { id: "orange", label: "주황" }
  ];

  var EXCEPT_SELECTORS = [
    "button",
    "a",
    "input",
    "textarea",
    "select",
    ".feedback-tag--link",
    ".note-quiz-chrome",
    ".note-quiz-memo",
    ".quiz-explain-hl-inline",
    ".quiz-explain-hl-stale"
  ];

  function normalizeId(id) {
    return String(id == null ? "" : id).trim();
  }

  function storageKey() {
    try {
      if (typeof window.getHanlawUser === "function") {
        var u = window.getHanlawUser();
        if (u && u.uid) return LS_PREFIX + STORAGE_VER + "_" + u.uid;
      }
    } catch (e) {}
    return LS_PREFIX + STORAGE_VER + "_local";
  }

  function readAll() {
    try {
      var s = localStorage.getItem(storageKey());
      if (!s) return { entries: {} };
      var o = JSON.parse(s);
      if (!o || typeof o.entries !== "object" || o.entries === null) return { entries: {} };
      return o;
    } catch (e) {
      return { entries: {} };
    }
  }

  function writeAll(data) {
    try {
      localStorage.setItem(storageKey(), JSON.stringify(data));
    } catch (e) {}
    try {
      window.dispatchEvent(new CustomEvent("hanlaw-explain-highlight-updated"));
    } catch (e2) {}
  }

  function entryKey(qid, field) {
    return normalizeId(qid) + "::" + field;
  }

  function loadEntry(qid, field) {
    var k = entryKey(qid, field);
    var e = readAll().entries[k];
    if (!e || typeof e !== "object") return null;
    return {
      version: typeof e.version === "number" && e.version >= 1 ? Math.floor(e.version) : 1,
      items: Array.isArray(e.items) ? e.items : []
    };
  }

  function saveEntry(qid, field, version, items) {
    var q = normalizeId(qid);
    if (!q) return;
    var data = readAll();
    var k = entryKey(q, field);
    if (!items || !items.length) {
      delete data.entries[k];
    } else {
      data.entries[k] = {
        version: typeof version === "number" && version >= 1 ? Math.floor(version) : 1,
        items: items
      };
    }
    writeAll(data);
  }

  function getVersions(q) {
    if (typeof window.getHanlawExplainVersions === "function") {
      return window.getHanlawExplainVersions(q);
    }
    return { basic: 1, detail: 1 };
  }

  function findQuestionById(id) {
    var want = normalizeId(id);
    var bank = window.QUESTION_BANK || [];
    for (var i = 0; i < bank.length; i++) {
      if (bank[i] && normalizeId(bank[i].id) === want) return bank[i];
    }
    return null;
  }

  function normalizeCompareText(s) {
    return String(s || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function textSimilarEnough(saved, actual) {
    var a = normalizeCompareText(saved);
    var b = normalizeCompareText(actual);
    if (!a || !b) return false;
    if (a === b) return true;
    if (a.length >= 4 && b.indexOf(a) >= 0) return true;
    if (b.length >= 4 && a.indexOf(b) >= 0) return true;
    return false;
  }

  function sourceToItem(src, color) {
    if (!src) return null;
    return {
      id: src.id,
      startMeta: src.startMeta,
      endMeta: src.endMeta,
      text: src.text,
      color: color || getSelectedColor()
    };
  }

  function normalizeColorId(raw) {
    var id = String(raw || "yellow").trim().toLowerCase();
    for (var i = 0; i < HIGHLIGHT_COLORS.length; i++) {
      if (HIGHLIGHT_COLORS[i].id === id) return id;
    }
    return "yellow";
  }

  function getSelectedColor() {
    try {
      return normalizeColorId(localStorage.getItem(COLOR_LS_KEY));
    } catch (e) {
      return "yellow";
    }
  }

  function setSelectedColor(colorId) {
    try {
      localStorage.setItem(COLOR_LS_KEY, normalizeColorId(colorId));
    } catch (e) {}
  }

  function colorClassName(colorId) {
    return "hanlaw-explain-highlight--" + normalizeColorId(colorId);
  }

  function applyColorToHighlight(hl, id, colorId) {
    if (!hl || !id) return;
    HIGHLIGHT_COLORS.forEach(function (c) {
      try {
        hl.removeClass(colorClassName(c.id), id);
      } catch (e) {}
    });
    try {
      hl.addClass(colorClassName(colorId), id);
    } catch (e2) {}
  }

  function getHighlighterCtor() {
    return window.Highlighter || null;
  }

  function selectionInRoot(root) {
    var sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount || !root) return null;
    var range = sel.getRangeAt(0);
    var text = String(sel.toString() || "");
    if (!text.trim()) return null;

    var ancestor = range.commonAncestorContainer;
    if (ancestor && ancestor.nodeType === Node.TEXT_NODE) ancestor = ancestor.parentNode;
    if (!ancestor || !root.contains(ancestor)) return null;

    try {
      if (typeof range.intersectsNode === "function" && !range.intersectsNode(root)) {
        return null;
      }
    } catch (e) {}

    return { selection: sel, range: range, text: text };
  }

  function cacheSelectionOnInst(inst, root) {
    var picked = selectionInRoot(root);
    if (!picked) return;
    inst._lastRange = picked.range.cloneRange();
    inst._lastText = picked.text;
  }

  function getEffectiveSelection(inst, root) {
    var live = selectionInRoot(root);
    if (live) {
      inst._lastRange = live.range.cloneRange();
      inst._lastText = live.text;
      return live;
    }
    if (inst._lastRange) {
      return {
        range: inst._lastRange.cloneRange(),
        text: inst._lastText || "",
        selection: window.getSelection()
      };
    }
    return null;
  }

  function rangeOverlapsNode(range, node) {
    if (!range || !node) return false;
    try {
      if (typeof range.intersectsNode === "function") return range.intersectsNode(node);
    } catch (e) {}
    try {
      var nodeRange = document.createRange();
      nodeRange.selectNodeContents(node);
      return (
        range.compareBoundaryPoints(Range.END_TO_START, nodeRange) < 0 &&
        range.compareBoundaryPoints(Range.START_TO_END, nodeRange) > 0
      );
    } catch (e2) {
      return false;
    }
  }

  function collectHighlightIdsInRange(root, range, hl) {
    var ids = [];
    var seen = {};
    if (!root || !range || !hl) return ids;

    var wraps = root.querySelectorAll(".hanlaw-explain-highlight");
    for (var i = 0; i < wraps.length; i++) {
      var wrap = wraps[i];
      if (!rangeOverlapsNode(range, wrap)) continue;
      var id = null;
      try {
        id = hl.getIdByDom(wrap);
      } catch (e) {}
      if (id && !seen[id]) {
        seen[id] = true;
        ids.push(id);
      }
    }

    if (!ids.length) {
      var node = range.commonAncestorContainer;
      if (node && node.nodeType === Node.TEXT_NODE) node = node.parentNode;
      try {
        var single = node && hl.getIdByDom ? hl.getIdByDom(node) : null;
        if (single && !seen[single]) ids.push(single);
      } catch (e2) {}
    }
    return ids;
  }

  function removeStaleNotice(root) {
    if (!root || !root.parentElement) return;
    var p = root.parentElement;
    var field = root.getAttribute("data-explain-hl-field") || "";
    var stale = p.querySelector(".quiz-explain-hl-stale[data-hl-field='" + field + "']");
    if (stale) stale.remove();
  }

  function showStaleNotice(root, field) {
    if (!root || !root.parentElement) return;
    removeStaleNotice(root);
    var p = root.parentElement;
    var el = document.createElement("p");
    el.className = "quiz-explain-hl-stale";
    el.setAttribute("data-hl-field", field);
    el.setAttribute("role", "status");
    el.textContent = STALE_MSG;
    if (root.nextSibling) p.insertBefore(el, root.nextSibling);
    else p.appendChild(el);
  }

  function removeInlineToolbar(root, field) {
    if (!root || !root.parentElement) return;
    var bar = root.parentElement.querySelector(
      '.quiz-explain-hl-inline[data-hl-field="' + field + '"]'
    );
    if (bar) bar.remove();
  }

  function setInlineHint(hintEl, text, warn) {
    if (!hintEl) return;
    hintEl.textContent = text;
    hintEl.classList.toggle("quiz-explain-hl-inline__hint--warn", !!warn);
  }

  function ensureInlineToolbar(root, field, inst) {
    if (!root || !root.parentElement || !inst) return;
    removeInlineToolbar(root, field);

    var bar = document.createElement("div");
    bar.className = "quiz-explain-hl-inline";
    bar.setAttribute("data-hl-field", field);
    bar.setAttribute("data-explain-hl-inline", "1");

    var btnMark = document.createElement("button");
    btnMark.type = "button";
    btnMark.className = "btn btn--secondary btn--small";
    btnMark.setAttribute("data-explain-hl-apply", "1");
    btnMark.textContent = "형광펜";

    var btnClear = document.createElement("button");
    btnClear.type = "button";
    btnClear.className = "btn btn--outline btn--small";
    btnClear.setAttribute("data-explain-hl-clear", "1");
    btnClear.textContent = "선택 형광펜 지우기";

    var colorsWrap = document.createElement("div");
    colorsWrap.className = "quiz-explain-hl-colors";
    colorsWrap.setAttribute("role", "group");
    colorsWrap.setAttribute("aria-label", "형광펜 색");

    var colorName = "hanlaw-hl-color-" + field + "-" + String(inst.qid || "").replace(/[^\w-]/g, "_");
    var selectedColor = getSelectedColor();

    HIGHLIGHT_COLORS.forEach(function (c) {
      var lbl = document.createElement("label");
      lbl.className = "quiz-explain-hl-colors__item";
      lbl.title = c.label;
      var inp = document.createElement("input");
      inp.type = "radio";
      inp.name = colorName;
      inp.value = c.id;
      inp.className = "quiz-explain-hl-colors__input";
      inp.checked = c.id === selectedColor;
      var sw = document.createElement("span");
      sw.className = "quiz-explain-hl-colors__swatch quiz-explain-hl-colors__swatch--" + c.id;
      sw.setAttribute("aria-hidden", "true");
      lbl.appendChild(inp);
      lbl.appendChild(sw);
      lbl.appendChild(document.createTextNode(c.label));
      colorsWrap.appendChild(lbl);
      inp.addEventListener("change", function () {
        if (inp.checked) setSelectedColor(c.id);
      });
    });

    var hint = document.createElement("span");
    hint.className = "quiz-explain-hl-inline__hint";
    hint.textContent = "색을 고른 뒤 해설에서 문장을 드래그하고 「형광펜」을 누르세요.";

    bar.appendChild(colorsWrap);
    bar.appendChild(btnMark);
    bar.appendChild(btnClear);
    bar.appendChild(hint);
    root.parentElement.insertBefore(bar, root);

    root.addEventListener("mouseup", function () {
      cacheSelectionOnInst(inst, root);
    });
    root.addEventListener("touchend", function () {
      cacheSelectionOnInst(inst, root);
    });

    btnMark.addEventListener("mousedown", function (ev) {
      ev.preventDefault();
    });
    btnClear.addEventListener("mousedown", function (ev) {
      ev.preventDefault();
    });

    btnMark.addEventListener("click", function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      var picked = getEffectiveSelection(inst, root);
      if (!picked) {
        setInlineHint(
          hint,
          "먼저 아래 해설 본문에서 문장을 드래그해 선택해 주세요.",
          true
        );
        return;
      }
      var colorId = getSelectedColor();
      try {
        inst.highlighter.fromRange(picked.range.cloneRange());
        setInlineHint(hint, "형광펜(" + colorId + ")을 적용했습니다.", false);
      } catch (err) {
        console.warn("[HanlawExplainHighlighter] fromRange:", err);
        setInlineHint(hint, "형광펜을 칠하지 못했습니다. 다시 선택해 주세요.", true);
      }
      try {
        if (picked.selection && picked.selection.removeAllRanges) picked.selection.removeAllRanges();
      } catch (e2) {}
      inst._lastRange = null;
      inst._lastText = "";
    });

    btnClear.addEventListener("click", function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      var picked = getEffectiveSelection(inst, root);
      if (!picked) {
        setInlineHint(hint, "지울 형광펜 구간을 드래그로 선택해 주세요.", true);
        return;
      }
      var ids = collectHighlightIdsInRange(root, picked.range, inst.highlighter);
      if (!ids.length) {
        setInlineHint(hint, "선택한 위치에 형광펜이 없습니다.", true);
        return;
      }
      var removed = 0;
      ids.forEach(function (hid) {
        try {
          inst.highlighter.remove(hid);
          removed += 1;
        } catch (err2) {
          console.warn("[HanlawExplainHighlighter] remove:", err2);
        }
      });
      if (removed > 0) {
        setInlineHint(
          hint,
          removed > 1 ? "형광펜 " + removed + "곳을 지웠습니다." : "형광펜을 지웠습니다.",
          false
        );
      } else {
        setInlineHint(hint, "형광펜을 지우지 못했습니다.", true);
      }
      try {
        if (picked.selection && picked.selection.removeAllRanges) picked.selection.removeAllRanges();
      } catch (e3) {}
      inst._lastRange = null;
      inst._lastText = "";
    });
  }

  function disposeRegion(inst) {
    if (!inst) return;
    try {
      if (inst.highlighter && typeof inst.highlighter.dispose === "function") {
        inst.highlighter.dispose();
      }
    } catch (e) {}
    if (inst.root) {
      removeInlineToolbar(inst.root, inst.field);
      inst.root.classList.remove("quiz-explain-hl-root");
      inst.root.removeAttribute("data-explain-hl-field");
      removeStaleNotice(inst.root);
    }
  }

  function disposeOnCard(article) {
    if (!article || !article._hanlawExplainHl) return;
    Object.keys(article._hanlawExplainHl).forEach(function (k) {
      disposeRegion(article._hanlawExplainHl[k]);
    });
    article._hanlawExplainHl = null;
  }

  function persistItems(qid, field, version, items) {
    saveEntry(qid, field, version, items);
  }

  function restoreItems(hl, qid, field, savedVersion, currentVersion, items, root) {
    removeStaleNotice(root);
    if (!items || !items.length) return;

    var versionMismatch = savedVersion !== currentVersion;
    if (!versionMismatch) {
      items.forEach(function (it) {
        try {
          hl.fromStore(it.startMeta, it.endMeta, it.text, it.id);
          applyColorToHighlight(hl, it.id, it.color || "yellow");
        } catch (e) {}
      });
      return;
    }

    var failed = false;
    items.forEach(function (it) {
      try {
        hl.fromStore(it.startMeta, it.endMeta, it.text, it.id);
        applyColorToHighlight(hl, it.id, it.color || "yellow");
        var doms = hl.getDoms(it.id);
        if (!doms || !doms.length) {
          failed = true;
          return;
        }
        var actual = "";
        for (var i = 0; i < doms.length; i++) actual += doms[i].textContent || "";
        if (!textSimilarEnough(it.text, actual)) failed = true;
      } catch (e2) {
        failed = true;
      }
    });

    if (failed) {
      try {
        hl.removeAll();
      } catch (e3) {}
      persistItems(qid, field, currentVersion, []);
      showStaleNotice(root, field);
      return;
    }
    persistItems(qid, field, currentVersion, items);
  }

  function bindHighlighterEvents(hl, qid, field, currentVersion) {
    var Ctor = getHighlighterCtor();
    if (!Ctor) return;

    hl.on(Ctor.event.CREATE, function (data) {
      var list = (data && (data.sources || data.source)) || [];
      if (!Array.isArray(list)) list = [list];
      var colorId = getSelectedColor();
      var entry = loadEntry(qid, field) || { version: currentVersion, items: [] };
      var items = entry.items.slice();
      list.forEach(function (src) {
        if (!src || src.type === "from-store") return;
        if (src.id) applyColorToHighlight(hl, src.id, colorId);
        var it = sourceToItem(src, colorId);
        if (!it || !it.id) return;
        var exists = false;
        for (var i = 0; i < items.length; i++) {
          if (items[i].id === it.id) {
            items[i] = it;
            exists = true;
            break;
          }
        }
        if (!exists) items.push(it);
      });
      persistItems(qid, field, currentVersion, items);
    });

    hl.on(Ctor.event.REMOVE, function (data) {
      var ids = (data && data.ids) || [];
      if (!ids.length) return;
      var entry = loadEntry(qid, field);
      if (!entry) return;
      var idSet = {};
      ids.forEach(function (id) {
        idSet[id] = true;
      });
      var next = entry.items.filter(function (it) {
        return !idSet[it.id];
      });
      persistItems(qid, field, entry.version, next);
    });
  }

  function mountRegion(article, q, field, root) {
    var Ctor = getHighlighterCtor();
    if (!Ctor || !root || !q) {
      if (!Ctor) {
        console.warn(
          "[HanlawExplainHighlighter] web-highlighter를 불러오지 못했습니다. /js/vendor/web-highlighter.min.js 로드를 확인하세요."
        );
      }
      return;
    }

    var qid = normalizeId(q.id);
    if (!qid) return;

    if (!article._hanlawExplainHl) article._hanlawExplainHl = {};
    if (article._hanlawExplainHl[field]) disposeRegion(article._hanlawExplainHl[field]);

    root.classList.add("quiz-explain-hl-root");
    root.setAttribute("data-explain-hl-field", field);

    var versions = getVersions(q);
    var currentVersion = field === "basic" ? versions.basic : versions.detail;

    var hl;
    try {
      hl = new Ctor({
        $root: root,
        exceptSelectors: EXCEPT_SELECTORS,
        style: { className: "hanlaw-explain-highlight" }
      });
    } catch (err) {
      console.warn("[HanlawExplainHighlighter] 초기화 실패:", err);
      return;
    }

    bindHighlighterEvents(hl, qid, field, currentVersion);

    var entry = loadEntry(qid, field);
    var savedVersion = entry ? entry.version : currentVersion;
    var items = entry ? entry.items : [];
    restoreItems(hl, qid, field, savedVersion, currentVersion, items, root);

    var inst = {
      highlighter: hl,
      root: root,
      qid: qid,
      field: field
    };
    article._hanlawExplainHl[field] = inst;
    ensureInlineToolbar(root, field, inst);
  }

  function pickExplainRoots(article) {
    var post = article.querySelector(".note-card__feedback");
    if (!post) return { basic: null, detail: null };
    var basic = post.querySelector(".feedback__block-body.quiz-ai-answer");
    if (!basic) {
      var bodies = post.querySelectorAll(".feedback__block-body:not(.feedback-detail)");
      for (var i = 0; i < bodies.length; i++) {
        if (
          !bodies[i].querySelector(".feedback-detail__empty") &&
          !bodies[i].classList.contains("feedback-detail") &&
          !bodies[i].classList.contains("feedback__tags")
        ) {
          basic = bodies[i];
          break;
        }
      }
    }
    var detail = post.querySelector(".feedback-detail__rich-html");
    if (!detail) {
      var detWrap = post.querySelector(".feedback-detail.feedback__block-body");
      if (detWrap && detWrap.textContent.trim() && !detWrap.querySelector(".feedback-premium-lock")) {
        detail = detWrap;
      }
    }
    return { basic: basic, detail: detail };
  }

  function mountOnCard(article, q) {
    if (!article || article.getAttribute("data-answered") !== "1") return;
    var latest = findQuestionById(article.getAttribute("data-qid")) || q;
    if (!latest) return;

    disposeOnCard(article);

    var roots = pickExplainRoots(article);
    if (roots.basic && normalizeCompareText(roots.basic.textContent)) {
      mountRegion(article, latest, "basic", roots.basic);
    }
    if (roots.detail && normalizeCompareText(roots.detail.textContent)) {
      mountRegion(article, latest, "detail", roots.detail);
    }
  }

  function remountDetailOnCard(article, q) {
    if (!article._hanlawExplainHl) {
      mountOnCard(article, q);
      return;
    }
    if (article._hanlawExplainHl.detail) disposeRegion(article._hanlawExplainHl.detail);
    delete article._hanlawExplainHl.detail;
    var latest = findQuestionById(article.getAttribute("data-qid")) || q;
    var roots = pickExplainRoots(article);
    if (latest && roots.detail && normalizeCompareText(roots.detail.textContent)) {
      mountRegion(article, latest, "detail", roots.detail);
    }
  }

  function remountAllAnsweredCards() {
    document.querySelectorAll('[data-note-quiz][data-answered="1"]').forEach(function (article) {
      var q = findQuestionById(article.getAttribute("data-qid"));
      if (q) mountOnCard(article, q);
    });
  }

  function remountDetailOnAnsweredCards() {
    document.querySelectorAll('[data-note-quiz][data-answered="1"]').forEach(function (article) {
      var q = findQuestionById(article.getAttribute("data-qid"));
      if (q) remountDetailOnCard(article, q);
    });
  }

  window.addEventListener("hanlaw-detail-unlocked", remountDetailOnAnsweredCards);
  window.addEventListener("question-bank-updated", remountAllAnsweredCards);

  window.HanlawExplainHighlighter = {
    mountOnCard: mountOnCard,
    disposeOnCard: disposeOnCard,
    remountDetailOnCard: remountDetailOnCard,
    remountAllAnsweredCards: remountAllAnsweredCards,
    isAvailable: function () {
      return !!getHighlighterCtor();
    }
  };
})();
