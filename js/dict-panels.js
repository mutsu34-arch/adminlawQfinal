(function () {
  function getTerms() {
    var a = window.LEGAL_TERMS_DATA || [];
    var b = window.LEGAL_TERMS_REMOTE || [];
    return a.concat(b);
  }

  function getCases() {
    var a = window.LEGAL_CASES_DATA || [];
    var b = window.LEGAL_CASES_REMOTE || [];
    return a.concat(b);
  }

  function norm(s) {
    return String(s)
      .trim()
      .replace(/[\s.\-·]/g, "")
      .toLowerCase();
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
      return (a.item.term || "").localeCompare(b.item.term || "", "ko");
    });
    return scored.map(function (x) {
      return x.item;
    });
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

  function applyDefinitionHtml(el, raw) {
    el.className = "dict-result-card__body quiz-ai-answer";
    if (typeof window.formatHanlawAiAnswerHtml === "function") {
      el.innerHTML = window.formatHanlawAiAnswerHtml(raw || "");
    } else {
      el.textContent = raw || "";
    }
  }

  function renderTermResults(container, items) {
    container.innerHTML = "";
    if (!items.length) {
      var p = document.createElement("p");
      p.className = "dict-empty";
      p.textContent =
        "일치하는 용어가 없습니다. 다른 키워드로 검색하거나, 로그인 후 AI 해설 생성을 이용해 보세요.";
      container.appendChild(p);
      return;
    }
    for (var i = 0; i < items.length; i++) {
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
      if (t._displaySource === "generated") {
        var foot = document.createElement("p");
        foot.className = "dict-result-card__foot";
        foot.textContent = "이 해설은 Gemini로 생성·저장된 항목입니다.";
        article.appendChild(foot);
      }
      container.appendChild(article);
    }
  }

  function renderCaseResults(container, items) {
    container.innerHTML = "";
    if (!items.length) {
      var p = document.createElement("p");
      p.className = "dict-empty";
      p.textContent =
        "일치하는 판례가 없습니다. 사건번호(예: 91누3224) 또는 키워드(예: 행정계획, 정보공개)로 검색하거나, js/case-dictionary-data.js·Firestore(hanlaw_dict_cases)에 판례를 추가하세요.";
      container.appendChild(p);
      return;
    }
    for (var i = 0; i < items.length; i++) {
      var c = items[i];
      var article = document.createElement("article");
      article.className = "case-result-card";
      var head = document.createElement("header");
      head.className = "case-result-card__head";
      var cit = document.createElement("p");
      cit.className = "case-result-card__citation";
      cit.textContent = c.citation || "";
      head.appendChild(cit);
      if (c.title) {
        var tit = document.createElement("h3");
        tit.className = "case-result-card__title";
        tit.textContent = c.title;
        head.appendChild(tit);
      }

      if (typeof window.buildCasenoteCaseLinks === "function") {
        var cn = window.buildCasenoteCaseLinks(c);
        if (cn && (cn.scourtList || cn.scourtPortal || cn.direct || cn.search)) {
          var nav = document.createElement("div");
          nav.className = "case-result-card__links";
          if (cn.scourtList) {
            var aPub = document.createElement("a");
            aPub.href = cn.scourtList;
            aPub.target = "_blank";
            aPub.rel = "noopener noreferrer";
            aPub.className = "case-result-card__link case-result-card__link--primary";
            aPub.textContent = "법고을에서 판례·전문 보기 (대법원 공공)";
            aPub.title =
              "대법원 법고을 판례 검색. 로그인 없이 목록에서 전문을 열 수 있습니다.";
            nav.appendChild(aPub);
          }
          if (cn.scourtPortal) {
            var aPortal = document.createElement("a");
            aPortal.href = cn.scourtPortal;
            aPortal.target = "_blank";
            aPortal.rel = "noopener noreferrer";
            aPortal.className = "case-result-card__link";
            aPortal.textContent =
              "사법정보공개포털 (종합법률정보·판례 전문)";
            aPortal.title =
              "대법원 사법정보공개포털. 항목에 jisCntntsSrno 또는 scourtPortalUrl이 있으면 해당 전문으로, 없으면 포털 판례 검색 화면으로 이동합니다.";
            nav.appendChild(aPortal);
          }
          if (cn.direct) {
            var aFull = document.createElement("a");
            aFull.href = cn.direct;
            aFull.target = "_blank";
            aFull.rel = "noopener noreferrer";
            aFull.className =
              "case-result-card__link" +
              (cn.scourtList ? "" : " case-result-card__link--primary");
            aFull.textContent = "케이스노트 (별도 사이트·로그인 필요할 수 있음)";
            aFull.title = "케이스노트는 회원·유료 구간이 있을 수 있습니다.";
            nav.appendChild(aFull);
          }
          if (cn.search) {
            var aSearch = document.createElement("a");
            aSearch.href = cn.search;
            aSearch.target = "_blank";
            aSearch.rel = "noopener noreferrer";
            aSearch.className = "case-result-card__link";
            aSearch.textContent = cn.direct
              ? "케이스노트 검색 (표기가 다를 때)"
              : "케이스노트에서 판결문 찾기";
            nav.appendChild(aSearch);
          }
          head.appendChild(nav);
        }
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
        div.className = "case-result-card__text";
        div.textContent = text;
        sec.appendChild(div);
        article.appendChild(sec);
      }

      addSection("사실관계", c.facts);
      addSection("쟁점", c.issues);
      addSection("법적 판단", c.judgment);
      container.appendChild(article);
    }
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
      return;
    }

    out.innerHTML = "";
    if (!q) {
      renderTermResults(out, []);
      return;
    }

    if (typeof window.getHanlawUser !== "function" || !window.getHanlawUser()) {
      var pGuest = document.createElement("p");
      pGuest.className = "dict-empty";
      pGuest.textContent =
        "일치하는 용어가 없습니다. 로그인하면 AI로 행정법 해설을 생성해 볼 수 있습니다(Google Gemini).";
      out.appendChild(pGuest);
      return;
    }

    if (typeof firebase === "undefined" || !firebase.apps || !firebase.apps.length || !firebase.functions) {
      var pFb = document.createElement("p");
      pFb.className = "dict-empty";
      pFb.textContent =
        "Firebase를 사용할 수 없습니다. 네트워크와 설정을 확인한 뒤 새로고침하세요.";
      out.appendChild(pFb);
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
          return;
        }
        if (d.kind === "case") {
          renderCaseResults(out, [d.record]);
          return;
        }
        var rec = d.record;
        if (d.source === "generated") {
          rec._displaySource = "generated";
        }
        renderTermResults(out, [rec]);
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
      });
  }

  function runCaseSearch() {
    var input = $("case-number-query");
    var out = $("case-search-results");
    if (!input || !out) return;
    renderCaseResults(out, searchCases(input.value));
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

    var btnC = $("case-search-btn");
    var inpC = $("case-number-query");
    if (btnC) btnC.addEventListener("click", runCaseSearch);
    if (inpC) {
      inpC.addEventListener("keydown", function (e) {
        if (e.key === "Enter") runCaseSearch();
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }

  function isLikelyCaseTagStr(s) {
    var t = String(s || "").trim();
    if (/헌재\s*\d{4}헌[가바마]\d+/i.test(t)) return true;
    if (/\d{2,4}\s*[누두구]\s*\d{3,6}/.test(t)) return true;
    if (/^\d{2,4}[누두구]\d{3,6}$/.test(t.replace(/\s/g, ""))) return true;
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
    return list.length ? list[0] : null;
  }

  window.DictionaryUI = {
    norm: norm,
    searchTerms: searchTerms,
    searchCases: searchCases,
    renderTermResults: renderTermResults,
    renderCaseResults: renderCaseResults,
    isLikelyCaseTag: isLikelyCaseTagStr,
    findTermForTag: findTermForTag,
    findCaseForTag: findCaseForTag,
    refreshPanelsIfOpen: function () {
      var pDict = document.getElementById("panel-dict");
      var pCase = document.getElementById("panel-cases");
      if (pDict && !pDict.hidden) runTermSearch();
      if (pCase && !pCase.hidden) runCaseSearch();
    }
  };

  window.addEventListener("dict-remote-updated", function () {
    if (window.DictionaryUI && window.DictionaryUI.refreshPanelsIfOpen) {
      window.DictionaryUI.refreshPanelsIfOpen();
    }
  });
})();
