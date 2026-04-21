(function () {
  /** 한글 가나다·영문 혼합 일관 정렬 (localeCompare("ko")만으로는 환경별 차이가 날 수 있음) */
  var KO_TERM_COLLATOR =
    typeof Intl !== "undefined" && typeof Intl.Collator === "function"
      ? new Intl.Collator("ko-KR", { sensitivity: "variant", numeric: true })
      : null;

  function compareTermText(a, b) {
    var sa = String(a || "");
    var sb = String(b || "");
    if (KO_TERM_COLLATOR) return KO_TERM_COLLATOR.compare(sa, sb);
    return sa.localeCompare(sb, "ko-KR");
  }

  function getTerms() {
    var a = window.LEGAL_TERMS_DATA || [];
    var b = window.LEGAL_TERMS_REMOTE || [];
    return a.concat(b);
  }

  function getCases() {
    var a = window.LEGAL_CASES_DATA || [];
    var b = window.LEGAL_CASES_REMOTE || [];
    return dedupeCasesByCitationPreferRemote(a.concat(b));
  }

  function norm(s) {
    return String(s)
      .trim()
      .replace(/[\s.\-·]/g, "")
      .toLowerCase();
  }

  /**
   * 정적 JS와 Firestore에 같은 citation이 있으면 검색·표시가 이중으로 나온다.
   * Firestore 쪽(_docId 있음)을 우선한다.
   */
  function dedupeCasesByCitationPreferRemote(cases) {
    var byKey = {};
    for (var i = 0; i < cases.length; i++) {
      var c = cases[i];
      if (!c) continue;
      var k = norm(String(c.citation || ""));
      if (!k) continue;
      var existing = byKey[k];
      if (!existing) {
        byKey[k] = c;
        continue;
      }
      if (c._docId && !existing._docId) {
        byKey[k] = c;
      } else if (!c._docId && existing._docId) {
        /* keep existing */
      } else {
        byKey[k] = c;
      }
    }
    return Object.keys(byKey).map(function (key) {
      return byKey[key];
    });
  }

  function searchTerms(query) {
    var q = String(query).trim();
    if (!q) return [];
    var list = getTerms();
    var nq = norm(q);
    var scored = [];

    for (var i = 0; i < list.length; i++) {
      var t = list[i];
      var term = t.term || "";
      var aliases = t.aliases || [];
      var score = 0;
      if (norm(term) === nq) score = 100;
      else if (norm(term).indexOf(nq) === 0) score = 80;
      else if (norm(term).indexOf(nq) >= 0) score = 60;
      else {
        for (var j = 0; j < aliases.length; j++) {
          var a = aliases[j];
          if (norm(a) === nq) {
            score = 75;
            break;
          }
          if (norm(a).indexOf(nq) === 0) {
            score = Math.max(score, 55);
          } else if (norm(a).indexOf(nq) >= 0) {
            score = Math.max(score, 40);
          }
        }
      }
      if (term.indexOf(q) >= 0 || q.indexOf(term) >= 0) {
        score = Math.max(score, 50);
      }
      if (score > 0) {
        scored.push({ item: t, score: score });
      }
    }

    scored.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return compareTermText(a.item.term, b.item.term);
    });
    return scored.map(function (x) {
      return x.item;
    });
  }

  function getStatuteEntries() {
    var raw = window.STATUTE_ARTICLE_STATIC || {};
    var remoteByKey = {};
    var remoteByDocId = {};
    var rem = window.LEGAL_STATUTES_REMOTE || [];
    for (var ri = 0; ri < rem.length; ri++) {
      var rr = rem[ri];
      if (!rr) continue;
      if (rr.key) remoteByKey[rr.key] = rr;
      if (rr._docId) remoteByDocId[rr._docId] = rr;
    }
    var out = [];
    Object.keys(raw).forEach(function (key) {
      var block = raw[key];
      if (!block || typeof block !== "object") return;
      var parts = String(key).split("|");
      var law = parts[0] || "";
      var art = parts[1] || "";
      var sub = parts[2] || "";
      var heading = block.heading || "";
      var body = block.body || "";
      var sourceNote = block.sourceNote || "";
      var ro = remoteByKey[key];
      if (
        !ro &&
        typeof window.normalizeHanlawStatuteDocId === "function" &&
        remoteByDocId[window.normalizeHanlawStatuteDocId(key)]
      ) {
        ro = remoteByDocId[window.normalizeHanlawStatuteDocId(key)];
      }
      if (!ro && typeof window.normalizeHanlawStatuteDocId === "function") {
        var nk0 = window.normalizeHanlawStatuteDocId(key);
        var rj;
        for (rj = 0; rj < rem.length; rj++) {
          var rx = rem[rj];
          if (!rx) continue;
          if (nk0 && String(rx._docId || "") === nk0) {
            ro = rx;
            break;
          }
          if (nk0 && rx.key && window.normalizeHanlawStatuteDocId(String(rx.key)) === nk0) {
            ro = rx;
            break;
          }
        }
      }
      var docId = null;
      var oxQuizzes = [];
      if (ro) {
        if (ro.heading !== undefined && ro.heading !== null) heading = ro.heading;
        if (ro.body !== undefined && ro.body !== null) body = ro.body;
        if (ro.sourceNote !== undefined && ro.sourceNote !== null) sourceNote = ro.sourceNote;
        docId = ro._docId || null;
        if (Array.isArray(ro.oxQuizzes) && ro.oxQuizzes.length) oxQuizzes = ro.oxQuizzes;
      }
      out.push({
        key: key,
        lawName: law,
        articleNo: art,
        articleSub: sub,
        heading: heading,
        body: body,
        sourceNote: sourceNote,
        oxQuizzes: oxQuizzes,
        _docId: docId
      });
    });
    out.sort(function (a, b) {
      var sa = (a.lawName || "") + "|" + (a.articleNo || "") + "|" + (a.articleSub || "");
      var sb = (b.lawName || "") + "|" + (b.articleNo || "") + "|" + (b.articleSub || "");
      return sa.localeCompare(sb, "ko-KR");
    });
    return out;
  }

  function statuteDisplayTitle(s) {
    if (!s) return "";
    var h = String(s.heading || "").trim();
    var law = String(s.lawName || "").trim();
    if (law && h) return law + " " + h;
    return h || law || s.key || "";
  }

  function searchStatutes(query) {
    var q = String(query).trim();
    if (!q) return [];
    var nq = norm(q);
    if (!nq) return [];
    var list = getStatuteEntries();
    var scored = [];
    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      var score = 0;
      var keyN = norm(s.key || "");
      var headN = norm(s.heading || "");
      var lawN = norm(s.lawName || "");
      var bodyN = norm(s.body || "");
      if (keyN.indexOf(nq) >= 0) score = Math.max(score, 96);
      if (lawN && (lawN === nq || lawN.indexOf(nq) === 0)) score = Math.max(score, 92);
      if (headN.indexOf(nq) >= 0) score = Math.max(score, 88);
      if (bodyN.indexOf(nq) >= 0) score = Math.max(score, 72);
      if (nq.length >= 2) {
        var blob = lawN + headN + bodyN;
        if (blob.indexOf(nq) >= 0) score = Math.max(score, 58);
      }
      if (score > 0) scored.push({ item: s, score: score });
    }
    scored.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return statuteDisplayTitle(a.item).localeCompare(statuteDisplayTitle(b.item), "ko-KR");
    });
    return scored.map(function (x) {
      return x.item;
    });
  }

  function browseStatutesSorted() {
    return getStatuteEntries();
  }

  function renderStatuteArticleIndex(container, items) {
    container.innerHTML = "";
    var wrap = document.createElement("section");
    wrap.className = "dict-term-index dict-statute-index dict-term-index--compact";
    var h = document.createElement("h3");
    h.className = "dict-term-index__title";
    h.textContent = "수록 조문 목록 (법령·조번 순)";
    wrap.appendChild(h);

    if (!items.length) {
      var p = document.createElement("p");
      p.className = "dict-empty";
      p.textContent =
        "아직 수록된 조문이 없습니다. js/statute-articles-static.js 에 조문을 추가할 수 있습니다.";
      wrap.appendChild(p);
      container.appendChild(wrap);
      return;
    }

    var guest = isGuestViewer();
    var cap = guest ? Math.min(items.length, dictGuestLimit()) : items.length;
    var list = document.createElement("div");
    list.className = "dict-term-index__list";
    for (var i = 0; i < cap; i++) {
      var s = items[i];
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn--small btn--outline dict-term-index__item";
      btn.setAttribute("data-statute-key", s.key);
      btn.textContent = statuteDisplayTitle(s);
      list.appendChild(btn);
    }
    wrap.appendChild(list);
    if (guest && items.length > cap) {
      var lock = document.createElement("p");
      lock.className = "dict-empty";
      lock.textContent = "비회원은 조문사전을 5개까지 열람할 수 있습니다. 전체 열람은 회원가입 후 이용해 주세요.";
      wrap.appendChild(lock);
    }
    container.appendChild(wrap);
  }

  function renderStatuteResults(container, items, opts) {
    opts = opts || {};
    container.innerHTML = "";
    if (!items.length) {
      var p = document.createElement("p");
      p.className = "dict-empty";
      p.textContent =
        "일치하는 조문이 없습니다. 법령명·조문번호·본문 키워드로 다시 검색하거나, js/statute-articles-static.js 에 조문을 추가하세요.";
      container.appendChild(p);
      return;
    }
    var guest = isGuestViewer();
    var cap = guest ? Math.min(items.length, dictGuestLimit()) : items.length;
    for (var i = 0; i < cap; i++) {
      var s = items[i];
      var article = document.createElement("article");
      article.className = "dict-result-card dict-result-card--statute";
      article.setAttribute("data-statute-key", s.key);
      var h = document.createElement("h3");
      h.className = "dict-result-card__title";
      var titleStr = statuteDisplayTitle(s);
      if (typeof window.formatHanlawRichParagraphsHtml === "function") {
        h.innerHTML = window.formatHanlawRichParagraphsHtml(titleStr);
      } else {
        h.textContent = titleStr;
      }
      article.appendChild(h);
      var body = document.createElement("div");
      body.className = "dict-result-card__body quiz-ai-answer";
      if (typeof window.formatHanlawAiAnswerHtml === "function") {
        body.innerHTML = window.formatHanlawAiAnswerHtml(s.body || "");
      } else {
        body.textContent = s.body || "";
      }
      article.appendChild(body);
      appendDictionaryOxQuizSection(article, s.oxQuizzes, "조문 OX 퀴즈", 3);
      if (s.sourceNote) {
        var foot = document.createElement("p");
        foot.className = "dict-result-card__foot";
        if (typeof window.formatHanlawRichParagraphsHtml === "function") {
          foot.innerHTML = window.formatHanlawRichParagraphsHtml(s.sourceNote);
        } else {
          foot.textContent = s.sourceNote;
        }
        article.appendChild(foot);
      }
      if (isAdminUser()) {
        var btnStEdit = document.createElement("button");
        btnStEdit.type = "button";
        btnStEdit.className = "btn btn--small btn--outline";
        btnStEdit.textContent = "수정";
        btnStEdit.setAttribute("data-admin-edit-statute", "1");
        btnStEdit._statute = s;
        article.appendChild(btnStEdit);
      }
      if (window.DictFavorites && !opts.skipFavButton) {
        var stTitle0 = statuteDisplayTitle(s);
        var subSt = "";
        if (s.sourceNote) {
          var dsn = document.createElement("div");
          dsn.innerHTML = String(s.sourceNote);
          subSt = (dsn.textContent || "").replace(/\s+/g, " ").trim().slice(0, 300);
        }
        appendDictFavoriteControl(article, "statute", {
          id: window.DictFavorites.makeId("statute", s.key),
          title: stTitle0,
          sub: subSt,
          searchText: String(s.key || "").trim()
        });
      }
      if (!opts.skipNavBack) appendDictNavBack(article, "statute");
      container.appendChild(article);
    }
    if (guest && items.length > cap) appendDictGuestLockNotice(container, "statute");
  }

  function runStatuteSearch() {
    var input = $("statute-article-query");
    var out = $("statute-search-results");
    if (!input || !out) return;
    var q = String(input.value || "").trim();
    if (!q) {
      var list0 = browseStatutesSorted();
      renderStatuteArticleIndex(out, list0);
      setDictGuestHint("statute", Math.min(list0.length, dictGuestLimit()), list0.length);
      emitDictResultsUpdated("statute");
      return;
    }
    var list = searchStatutes(q);
    renderStatuteResults(out, list);
    setDictGuestHint("statute", Math.min(list.length, dictGuestLimit()), list.length);
    emitDictResultsUpdated("statute");
  }

  function generatedTermsSorted() {
    var remote = window.LEGAL_TERMS_REMOTE || [];
    var out = [];
    var seen = {};
    for (var i = 0; i < remote.length; i++) {
      var t = remote[i];
      if (!t || !t.term) continue;
      var key = norm(t.term);
      if (!key || seen[key]) continue;
      seen[key] = true;
      out.push(t);
    }
    out.sort(function (a, b) {
      return compareTermText(a.term, b.term);
    });
    return out;
  }

  function caseCreatedMs(c) {
    if (!c) return 0;
    var t = c.createdAt;
    if (t && typeof t.toMillis === "function") return t.toMillis();
    t = c.updatedAt;
    if (t && typeof t.toMillis === "function") return t.toMillis();
    return 0;
  }

  function generatedCasesSorted() {
    var remote = window.LEGAL_CASES_REMOTE || [];
    var out = [];
    var seen = {};
    for (var i = 0; i < remote.length; i++) {
      var c = remote[i];
      if (!c || !String(c.citation || "").trim()) continue;
      var key = norm(c.citation);
      if (!key || seen[key]) continue;
      seen[key] = true;
      out.push(c);
    }
    out.sort(function (a, b) {
      return caseCreatedMs(b) - caseCreatedMs(a);
    });
    return out;
  }

  /**
   * 조회에 쓰이는 판례 풀(getCases)과 동일하게, 빈 검색 시 목록에는
   * Firestore 저장분(최신순) + 앱에 포함된 기본 데이터(중복 제외·파일 순)를 함께 노출한다.
   * (검색만 되고 목록은 비는 혼동 방지)
   */
  function browseCasesSorted() {
    var remote = generatedCasesSorted();
    var remoteKey = {};
    for (var r = 0; r < remote.length; r++) {
      var k = norm(remote[r].citation || "");
      if (k) remoteKey[k] = true;
    }
    var bundled = window.LEGAL_CASES_DATA || [];
    var extra = [];
    for (var i = 0; i < bundled.length; i++) {
      var c = bundled[i];
      if (!c || !String(c.citation || "").trim()) continue;
      var nk = norm(c.citation);
      if (!nk || remoteKey[nk]) continue;
      extra.push(c);
    }
    return remote.concat(extra);
  }

  function renderGeneratedTermIndex(container, terms) {
    container.innerHTML = "";
    var wrap = document.createElement("section");
    wrap.className = "dict-term-index dict-term-index--compact";
    var h = document.createElement("h3");
    h.className = "dict-term-index__title";
    h.textContent = "생성된 용어 목록 (가나다순)";
    wrap.appendChild(h);

    if (!terms.length) {
      var p = document.createElement("p");
      p.className = "dict-empty";
      p.textContent = "아직 생성된 용어가 없습니다.";
      wrap.appendChild(p);
      container.appendChild(wrap);
      return;
    }

    var guest = isGuestViewer();
    var cap = guest ? Math.min(terms.length, dictGuestLimit()) : terms.length;
    var list = document.createElement("div");
    list.className = "dict-term-index__list";
    for (var i = 0; i < cap; i++) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn--small btn--outline dict-term-index__item";
      btn.setAttribute("data-term", terms[i].term);
      btn.textContent = terms[i].term;
      list.appendChild(btn);
    }
    wrap.appendChild(list);
    if (guest && terms.length > cap) {
      var lock = document.createElement("p");
      lock.className = "dict-empty";
      lock.textContent = "비회원은 용어사전을 5개까지 열람할 수 있습니다. 전체 열람은 회원가입 후 이용해 주세요.";
      wrap.appendChild(lock);
    }
    container.appendChild(wrap);
  }

  function renderGeneratedCaseIndex(container, cases) {
    container.innerHTML = "";
    var wrap = document.createElement("section");
    wrap.className = "dict-term-index dict-case-index dict-term-index--compact";
    var h = document.createElement("h3");
    h.className = "dict-term-index__title";
    h.textContent = "등록된 판례 목록 (저장분 최신순·앱 기본 포함)";
    wrap.appendChild(h);

    if (!cases.length) {
      var p = document.createElement("p");
      p.className = "dict-empty";
      p.textContent = "표시할 판례가 없습니다.";
      wrap.appendChild(p);
      container.appendChild(wrap);
      return;
    }

    var list = document.createElement("div");
    list.className = "dict-term-index__list";
    var guest = isGuestViewer();
    var cap = guest ? Math.min(cases.length, dictGuestLimit()) : cases.length;
    for (var i = 0; i < cap; i++) {
      var c = cases[i];
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn--small btn--outline dict-term-index__item";
      var label = String(c.citation || "").trim() || String(c.title || "").trim() || "판례";
      btn.textContent = label;
      btn.dataset.caseCitation = String(c.citation || "").trim();
      list.appendChild(btn);
    }
    wrap.appendChild(list);
    if (guest && cases.length > cap) {
      var lock = document.createElement("p");
      lock.className = "dict-empty";
      lock.textContent = "비회원은 판례사전을 5개까지 열람할 수 있습니다. 전체 열람은 회원가입 후 이용해 주세요.";
      wrap.appendChild(lock);
    }
    container.appendChild(wrap);
  }

  function searchCases(query) {
    var q = String(query).trim();
    if (!q) return [];
    var nq = norm(q);
    if (!nq) return [];
    var list = getCases();
    var scored = [];

    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      var score = 0;

      var keys = c.searchKeys || [];
      for (var j = 0; j < keys.length; j++) {
        var nk = norm(keys[j]);
        if (nk === nq) {
          score = Math.max(score, 100);
          break;
        }
        if (nq.length >= 6 && nk.length >= 6 && (nk.indexOf(nq) >= 0 || nq.indexOf(nk) >= 0)) {
          score = Math.max(score, 88);
        }
      }
      if (c.citation && norm(c.citation).indexOf(nq) >= 0) {
        score = Math.max(score, 95);
      }

      var tks = c.topicKeywords || c.keywords || [];
      for (var k = 0; k < tks.length; k++) {
        var tk = norm(String(tks[k] || ""));
        if (!tk) continue;
        if (tk === nq) score = Math.max(score, 92);
        else if (tk.indexOf(nq) >= 0 || nq.indexOf(tk) >= 0) {
          score = Math.max(score, 82);
        }
      }

      if (nq.length >= 2) {
        var titleN = norm(c.title || "");
        var factsN = norm(c.facts || "");
        var issuesN = norm(c.issues || "");
        var judgmentN = norm(c.judgment || "");
        var blob = titleN + factsN + issuesN + judgmentN;
        if (blob.indexOf(nq) >= 0) {
          if (titleN.indexOf(nq) >= 0) score = Math.max(score, 78);
          else if (issuesN.indexOf(nq) >= 0) score = Math.max(score, 58);
          else if (judgmentN.indexOf(nq) >= 0) score = Math.max(score, 52);
          else if (factsN.indexOf(nq) >= 0) score = Math.max(score, 48);
          else score = Math.max(score, 42);
        }
      }

      if (score > 0) scored.push({ item: c, score: score });
    }

    scored.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return (a.item.citation || "").localeCompare(b.item.citation || "", "ko");
    });
    return scored.map(function (x) {
      return x.item;
    });
  }

  function $(id) {
    return document.getElementById(id);
  }

  /** Text 노드 클릭 시 Element.closest 미지원 방지 */
  function eventTargetElement(e) {
    var t = e && e.target;
    if (!t) return null;
    if (t.nodeType === 1) return t;
    return t.parentElement || null;
  }

  function emitDictResultsUpdated(kind) {
    try {
      window.dispatchEvent(new CustomEvent("dict-panel-results-updated", { detail: { kind: kind } }));
    } catch (e) {}
  }

  function isGuestViewer() {
    var u = typeof window.getHanlawUser === "function" ? window.getHanlawUser() : null;
    return !(u && u.email);
  }

  function dictGuestLimit() {
    return 5;
  }

  function setDictGuestHint(kind, shownCount, totalCount) {
    var id = kind === "term" ? "dict-term-guest-hint" : kind === "statute" ? "dict-statute-guest-hint" : "dict-case-guest-hint";
    var el = $(id);
    if (!el) return;
    if (!isGuestViewer()) {
      el.hidden = true;
      el.textContent = "";
      return;
    }
    var label = kind === "term" ? "용어사전" : kind === "statute" ? "조문사전" : "판례사전";
    var shown = Math.max(0, parseInt(shownCount, 10) || 0);
    var total = Math.max(shown, parseInt(totalCount, 10) || shown);
    el.hidden = false;
    if (total > dictGuestLimit()) {
      el.textContent =
        "[무료 체험 중] 비회원은 " + label + "을 최대 5개까지 볼 수 있습니다. 현재 " + shown + "개만 표시됩니다.";
    } else {
      el.textContent =
        "[무료 체험 중] 비회원은 " + label + "을 최대 5개까지 볼 수 있습니다. 현재 " + shown + "개 공개 중입니다.";
    }
  }

  function appendDictGuestLockNotice(container, kind) {
    if (!container) return;
    var p = document.createElement("p");
    p.className = "dict-empty";
    var label = kind === "term" ? "용어사전" : kind === "statute" ? "조문사전" : "판례사전";
    p.textContent =
      "비회원은 " + label + " 콘텐츠를 5개까지 열람할 수 있습니다. 전체 열람은 회원가입 후 이용해 주세요.";
    container.appendChild(p);
  }

  function isAdminUser() {
    var user = typeof window.getHanlawUser === "function" ? window.getHanlawUser() : null;
    if (!user || !user.email) return false;
    var emails = window.ADMIN_EMAILS || [];
    var mail = String(user.email).toLowerCase();
    for (var i = 0; i < emails.length; i++) {
      if (String(emails[i]).toLowerCase() === mail) return true;
    }
    return false;
  }

  function parseCsv(v) {
    return String(v || "")
      .split(",")
      .map(function (x) {
        return String(x || "").trim();
      })
      .filter(Boolean);
  }

  var dictTermEditSaving = false;

  function setDictTermEditMsg(text, isError) {
    var el = $("dict-term-edit-msg");
    if (!el) return;
    if (!text) {
      el.textContent = "";
      el.hidden = true;
      el.classList.remove("admin-msg--error");
      return;
    }
    el.textContent = text;
    el.hidden = false;
    el.classList.toggle("admin-msg--error", !!isError);
  }

  function closeDictTermEditModal() {
    var m = $("dict-term-edit-modal");
    if (!m) return;
    m.hidden = true;
    m.setAttribute("aria-hidden", "true");
    delete m.dataset.docId;
    setDictTermEditMsg("", false);
  }

  function openDictTermEditModal(term) {
    var m = $("dict-term-edit-modal");
    if (!m || !term) return;
    var termIn = $("dict-term-edit-term");
    var aliasesIn = $("dict-term-edit-aliases");
    var defIn = $("dict-term-edit-definition");
    if (termIn) termIn.value = term.term || "";
    if (aliasesIn) {
      aliasesIn.value = Array.isArray(term.aliases) ? term.aliases.join(", ") : "";
    }
    if (defIn) defIn.value = term.definition || "";
    if (window.CaseOxForm && typeof window.CaseOxForm.ensureBuilt === "function") {
      window.CaseOxForm.ensureBuilt("dict-term-edit-ox-editor");
      window.CaseOxForm.fill("dict-term-edit-ox-editor", Array.isArray(term.oxQuizzes) ? term.oxQuizzes : []);
    }
    m.dataset.docId = term._docId ? String(term._docId) : "";
    setDictTermEditMsg("", false);
    m.hidden = false;
    m.setAttribute("aria-hidden", "false");
    if (termIn) {
      termIn.focus();
      termIn.select();
    }
  }

  var dictCaseEditSaving = false;

  function setDictCaseEditMsg(text, isError) {
    var el = $("dict-case-edit-msg");
    if (!el) return;
    if (!text) {
      el.textContent = "";
      el.hidden = true;
      el.classList.remove("admin-msg--error");
      return;
    }
    el.textContent = text;
    el.hidden = false;
    el.classList.toggle("admin-msg--error", !!isError);
  }

  function closeDictCaseEditModal() {
    var m = $("dict-case-edit-modal");
    if (!m) return;
    m.hidden = true;
    m.setAttribute("aria-hidden", "true");
    delete m.dataset.docId;
    setDictCaseEditMsg("", false);
  }

  function openDictCaseEditModal(c) {
    var m = $("dict-case-edit-modal");
    if (!m || !c) return;
    var setVal = function (id, v) {
      var el = $(id);
      if (el) el.value = v != null ? String(v) : "";
    };
    setVal("dict-case-edit-citation", c.citation || "");
    setVal("dict-case-edit-title", c.title || "");
    setVal("dict-case-edit-facts", c.facts || "");
    setVal("dict-case-edit-issues", c.issues || "");
    setVal("dict-case-edit-judgment", c.judgment || "");
    setVal("dict-case-edit-full-text", c.caseFullText || "");
    setVal(
      "dict-case-edit-search-keys",
      Array.isArray(c.searchKeys) ? c.searchKeys.join(", ") : ""
    );
    setVal(
      "dict-case-edit-topic-keywords",
      Array.isArray(c.topicKeywords) ? c.topicKeywords.join(", ") : ""
    );
    setVal("dict-case-edit-casenote-url", c.casenoteUrl || "");
    setVal("dict-case-edit-jis-srno", c.jisCntntsSrno || "");
    setVal("dict-case-edit-scourt-url", c.scourtPortalUrl || "");
    m._oxQuizzes = Array.isArray(c.oxQuizzes) ? c.oxQuizzes.slice(0, 5) : [];
    m.dataset.docId = c._docId ? String(c._docId) : "";
    setDictCaseEditMsg("", false);
    m.hidden = false;
    m.setAttribute("aria-hidden", "false");
    var cit = $("dict-case-edit-citation");
    if (cit) {
      cit.focus();
      cit.select();
    }
  }

  function bindDictCaseEditModal() {
    var dem = $("dict-case-edit-modal");
    if (dem) {
      dem.addEventListener("click", function (e) {
        if (e.target === dem) closeDictCaseEditModal();
      });
    }
    var dec = $("dict-case-edit-close");
    var dex = $("dict-case-edit-cancel");
    var aiFill = $("dict-case-edit-ai-fill");
    if (dec) dec.addEventListener("click", closeDictCaseEditModal);
    if (dex) dex.addEventListener("click", closeDictCaseEditModal);
    if (aiFill) {
      aiFill.addEventListener("click", function () {
        var citation = String(($("dict-case-edit-citation") && $("dict-case-edit-citation").value) || "").trim();
        var caseFullText = String(($("dict-case-edit-full-text") && $("dict-case-edit-full-text").value) || "").trim();
        if (!citation) {
          setDictCaseEditMsg("사건 표기(citation)를 먼저 입력해 주세요.", true);
          return;
        }
        if (!caseFullText) {
          setDictCaseEditMsg("판결문 전문을 입력한 뒤 AI 요약을 실행해 주세요.", true);
          return;
        }
        if (typeof firebase === "undefined" || !firebase.apps || !firebase.apps.length || !firebase.functions) {
          setDictCaseEditMsg("Firebase Functions를 사용할 수 없습니다.", true);
          return;
        }
        var region = window.FIREBASE_FUNCTIONS_REGION || "asia-northeast3";
        var fn = firebase.app().functions(region).httpsCallable("generateOrGetDictionaryEntry");
        aiFill.disabled = true;
        setDictCaseEditMsg("AI가 판결문 전문을 분석해 요약 중입니다...", false);
        fn({ tag: citation, caseFullText: caseFullText })
          .then(function (res) {
            var d = res && res.data;
            if (!d || !d.ok || d.kind !== "case" || !d.record) {
              throw new Error("AI 요약 결과를 가져오지 못했습니다.");
            }
            var rec = d.record || {};
            var setVal = function (id, v) {
              var el = $(id);
              if (el) el.value = v != null ? String(v) : "";
            };
            setVal("dict-case-edit-title", rec.title || "");
            setVal("dict-case-edit-facts", rec.facts || "");
            setVal("dict-case-edit-issues", rec.issues || "");
            setVal("dict-case-edit-judgment", rec.judgment || "");
            setVal(
              "dict-case-edit-search-keys",
              Array.isArray(rec.searchKeys) ? rec.searchKeys.join(", ") : ""
            );
            var modal = $("dict-case-edit-modal");
            if (modal) {
              modal._oxQuizzes = Array.isArray(rec.oxQuizzes) ? rec.oxQuizzes.slice(0, 5) : [];
            }
            if (rec.citation) setVal("dict-case-edit-citation", rec.citation);
            setDictCaseEditMsg("AI 요약을 채웠습니다. 저장 버튼으로 확정하세요.", false);
          })
          .catch(function (err) {
            setDictCaseEditMsg((err && err.message) || "AI 요약 생성에 실패했습니다.", true);
          })
          .then(function () {
            aiFill.disabled = false;
          });
      });
    }
    var form = $("dict-case-edit-form");
    if (form) {
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        if (dictCaseEditSaving) return;
        if (typeof window.saveCaseEntryToFirestore !== "function") {
          setDictCaseEditMsg("저장 함수를 찾지 못했습니다.", true);
          return;
        }
        var modal = $("dict-case-edit-modal");
        var docId = modal && modal.dataset ? modal.dataset.docId : "";
        var oxQuizzes = modal && Array.isArray(modal._oxQuizzes) ? modal._oxQuizzes.slice(0, 5) : [];
        var citation = String(($("dict-case-edit-citation") && $("dict-case-edit-citation").value) || "").trim();
        if (!citation) {
          setDictCaseEditMsg("사건 표기(citation)를 입력해 주세요.", true);
          return;
        }
        var btnSave = $("dict-case-edit-save");
        dictCaseEditSaving = true;
        if (btnSave) btnSave.disabled = true;
        setDictCaseEditMsg("", false);
        window
          .saveCaseEntryToFirestore(
            {
              citation: citation,
              title: String(($("dict-case-edit-title") && $("dict-case-edit-title").value) || "").trim(),
              facts: String(($("dict-case-edit-facts") && $("dict-case-edit-facts").value) || "").trim(),
              issues: String(($("dict-case-edit-issues") && $("dict-case-edit-issues").value) || "").trim(),
              judgment: String(($("dict-case-edit-judgment") && $("dict-case-edit-judgment").value) || "").trim(),
              caseFullText: String(($("dict-case-edit-full-text") && $("dict-case-edit-full-text").value) || "").trim(),
              oxQuizzes: oxQuizzes,
              searchKeys: parseCsv($("dict-case-edit-search-keys") && $("dict-case-edit-search-keys").value),
              topicKeywords: parseCsv($("dict-case-edit-topic-keywords") && $("dict-case-edit-topic-keywords").value),
              casenoteUrl: String(($("dict-case-edit-casenote-url") && $("dict-case-edit-casenote-url").value) || "").trim(),
              jisCntntsSrno: String(($("dict-case-edit-jis-srno") && $("dict-case-edit-jis-srno").value) || "").trim(),
              scourtPortalUrl: String(($("dict-case-edit-scourt-url") && $("dict-case-edit-scourt-url").value) || "").trim()
            },
            docId
          )
          .then(function () {
            closeDictCaseEditModal();
            runCaseSearch();
          })
          .catch(function (err) {
            setDictCaseEditMsg((err && err.message) || "판례 수정에 실패했습니다.", true);
          })
          .then(function () {
            dictCaseEditSaving = false;
            if (btnSave) btnSave.disabled = false;
          });
      });
    }
  }

  function setDictCaseCreateMsg(text, isError) {
    var el = $("dict-case-create-msg");
    if (!el) return;
    if (!text) {
      el.textContent = "";
      el.hidden = true;
      el.classList.remove("admin-msg--error");
      return;
    }
    el.textContent = text;
    el.hidden = false;
    if (isError) el.classList.add("admin-msg--error");
    else el.classList.remove("admin-msg--error");
  }

  function refreshAdminCaseCreateVisibility() {
    var box = $("dict-case-create-admin");
    if (!box) return;
    box.hidden = !isAdminUser();
  }

  function bindAdminCaseCreate() {
    refreshAdminCaseCreateVisibility();
    window.addEventListener("app-auth", refreshAdminCaseCreateVisibility);
    window.addEventListener("membership-updated", refreshAdminCaseCreateVisibility);
    if (window.CaseOxForm && typeof window.CaseOxForm.ensureBuilt === "function") {
      window.CaseOxForm.ensureBuilt("dict-case-create-ox-editor");
    }
    var btn = $("dict-case-create-run");
    var lastCaseStaging = null;

    function hideCaseCreateOxPanel() {
      var oxSec = $("dict-case-create-ox-section");
      var oxBtn = $("dict-case-create-ox-save");
      lastCaseStaging = null;
      if (oxSec) oxSec.hidden = true;
      if (window.CaseOxForm && typeof window.CaseOxForm.fill === "function") {
        window.CaseOxForm.fill("dict-case-create-ox-editor", []);
      }
      if (oxBtn) oxBtn.disabled = false;
    }

    function mergeCasePayloadBase(rec) {
      var r = rec || {};
      return Object.assign(
        {
          searchKeys: [],
          topicKeywords: [],
          caseFullText: "",
          casenoteUrl: "",
          jisCntntsSrno: "",
          scourtPortalUrl: ""
        },
        r
      );
    }

    var btnOxSave = $("dict-case-create-ox-save");
    if (btnOxSave) {
      btnOxSave.addEventListener("click", function () {
        if (!lastCaseStaging || !lastCaseStaging.id) {
          setDictCaseCreateMsg("먼저 판례사전 생성을 완료해 주세요.", true);
          return;
        }
        if (typeof window.adminUpdateDictStaging !== "function" || typeof window.adminGetDictStaging !== "function") {
          setDictCaseCreateMsg("검수 저장 API를 찾지 못했습니다. 페이지를 새로고침해 주세요.", true);
          return;
        }
        if (!window.CaseOxForm || typeof window.CaseOxForm.collect !== "function") {
          setDictCaseCreateMsg("OX 퀴즈 편집 모듈을 불러오지 못했습니다. 페이지를 새로고침해 주세요.", true);
          return;
        }
        var oxArr = window.CaseOxForm.collect("dict-case-create-ox-editor");
        var oxErr = window.CaseOxForm.validateForSave(oxArr);
        if (oxErr) {
          setDictCaseCreateMsg(oxErr, true);
          return;
        }
        var payload = mergeCasePayloadBase(lastCaseStaging.basePayload);
        payload.oxQuizzes = oxArr;
        btnOxSave.disabled = true;
        setDictCaseCreateMsg("검수 대기함에 OX 퀴즈를 반영하는 중…", false);
        window
          .adminUpdateDictStaging("case", lastCaseStaging.id, lastCaseStaging.version, payload)
          .then(function () {
            return window.adminGetDictStaging("case", lastCaseStaging.id);
          })
          .then(function (res) {
            var it = res && res.item;
            if (!it || !it.payload) {
              throw new Error("검수 항목을 다시 불러오지 못했습니다.");
            }
            lastCaseStaging.version = it.version;
            lastCaseStaging.basePayload = mergeCasePayloadBase(it.payload);
            if (window.CaseOxForm && typeof window.CaseOxForm.fill === "function") {
              window.CaseOxForm.fill("dict-case-create-ox-editor", it.payload.oxQuizzes || []);
            }
            setDictCaseCreateMsg("검수 대기함에 OX 퀴즈를 반영했습니다.", false);
            if (typeof window.loadAdminReviewQueue === "function") {
              window.loadAdminReviewQueue();
            }
          })
          .catch(function (err) {
            setDictCaseCreateMsg((err && err.message) || "OX 퀴즈 저장에 실패했습니다.", true);
          })
          .then(function () {
            btnOxSave.disabled = false;
          });
      });
    }

    if (!btn) return;
    btn.addEventListener("click", function () {
      hideCaseCreateOxPanel();
      if (!isAdminUser()) {
        setDictCaseCreateMsg("관리자만 사용할 수 있습니다.", true);
        return;
      }
      var citation = String(($("dict-case-create-citation") && $("dict-case-create-citation").value) || "").trim();
      var fullText = String(($("dict-case-create-fulltext") && $("dict-case-create-fulltext").value) || "").trim();
      if (!citation) {
        setDictCaseCreateMsg("사건 표기/사건번호를 입력해 주세요.", true);
        return;
      }
      if (!fullText) {
        setDictCaseCreateMsg("판결문 전문 텍스트를 입력해 주세요.", true);
        return;
      }
      if (
        typeof firebase === "undefined" ||
        !firebase.apps ||
        !firebase.apps.length ||
        !firebase.functions
      ) {
        setDictCaseCreateMsg("Firebase Functions를 사용할 수 없습니다.", true);
        return;
      }
      btn.disabled = true;
      setDictCaseCreateMsg("판례사전 생성 중입니다... (검수 대기 등록)", false);
      var region = window.FIREBASE_FUNCTIONS_REGION || "asia-northeast3";
      var fn = firebase.app().functions(region).httpsCallable("generateOrGetDictionaryEntry");
      fn({ tag: citation, caseFullText: fullText })
        .then(function (res) {
          var d = res && res.data;
          if (!d || !d.ok || d.kind !== "case" || !d.record) {
            throw new Error("판례 생성 결과를 가져오지 못했습니다.");
          }
          var rec = d.record || {};
          var oxSec = $("dict-case-create-ox-section");
          if (d.source === "generated-pending-review" && d.stagingDocId) {
            lastCaseStaging = {
              id: String(d.stagingDocId),
              version:
                d.stagingVersion != null && Number.isFinite(parseInt(d.stagingVersion, 10))
                  ? parseInt(d.stagingVersion, 10)
                  : 1,
              basePayload: mergeCasePayloadBase(rec)
            };
            if (window.CaseOxForm && typeof window.CaseOxForm.fill === "function") {
              window.CaseOxForm.fill("dict-case-create-ox-editor", rec.oxQuizzes || []);
            }
            if (oxSec) oxSec.hidden = false;
            if (btnOxSave) btnOxSave.disabled = false;
            setDictCaseCreateMsg(
              "생성 결과를 검수 대기함에 등록했습니다. 아래 OX 퀴즈를 확인·수정한 뒤 필요 시 저장하세요. 최종 승인은 검수·승인 탭에서 합니다.",
              false
            );
          } else if (d.source === "generated-pending-review") {
            if (window.CaseOxForm && typeof window.CaseOxForm.fill === "function") {
              window.CaseOxForm.fill("dict-case-create-ox-editor", rec.oxQuizzes || []);
            }
            if (oxSec) oxSec.hidden = false;
            if (btnOxSave) btnOxSave.disabled = true;
            setDictCaseCreateMsg(
              "OX 퀴즈가 생성되었습니다. Functions를 최신 배포하면 아래에서 검수 대기함에 바로 저장할 수 있습니다. 지금은 검수·승인 탭의 판례사전에서 편집해 주세요.",
              false
            );
          } else {
            hideCaseCreateOxPanel();
            if (d.source === "store") {
              setDictCaseCreateMsg(
                "이미 운영에 있는 판례입니다. OX 퀴즈 수정은 검수·승인 탭의 판례사전에서 진행해 주세요.",
                false
              );
            } else {
              setDictCaseCreateMsg("판례 생성이 완료되었습니다.", false);
            }
          }
          try {
            window.dispatchEvent(
              new CustomEvent("dict-case-staging-created", {
                detail: {
                  citation: String(rec.citation || citation || "").trim()
                }
              })
            );
          } catch (e2) {}
          var adminTab = $("admin-tab");
          var reviewTab = $("admin-tab-review");
          var reviewTypeCase = $("admin-review-type-case");
          if (adminTab && typeof adminTab.click === "function") adminTab.click();
          if (reviewTab && typeof reviewTab.click === "function") reviewTab.click();
          if (reviewTypeCase && typeof reviewTypeCase.click === "function") reviewTypeCase.click();
          if (typeof window.loadAdminReviewQueue === "function") {
            window.setTimeout(function () {
              window.loadAdminReviewQueue();
            }, 0);
          }
        })
        .catch(function (err) {
          setDictCaseCreateMsg((err && err.message) || "판례사전 생성에 실패했습니다.", true);
        })
        .then(function () {
          btn.disabled = false;
        });
    });
  }

  function setDictTermCreateMsg(text, isError) {
    var el = $("dict-term-create-msg");
    if (!el) return;
    if (!text) {
      el.textContent = "";
      el.hidden = true;
      el.classList.remove("admin-msg--error");
      return;
    }
    el.textContent = text;
    el.hidden = false;
    if (isError) el.classList.add("admin-msg--error");
    else el.classList.remove("admin-msg--error");
  }

  function refreshAdminTermCreateVisibility() {
    var box = $("dict-term-create-admin");
    if (!box) return;
    box.hidden = !isAdminUser();
  }

  function bindAdminTermCreate() {
    refreshAdminTermCreateVisibility();
    window.addEventListener("app-auth", refreshAdminTermCreateVisibility);
    window.addEventListener("membership-updated", refreshAdminTermCreateVisibility);
    var btn = $("dict-term-create-run");
    if (!btn) return;
    btn.addEventListener("click", function () {
      if (!isAdminUser()) {
        setDictTermCreateMsg("관리자만 사용할 수 있습니다.", true);
        return;
      }
      var tag = String(($("dict-term-create-tag") && $("dict-term-create-tag").value) || "").trim();
      if (!tag) {
        setDictTermCreateMsg("용어/키워드를 입력해 주세요.", true);
        return;
      }
      if (
        typeof firebase === "undefined" ||
        !firebase.apps ||
        !firebase.apps.length ||
        !firebase.functions
      ) {
        setDictTermCreateMsg("Firebase Functions를 사용할 수 없습니다.", true);
        return;
      }
      if (typeof window.saveTermEntryToFirestore !== "function") {
        setDictTermCreateMsg("용어 저장 함수를 찾지 못했습니다.", true);
        return;
      }
      btn.disabled = true;
      setDictTermCreateMsg("용어사전 생성 중입니다...", false);
      var region = window.FIREBASE_FUNCTIONS_REGION || "asia-northeast3";
      var fn = firebase.app().functions(region).httpsCallable("generateOrGetDictionaryEntry");
      fn({ tag: tag })
        .then(function (res) {
          var d = res && res.data;
          if (!d || !d.ok || d.kind !== "term" || !d.record) {
            throw new Error("용어 생성 결과를 가져오지 못했습니다.");
          }
          var rec = d.record || {};
          return window.saveTermEntryToFirestore(rec).then(function () {
            return rec;
          });
        })
        .then(function (saved) {
          var input = $("dict-term-query");
          if (input) input.value = String((saved && saved.term) || tag || "").trim();
          runTermSearch();
          setDictTermCreateMsg("용어사전 생성·저장을 완료했습니다.", false);
        })
        .catch(function (err) {
          setDictTermCreateMsg((err && err.message) || "용어사전 생성에 실패했습니다.", true);
        })
        .then(function () {
          btn.disabled = false;
        });
    });
  }

  function bindDictTermEditModal() {
    var dem = $("dict-term-edit-modal");
    if (dem) {
      dem.addEventListener("click", function (e) {
        if (e.target === dem) closeDictTermEditModal();
      });
    }
    var dec = $("dict-term-edit-close");
    var dex = $("dict-term-edit-cancel");
    if (dec) dec.addEventListener("click", closeDictTermEditModal);
    if (dex) dex.addEventListener("click", closeDictTermEditModal);
    var form = $("dict-term-edit-form");
    if (form) {
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        if (dictTermEditSaving) return;
        if (typeof window.saveTermEntryToFirestore !== "function") {
          setDictTermEditMsg("저장 함수를 찾지 못했습니다.", true);
          return;
        }
        var modal = $("dict-term-edit-modal");
        var termEl = $("dict-term-edit-term");
        var aliasesEl = $("dict-term-edit-aliases");
        var defEl = $("dict-term-edit-definition");
        var docId = modal && modal.dataset ? modal.dataset.docId : "";
        var nextTerm = termEl ? String(termEl.value || "").trim() : "";
        var nextDef = defEl ? String(defEl.value || "").trim() : "";
        var nextAliases = aliasesEl ? parseCsv(aliasesEl.value) : [];
        if (!nextTerm || !nextDef) {
          setDictTermEditMsg("표제어와 정의·해설을 모두 입력해 주세요.", true);
          return;
        }
        var btnSave = $("dict-term-edit-save");
        dictTermEditSaving = true;
        if (btnSave) btnSave.disabled = true;
        setDictTermEditMsg("", false);
        var oxList = [];
        if (window.CaseOxForm && typeof window.CaseOxForm.collect === "function") {
          window.CaseOxForm.ensureBuilt("dict-term-edit-ox-editor");
          oxList = window.CaseOxForm.collect("dict-term-edit-ox-editor");
          var oxErrTerm = window.CaseOxForm.validateForSave(oxList);
          if (oxErrTerm) {
            setDictTermEditMsg(oxErrTerm, true);
            dictTermEditSaving = false;
            if (btnSave) btnSave.disabled = false;
            return;
          }
        }
        window
          .saveTermEntryToFirestore(
            {
              term: nextTerm,
              aliases: nextAliases,
              definition: nextDef,
              oxQuizzes: oxList
            },
            docId
          )
          .then(function () {
            closeDictTermEditModal();
            runTermSearch();
          })
          .catch(function (err) {
            setDictTermEditMsg((err && err.message) || "용어 수정에 실패했습니다.", true);
          })
          .then(function () {
            dictTermEditSaving = false;
            if (btnSave) btnSave.disabled = false;
          });
      });
    }
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      var caseModal = $("dict-case-edit-modal");
      if (caseModal && !caseModal.hidden) {
        closeDictCaseEditModal();
        return;
      }
      var statuteModal = $("dict-statute-edit-modal");
      if (statuteModal && !statuteModal.hidden) {
        closeDictStatuteEditModal();
        return;
      }
      var modal = $("dict-term-edit-modal");
      if (!modal || modal.hidden) return;
      closeDictTermEditModal();
    });
  }

  var dictStatuteEditSaving = false;

  function setDictStatuteEditMsg(text, isError) {
    var el = $("dict-statute-edit-msg");
    if (!el) return;
    if (!text) {
      el.textContent = "";
      el.hidden = true;
      el.classList.remove("admin-msg--error");
      return;
    }
    el.textContent = text;
    el.hidden = false;
    el.classList.toggle("admin-msg--error", !!isError);
  }

  function closeDictStatuteEditModal() {
    var m = $("dict-statute-edit-modal");
    if (!m) return;
    m.hidden = true;
    m.setAttribute("aria-hidden", "true");
    delete m.dataset.docId;
    delete m.dataset.statuteKey;
    setDictStatuteEditMsg("", false);
  }

  function openDictStatuteEditModal(s) {
    var m = $("dict-statute-edit-modal");
    if (!m || !s) return;
    var keyEl = $("dict-statute-edit-key");
    if (keyEl) keyEl.value = s.key || "";
    var hEl = $("dict-statute-edit-heading");
    if (hEl) hEl.value = s.heading || "";
    var bEl = $("dict-statute-edit-body");
    if (bEl) bEl.value = s.body || "";
    var snEl = $("dict-statute-edit-source-note");
    if (snEl) snEl.value = s.sourceNote || "";
    if (window.CaseOxForm && typeof window.CaseOxForm.ensureBuilt === "function") {
      window.CaseOxForm.ensureBuilt("dict-statute-edit-ox-editor");
      window.CaseOxForm.fill("dict-statute-edit-ox-editor", Array.isArray(s.oxQuizzes) ? s.oxQuizzes : []);
    }
    m.dataset.docId = s._docId ? String(s._docId) : "";
    m.dataset.statuteKey = s.key ? String(s.key) : "";
    setDictStatuteEditMsg("", false);
    m.hidden = false;
    m.setAttribute("aria-hidden", "false");
    if (hEl) hEl.focus();
  }

  function bindDictStatuteEditModal() {
    var dem = $("dict-statute-edit-modal");
    if (dem) {
      dem.addEventListener("click", function (e) {
        if (e.target === dem) closeDictStatuteEditModal();
      });
    }
    var dec = $("dict-statute-edit-close");
    var dex = $("dict-statute-edit-cancel");
    if (dec) dec.addEventListener("click", closeDictStatuteEditModal);
    if (dex) dex.addEventListener("click", closeDictStatuteEditModal);
    var form = $("dict-statute-edit-form");
    if (form) {
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        if (dictStatuteEditSaving) return;
        if (typeof window.saveStatuteEntryToFirestore !== "function") {
          setDictStatuteEditMsg("저장 함수를 찾지 못했습니다.", true);
          return;
        }
        var modal = $("dict-statute-edit-modal");
        var statuteKey =
          modal && modal.dataset && modal.dataset.statuteKey
            ? String(modal.dataset.statuteKey).trim()
            : "";
        var docId = modal && modal.dataset ? modal.dataset.docId : "";
        if (!statuteKey) {
          setDictStatuteEditMsg("조문 식별자가 없습니다.", true);
          return;
        }
        var btnSave = $("dict-statute-edit-save");
        dictStatuteEditSaving = true;
        if (btnSave) btnSave.disabled = true;
        setDictStatuteEditMsg("", false);
        var oxSt = [];
        if (window.CaseOxForm && typeof window.CaseOxForm.collect === "function") {
          window.CaseOxForm.ensureBuilt("dict-statute-edit-ox-editor");
          oxSt = window.CaseOxForm.collect("dict-statute-edit-ox-editor");
          var oxErrSt = window.CaseOxForm.validateForSave(oxSt);
          if (oxErrSt) {
            setDictStatuteEditMsg(oxErrSt, true);
            dictStatuteEditSaving = false;
            if (btnSave) btnSave.disabled = false;
            return;
          }
        }
        window
          .saveStatuteEntryToFirestore(
            {
              statuteKey: statuteKey,
              heading: String(($("dict-statute-edit-heading") && $("dict-statute-edit-heading").value) || "").trim(),
              body: String(($("dict-statute-edit-body") && $("dict-statute-edit-body").value) || "").trim(),
              sourceNote: String(
                ($("dict-statute-edit-source-note") && $("dict-statute-edit-source-note").value) || ""
              ).trim(),
              oxQuizzes: oxSt
            },
            docId
          )
          .then(function () {
            closeDictStatuteEditModal();
            runStatuteSearch();
          })
          .catch(function (err) {
            setDictStatuteEditMsg((err && err.message) || "조문 수정에 실패했습니다.", true);
          })
          .then(function () {
            dictStatuteEditSaving = false;
            if (btnSave) btnSave.disabled = false;
          });
      });
    }
    var btnGenOx = $("dict-statute-edit-gen-ox");
    if (btnGenOx) {
      btnGenOx.addEventListener("click", function () {
        var modal = $("dict-statute-edit-modal");
        var sk =
          modal && modal.dataset && modal.dataset.statuteKey
            ? String(modal.dataset.statuteKey).trim()
            : "";
        var heading = String(
          ($("dict-statute-edit-heading") && $("dict-statute-edit-heading").value) || ""
        ).trim();
        var body = String(($("dict-statute-edit-body") && $("dict-statute-edit-body").value) || "").trim();
        if (!sk || !body) {
          setDictStatuteEditMsg("조문 키와 본문을 먼저 입력해 주세요.", true);
          return;
        }
        if (typeof window.generateDictStatuteOxQuizzes !== "function") {
          setDictStatuteEditMsg("퀴즈 생성 기능을 불러오지 못했습니다. 페이지를 새로고침해 주세요.", true);
          return;
        }
        btnGenOx.disabled = true;
        setDictStatuteEditMsg("AI가 조문 OX 퀴즈 초안을 만드는 중…", false);
        window
          .generateDictStatuteOxQuizzes({ statuteKey: sk, heading: heading, body: body })
          .then(function (data) {
            var ox = (data && data.oxQuizzes) || [];
            if (window.CaseOxForm && typeof window.CaseOxForm.fill === "function") {
              window.CaseOxForm.ensureBuilt("dict-statute-edit-ox-editor");
              window.CaseOxForm.fill("dict-statute-edit-ox-editor", ox);
            }
            setDictStatuteEditMsg(
              ox.length ? "초안을 폼에 넣었습니다. 검토한 뒤 저장하세요." : "생성된 문항이 없습니다.",
              false
            );
          })
          .catch(function (err) {
            setDictStatuteEditMsg((err && err.message) || "퀴즈 생성에 실패했습니다.", true);
          })
          .then(function () {
            btnGenOx.disabled = false;
          });
      });
    }
  }

  function applyDefinitionHtml(el, raw) {
    el.className = "dict-result-card__body quiz-ai-answer";
    if (typeof window.formatHanlawAiAnswerHtml === "function") {
      el.innerHTML = window.formatHanlawAiAnswerHtml(raw || "");
    } else {
      el.textContent = raw || "";
    }
  }

  /** 사전 카드 — 찜하기(찜노트에 저장, DictFavorites) */
  function appendDictFavoriteControl(article, kind, payload) {
    if (!article || !window.DictFavorites || !payload || !payload.id) return;
    var wr = document.createElement("div");
    wr.className = "dict-result-card__fav-row";
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn--small btn--outline btn--dict-fav";
    function sync() {
      var on = window.DictFavorites.has(kind, payload.id);
      btn.classList.toggle("btn--dict-fav--on", on);
      btn.textContent = on ? "찜함 · 취소" : "☆ 찜하기";
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    }
    sync();
    btn.addEventListener("click", function (ev) {
      ev.preventDefault();
      var u = typeof window.getHanlawUser === "function" ? window.getHanlawUser() : null;
      if (!u || !u.email) {
        window.alert("찜하기는 로그인 후 이용할 수 있습니다.");
        return;
      }
      window.DictFavorites.toggle(kind, payload);
      sync();
      try {
        window.dispatchEvent(new CustomEvent("dict-favorites-updated"));
      } catch (e2) {}
    });
    wr.appendChild(btn);
    article.appendChild(wr);
  }

  /** 검색·상세 조회 후 수록 목록(첫 화면)으로 돌아가기 */
  function appendDictNavBack(article, panelKind) {
    if (!article) return;
    var nav = document.createElement("div");
    nav.className = "dict-card-nav";
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn--ghost btn--small dict-back-to-list";
    btn.setAttribute("data-dict-back", panelKind);
    btn.textContent = "목록으로";
    nav.appendChild(btn);
    article.appendChild(nav);
  }

  function renderTermResults(container, items, opts) {
    opts = opts || {};
    container.innerHTML = "";
    if (!items.length) {
      var p = document.createElement("p");
      p.className = "dict-empty";
      p.textContent =
        "일치하는 용어가 없습니다. 다른 키워드로 검색하거나, 로그인 후 AI 해설 생성을 이용해 보세요.";
      container.appendChild(p);
      return;
    }
    var guest = isGuestViewer();
    var cap = guest ? Math.min(items.length, dictGuestLimit()) : items.length;
    for (var i = 0; i < cap; i++) {
      var t = items[i];
      var article = document.createElement("article");
      article.className = "dict-result-card";
      var h = document.createElement("h3");
      h.className = "dict-result-card__title";
      h.textContent = t.term;
      article.appendChild(h);
      if (t.aliases && t.aliases.length) {
        var al = document.createElement("p");
        al.className = "dict-result-card__aliases";
        al.textContent = "관련어: " + t.aliases.join(", ");
        article.appendChild(al);
      }
      var body = document.createElement("div");
      applyDefinitionHtml(body, t.definition || "");
      article.appendChild(body);
      appendDictionaryOxQuizSection(article, t.oxQuizzes, "용어 OX 퀴즈", 3);
      if (t._displaySource === "generated" || t._displaySource === "generated-pending-review") {
        var foot = document.createElement("p");
        foot.className = "dict-result-card__foot";
        foot.textContent =
          t._displaySource === "generated-pending-review"
            ? "이 항목은 Gemini로 생성되어 관리자 검수 대기 상태입니다."
            : "이 해설은 Gemini로 생성·저장된 항목입니다.";
        article.appendChild(foot);
      }
      if (isAdminUser()) {
        var btnEdit = document.createElement("button");
        btnEdit.type = "button";
        btnEdit.className = "btn btn--small btn--outline";
        btnEdit.textContent = "수정";
        btnEdit.setAttribute("data-admin-edit-term", "1");
        btnEdit._term = t;
        article.appendChild(btnEdit);
      }
      if (window.DictFavorites && !opts.skipFavButton) {
        appendDictFavoriteControl(article, "term", {
          id: window.DictFavorites.makeId("term", t.term),
          title: t.term,
          sub: t.aliases && t.aliases.length ? "관련어: " + t.aliases.join(", ") : "",
          searchText: t.term
        });
      }
      if (!opts.skipNavBack) appendDictNavBack(article, "term");
      container.appendChild(article);
    }
    if (guest && items.length > cap) appendDictGuestLockNotice(container, "term");
  }

  /** 판례 카드: 관리자 입력 판결문 전문 토글 */
  function appendCaseFullTextToggle(article, caseObj) {
    var fullText = String((caseObj && caseObj.caseFullText) || "").trim();
    if (!fullText) return;
    var nav = document.createElement("div");
    nav.className = "case-result-card__links";
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn--ghost btn--small case-result-card__fulltext-toggle";
    btn.textContent = "전문 보기";
    btn.setAttribute("aria-expanded", "false");
    nav.appendChild(btn);
    article.appendChild(nav);

    var sec = document.createElement("section");
    sec.className = "case-result-card__section case-result-card__fulltext";
    sec.hidden = true;
    var h = document.createElement("h4");
    h.className = "case-result-card__label";
    h.textContent = "판결문 전문";
    sec.appendChild(h);
    var div = document.createElement("div");
    div.className = "case-result-card__text quiz-ai-answer";
    if (typeof window.formatHanlawAiAnswerHtml === "function") {
      div.innerHTML = window.formatHanlawAiAnswerHtml(fullText);
    } else {
      div.textContent = fullText;
    }
    sec.appendChild(div);
    article.appendChild(sec);

    btn.addEventListener("click", function () {
      var nextOpen = !!sec.hidden;
      sec.hidden = !nextOpen;
      btn.textContent = nextOpen ? "전문 접기" : "전문 보기";
      btn.setAttribute("aria-expanded", nextOpen ? "true" : "false");
    });
  }

  function normalizeDictOxAnswer(v) {
    if (v === true || v === false) return v;
    var s = String(v == null ? "" : v).trim().toLowerCase();
    if (s === "o" || s === "true" || s === "참" || s === "1") return true;
    if (s === "x" || s === "false" || s === "거짓" || s === "0") return false;
    return null;
  }

  function normalizeCaseIssuesTextForUi(raw) {
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

  function dictOxButtonIsTrue(btn) {
    if (!btn) return false;
    if (btn.getAttribute("data-answer") != null) {
      return btn.getAttribute("data-answer") === "true";
    }
    return false;
  }

  function applyDictOxReveal(container, userTrue, correctTrue) {
    if (!container) return;
    container.classList.add("q-actions--revealed");
    container.querySelectorAll(".btn--ox").forEach(function (b) {
      var isTrue = dictOxButtonIsTrue(b);
      b.classList.remove("btn--ox-reveal-correct", "btn--ox-reveal-wrong", "btn--ox-reveal-dim");
      var isCorrectBtn = isTrue === correctTrue;
      var isUserBtn = isTrue === userTrue;
      if (isCorrectBtn) b.classList.add("btn--ox-reveal-correct");
      else if (isUserBtn) b.classList.add("btn--ox-reveal-wrong");
      else b.classList.add("btn--ox-reveal-dim");
    });
  }

  /** 판례·용어·조문 카드 공통 OX 블록 (기존 case-result-card__ox-* 스타일 재사용) */
  function appendDictionaryOxQuizSection(article, oxQuizzes, headingText, maxItems) {
    if (!article || !Array.isArray(oxQuizzes) || !oxQuizzes.length) return;
    var maxQ = maxItems != null ? maxItems : 5;
    var secOx = document.createElement("section");
    secOx.className = "case-result-card__section";
    var hOx = document.createElement("h4");
    hOx.className = "case-result-card__label";
    hOx.textContent = headingText || "OX 퀴즈";
    secOx.appendChild(hOx);
    var listOx = document.createElement("ol");
    listOx.className = "case-result-card__ox-list";
    var qi;
    for (qi = 0; qi < oxQuizzes.length && qi < maxQ; qi++) {
      var qx = oxQuizzes[qi] || {};
      var li = document.createElement("li");
      li.className = "case-result-card__ox-item";
      var st = document.createElement("p");
      st.className = "case-result-card__text";
      st.textContent = String(qx.statement || "").trim();
      li.appendChild(st);

      var correctTrue = normalizeDictOxAnswer(qx.answer);
      var explainRaw =
        qx.explanationBasic != null && String(qx.explanationBasic).trim()
          ? String(qx.explanationBasic).trim()
          : String(qx.explanation || "").trim();

      if (correctTrue == null) {
        var ansOnly = document.createElement("p");
        ansOnly.className = "case-result-card__ox-answer";
        ansOnly.textContent = "정답: (데이터 형식을 확인할 수 없습니다)";
        li.appendChild(ansOnly);
        listOx.appendChild(li);
        continue;
      }

      var actions = document.createElement("div");
      actions.className = "q-actions case-result-card__ox-actions";
      var btnO = document.createElement("button");
      btnO.type = "button";
      btnO.className = "btn btn--ox btn--o";
      btnO.setAttribute("data-answer", "true");
      btnO.setAttribute("aria-label", "참(O)");
      btnO.textContent = "O";
      var btnX = document.createElement("button");
      btnX.type = "button";
      btnX.className = "btn btn--ox btn--x";
      btnX.setAttribute("data-answer", "false");
      btnX.setAttribute("aria-label", "거짓(X)");
      btnX.textContent = "X";
      actions.appendChild(btnO);
      actions.appendChild(btnX);
      li.appendChild(actions);

      var feedback = document.createElement("div");
      feedback.className = "case-result-card__ox-feedback";
      feedback.hidden = true;
      feedback.setAttribute("aria-live", "polite");
      var resultLine = document.createElement("p");
      resultLine.className = "case-result-card__ox-result";
      var explainEl = document.createElement("div");
      explainEl.className = "case-result-card__ox-explain quiz-ai-answer";
      feedback.appendChild(resultLine);
      feedback.appendChild(explainEl);
      li.appendChild(feedback);

      (function (correctT, explainText, actEl, fb, resP, expDiv, bO, bX) {
        var answered = false;
        function onPick(userTrue) {
          if (answered) return;
          answered = true;
          bO.disabled = true;
          bX.disabled = true;
          applyDictOxReveal(actEl, userTrue, correctT);
          var ok = userTrue === correctT;
          resP.textContent = ok ? "정답입니다." : "오답입니다.";
          resP.className =
            "case-result-card__ox-result " +
            (ok ? "case-result-card__ox-result--ok" : "case-result-card__ox-result--bad");
          if (!ok) {
            resP.textContent += " 정답은 " + (correctT ? "O" : "X") + "입니다.";
          }
          expDiv.innerHTML = "";
          if (explainText) {
            if (typeof window.formatHanlawAiAnswerHtml === "function") {
              expDiv.innerHTML = window.formatHanlawAiAnswerHtml(explainText);
            } else {
              expDiv.textContent = explainText;
            }
          } else {
            expDiv.textContent = "해설이 아직 준비되지 않았습니다.";
          }
          fb.hidden = false;
        }
        function onBtn(ev, userTrue) {
          if (ev) {
            ev.preventDefault();
            ev.stopPropagation();
          }
          onPick(userTrue);
        }
        bO.addEventListener("click", function (ev) {
          onBtn(ev, true);
        });
        bX.addEventListener("click", function (ev) {
          onBtn(ev, false);
        });
      })(correctTrue, explainRaw, actions, feedback, resultLine, explainEl, btnO, btnX);

      listOx.appendChild(li);
    }
    secOx.appendChild(listOx);
    article.appendChild(secOx);
  }

  function renderCaseResults(container, items, listBackKind, opts) {
    opts = opts || {};
    var backKind = listBackKind || "case";
    container.innerHTML = "";
    if (!items.length) {
      var p = document.createElement("p");
      p.className = "dict-empty";
      p.textContent =
        "일치하는 판례가 없습니다. 사건번호(예: 91누3224) 또는 키워드(예: 행정계획, 정보공개)로 검색하거나, js/case-dictionary-data.js·Firestore(hanlaw_dict_cases)에 판례를 추가하세요.";
      container.appendChild(p);
      return;
    }
    var guest = isGuestViewer();
    var cap = guest ? Math.min(items.length, dictGuestLimit()) : items.length;
    for (var i = 0; i < cap; i++) {
      var c = items[i];
      var article = document.createElement("article");
      article.className = "case-result-card";
      article.setAttribute("data-case-citation", String(c.citation || "").trim());
      var head = document.createElement("header");
      head.className = "case-result-card__head";
      var cit = document.createElement("p");
      cit.className = "case-result-card__citation";
      if (typeof window.formatHanlawRichParagraphsHtml === "function") {
        cit.innerHTML = window.formatHanlawRichParagraphsHtml(c.citation || "");
      } else {
        cit.textContent = c.citation || "";
      }
      head.appendChild(cit);
      if (c.title) {
        var tit = document.createElement("h3");
        tit.className = "case-result-card__title";
        if (typeof window.formatHanlawRichParagraphsHtml === "function") {
          tit.innerHTML = window.formatHanlawRichParagraphsHtml(c.title);
        } else {
          tit.textContent = c.title;
        }
        head.appendChild(tit);
      }

      article.appendChild(head);

      function addSection(label, text) {
        if (!text) return;
        var sec = document.createElement("section");
        sec.className = "case-result-card__section";
        var h = document.createElement("h4");
        h.className = "case-result-card__label";
        h.textContent = label;
        sec.appendChild(h);
        var div = document.createElement("div");
        div.className = "case-result-card__text quiz-ai-answer";
        if (typeof window.formatHanlawAiAnswerHtml === "function") {
          div.innerHTML = window.formatHanlawAiAnswerHtml(text);
        } else {
          div.textContent = text;
        }
        sec.appendChild(div);
        article.appendChild(sec);
      }

      addSection("사실관계", c.facts);
      addSection("쟁점", normalizeCaseIssuesTextForUi(c.issues));
      addSection("법적 판단", c.judgment);
      appendDictionaryOxQuizSection(article, c.oxQuizzes, "판례 OX 퀴즈", 5);
      appendCaseFullTextToggle(article, c);
      if (isAdminUser()) {
        var btnCaseEdit = document.createElement("button");
        btnCaseEdit.type = "button";
        btnCaseEdit.className = "btn btn--small btn--outline";
        btnCaseEdit.textContent = "수정";
        btnCaseEdit.setAttribute("data-admin-edit-case", "1");
        btnCaseEdit._case = c;
        article.appendChild(btnCaseEdit);
      }
      if (window.DictFavorites && !opts.skipFavButton) {
        var citP = String(c.citation || "").trim();
        var titP = "";
        if (c.title) {
          var dti = document.createElement("div");
          dti.innerHTML = String(c.title);
          titP = (dti.textContent || "").replace(/\s+/g, " ").trim();
        }
        var keyCase = citP || titP || "unknown";
        appendDictFavoriteControl(article, "case", {
          id: window.DictFavorites.makeId("case", keyCase),
          title: citP || titP || "(판례)",
          sub: titP && citP ? titP : "",
          searchText: citP || titP
        });
      }
      if (!opts.skipNavBack) appendDictNavBack(article, backKind);
      container.appendChild(article);
    }
    if (guest && items.length > cap) appendDictGuestLockNotice(container, "case");
  }

  function hideDictTermLoading() {
    var loading = $("dict-term-ai-loading");
    if (loading) {
      loading.hidden = true;
      loading.setAttribute("aria-busy", "false");
    }
  }

  function showDictTermLoading() {
    var loading = $("dict-term-ai-loading");
    var loadingQ = $("dict-term-ai-loading-quote");
    if (loadingQ && typeof window.pickHanlawAiLoadingQuote === "function") {
      loadingQ.textContent = window.pickHanlawAiLoadingQuote();
    }
    if (loading) {
      loading.hidden = false;
      loading.setAttribute("aria-busy", "true");
    }
  }

  function runTermSearch() {
    var input = $("dict-term-query");
    var out = $("dict-term-results");
    if (!input || !out) return;
    hideDictTermLoading();

    var q = String(input.value || "").trim();
    var local = searchTerms(input.value);
    if (local.length) {
      renderTermResults(out, local);
      setDictGuestHint("term", Math.min(local.length, dictGuestLimit()), local.length);
      emitDictResultsUpdated("term");
      return;
    }

    out.innerHTML = "";
    if (!q) {
      var terms0 = generatedTermsSorted();
      renderGeneratedTermIndex(out, terms0);
      setDictGuestHint("term", Math.min(terms0.length, dictGuestLimit()), terms0.length);
      emitDictResultsUpdated("term");
      return;
    }

    if (typeof window.getHanlawUser !== "function" || !window.getHanlawUser()) {
      var pGuest = document.createElement("p");
      pGuest.className = "dict-empty";
      pGuest.textContent =
        "일치하는 용어가 없습니다. 로그인하면 AI로 행정법 해설을 생성해 볼 수 있습니다(Google Gemini).";
      out.appendChild(pGuest);
      setDictGuestHint("term", 0, 0);
      emitDictResultsUpdated("term");
      return;
    }

    if (typeof firebase === "undefined" || !firebase.apps || !firebase.apps.length || !firebase.functions) {
      var pFb = document.createElement("p");
      pFb.className = "dict-empty";
      pFb.textContent =
        "Firebase를 사용할 수 없습니다. 네트워크와 설정을 확인한 뒤 새로고침하세요.";
      out.appendChild(pFb);
      setDictGuestHint("term", 0, 0);
      emitDictResultsUpdated("term");
      return;
    }

    showDictTermLoading();
    var region = window.FIREBASE_FUNCTIONS_REGION || "asia-northeast3";
    var fn = firebase.app().functions(region).httpsCallable("generateOrGetDictionaryEntry");
    fn({ tag: q })
      .then(function (res) {
        hideDictTermLoading();
        var d = res && res.data;
        if (!d || !d.ok || !d.record) {
          renderTermResults(out, []);
          setDictGuestHint("term", 0, 0);
          emitDictResultsUpdated("term");
          return;
        }
        if (d.kind === "case") {
          renderCaseResults(out, [d.record], "term");
          setDictGuestHint("term", 1, 1);
          emitDictResultsUpdated("term");
          return;
        }
        var rec = d.record;
        if (d.source === "generated" || d.source === "generated-pending-review") {
          rec._displaySource = d.source;
        }
        renderTermResults(out, [rec]);
        setDictGuestHint("term", 1, 1);
        emitDictResultsUpdated("term");
      })
      .catch(function (e) {
        hideDictTermLoading();
        out.innerHTML = "";
        var pe = document.createElement("p");
        pe.className = "dict-empty dict-empty--error";
        var msg = (e && e.message) ? String(e.message) : "해설을 불러오지 못했습니다.";
        if (e && e.code === "functions/failed-precondition") {
          msg = e.message || "서버에 Gemini API가 설정되어 있지 않습니다.";
        }
        if (e && e.code === "functions/unauthenticated") {
          msg = "로그인이 필요합니다.";
        }
        pe.textContent = msg;
        out.appendChild(pe);
        setDictGuestHint("term", 0, 0);
        emitDictResultsUpdated("term");
      });
  }

  function runCaseSearch() {
    var input = $("case-number-query");
    var out = $("case-search-results");
    if (!input || !out) return;
    var q = String(input.value || "").trim();
    if (!q) {
      var list0 = browseCasesSorted();
      renderGeneratedCaseIndex(out, list0);
      setDictGuestHint("case", Math.min(list0.length, dictGuestLimit()), list0.length);
      emitDictResultsUpdated("case");
      return;
    }
    var list = searchCases(input.value);
    renderCaseResults(out, list);
    setDictGuestHint("case", Math.min(list.length, dictGuestLimit()), list.length);
    emitDictResultsUpdated("case");
  }

  function bind() {
    var btnT = $("dict-term-search");
    var inpT = $("dict-term-query");
    if (btnT) btnT.addEventListener("click", runTermSearch);
    if (inpT) {
      inpT.addEventListener("keydown", function (e) {
        if (e.key === "Enter") runTermSearch();
      });
    }
    var outT = $("dict-term-results");
    if (outT && inpT) {
      outT.addEventListener("click", function (e) {
        var el = eventTargetElement(e);
        if (!el) return;
        var btn = el.closest("[data-term]");
        if (!btn) return;
        var t = String(btn.getAttribute("data-term") || "").trim();
        if (!t) return;
        inpT.value = t;
        runTermSearch();
      });
      outT.addEventListener("click", function (e) {
        var el = eventTargetElement(e);
        if (!el) return;
        var bc = el.closest("[data-admin-edit-case]");
        if (bc && bc._case) {
          if (typeof window.saveCaseEntryToFirestore !== "function") {
            window.alert("저장 함수를 찾지 못했습니다.");
            return;
          }
          openDictCaseEditModal(bc._case);
          return;
        }
        var bt = el.closest("[data-admin-edit-term]");
        if (bt && bt._term) {
          openDictTermEditModal(bt._term);
        }
      });
    }

    document.body.addEventListener("click", function (e) {
      var el = eventTargetElement(e);
      if (!el || !el.closest("#tag-dict-modal")) return;
      var bc = el.closest("[data-admin-edit-case]");
      if (bc && bc._case) {
        if (typeof window.saveCaseEntryToFirestore !== "function") {
          window.alert("저장 함수를 찾지 못했습니다.");
          return;
        }
        openDictCaseEditModal(bc._case);
        return;
      }
      var bt = el.closest("[data-admin-edit-term]");
      if (bt && bt._term) {
        openDictTermEditModal(bt._term);
      }
    });

    var btnC = $("case-search-btn");
    var inpC = $("case-number-query");
    var outC = $("case-search-results");
    if (outC && inpC) {
      outC.addEventListener("click", function (e) {
        var el = eventTargetElement(e);
        if (!el) return;
        var bc = el.closest("[data-admin-edit-case]");
        if (bc && bc._case) {
          if (typeof window.saveCaseEntryToFirestore !== "function") {
            window.alert("저장 함수를 찾지 못했습니다.");
            return;
          }
          openDictCaseEditModal(bc._case);
          return;
        }
        var pick = el.closest("[data-case-citation]");
        if (pick && pick.dataset.caseCitation) {
          inpC.value = pick.dataset.caseCitation;
          runCaseSearch();
        }
      });
    }
    if (btnC) btnC.addEventListener("click", runCaseSearch);
    if (inpC) {
      inpC.addEventListener("keydown", function (e) {
        if (e.key === "Enter") runCaseSearch();
      });
    }

    var btnS = $("statute-search-btn");
    var inpS = $("statute-article-query");
    var outS = $("statute-search-results");
    if (btnS) btnS.addEventListener("click", runStatuteSearch);
    if (inpS) {
      inpS.addEventListener("keydown", function (e) {
        if (e.key === "Enter") runStatuteSearch();
      });
    }
    if (outS && inpS) {
      outS.addEventListener("click", function (e) {
        var el = eventTargetElement(e);
        if (!el) return;
        var bs = el.closest("[data-admin-edit-statute]");
        if (bs && bs._statute) {
          if (typeof window.saveStatuteEntryToFirestore !== "function") {
            window.alert("저장 함수를 찾지 못했습니다.");
            return;
          }
          openDictStatuteEditModal(bs._statute);
          return;
        }
        var pick = el.closest("[data-statute-key]");
        if (!pick || !pick.getAttribute("data-statute-key")) return;
        var key = pick.getAttribute("data-statute-key");
        var entries = getStatuteEntries();
        var found = null;
        for (var si = 0; si < entries.length; si++) {
          if (entries[si].key === key) {
            found = entries[si];
            break;
          }
        }
        if (found) {
          inpS.value = statuteDisplayTitle(found);
          runStatuteSearch();
        }
      });
    }

    var panelFav = document.getElementById("panel-fav");
    if (panelFav) {
      panelFav.addEventListener("click", function (e) {
        var el = eventTargetElement(e);
        if (!el) return;
        var bc = el.closest("[data-admin-edit-case]");
        if (bc && bc._case) {
          if (typeof window.saveCaseEntryToFirestore !== "function") {
            window.alert("저장 함수를 찾지 못했습니다.");
            return;
          }
          openDictCaseEditModal(bc._case);
          return;
        }
        var bt = el.closest("[data-admin-edit-term]");
        if (bt && bt._term) {
          openDictTermEditModal(bt._term);
          return;
        }
        var bs = el.closest("[data-admin-edit-statute]");
        if (bs && bs._statute) {
          if (typeof window.saveStatuteEntryToFirestore !== "function") {
            window.alert("저장 함수를 찾지 못했습니다.");
            return;
          }
          openDictStatuteEditModal(bs._statute);
        }
      });
    }

    bindDictCaseEditModal();
    bindDictTermEditModal();
    bindDictStatuteEditModal();
    bindAdminCaseCreate();
    bindAdminTermCreate();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      runTermSearch();
      runStatuteSearch();
      runCaseSearch();
    });
  } else {
    runTermSearch();
    runStatuteSearch();
    runCaseSearch();
  }

  function isLikelyCaseTagStr(s) {
    var raw = String(s || "").trim().replace(/^#/, "");
    var variants = [raw, raw.replace(/^판례/i, "").trim(), raw.replace(/^대법원?/i, "").trim()];
    for (var vi = 0; vi < variants.length; vi++) {
      var t = variants[vi];
      if (!t) continue;
      if (/헌재\s*\d{4}헌[가바마]\d+/i.test(t)) return true;
      if (/\d{2,4}\s*[가-힣]{1,3}\s*\d{2,7}/.test(t)) return true;
      if (/^\d{2,4}[가-힣]{1,3}\d{2,7}$/.test(t.replace(/\s/g, ""))) return true;
    }
    return false;
  }

  function findTermForTag(tag) {
    var t = String(tag || "").replace(/^#/, "").trim();
    if (!t) return null;
    var nq = norm(t);
    var list = searchTerms(t);
    for (var i = 0; i < list.length; i++) {
      if (norm(list[i].term || "") === nq) return list[i];
    }
    return list.length ? list[0] : null;
  }

  function findCaseForTag(tag) {
    var t = String(tag || "").replace(/^#/, "").trim();
    if (!t) return null;
    var list = searchCases(t);
    if (list.length) return list[0];
    var stripped = t.replace(/^판례/i, "").trim();
    if (stripped && stripped !== t) {
      list = searchCases(stripped);
      if (list.length) return list[0];
    }
    return null;
  }

  /** 찜 id(statute:…)·searchText로 조문 레코드 조회 */
  function findStatuteForKey(favId, searchText) {
    var DF = window.DictFavorites;
    var entries = getStatuteEntries();
    var fid = String(favId || "").trim();
    if (fid && DF && typeof DF.makeId === "function") {
      for (var i = 0; i < entries.length; i++) {
        var e = entries[i];
        if (DF.makeId("statute", e.key) === fid) return e;
      }
    }
    var keyGuess = "";
    if (fid.indexOf("statute:") === 0) keyGuess = fid.slice(8).trim();
    for (var j = 0; j < entries.length; j++) {
      if (keyGuess && entries[j].key === keyGuess) return entries[j];
    }
    var q = String(searchText || "").trim();
    if (!q) return null;
    var found = searchStatutes(q);
    return found.length ? found[0] : null;
  }

  window.DictionaryUI = {
    norm: norm,
    searchTerms: searchTerms,
    searchCases: searchCases,
    searchStatutes: searchStatutes,
    renderTermResults: renderTermResults,
    renderCaseResults: renderCaseResults,
    isLikelyCaseTag: isLikelyCaseTagStr,
    findTermForTag: findTermForTag,
    findCaseForTag: findCaseForTag,
    findStatuteForKey: findStatuteForKey,
    renderStatuteResults: renderStatuteResults,
    /** 용어사전 탭을 열 때·원격 데이터 갱신 후 목록을 다시 그릴 때 사용 */
    refreshTermSearch: runTermSearch,
    refreshStatuteSearch: runStatuteSearch,
    refreshCaseSearch: runCaseSearch,
    refreshPanelsIfOpen: function () {
      var pDict = document.getElementById("panel-dict");
      var pStat = document.getElementById("panel-statutes");
      var pCase = document.getElementById("panel-cases");
      if (pDict && !pDict.hidden) runTermSearch();
      if (pStat && !pStat.hidden) runStatuteSearch();
      if (pCase && !pCase.hidden) runCaseSearch();
    }
  };

  window.addEventListener("dict-remote-updated", function () {
    if (window.DictionaryUI && window.DictionaryUI.refreshPanelsIfOpen) {
      window.DictionaryUI.refreshPanelsIfOpen();
    }
  });
})();
