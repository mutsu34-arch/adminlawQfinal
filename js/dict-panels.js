(function () {
  /** 한글 가나다·영문 혼합 일관 정렬 (localeCompare("ko")만으로는 환경별 차이가 날 수 있음) */
  var KO_TERM_COLLATOR =
    typeof Intl !== "undefined" && typeof Intl.Collator === "function"
      ? new Intl.Collator("ko-KR", { sensitivity: "variant", numeric: true })
      : null;
  var selectedTermInitialFilter = "none";
  var selectedCaseYearFilter = "none";

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
    return dedupeCasesByCitationPreferRemote(a.concat(b)).filter(function (c) {
      return !(c && c.hidden);
    });
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
      appendCopyButtonRow(article, {
        label: "본문 복사",
        getText: function () {
          return String(s.body || "");
        }
      });
      appendDictionaryOxQuizSection(article, s.oxQuizzes, "조문 OX 퀴즈", 3);
      if (s.sourceNote && isAdminUser()) {
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
        if (s.sourceNote && isAdminUser()) {
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
      appendCopyButtonRow(article, {
        label: "전체 복사",
        getText: function () {
          return (
            "[조문] " +
            String(titleStr || "") +
            "\n[본문]\n" +
            String(s.body || "") +
            "\n[출처 메모]\n" +
            String(s.sourceNote || "") +
            "\n[OX 퀴즈]\n" +
            formatOxQuizzesForCopy(s.oxQuizzes)
          );
        }
      });
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
    if (list.length) markDictGuestUsage("statute", q);
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
      return extractCaseDecisionDateInfo(b).ts - extractCaseDecisionDateInfo(a).ts;
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
    var all = remote.concat(extra);
    all.sort(function (a, b) {
      return extractCaseDecisionDateInfo(b).ts - extractCaseDecisionDateInfo(a).ts;
    });
    return all;
  }

  function termInitialKey(termText) {
    var s = String(termText || "").trim();
    if (!s) return "#";
    var ch = s.charAt(0);
    var code = ch.charCodeAt(0);
    if (code >= 0xac00 && code <= 0xd7a3) {
      var CHO = ["ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅉ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"];
      return CHO[Math.floor((code - 0xac00) / 588)] || "#";
    }
    if (/[ㄱ-ㅎ]/.test(ch)) return ch;
    if (/[a-z]/i.test(ch)) return ch.toUpperCase();
    return "#";
  }

  function extractCaseDecisionDateInfo(c) {
    var citation = String((c && c.citation) || "");
    var m = citation.match(/((?:19|20)\d{2})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})/);
    var year = null;
    var ts = 0;
    if (m) {
      var y = parseInt(m[1], 10);
      var mo = parseInt(m[2], 10);
      var d = parseInt(m[3], 10);
      if (isFinite(y) && isFinite(mo) && isFinite(d)) {
        year = y;
        ts = new Date(y, Math.max(0, mo - 1), Math.max(1, d)).getTime();
      }
    } else {
      var yOnly = citation.match(/((?:19|20)\d{2})/);
      if (yOnly) {
        year = parseInt(yOnly[1], 10);
        if (isFinite(year)) ts = new Date(year, 0, 1).getTime();
      }
    }
    if (!ts) ts = caseCreatedMs(c);
    if (!year && ts) year = new Date(ts).getFullYear();
    return { year: year, ts: ts || 0 };
  }

  function isNoInfoCaseEntry(c) {
    var text = [
      c && c.citation,
      c && c.title,
      c && c.facts,
      c && c.issues,
      c && c.judgment
    ]
      .map(function (x) {
        return String(x || "");
      })
      .join(" ");
    return /정보\s*없음|찾을\s*수\s*없습니다/i.test(text);
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

    var termInitials = [];
    var initialSeen = {};
    terms.forEach(function (t) {
      var k = termInitialKey(t.term);
      if (initialSeen[k]) return;
      initialSeen[k] = true;
      termInitials.push(k);
    });
    termInitials.sort(function (a, b) {
      var ORDER = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";
      var ai = ORDER.indexOf(a);
      var bi = ORDER.indexOf(b);
      if (ai >= 0 && bi >= 0) return ai - bi;
      if (ai >= 0) return -1;
      if (bi >= 0) return 1;
      return a.localeCompare(b, "ko-KR");
    });
    if (selectedTermInitialFilter !== "none" && selectedTermInitialFilter !== "all" && !initialSeen[selectedTermInitialFilter]) {
      selectedTermInitialFilter = "none";
    }
    var filterRow = document.createElement("div");
    filterRow.className = "dict-term-index__list dict-term-index__filters";
    var bAll = document.createElement("button");
    bAll.type = "button";
    bAll.className =
      "btn btn--small dict-term-index__filter-btn " +
      (selectedTermInitialFilter === "all" ? "btn--secondary" : "btn--outline");
    bAll.textContent = "전체";
    bAll.addEventListener("click", function () {
      selectedTermInitialFilter = "all";
      renderGeneratedTermIndex(container, terms);
    });
    filterRow.appendChild(bAll);
    termInitials.forEach(function (ini) {
      var b = document.createElement("button");
      b.type = "button";
      b.className =
        "btn btn--small dict-term-index__filter-btn " +
        (selectedTermInitialFilter === ini ? "btn--secondary" : "btn--outline");
      b.textContent = ini;
      b.addEventListener("click", function () {
        selectedTermInitialFilter = ini;
        renderGeneratedTermIndex(container, terms);
      });
      filterRow.appendChild(b);
    });
    wrap.appendChild(filterRow);

    var filteredTerms = [];
    if (selectedTermInitialFilter === "all") {
      filteredTerms = terms.slice();
    } else if (selectedTermInitialFilter !== "none") {
      filteredTerms = terms.filter(function (t) {
        return termInitialKey(t.term) === selectedTermInitialFilter;
      });
    }

    if (selectedTermInitialFilter === "none") {
      var hint = document.createElement("p");
      hint.className = "dict-empty";
      hint.textContent = "초성 버튼을 누르면 해당 용어 목록이 표시됩니다.";
      wrap.appendChild(hint);
      container.appendChild(wrap);
      return;
    }

    var guest = isGuestViewer();
    var cap = guest ? Math.min(filteredTerms.length, dictGuestLimit()) : filteredTerms.length;
    var list = document.createElement("div");
    list.className = "dict-term-index__list";
    for (var i = 0; i < cap; i++) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn--small btn--outline dict-term-index__item";
      btn.setAttribute("data-term", filteredTerms[i].term);
      btn.textContent = filteredTerms[i].term;
      list.appendChild(btn);
    }
    wrap.appendChild(list);
    if (guest && filteredTerms.length > cap) {
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

    var nowYear = new Date().getFullYear();
    var RANGE_OPTIONS = [
      { id: "recent3", label: "최근 3년", years: 3 },
      { id: "recent5", label: "최근 5년", years: 5 },
      { id: "recent10", label: "최근 10년", years: 10 },
      { id: "recent15", label: "최근 15년", years: 15 },
      { id: "recent20", label: "최근 20년", years: 20 },
      { id: "all", label: "전부", years: null }
    ];
    var validFilter = {};
    RANGE_OPTIONS.forEach(function (x) {
      validFilter[x.id] = true;
    });
    if (selectedCaseYearFilter !== "none" && !validFilter[selectedCaseYearFilter]) selectedCaseYearFilter = "none";

    function inSelectedRange(c) {
      if (selectedCaseYearFilter === "all") return true;
      var opt = null;
      for (var i = 0; i < RANGE_OPTIONS.length; i++) {
        if (RANGE_OPTIONS[i].id === selectedCaseYearFilter) {
          opt = RANGE_OPTIONS[i];
          break;
        }
      }
      if (!opt || !opt.years) return true;
      var y = extractCaseDecisionDateInfo(c).year;
      if (!y) return false;
      return y >= nowYear - opt.years + 1;
    }
    var filterRow = document.createElement("div");
    filterRow.className = "dict-term-index__list dict-term-index__filters";
    RANGE_OPTIONS.forEach(function (opt) {
      var b = document.createElement("button");
      b.type = "button";
      b.className =
        "btn btn--small dict-term-index__filter-btn " +
        (selectedCaseYearFilter === opt.id ? "btn--secondary" : "btn--outline");
      b.textContent = opt.label;
      b.addEventListener("click", function () {
        selectedCaseYearFilter = opt.id;
        renderGeneratedCaseIndex(container, cases);
      });
      filterRow.appendChild(b);
    });
    wrap.appendChild(filterRow);

    var validCases = cases.filter(function (c) {
      return !isNoInfoCaseEntry(c);
    });
    var filteredCases = [];
    if (selectedCaseYearFilter === "all") {
      filteredCases = validCases.slice();
    } else if (selectedCaseYearFilter !== "none") {
      filteredCases = validCases.filter(inSelectedRange);
    }

    if (selectedCaseYearFilter === "none") {
      var hint = document.createElement("p");
      hint.className = "dict-empty";
      hint.textContent = "기간 토글 버튼을 누르면 해당 판례 목록이 표시됩니다.";
      wrap.appendChild(hint);
      container.appendChild(wrap);
      return;
    }

    var list = document.createElement("div");
    list.className = "dict-term-index__list";
    var guest = isGuestViewer();
    var cap = guest ? Math.min(filteredCases.length, dictGuestLimit()) : filteredCases.length;
    for (var i = 0; i < cap; i++) {
      var c = filteredCases[i];
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn--small btn--outline dict-term-index__item";
      var label = String(c.citation || "").trim() || String(c.title || "").trim() || "판례";
      btn.textContent = label;
      btn.dataset.caseCitation = String(c.citation || "").trim();
      list.appendChild(btn);
    }
    wrap.appendChild(list);
    if (guest && filteredCases.length > cap) {
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
    var exact = [];
    for (var ei = 0; ei < list.length; ei++) {
      var ec = list[ei];
      var citeNorm = norm(ec && ec.citation ? ec.citation : "");
      if (citeNorm && citeNorm === nq) exact.push(ec);
    }
    // 사건표기를 정확히 입력한 경우에는 해당 판례만 보여준다.
    if (exact.length) return exact;
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
    if (window.HANLAW_ADSENSE_OPEN_MODE) return false;
    var u = typeof window.getHanlawUser === "function" ? window.getHanlawUser() : null;
    return !(u && u.email);
  }

  function dictGuestLimit() {
    return 5;
  }

  var DICT_GUEST_USAGE_KEY = "hanlaw_dict_guest_usage_v1";
  var dictGuestUsageCache = null;

  function readDictGuestUsage() {
    if (dictGuestUsageCache) return dictGuestUsageCache;
    var fallback = { term: {}, statute: {}, case: {} };
    try {
      var raw = localStorage.getItem(DICT_GUEST_USAGE_KEY);
      if (!raw) {
        dictGuestUsageCache = fallback;
        return dictGuestUsageCache;
      }
      var parsed = JSON.parse(raw);
      dictGuestUsageCache = {
        term: parsed && parsed.term && typeof parsed.term === "object" ? parsed.term : {},
        statute: parsed && parsed.statute && typeof parsed.statute === "object" ? parsed.statute : {},
        case: parsed && parsed.case && typeof parsed.case === "object" ? parsed.case : {}
      };
      return dictGuestUsageCache;
    } catch (_) {
      dictGuestUsageCache = fallback;
      return dictGuestUsageCache;
    }
  }

  function saveDictGuestUsage() {
    try {
      localStorage.setItem(DICT_GUEST_USAGE_KEY, JSON.stringify(readDictGuestUsage()));
    } catch (_) {}
  }

  function markDictGuestUsage(kind, token) {
    if (!isGuestViewer()) return;
    var k = kind === "term" || kind === "statute" || kind === "case" ? kind : "term";
    var key = String(token || "").trim().toLowerCase();
    if (!key) return;
    var bag = readDictGuestUsage();
    if (!bag[k][key]) {
      bag[k][key] = Date.now();
      saveDictGuestUsage();
    }
  }

  function getDictGuestUsedCount(kind) {
    var k = kind === "term" || kind === "statute" || kind === "case" ? kind : "term";
    var bag = readDictGuestUsage();
    return Math.min(dictGuestLimit(), Object.keys(bag[k] || {}).length);
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
    var limit = dictGuestLimit();
    var used = getDictGuestUsedCount(kind);
    var remaining = Math.max(0, limit - used);
    el.hidden = false;
    el.textContent =
      "[무료 체험 중] 비회원은 " +
      label +
      "을 최대 " +
      limit +
      "회 체험할 수 있습니다. 현재 " +
      remaining +
      "회 남았습니다.";
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

  function enableMarkdownBoldShortcut(el) {
    if (!el || el._hanlawBoldBound) return;
    el._hanlawBoldBound = true;
    el.addEventListener("keydown", function (ev) {
      var isBoldHotkey = (ev.ctrlKey || ev.metaKey) && !ev.altKey && String(ev.key || "").toLowerCase() === "b";
      if (!isBoldHotkey) return;
      if (el.readOnly || el.disabled) return;
      ev.preventDefault();
      var start = typeof el.selectionStart === "number" ? el.selectionStart : 0;
      var end = typeof el.selectionEnd === "number" ? el.selectionEnd : start;
      var v = String(el.value || "");
      var picked = v.slice(start, end);
      if (picked) {
        el.value = v.slice(0, start) + "**" + picked + "**" + v.slice(end);
        el.setSelectionRange(start + 2, end + 2);
      } else {
        el.value = v.slice(0, start) + "****" + v.slice(end);
        el.setSelectionRange(start + 2, start + 2);
      }
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
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
    if (!isAdminUser()) return;
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
    if (!isAdminUser()) return;
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
    var del = $("dict-case-edit-delete");
    var aiFill = $("dict-case-edit-ai-fill");
    [
      "dict-case-edit-citation",
      "dict-case-edit-title",
      "dict-case-edit-facts",
      "dict-case-edit-issues",
      "dict-case-edit-judgment",
      "dict-case-edit-full-text",
      "dict-case-edit-search-keys",
      "dict-case-edit-topic-keywords"
    ].forEach(function (id) {
      enableMarkdownBoldShortcut($(id));
    });
    if (dec) dec.addEventListener("click", closeDictCaseEditModal);
    if (dex) dex.addEventListener("click", closeDictCaseEditModal);
    if (del) {
      del.addEventListener("click", function () {
        if (!isAdminUser()) {
          setDictCaseEditMsg("관리자만 삭제할 수 있습니다.", true);
          return;
        }
        if (dictCaseEditSaving) return;
        if (typeof window.deleteCaseEntryFromFirestore !== "function") {
          setDictCaseEditMsg("삭제 함수를 찾지 못했습니다.", true);
          return;
        }
        var modal = $("dict-case-edit-modal");
        var docId = modal && modal.dataset ? String(modal.dataset.docId || "").trim() : "";
        var citation = String(($("dict-case-edit-citation") && $("dict-case-edit-citation").value) || "").trim();
        if (!docId && !citation) {
          setDictCaseEditMsg("삭제할 판례 식별자를 찾지 못했습니다.", true);
          return;
        }
        if (!docId) {
          if (!citation) {
            setDictCaseEditMsg("삭제할 판례 식별자를 찾지 못했습니다.", true);
            return;
          }
          if (typeof window.softHideBundledCaseEntry !== "function") {
            setDictCaseEditMsg("번들 판례 숨김 함수를 찾지 못했습니다.", true);
            return;
          }
          if (!window.confirm("이 앱 기본(번들) 판례를 목록에서 숨길까요? (soft delete)")) return;
          dictCaseEditSaving = true;
          del.disabled = true;
          setDictCaseEditMsg("숨김 처리 중...", false);
          window
            .softHideBundledCaseEntry(citation)
            .then(function () {
              closeDictCaseEditModal();
              runCaseSearch();
            })
            .catch(function (err) {
              setDictCaseEditMsg((err && err.message) || "번들 판례 숨김 처리에 실패했습니다.", true);
            })
            .then(function () {
              dictCaseEditSaving = false;
              del.disabled = false;
            });
          return;
        }
        if (!window.confirm("이 판례 항목을 삭제할까요?")) return;
        dictCaseEditSaving = true;
        del.disabled = true;
        setDictCaseEditMsg("삭제 중...", false);
        window
          .deleteCaseEntryFromFirestore(docId, { rawDocId: true })
          .then(function () {
            closeDictCaseEditModal();
            runCaseSearch();
          })
          .catch(function (err) {
            setDictCaseEditMsg((err && err.message) || "판례 삭제에 실패했습니다.", true);
          })
          .then(function () {
            dictCaseEditSaving = false;
            del.disabled = false;
          });
      });
    }
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
        if (!isAdminUser()) {
          setDictCaseEditMsg("관리자만 저장할 수 있습니다.", true);
          return;
        }
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
    var btnCleanInvalid = $("dict-case-clean-invalid");
    var btnRestoreHidden = $("dict-case-restore-hidden");
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

    function parseCaseCitationsFromField() {
      var raw = String(($("dict-case-create-citation") && $("dict-case-create-citation").value) || "").trim();
      if (!raw) return [];
      var parts = raw
        .split(/[,，;#|/\n\r]+/g)
        .map(function (x) {
          return String(x || "").trim();
        })
        .filter(Boolean);
      var out = [];
      var seen = {};
      for (var i = 0; i < parts.length; i++) {
        var t = parts[i];
        if (!t) continue;
        if (t.length > 400) t = t.slice(0, 400);
        if (seen[t]) continue;
        seen[t] = true;
        out.push(t);
      }
      return out;
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

    if (btnCleanInvalid) {
      btnCleanInvalid.addEventListener("click", function () {
        if (!isAdminUser()) {
          setDictCaseCreateMsg("관리자만 사용할 수 있습니다.", true);
          return;
        }
        if (typeof window.deleteCaseEntryFromFirestore !== "function") {
          setDictCaseCreateMsg("판례 삭제 함수를 찾지 못했습니다.", true);
          return;
        }
        var remoteCases = window.LEGAL_CASES_REMOTE || [];
        var targets = remoteCases.filter(function (c) {
          return c && c._docId && isNoInfoCaseEntry(c);
        });
        if (!targets.length) {
          setDictCaseCreateMsg("삭제할 '정보 없음' 판례가 없습니다.", false);
          return;
        }
        if (!window.confirm("'정보 없음' 판례 " + targets.length + "건을 일괄 삭제할까요?")) return;
        btnCleanInvalid.disabled = true;
        setDictCaseCreateMsg("'정보 없음' 판례 일괄 삭제 중... (0/" + targets.length + ")", false);
        var done = 0;
        var fail = 0;
        var chain = Promise.resolve();
        targets.forEach(function (c) {
          chain = chain.then(function () {
            return window
              .deleteCaseEntryFromFirestore(c._docId, { rawDocId: true })
              .catch(function () {
                fail += 1;
                return null;
              })
              .then(function () {
                done += 1;
                setDictCaseCreateMsg(
                  "'정보 없음' 판례 일괄 삭제 중... (" + done + "/" + targets.length + ")",
                  false
                );
              });
          });
        });
        chain
          .then(function () {
            setDictCaseCreateMsg(
              "'정보 없음' 판례 삭제 완료: 성공 " + (targets.length - fail) + "건, 실패 " + fail + "건",
              fail > 0
            );
            runCaseSearch();
          })
          .finally(function () {
            btnCleanInvalid.disabled = false;
          });
      });
    }

    if (btnRestoreHidden) {
      btnRestoreHidden.addEventListener("click", function () {
        if (!isAdminUser()) {
          setDictCaseCreateMsg("관리자만 사용할 수 있습니다.", true);
          return;
        }
        if (typeof window.restoreHiddenBundledCases !== "function") {
          setDictCaseCreateMsg("숨김 판례 복구 함수를 찾지 못했습니다.", true);
          return;
        }
        if (!window.confirm("숨김 처리된 판례를 모두 복구할까요?")) return;
        btnRestoreHidden.disabled = true;
        setDictCaseCreateMsg("숨김 판례 복구 중...", false);
        window
          .restoreHiddenBundledCases()
          .then(function (res) {
            var total = res && typeof res.total === "number" ? res.total : 0;
            var restored = res && typeof res.restored === "number" ? res.restored : 0;
            var failed = res && typeof res.failed === "number" ? res.failed : 0;
            setDictCaseCreateMsg(
              "숨김 판례 복구 완료: 대상 " + total + "건, 복구 " + restored + "건, 실패 " + failed + "건",
              failed > 0
            );
            runCaseSearch();
          })
          .catch(function (err) {
            setDictCaseCreateMsg((err && err.message) || "숨김 판례 복구에 실패했습니다.", true);
          })
          .then(function () {
            btnRestoreHidden.disabled = false;
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
      var citations = parseCaseCitationsFromField();
      var fullText = String(($("dict-case-create-fulltext") && $("dict-case-create-fulltext").value) || "").trim();
      if (!citations.length) {
        setDictCaseCreateMsg("사건 표기/사건번호를 입력해 주세요.", true);
        return;
      }
      if (citations.length > 500) {
        setDictCaseCreateMsg("한 번에 최대 500개 사건까지 순차 생성할 수 있습니다.", true);
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
      var region = window.FIREBASE_FUNCTIONS_REGION || "asia-northeast3";
      var fn = firebase.app().functions(region).httpsCallable("generateOrGetDictionaryEntry");

      if (citations.length > 1) {
        if (fullText) {
          setDictCaseCreateMsg(
            "여러 사건을 순차 생성할 때는 판결문 전문 입력을 사용하지 않습니다. (사건번호 기반 생성으로 진행)",
            false
          );
        }
        hideCaseCreateOxPanel();
        var okCount = 0;
        var failCount = 0;
        var firstFail = "";
        var chainMulti = Promise.resolve();
        citations.forEach(function (citation, i) {
          chainMulti = chainMulti.then(function () {
            setDictCaseCreateMsg(
              "판례사전 순차 생성 중 (" + (i + 1) + "/" + citations.length + ") · " + citation,
              false
            );
            return fn({ tag: citation, caseFullText: "" })
              .then(function (res) {
                var d = res && res.data;
                if (!d || !d.ok || d.kind !== "case" || !d.record) {
                  throw new Error("판례 생성 결과를 가져오지 못했습니다.");
                }
                okCount += 1;
              })
              .catch(function (err) {
                failCount += 1;
                if (!firstFail) firstFail = citation + ": " + ((err && err.message) || "실패");
                return null;
              });
          });
        });
        chainMulti
          .then(function () {
            var msg = "판례사전 생성 완료: 성공 " + okCount + "건";
            if (failCount) msg += ", 실패 " + failCount + "건";
            if (firstFail) msg += " (예: " + firstFail + ")";
            msg += " · 생성된 항목은 검수·승인 탭에서 확인·일괄 승인할 수 있습니다.";
            setDictCaseCreateMsg(msg, failCount > 0 && okCount === 0);
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
            setDictCaseCreateMsg((err && err.message) || "판례사전 순차 생성에 실패했습니다.", true);
          })
          .then(function () {
            btn.disabled = false;
          });
        return;
      }

      setDictCaseCreateMsg(
        fullText
          ? "판례사전 생성 중입니다... (입력한 판결문 기반 · 검수 대기 등록)"
          : "판례사전 생성 중입니다... (웹에서 판결문 자동 확인 시도 후 검수 대기 등록)",
        false
      );
      var citation = citations[0];
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
    var btnBatch = $("dict-term-create-run-batch");
    var btnExcel = $("dict-term-create-upload-excel");
    var excelFileEl = $("dict-term-create-excel-file");
    var MAX_TERM_KEYWORDS = 500;

    function parseTermKeywordsFromField() {
      var raw = String(($("dict-term-create-tag") && $("dict-term-create-tag").value) || "").trim();
      if (!raw) return [];
      var parts = raw
        .split(/[,，;#|/\n\r]+/g)
        .map(function (x) {
          return String(x || "").trim();
        })
        .filter(Boolean);
      var seen = {};
      var out = [];
      for (var i = 0; i < parts.length; i++) {
        var t = parts[i].replace(/^#+/, "").trim();
        if (!t) continue;
        if (t.length > 160) t = t.slice(0, 160);
        if (seen[t]) continue;
        seen[t] = true;
        out.push(t);
      }
      return out;
    }

    if (!btn) return;
    btn.addEventListener("click", function () {
      if (!isAdminUser()) {
        setDictTermCreateMsg("관리자만 사용할 수 있습니다.", true);
        return;
      }
      var tags = parseTermKeywordsFromField();
      if (!tags.length) {
        setDictTermCreateMsg("용어·키워드를 1개 이상 입력해 주세요. (여러 개는 쉼표로 구분)", true);
        return;
      }
      if (tags.length > MAX_TERM_KEYWORDS) {
        setDictTermCreateMsg("한 번에 최대 " + MAX_TERM_KEYWORDS + "개 키워드까지 순차 생성할 수 있습니다.", true);
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
      var region = window.FIREBASE_FUNCTIONS_REGION || "asia-northeast3";
      var fn = firebase.app().functions(region).httpsCallable("generateOrGetDictionaryEntry");
      var lastSaved = null;
      var failures = [];
      var chain = Promise.resolve();
      tags.forEach(function (tag, i) {
        chain = chain.then(function () {
          setDictTermCreateMsg(
            "용어 생성 중 (" + (i + 1) + "/" + tags.length + ") · " + tag,
            false
          );
          return fn({ tag: tag })
            .then(function (res) {
              var d = res && res.data;
              if (!d || !d.ok || d.kind !== "term" || !d.record) {
                throw new Error("용어 생성 결과를 가져오지 못했습니다.");
              }
              var rec = d.record || {};
              return window.saveTermEntryToFirestore(rec).then(function () {
                lastSaved = rec;
                return rec;
              });
            })
            .catch(function (err) {
              failures.push(tag + ": " + ((err && err.message) || "실패"));
              return null;
            });
        });
      });
      chain
        .then(function () {
          var input = $("dict-term-query");
          if (input && lastSaved && lastSaved.term) {
            input.value = String(lastSaved.term).trim();
          } else if (input && tags.length) {
            input.value = tags[tags.length - 1];
          }
          runTermSearch();
          var ok = tags.length - failures.length;
          var msg =
            ok +
            "/" +
            tags.length +
            "건 용어사전 생성·저장을 마쳤습니다." +
            (tags.length > 1 ? " (순차 처리)" : "");
          if (failures.length) {
            msg += " 실패 " + failures.length + "건: " + failures.slice(0, 3).join(" · ");
            if (failures.length > 3) msg += " …";
          }
          setDictTermCreateMsg(msg, failures.length === tags.length);
        })
        .catch(function (err) {
          setDictTermCreateMsg((err && err.message) || "용어사전 생성에 실패했습니다.", true);
        })
        .then(function () {
          btn.disabled = false;
        });
    });

    if (btnBatch) {
      btnBatch.addEventListener("click", function () {
        if (!isAdminUser()) {
          setDictTermCreateMsg("관리자만 사용할 수 있습니다.", true);
          return;
        }
        var prompt = String(($("dict-term-create-prompt") && $("dict-term-create-prompt").value) || "").trim();
        var count = parseInt(($("dict-term-create-count") && $("dict-term-create-count").value) || "", 10);
        if (!prompt) {
          setDictTermCreateMsg("자동 생성 지시를 입력해 주세요.", true);
          return;
        }
        if (!Number.isFinite(count) || count < 1 || count > 30) {
          setDictTermCreateMsg("자동 생성 개수는 1~30 사이여야 합니다.", true);
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
        var tags = parseTermKeywordsFromField();
        if (tags.length > MAX_TERM_KEYWORDS) {
          setDictTermCreateMsg("키워드는 최대 " + MAX_TERM_KEYWORDS + "개까지 자동 생성에 사용할 수 있습니다.", true);
          return;
        }
        btnBatch.disabled = true;
        var region = window.FIREBASE_FUNCTIONS_REGION || "asia-northeast3";
        var fn = firebase.app().functions(region).httpsCallable("adminGenerateTermsFromLibrary");

        function afterBatchSuccess(totalOk, failRows) {
          var msg = totalOk + "건을 용어사전 검수 대기에 등록했습니다.";
          if (failRows.length) msg += " 형식 실패 " + failRows.length + "건.";
          if (tags.length > 1) msg += " (" + tags.length + "개 키워드 순차 처리)";
          setDictTermCreateMsg(msg + " 검수·승인 탭에서 최종 승인하세요.", false);
          var adminTab = $("admin-tab-review");
          var reviewTypeTerm = $("admin-review-type-term");
          if (adminTab && typeof adminTab.click === "function") adminTab.click();
          if (reviewTypeTerm && typeof reviewTypeTerm.click === "function") reviewTypeTerm.click();
          if (typeof window.loadAdminReviewQueue === "function") {
            window.setTimeout(function () {
              window.loadAdminReviewQueue();
            }, 0);
          }
        }

        if (!tags.length) {
          setDictTermCreateMsg("자료실 기반 용어 자동 생성 중… (검수 대기 등록)", false);
          fn({ prompt: prompt, count: count })
            .then(function (res) {
              var d = res && res.data ? res.data : {};
              var okCount = parseInt(d.okCount, 10) || 0;
              var failRows = Array.isArray(d.failRows) ? d.failRows : [];
              afterBatchSuccess(okCount, failRows);
            })
            .catch(function (err) {
              setDictTermCreateMsg((err && err.message) || "자동 생성에 실패했습니다.", true);
            })
            .then(function () {
              btnBatch.disabled = false;
            });
          return;
        }

        var totalOk = 0;
        var allFailRows = [];
        var chain = Promise.resolve();
        tags.forEach(function (kw, i) {
          chain = chain.then(function () {
            setDictTermCreateMsg(
              "자동 생성 중 (" + (i + 1) + "/" + tags.length + ") · " + kw + " … (검수 대기 등록)",
              false
            );
            var scopedPrompt = "[용어·키워드: " + kw + "]\n" + prompt;
            return fn({ prompt: scopedPrompt, count: count }).then(function (res) {
              var d = res && res.data ? res.data : {};
              totalOk += parseInt(d.okCount, 10) || 0;
              if (Array.isArray(d.failRows)) {
                allFailRows = allFailRows.concat(d.failRows);
              }
            });
          });
        });
        chain
          .then(function () {
            afterBatchSuccess(totalOk, allFailRows);
          })
          .catch(function (err) {
            setDictTermCreateMsg((err && err.message) || "자동 생성에 실패했습니다.", true);
          })
          .then(function () {
            btnBatch.disabled = false;
          });
      });
    }

    function normHeaderKey(k) {
      return String(k == null ? "" : k).replace(/^\uFEFF/, "").trim().toLowerCase().replace(/\s/g, "");
    }

    function splitComma(v) {
      var s = String(v == null ? "" : v).trim();
      if (!s) return [];
      return s
        .split(/[,;#]/g)
        .map(function (x) { return String(x || "").trim(); })
        .filter(Boolean);
    }

    function parseBoolCell(v) {
      if (v === true || v === false) return v;
      var s = String(v == null ? "" : v).trim().toUpperCase();
      if (!s) return null;
      if (s === "O" || s === "TRUE" || s === "Y" || s === "1" || s === "참") return true;
      if (s === "X" || s === "FALSE" || s === "N" || s === "0" || s === "거짓") return false;
      return null;
    }

    function parseOxSet(mapped, maxItems) {
      var out = [];
      for (var i = 1; i <= maxItems; i++) {
        var st = String(mapped["ox" + i + "_statement"] || "").trim();
        var ans = parseBoolCell(mapped["ox" + i + "_answer"]);
        var ex = String(mapped["ox" + i + "_explanation"] || "").trim();
        if (!st && ans == null && !ex) continue;
        if (!st || ans == null || !ex) continue;
        out.push({ statement: st, answer: ans, explanation: ex, explanationBasic: ex });
      }
      return out;
    }

    function parseWorkbookToTerms(buffer) {
      if (typeof XLSX === "undefined") throw new Error("엑셀 라이브러리(xlsx)를 불러오지 못했습니다.");
      var wb = XLSX.read(buffer, { type: "array" });
      if (!wb.SheetNames || !wb.SheetNames.length) throw new Error("시트가 없습니다.");
      var first = wb.Sheets[wb.SheetNames[0]];
      var rows = XLSX.utils.sheet_to_json(first, { defval: "", raw: false });
      var out = [];
      var headerToField = {
        term: "term",
        용어: "term",
        aliases: "aliases",
        동의어: "aliases",
        별칭: "aliases",
        definition: "definition",
        정의: "definition",
        설명: "definition"
      };
      for (var i = 0; i < rows.length; i++) {
        var raw = rows[i] || {};
        var mapped = {};
        Object.keys(raw).forEach(function (k) {
          var nk = normHeaderKey(k);
          var field = headerToField[nk] || null;
          if (!field && /^ox[1-9]_(statement|answer|explanation)$/.test(nk)) field = nk;
          if (!field) return;
          mapped[field] = raw[k];
        });
        var term = String(mapped.term || "").trim();
        var definition = String(mapped.definition || "").trim();
        if (!term && !definition) continue;
        if (!term || !definition) {
          throw new Error(i + 2 + "번째 행: term/definition은 필수입니다.");
        }
        out.push({
          term: term,
          definition: definition,
          aliases: splitComma(mapped.aliases),
          oxQuizzes: parseOxSet(mapped, 3)
        });
      }
      return out;
    }

    if (btnExcel && excelFileEl) {
      btnExcel.addEventListener("click", function () {
        if (!isAdminUser()) {
          setDictTermCreateMsg("관리자만 사용할 수 있습니다.", true);
          return;
        }
        var file = excelFileEl.files && excelFileEl.files[0];
        if (!file) {
          setDictTermCreateMsg("엑셀 파일(.xlsx/.xls)을 선택해 주세요.", true);
          return;
        }
        var lower = String(file.name || "").toLowerCase();
        if (lower.indexOf(".xlsx") === -1 && lower.indexOf(".xls") === -1) {
          setDictTermCreateMsg("엑셀 파일(.xlsx/.xls)만 업로드할 수 있습니다.", true);
          return;
        }
        if (typeof window.adminStageDictBatch !== "function") {
          setDictTermCreateMsg("사전 스테이징 함수를 찾지 못했습니다. Functions 배포를 확인해 주세요.", true);
          return;
        }
        btnExcel.disabled = true;
        setDictTermCreateMsg("엑셀 파싱 중…", false);
        var reader = new FileReader();
        reader.onload = function () {
          var rows = [];
          try {
            rows = parseWorkbookToTerms(new Uint8Array(reader.result));
          } catch (e) {
            setDictTermCreateMsg((e && e.message) || "엑셀 파싱에 실패했습니다.", true);
            btnExcel.disabled = false;
            return;
          }
          if (!rows.length) {
            setDictTermCreateMsg("유효한 데이터 행이 없습니다. 엑셀 형식을 확인해 주세요.", true);
            btnExcel.disabled = false;
            return;
          }
          setDictTermCreateMsg(rows.length + "건 검수 대기 등록 중…", false);
          window.adminStageDictBatch("term", rows)
            .then(function (res) {
              var okCount = parseInt(res && res.okCount, 10) || 0;
              var failRows = (res && res.failRows) || [];
              var msg = "용어사전 " + okCount + "건을 검수 대기에 등록했습니다.";
              if (failRows.length) msg += " 실패 " + failRows.length + "건.";
              setDictTermCreateMsg(msg + " 검수·승인 탭에서 최종 승인하세요.", false);
              excelFileEl.value = "";
              var adminTab = $("admin-tab-review");
              var reviewTypeTerm = $("admin-review-type-term");
              if (adminTab && typeof adminTab.click === "function") adminTab.click();
              if (reviewTypeTerm && typeof reviewTypeTerm.click === "function") reviewTypeTerm.click();
              if (typeof window.loadAdminReviewQueue === "function") {
                window.setTimeout(function () {
                  window.loadAdminReviewQueue();
                }, 0);
              }
            })
            .catch(function (err) {
              setDictTermCreateMsg((err && err.message) || "엑셀 업로드에 실패했습니다.", true);
            })
            .then(function () {
              btnExcel.disabled = false;
            });
        };
        reader.onerror = function () {
          setDictTermCreateMsg("파일을 읽지 못했습니다.", true);
          btnExcel.disabled = false;
        };
        reader.readAsArrayBuffer(file);
      });
    }
  }

  function bindDictTermEditModal() {
    var dem = $("dict-term-edit-modal");
    ["dict-term-edit-term", "dict-term-edit-aliases", "dict-term-edit-definition"].forEach(function (id) {
      enableMarkdownBoldShortcut($(id));
    });
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
        if (!isAdminUser()) {
          setDictTermEditMsg("관리자만 저장할 수 있습니다.", true);
          return;
        }
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

  function setDictStatuteEditMsg(text, isError, asHtml) {
    var el = $("dict-statute-edit-msg");
    if (!el) return;
    if (!text) {
      el.textContent = "";
      el.hidden = true;
      el.classList.remove("admin-msg--error");
      return;
    }
    if (asHtml) el.innerHTML = text;
    else el.textContent = text;
    el.hidden = false;
    el.classList.toggle("admin-msg--error", !!isError);
  }

  function parseStatuteBodySections(raw) {
    var src = String(raw || "").replace(/\r\n/g, "\n");
    var out = {
      bodyMain: src.trim(),
      appliedRules: "",
      subordinateRules: ""
    };
    if (!src.trim()) return out;
    var mkApplied = src.match(/(?:^|\n)(?:##\s*)?\[?준용\s*규정\]?\s*\n([\s\S]*?)(?=\n(?:##\s*)?\[?하위\s*법령\]?|\n(?:##\s*)?\[?수험\s*포인트\]?|$)/i);
    var mkSub = src.match(/(?:^|\n)(?:##\s*)?\[?하위\s*법령\]?\s*\n([\s\S]*?)(?=\n(?:##\s*)?\[?수험\s*포인트\]?|$)/i);
    if (mkApplied && mkApplied[1]) out.appliedRules = String(mkApplied[1]).trim();
    if (mkSub && mkSub[1]) out.subordinateRules = String(mkSub[1]).trim();
    var stripped = src
      .replace(/(?:^|\n)(?:##\s*)?\[?준용\s*규정\]?\s*\n[\s\S]*?(?=\n(?:##\s*)?\[?하위\s*법령\]?|\n(?:##\s*)?\[?수험\s*포인트\]?|$)/gi, "\n")
      .replace(/(?:^|\n)(?:##\s*)?\[?하위\s*법령\]?\s*\n[\s\S]*?(?=\n(?:##\s*)?\[?수험\s*포인트\]?|$)/gi, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    if (stripped) out.bodyMain = stripped;
    return out;
  }

  function composeStatuteBodyForSave(bodyMain, appliedRules, subordinateRules) {
    var parts = [];
    var main = String(bodyMain || "").trim();
    var ap = String(appliedRules || "").trim();
    var sub = String(subordinateRules || "").trim();
    if (main) parts.push(main);
    if (ap) parts.push("[준용 규정]\n" + ap);
    if (sub) parts.push("[하위 법령]\n" + sub);
    return parts.join("\n\n").trim();
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function normalizeFetchReasonTag(reason) {
    var low = String(reason || "").toLowerCase();
    if (!low) return "실패";
    if (low.indexOf("timeout") >= 0) return "타임아웃";
    if (low.indexOf("http 401") >= 0 || low.indexOf("http 403") >= 0) return "접근거부";
    if (low.indexOf("http 404") >= 0) return "404";
    if (low.indexOf("http 5") >= 0) return "서버오류";
    if (low.indexOf("본문 없음") >= 0 || low.indexOf("empty") >= 0) return "본문없음";
    if (low.indexOf("econnreset") >= 0 || low.indexOf("socket hang up") >= 0) return "연결끊김";
    if (low.indexOf("enotfound") >= 0 || low.indexOf("dns") >= 0) return "도메인오류";
    return "요청실패";
  }

  function buildFetchSummaryHtml(fetchSummary) {
    var fs = fetchSummary || {};
    var attempted = parseInt(fs.attempted, 10) || 0;
    var succeeded = parseInt(fs.succeeded, 10) || 0;
    var rows = Array.isArray(fs.results) ? fs.results : [];
    var failed = [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i] || {};
      if (r.ok) continue;
      var url = String(r.url || "").trim();
      var reason = String(r.reason || "원인 미상").trim();
      if (!url) continue;
      var tag = normalizeFetchReasonTag(reason);
      failed.push(
        '<span class="admin-msg-badge">' +
          escapeHtml(tag) +
          "</span> " +
          '<span class="admin-msg-url">' +
          escapeHtml(url) +
          "</span>" +
          '<span class="admin-msg-reason">(' +
          escapeHtml(reason) +
          ")</span>"
      );
    }
    var msg =
      '<span class="admin-msg-main">조문 초안을 폼에 채웠습니다. (법령검색 수집 ' +
      succeeded +
      "/" +
      attempted +
      " 성공)</span>";
    if (failed.length) {
      var maxShow = 3;
      var shown = failed.slice(0, maxShow);
      var remain = failed.length - shown.length;
      msg += '<div class="admin-msg-fail-list">실패: ' + shown.join(" · ");
      if (remain > 0) {
        msg += ' · <span class="admin-msg-reason">외 ' + remain + "건</span>";
      }
      msg += "</div>";
    }
    msg += '<span class="admin-msg-main">검토 후 저장하면 반영됩니다.</span>';
    return msg;
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
    if (!isAdminUser()) return;
    var m = $("dict-statute-edit-modal");
    if (!m || !s) return;
    var keyEl = $("dict-statute-edit-key");
    if (keyEl) keyEl.value = s.key || "";
    var hEl = $("dict-statute-edit-heading");
    if (hEl) hEl.value = s.heading || "";
    var bEl = $("dict-statute-edit-body");
    var parsedBody = parseStatuteBodySections(s.body || "");
    if (bEl) bEl.value = parsedBody.bodyMain || "";
    var apEl = $("dict-statute-edit-applied-rules");
    if (apEl) apEl.value = parsedBody.appliedRules || "";
    var subEl = $("dict-statute-edit-subordinate-rules");
    if (subEl) subEl.value = parsedBody.subordinateRules || "";
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
        if (!isAdminUser()) {
          setDictStatuteEditMsg("관리자만 저장할 수 있습니다.", true);
          return;
        }
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
              body: composeStatuteBodyForSave(
                ($("dict-statute-edit-body") && $("dict-statute-edit-body").value) || "",
                ($("dict-statute-edit-applied-rules") && $("dict-statute-edit-applied-rules").value) || "",
                ($("dict-statute-edit-subordinate-rules") &&
                  $("dict-statute-edit-subordinate-rules").value) ||
                  ""
              ),
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
    var btnAiFill = $("dict-statute-edit-ai-fill");
    if (btnAiFill) {
      btnAiFill.addEventListener("click", function () {
        var modal = $("dict-statute-edit-modal");
        var sk =
          modal && modal.dataset && modal.dataset.statuteKey
            ? String(modal.dataset.statuteKey).trim()
            : "";
        var headingHint = String(
          ($("dict-statute-edit-heading") && $("dict-statute-edit-heading").value) || ""
        ).trim();
        var bodyHint = String(($("dict-statute-edit-body") && $("dict-statute-edit-body").value) || "").trim();
        if (!sk) {
          setDictStatuteEditMsg("조문 키가 있어야 자동 생성할 수 있습니다.", true);
          return;
        }
        if (typeof window.generateDictStatuteFromWeb !== "function") {
          setDictStatuteEditMsg("조문 자동 생성 함수를 불러오지 못했습니다. 페이지를 새로고침해 주세요.", true);
          return;
        }
        btnAiFill.disabled = true;
        setDictStatuteEditMsg(
          "AI가 조문·준용규정·하위법령을 검색해 생성 중입니다… (수십 초 소요될 수 있습니다)",
          false
        );
        window
          .generateDictStatuteFromWeb({
            statuteKey: sk,
            headingHint: headingHint,
            bodyHint: bodyHint
          })
          .then(function (data) {
            var entry = data && data.entry ? data.entry : null;
            if (!entry) throw new Error("조문 생성 결과를 받지 못했습니다.");
            var hEl = $("dict-statute-edit-heading");
            var bEl = $("dict-statute-edit-body");
            var apEl = $("dict-statute-edit-applied-rules");
            var subEl = $("dict-statute-edit-subordinate-rules");
            var sEl = $("dict-statute-edit-source-note");
            var parsedAi = parseStatuteBodySections(entry.body || "");
            if (hEl) hEl.value = entry.heading || hEl.value || "";
            if (bEl) bEl.value = parsedAi.bodyMain || bEl.value || "";
            if (apEl) apEl.value = entry.appliedRules || parsedAi.appliedRules || "";
            if (subEl) subEl.value = entry.subordinateRules || parsedAi.subordinateRules || "";
            if (sEl) sEl.value = entry.sourceNote || sEl.value || "";
            if (window.CaseOxForm && typeof window.CaseOxForm.fill === "function") {
              window.CaseOxForm.ensureBuilt("dict-statute-edit-ox-editor");
              window.CaseOxForm.fill("dict-statute-edit-ox-editor", entry.oxQuizzes || []);
            }
            var fs = entry.fetchSummary || {};
            setDictStatuteEditMsg(buildFetchSummaryHtml(fs), false, true);
          })
          .catch(function (err) {
            setDictStatuteEditMsg((err && err.message) || "조문 자동 생성에 실패했습니다.", true);
          })
          .then(function () {
            btnAiFill.disabled = false;
          });
      });
    }
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

  function copyTextToClipboard(text) {
    var t = String(text || "");
    if (!t.trim()) return Promise.reject(new Error("복사할 내용이 없습니다."));
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(t);
    }
    var ta = document.createElement("textarea");
    ta.value = t;
    ta.setAttribute("readonly", "readonly");
    ta.style.position = "fixed";
    ta.style.top = "-1000px";
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try {
      ok = document.execCommand("copy");
    } catch (_) {
      ok = false;
    }
    document.body.removeChild(ta);
    return ok ? Promise.resolve() : Promise.reject(new Error("복사 실패"));
  }

  function formatOxQuizzesForCopy(oxQuizzes) {
    var rows = Array.isArray(oxQuizzes) ? oxQuizzes : [];
    if (!rows.length) return "";
    var out = [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i] || {};
      out.push(
        "문항 " +
          (i + 1) +
          "\n- 지문: " +
          String(r.statement || "").trim() +
          "\n- 정답: " +
          (r.answer === true ? "O(참)" : "X(거짓)") +
          "\n- 해설: " +
          String(r.explanation || "").trim()
      );
    }
    return out.join("\n\n");
  }

  function appendCopyButtonRow(article, options) {
    if (!article || !options || !options.getText) return;
    if (!isAdminUser()) return;
    var nav = document.createElement("div");
    nav.className = "dict-card-nav";
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn--ghost btn--small";
    btn.textContent = options.label || "복사";
    btn.addEventListener("click", function () {
      copyTextToClipboard(options.getText())
        .then(function () {
          var old = btn.textContent;
          btn.textContent = "복사됨";
          window.setTimeout(function () {
            btn.textContent = old;
          }, 1200);
        })
        .catch(function () {
          window.alert("복사에 실패했습니다.");
        });
    });
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
      appendCopyButtonRow(article, {
        label: "정의 복사",
        getText: function () {
          return String(t.definition || "");
        }
      });
      appendDictionaryOxQuizSection(article, t.oxQuizzes, "용어 OX 퀴즈", 3);
      appendCopyButtonRow(article, {
        label: "전체 복사",
        getText: function () {
          return (
            "[용어] " +
            String(t.term || "") +
            "\n[관련어] " +
            (Array.isArray(t.aliases) ? t.aliases.join(", ") : "") +
            "\n[정의]\n" +
            String(t.definition || "") +
            "\n[OX 퀴즈]\n" +
            formatOxQuizzesForCopy(t.oxQuizzes)
          );
        }
      });
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
    var ORD = ["첫째", "둘째", "셋째", "넷째", "다섯째", "여섯째", "일곱째", "여덟째"];
    function withOrdinal(lines) {
      return lines.map(function (line, idx) {
        var t = String(line || "").trim();
        if (!t) return "";
        if (/^(첫째|둘째|셋째|넷째|다섯째|여섯째|일곱째|여덟째)\s*,/.test(t)) return t;
        if (/^\d+\s*[.)]/.test(t)) return t;
        if (/^[가-힣]\s*[.)]/.test(t)) return t;
        var o = ORD[idx] || (idx + 1) + "째";
        return o + ", " + t;
      }).filter(Boolean);
    }
    var src = String(raw || "").replace(/\r\n/g, "\n");
    if (!src.trim()) return "";
    var lines = src
      .split("\n")
      .map(function (x) {
        return String(x || "").trim();
      })
      .filter(Boolean);
    if (lines.length > 1) return withOrdinal(lines).join("\n");
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
      return withOrdinal(parts).join("\n");
    }
    return one;
  }

  function normalizeCasePoliteStyle(raw) {
    var s = String(raw || "").replace(/\r\n/g, "\n");
    if (!s.trim()) return "";
    var map = [
      [/제기하였다/g, "제기하였습니다"],
      [/판단하였다/g, "판단하였습니다"],
      [/보았다/g, "보았습니다"],
      [/하였다/g, "하였습니다"],
      [/되었다/g, "되었습니다"],
      [/있었다/g, "있었습니다"],
      [/없었다/g, "없었습니다"],
      [/밝혔다/g, "밝혔습니다"],
      [/인정하였다/g, "인정하였습니다"],
      [/취소하였다/g, "취소하였습니다"],
      [/기각하였다/g, "기각하였습니다"]
    ];
    for (var i = 0; i < map.length; i++) {
      s = s.replace(map[i][0], map[i][1]);
    }
    return s;
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
    secOx.className = "case-result-card__section dict-ox-section";
    var hOx = document.createElement("h4");
    hOx.className = "case-result-card__label dict-ox-section__heading";
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
        var head = document.createElement("div");
        head.className = "dict-card-nav";
        var h = document.createElement("h4");
        h.className = "case-result-card__label";
        h.textContent = label;
        head.appendChild(h);
        if (isAdminUser()) {
          var btnCopy = document.createElement("button");
          btnCopy.type = "button";
          btnCopy.className = "btn btn--ghost btn--small";
          btnCopy.textContent = "복사";
          btnCopy.addEventListener("click", function () {
            copyTextToClipboard(String(text || ""))
              .then(function () {
                btnCopy.textContent = "복사됨";
                window.setTimeout(function () {
                  btnCopy.textContent = "복사";
                }, 1200);
              })
              .catch(function () {
                window.alert("복사에 실패했습니다.");
              });
          });
          head.appendChild(btnCopy);
        }
        sec.appendChild(head);
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

      addSection("사실관계", normalizeCasePoliteStyle(c.facts));
      addSection("쟁점", normalizeCaseIssuesTextForUi(normalizeCasePoliteStyle(c.issues)));
      addSection("법적 판단", normalizeCasePoliteStyle(c.judgment));
      appendDictionaryOxQuizSection(article, c.oxQuizzes, "판례 OX 퀴즈", 5);
      appendCaseFullTextToggle(article, c);
      appendCopyButtonRow(article, {
        label: "전체 복사",
        getText: function () {
          return (
            "[사건 표기] " +
            String(c.citation || "") +
            "\n[제목] " +
            String(c.title || "") +
            "\n[사실관계]\n" +
            String(normalizeCasePoliteStyle(c.facts) || "") +
            "\n[쟁점]\n" +
            String(normalizeCaseIssuesTextForUi(normalizeCasePoliteStyle(c.issues)) || "") +
            "\n[법적 판단]\n" +
            String(normalizeCasePoliteStyle(c.judgment) || "") +
            "\n[OX 퀴즈]\n" +
            formatOxQuizzesForCopy(c.oxQuizzes)
          );
        }
      });
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
      if (q) markDictGuestUsage("term", q);
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
    if (list.length) markDictGuestUsage("case", q);
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
