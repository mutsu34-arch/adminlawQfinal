/**
 * 오답노트·찜노트 공통: 목록 노출 한도, 번호, O/X 후 정답·해설 표시
 */
(function () {
  var DISPLAY_FREE = 100;
  var DISPLAY_PAID = 1000;

  function normalizeId(id) {
    return String(id == null ? "" : id).trim();
  }

  function paidMember() {
    return typeof window.isPaidMember === "function" && window.isPaidMember();
  }

  function oxButtonIsTrue(btn) {
    if (!btn) return false;
    if (btn.getAttribute("data-answer") != null) {
      return btn.getAttribute("data-answer") === "true";
    }
    return false;
  }

  function clearOxReveal(container) {
    if (!container) return;
    container.classList.remove("q-actions--revealed");
    container.querySelectorAll(".btn--ox").forEach(function (b) {
      b.classList.remove("btn--ox-reveal-correct", "btn--ox-reveal-wrong", "btn--ox-reveal-dim");
    });
  }

  function applyOxReveal(container, userTrue, correctTrue) {
    if (!container) return;
    container.classList.add("q-actions--revealed");
    container.querySelectorAll(".btn--ox").forEach(function (b) {
      var isTrue = oxButtonIsTrue(b);
      b.classList.remove("btn--ox-reveal-correct", "btn--ox-reveal-wrong", "btn--ox-reveal-dim");
      var isCorrectBtn = isTrue === correctTrue;
      var isUserBtn = isTrue === userTrue;
      if (isCorrectBtn) b.classList.add("btn--ox-reveal-correct");
      else if (isUserBtn) b.classList.add("btn--ox-reveal-wrong");
      else b.classList.add("btn--ox-reveal-dim");
    });
  }

  function starsLine(n) {
    var max = 5;
    var v = typeof n === "number" && n >= 0 ? Math.min(max, Math.floor(n)) : 0;
    var s = "";
    for (var i = 0; i < max; i++) s += i < v ? "★" : "☆";
    return s;
  }

  function getBasicExplain(q) {
    if (!q) return "";
    if (q.explanationBasic != null && q.explanationBasic !== "") return q.explanationBasic;
    return q.explanation != null ? q.explanation : "";
  }

  function setImportanceLine(lineEl, q) {
    if (!lineEl) return;
    lineEl.textContent = "";
    lineEl.appendChild(document.createTextNode("중요도: "));
    var hasNum = typeof q.importance === "number" && q.importance >= 1 && q.importance <= 5;
    var stars = document.createElement("span");
    stars.className = "feedback__star-part";
    stars.textContent = hasNum ? starsLine(q.importance) : "—";
    lineEl.appendChild(stars);
    var noteRaw = q.importanceNote != null ? String(q.importanceNote).trim() : "";
    if (noteRaw) lineEl.appendChild(document.createTextNode(" (" + noteRaw + ")"));
  }

  function setDifficultyLine(lineEl, q) {
    if (!lineEl) return;
    lineEl.textContent = "";
    lineEl.appendChild(document.createTextNode("난이도: "));
    var stars = document.createElement("span");
    stars.className = "feedback__star-part";
    var hasNum = typeof q.difficulty === "number" && q.difficulty >= 1 && q.difficulty <= 5;
    stars.textContent = hasNum ? starsLine(q.difficulty) : "—";
    lineEl.appendChild(stars);
  }

  function formatOx(v) {
    return v ? "O" : "X";
  }

  function buildDetailBlocks(container, detail) {
    container.innerHTML = "";
    if (!detail) return;
    function stripHeadLabel(text, labels) {
      var t = String(text || "").trim();
      if (!t) return "";
      for (var i = 0; i < labels.length; i++) {
        var esc = labels[i].replace(/\s+/g, "\\s*");
        var re = new RegExp("^" + esc + "\\s*[:：-]?\\s*", "i");
        t = t.replace(re, "").trim();
      }
      return t;
    }
    function normalizeDetailBodyRaw(raw) {
      return String(raw || "").replace(/\r\n/g, "\n");
    }

    function normalizedText(raw) {
      return String(raw || "").replace(/\r\n/g, "\n").trim();
    }
    var merged = "";
    if (typeof detail === "string") {
      merged = normalizeDetailBodyRaw(detail);
    } else if (typeof detail === "object") {
      if (detail.body != null && String(detail.body).trim()) {
        merged = normalizeDetailBodyRaw(String(detail.body));
      } else {
        var parts = [];
        if (detail.legal != null && String(detail.legal).trim()) {
          parts.push(
            "법리 근거: " + stripHeadLabel(String(detail.legal), ["법리 근거", "법리"])
          );
        }
        if (detail.trap != null && String(detail.trap).trim()) {
          parts.push(
            "함정 포인트: " + stripHeadLabel(String(detail.trap), ["함정 포인트", "함정"])
          );
        }
        if (detail.precedent != null && String(detail.precedent).trim()) {
          parts.push("판례: " + stripHeadLabel(String(detail.precedent), ["판례 요지", "판례"]));
        }
        merged = normalizedText(parts.join("\n\n"));
      }
    }
    if (!merged) return;
    var root = document.createElement("div");
    root.className = "feedback-detail__rich-html";
    if (typeof window.formatHanlawAiAnswerHtml === "function") {
      root.innerHTML = window.formatHanlawAiAnswerHtml(merged);
    } else {
      root.textContent = merged;
    }
    container.appendChild(root);
  }

  function populateDetailContainer(container, q) {
    if (!container) return;
    container.innerHTML = "";
    var hasDetail =
      q.detail &&
      ((q.detail.body && String(q.detail.body).trim()) ||
        q.detail.legal ||
        q.detail.trap ||
        q.detail.precedent);
    if (!hasDetail) {
      var empty = document.createElement("p");
      empty.className = "feedback-detail__empty";
      empty.textContent = "등록된 상세 해설이 없습니다.";
      container.appendChild(empty);
      return;
    }
    if (
      typeof window.HanlawDetailUnlock === "object" &&
      typeof window.HanlawDetailUnlock.render === "function"
    ) {
      window.HanlawDetailUnlock.render(container, q, buildDetailBlocks);
    } else if (paidMember()) {
      buildDetailBlocks(container, q.detail);
    } else {
      var lockP = document.createElement("p");
      lockP.className = "feedback-premium-lock";
      lockP.textContent =
        "법리·함정·판례 등 상세 해설은 유료회원에게 제공됩니다. 요금제에서 구독 후 이용할 수 있습니다.";
      container.appendChild(lockP);
    }
  }

  function renderTags(container, tags) {
    container.innerHTML = "";
    if (!tags || !tags.length) return;
    for (var i = 0; i < tags.length; i++) {
      var label = String(tags[i] || "").trim();
      if (!label) continue;
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "feedback-tag feedback-tag--link";
      btn.setAttribute("data-tag", label);
      btn.setAttribute("aria-label", label + " 사전에서 보기");
      btn.textContent = "#" + label;
      container.appendChild(btn);
    }
  }

  function fillExplainParts(parts, q) {
    if (parts.answerKey) {
      parts.answerKey.textContent = "정답: " + formatOx(q.answer);
      parts.answerKey.hidden = false;
    }
    setImportanceLine(parts.importanceLine, q);
    setDifficultyLine(parts.difficultyLine, q);
    if (parts.explain) {
      var basic = getBasicExplain(q);
      var explainText = basic ? basic : "등록된 기본 해설이 없습니다.";
      parts.explain.classList.add("quiz-ai-answer");
      if (typeof window.formatHanlawAiAnswerHtml === "function") {
        parts.explain.innerHTML = window.formatHanlawAiAnswerHtml(explainText);
      } else {
        parts.explain.textContent = explainText;
      }
    }
    populateDetailContainer(parts.detail, q);
    if (parts.tags) {
      parts.tags.innerHTML = "";
      if (q.tags && q.tags.length) renderTags(parts.tags, q.tags);
      else {
        var dash = document.createElement("span");
        dash.className = "feedback__tag-empty";
        dash.textContent = "—";
        parts.tags.appendChild(dash);
      }
    }
  }

  function setOxDisabledIn(container, disabled) {
    if (!container) return;
    container.querySelectorAll(".btn--ox").forEach(function (b) {
      b.disabled = !!disabled;
    });
  }

  function formatSourceLine(q) {
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

  function noteKindLayout(kind) {
    if (kind === "wrong") {
      return { prefix: "wrong-note", rmClass: "wrong-note-remove", rmLabel: "오답노트에서 제거" };
    }
    if (kind === "master") {
      return { prefix: "master-note", rmClass: "master-note-remove", rmLabel: "마스터 해제" };
    }
    return { prefix: "fav-note", rmClass: "fav-note-remove", rmLabel: "찜 해제" };
  }

  /**
   * @param {object} q
   * @param {number} index1 1부터 매기는 목록 번호
   * @param {"wrong"|"fav"|"master"} kind
   */
  function buildCard(q, index1, kind) {
    var cfg = noteKindLayout(kind);
    var prefix = cfg.prefix;
    var rmClass = cfg.rmClass;
    var rmLabel = cfg.rmLabel;

    var article = document.createElement("article");
    article.className = prefix + "-card";
    article.setAttribute("data-note-quiz", "1");
    article.setAttribute("data-qid", normalizeId(q.id));
    article.setAttribute("data-answered", "0");

    var head = document.createElement("div");
    head.className = prefix + "-card__head " + prefix + "-card__head--indexed";

    var numEl = document.createElement("span");
    numEl.className = "note-card__index";
    numEl.setAttribute("aria-hidden", "true");
    numEl.textContent = String(index1);

    var meta = document.createElement("div");
    meta.className = prefix + "-card__meta";
    var title = document.createElement("h3");
    title.className = prefix + "-card__title";
    var src = formatSourceLine(q);
    title.textContent = (src ? src + " · " : "") + (q.topic || "주제 없음");
    meta.appendChild(title);
    head.appendChild(numEl);
    head.appendChild(meta);
    article.appendChild(head);

    var stmt = document.createElement("p");
    stmt.className = prefix + "-card__stmt";
    if (typeof window.formatHanlawRichParagraphsHtml === "function") {
      stmt.innerHTML = window.formatHanlawRichParagraphsHtml(q.statement || "");
    } else {
      stmt.textContent = q.statement || "";
    }
    article.appendChild(stmt);

    var actions = document.createElement("div");
    actions.className = "q-actions note-card__q-actions";
    var bO = document.createElement("button");
    bO.type = "button";
    bO.className = "btn btn--ox btn--o";
    bO.setAttribute("data-answer", "true");
    bO.setAttribute("aria-label", "참(O)");
    bO.textContent = "O";
    var bX = document.createElement("button");
    bX.type = "button";
    bX.className = "btn btn--ox btn--x";
    bX.setAttribute("data-answer", "false");
    bX.setAttribute("aria-label", "거짓(X)");
    bX.textContent = "X";
    actions.appendChild(bO);
    actions.appendChild(bX);
    article.appendChild(actions);

    var post = document.createElement("div");
    post.className = "note-card__feedback feedback";
    post.hidden = true;

    var res = document.createElement("p");
    res.className = "feedback__result";
    post.appendChild(res);

    var ak = document.createElement("p");
    ak.className = "feedback__kv";
    ak.hidden = true;
    post.appendChild(ak);

    var imp = document.createElement("p");
    imp.className = "feedback__kv feedback__kv--stars";
    post.appendChild(imp);

    var diff = document.createElement("p");
    diff.className = "feedback__kv feedback__kv--stars";
    post.appendChild(diff);

    var lblBasic = document.createElement("p");
    lblBasic.className = "feedback__block-label";
    lblBasic.textContent = "기본 해설";
    post.appendChild(lblBasic);

    // formatHanlawAiAnswerHtml 이 <p>/<div> 블록을 넣으므로 부모는 <p>가 되면 안 됨(중첩 무효로 해설이 안 보일 수 있음)
    var ex = document.createElement("div");
    ex.className = "feedback__block-body";
    post.appendChild(ex);

    var lblDet = document.createElement("p");
    lblDet.className = "feedback__block-label";
    lblDet.textContent = "상세 해설";
    post.appendChild(lblDet);

    var det = document.createElement("div");
    det.className = "feedback-detail feedback__block-body";
    post.appendChild(det);

    var lblTags = document.createElement("p");
    lblTags.className = "feedback__block-label";
    lblTags.textContent = "태그";
    post.appendChild(lblTags);

    var tags = document.createElement("div");
    tags.className = "feedback__tags feedback__block-body";
    post.appendChild(tags);

    if (window.HanlawNoteQuizChrome && typeof window.HanlawNoteQuizChrome.appendChromeAndMemo === "function") {
      window.HanlawNoteQuizChrome.appendChromeAndMemo(post);
    }

    post._hanlawParts = {
      result: res,
      answerKey: ak,
      importanceLine: imp,
      difficultyLine: diff,
      explain: ex,
      detail: det,
      tags: tags
    };

    article.appendChild(post);

    var actRow = document.createElement("div");
    actRow.className = prefix + "-card__actions";
    var rm = document.createElement("button");
    rm.type = "button";
    rm.className = "btn btn--small btn--outline " + rmClass;
    rm.setAttribute("data-qid", normalizeId(q.id));
    rm.textContent = rmLabel;
    actRow.appendChild(rm);
    article.appendChild(actRow);

    article._hanlawPost = post;
    article._hanlawActions = actions;
    article._hanlawCachedQ = q;
    return article;
  }

  function revealCardAnswer(article, q, userTrue) {
    var ok = userTrue === q.answer;
    var post = article._hanlawPost;
    var actions = article._hanlawActions;
    if (!post || !post._hanlawParts) return;

    var parts = post._hanlawParts;
    parts.result.textContent = ok ? "정답입니다." : "오답입니다.";
    parts.result.classList.remove("is-correct", "is-wrong");
    parts.result.classList.add(ok ? "is-correct" : "is-wrong");

    applyOxReveal(actions, userTrue, q.answer);
    try {
      fillExplainParts(
        {
          answerKey: parts.answerKey,
          importanceLine: parts.importanceLine,
          difficultyLine: parts.difficultyLine,
          explain: parts.explain,
          detail: parts.detail,
          tags: parts.tags
        },
        q
      );
    } catch (err) {
      if (parts.explain) {
        parts.explain.classList.add("quiz-ai-answer");
        parts.explain.textContent = getBasicExplain(q) || "해설을 표시하지 못했습니다.";
      }
    }

    if (window.HanlawNoteQuizChrome && typeof window.HanlawNoteQuizChrome.onCardRevealed === "function") {
      window.HanlawNoteQuizChrome.onCardRevealed(article, q, userTrue);
    }

    post.hidden = false;
    setOxDisabledIn(actions, true);
    article.setAttribute("data-answered", "1");
  }

  function getDisplayLimit() {
    return paidMember() ? DISPLAY_PAID : DISPLAY_FREE;
  }

  var SORT_STORAGE_VER = "v1";

  function normalizeSortMode(raw) {
    var s = String(raw == null ? "" : raw).trim();
    if (s === "timeAsc" || s === "timeDesc" || s === "importanceDesc" || s === "difficultyDesc") {
      return s;
    }
    return "timeDesc";
  }

  function sortModeBannerPhrase(mode) {
    var m = normalizeSortMode(mode);
    if (m === "timeAsc") return "오래된 순";
    if (m === "importanceDesc") return "중요도 높은 순";
    if (m === "difficultyDesc") return "난이도 높은 순";
    return "최신 순";
  }

  function importanceSortValue(q) {
    if (!q || typeof q.importance !== "number" || q.importance < 1) return 0;
    return Math.min(5, Math.floor(q.importance));
  }

  function difficultySortValue(q) {
    if (!q || typeof q.difficulty !== "number" || q.difficulty < 1) return 0;
    return Math.min(5, Math.floor(q.difficulty));
  }

  /**
   * 저장 순서(앞이 최신)인 ID 배열을 표시용으로 정렬합니다. findQuestion으로 은행 조회가 가능할 때만 중요도·난이도 정렬이 의미 있습니다.
   */
  function sortNoteIds(ids, mode, findQuestion) {
    var list = Array.isArray(ids) ? ids.slice() : [];
    var m = normalizeSortMode(mode);
    var fn = typeof findQuestion === "function" ? findQuestion : function () {
      return null;
    };
    if (m === "timeDesc") {
      return list;
    }
    if (m === "timeAsc") {
      return list.reverse();
    }
    var enriched = list.map(function (id, storageIdx) {
      return { id: id, storageIdx: storageIdx, q: fn(id) };
    });
    if (m === "importanceDesc") {
      enriched.sort(function (a, b) {
        var va = importanceSortValue(a.q);
        var vb = importanceSortValue(b.q);
        if (vb !== va) return vb - va;
        return a.storageIdx - b.storageIdx;
      });
    } else if (m === "difficultyDesc") {
      enriched.sort(function (a, b) {
        var va = difficultySortValue(a.q);
        var vb = difficultySortValue(b.q);
        if (vb !== va) return vb - va;
        return a.storageIdx - b.storageIdx;
      });
    }
    return enriched.map(function (x) {
      return x.id;
    });
  }

  function noteSortStorageKey(panelKey) {
    return "hanlaw_note_sort_" + String(panelKey || "note") + "_" + SORT_STORAGE_VER;
  }

  function getNoteSortMode(panelKey) {
    try {
      return normalizeSortMode(localStorage.getItem(noteSortStorageKey(panelKey)));
    } catch (e) {
      return "timeDesc";
    }
  }

  function setNoteSortMode(panelKey, raw) {
    var mode = normalizeSortMode(raw);
    try {
      localStorage.setItem(noteSortStorageKey(panelKey), mode);
    } catch (e) {}
    return mode;
  }

  function syncNoteSortBarUI(container, mode) {
    if (!container) return;
    var m = normalizeSortMode(mode);
    var buttons = container.querySelectorAll("[data-note-sort]");
    var i;
    for (i = 0; i < buttons.length; i++) {
      var b = buttons[i];
      var bm = normalizeSortMode(b.getAttribute("data-note-sort"));
      var active = bm === m;
      b.classList.toggle("btn--primary", active);
      b.classList.toggle("btn--outline", !active);
      b.setAttribute("aria-pressed", active ? "true" : "false");
    }
  }

  function getDisplaySlice(ids) {
    var lim = getDisplayLimit();
    var list = Array.isArray(ids) ? ids : [];
    var visible = list.slice(0, lim);
    return {
      visible: visible,
      total: list.length,
      limit: lim,
      hiddenCount: Math.max(0, list.length - lim)
    };
  }

  function updateLimitBanner(bannerEl, slice, sortMode) {
    if (!bannerEl) return;
    if (slice.hiddenCount <= 0) {
      bannerEl.hidden = true;
      bannerEl.textContent = "";
      return;
    }
    bannerEl.hidden = false;
    var phrase = sortModeBannerPhrase(sortMode);
    if (paidMember()) {
      bannerEl.textContent =
        "저장된 문항 " +
        slice.total +
        "개를 " +
        phrase +
        "으로 정렬할 때, 앞쪽 " +
        slice.limit +
        "개만 이 목록에 표시됩니다.";
    } else {
      bannerEl.textContent =
        "저장 " +
        slice.total +
        "개를 " +
        phrase +
        "으로 정렬할 때 앞쪽 " +
        slice.limit +
        "개만 표시됩니다. (유료 회원은 최대 " +
        DISPLAY_PAID +
        "개까지 열람 가능)";
    }
  }

  function attachListInteractions(listEl, opts) {
    var findQ = opts.findQuestion;
    var onRemove = opts.onRemove;
    var removeSelector = opts.removeSelector;

    listEl.addEventListener("click", function (e) {
      var rm = e.target.closest(removeSelector);
      if (rm) {
        var rid = rm.getAttribute("data-qid");
        if (rid && typeof onRemove === "function") onRemove(rid);
        return;
      }

      var ox = e.target.closest(".btn--ox");
      if (!ox) return;
      var card = ox.closest("[data-note-quiz]");
      if (!card || card.getAttribute("data-answered") === "1") return;

      var qid = normalizeId(card.getAttribute("data-qid"));
      var q = typeof findQ === "function" ? findQ(qid) : null;
      if (!q) return;

      var userTrue = oxButtonIsTrue(ox);
      revealCardAnswer(card, q, userTrue);
      var ok = userTrue === q.answer;
      if (typeof opts.onAnswered === "function") {
        try {
          opts.onAnswered(q, userTrue, ok);
        } catch (err) {}
      }
    });
  }

  function refreshMemosOnAnsweredNoteCards() {
    if (window.HanlawNoteQuizChrome && typeof window.HanlawNoteQuizChrome.refreshMemosOnAnsweredCards === "function") {
      try {
        window.HanlawNoteQuizChrome.refreshMemosOnAnsweredCards();
      } catch (e) {}
    }
  }

  window.addEventListener("quiz-question-memo-updated", refreshMemosOnAnsweredNoteCards);

  function refreshAnsweredNoteCardsDetail() {
    document.querySelectorAll('[data-note-quiz][data-answered="1"]').forEach(function (article) {
      var post = article._hanlawPost;
      var q = article._hanlawCachedQ;
      if (!post || !post._hanlawParts || !q) return;
      var parts = post._hanlawParts;
      try {
        fillExplainParts(
          {
            answerKey: parts.answerKey,
            importanceLine: parts.importanceLine,
            difficultyLine: parts.difficultyLine,
            explain: parts.explain,
            detail: parts.detail,
            tags: parts.tags
          },
          q
        );
      } catch (err) {}
    });
  }
  window.addEventListener("hanlaw-detail-unlocked", refreshAnsweredNoteCardsDetail);
  window.addEventListener("membership-updated", refreshAnsweredNoteCardsDetail);

  window.HanlawNoteQuizUi = {
    DISPLAY_FREE: DISPLAY_FREE,
    DISPLAY_PAID: DISPLAY_PAID,
    getDisplayLimit: getDisplayLimit,
    getDisplaySlice: getDisplaySlice,
    updateLimitBanner: updateLimitBanner,
    normalizeSortMode: normalizeSortMode,
    sortNoteIds: sortNoteIds,
    getNoteSortMode: getNoteSortMode,
    setNoteSortMode: setNoteSortMode,
    syncNoteSortBarUI: syncNoteSortBarUI,
    buildCard: buildCard,
    attachListInteractions: attachListInteractions,
    normalizeId: normalizeId,
    formatQuizSourceLine: formatSourceLine
  };
})();
