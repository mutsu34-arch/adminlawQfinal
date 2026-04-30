(function () {
  var TAG_DICT_CACHE = {};
  var CURRENT_ENTRY = null;

  function $(id) {
    return document.getElementById(id);
  }

  function isAdminViewer() {
    var u = typeof window.getHanlawUser === "function" ? window.getHanlawUser() : null;
    if (!u || !u.email) return false;
    var emails = window.ADMIN_EMAILS || [];
    var mail = String(u.email).toLowerCase();
    for (var i = 0; i < emails.length; i++) {
      if (String(emails[i]).toLowerCase() === mail) return true;
    }
    return false;
  }

  function normTagKey(tag) {
    return String(tag || "")
      .replace(/^#/, "")
      .trim()
      .replace(/[\s.\-·]/g, "")
      .toLowerCase();
  }

  function cacheGet(tag) {
    return TAG_DICT_CACHE[normTagKey(tag)] || null;
  }

  function cacheSet(tag, value) {
    var k = normTagKey(tag);
    if (!k || !value) return;
    TAG_DICT_CACHE[k] = value;
  }

  function renderAiLoading(body, statusText) {
    if (!body) return;
    body.innerHTML = "";
    var box = document.createElement("div");
    box.className = "quiz-ai-loading";
    box.setAttribute("aria-live", "polite");
    box.setAttribute("aria-busy", "true");

    var s = document.createElement("p");
    s.className = "quiz-ai-loading__status";
    s.textContent = statusText || "생성 중…";
    box.appendChild(s);

    var q = document.createElement("p");
    q.className = "quiz-ai-loading__quote";
    q.textContent =
      typeof window.pickHanlawAiLoadingQuote === "function"
        ? window.pickHanlawAiLoadingQuote()
        : "한 걸음씩 꾸준히 가면 결국 합격점에 도달합니다.";
    box.appendChild(q);
    body.appendChild(box);
  }

  function appendExternalLinks(container, parsed) {
    var searchText =
      typeof window.lawGoKrSearchQuery === "function"
        ? window.lawGoKrSearchQuery(parsed)
        : "";
    if (!searchText) searchText = parsed.displayTitle || "";

    var row = document.createElement("div");
    row.className = "statute-article-popup__actions";

    var g = document.createElement("a");
    g.href =
      "https://www.google.com/search?q=" +
      encodeURIComponent(searchText + " site:law.go.kr");
    g.target = "_blank";
    g.rel = "noopener noreferrer";
    g.className = "statute-article-popup__action";
    g.textContent = "국가법령정보센터 검색(구글)";
    row.appendChild(g);

    var lawKey = parsed.lawName.replace(/\s+/g, "");
    var wikiMap = window.STATUTE_FULLTEXT_HINT_URL || {};
    if (wikiMap[lawKey]) {
      var w = document.createElement("a");
      w.href = wikiMap[lawKey];
      w.target = "_blank";
      w.rel = "noopener noreferrer";
      w.className = "statute-article-popup__action";
      w.textContent = "위키문헌 전체 본문";
      row.appendChild(w);
    }

    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn--secondary statute-article-popup__copy";
    btn.textContent = "검색어 복사";
    btn.addEventListener("click", function () {
      var t = searchText;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(t).then(
          function () {
            btn.textContent = "복사됨";
            setTimeout(function () {
              btn.textContent = "검색어 복사";
            }, 1600);
          },
          function () {
            window.prompt("검색어를 복사하세요:", t);
          }
        );
      } else {
        window.prompt("검색어를 복사하세요:", t);
      }
    });
    row.appendChild(btn);

    container.appendChild(row);

    var hint = document.createElement("p");
    hint.className = "statute-article-popup__hint";
    hint.textContent =
      "검색어: " + searchText;
    container.appendChild(hint);
  }

  function renderStatuteStatic(body, parsed, block) {
    body.innerHTML = "";
    var root = document.createElement("div");
    root.className = "statute-article-popup";

    var h = document.createElement("h3");
    h.className = "statute-article-popup__heading";
    var headStr = block.heading || parsed.displayTitle;
    if (typeof window.formatHanlawRichParagraphsHtml === "function") {
      h.innerHTML = window.formatHanlawRichParagraphsHtml(headStr);
    } else {
      h.textContent = headStr;
    }
    root.appendChild(h);

    if (parsed.paragraph) {
      var sub = document.createElement("p");
      sub.className = "statute-article-popup__para-note";
      sub.textContent =
        "태그에 제" + parsed.paragraph + "항이 포함되어 있습니다. 아래는 해당 조 전체입니다.";
      root.appendChild(sub);
    }

    var text = document.createElement("div");
    text.className = "statute-article-popup__body quiz-ai-answer";
    if (typeof window.formatHanlawAiAnswerHtml === "function") {
      text.innerHTML = window.formatHanlawAiAnswerHtml(block.body || "");
    } else {
      text.textContent = block.body || "";
    }
    root.appendChild(text);

    if (block.sourceNote && isAdminViewer()) {
      var sn = document.createElement("p");
      sn.className = "statute-article-popup__source";
      if (typeof window.formatHanlawRichParagraphsHtml === "function") {
        sn.innerHTML = window.formatHanlawRichParagraphsHtml(block.sourceNote);
      } else {
        sn.textContent = block.sourceNote;
      }
      root.appendChild(sn);
    }

    appendExternalLinks(root, parsed);
    body.appendChild(root);
  }

  function renderStatuteFallback(body, parsed) {
    body.innerHTML = "";
    var root = document.createElement("div");
    root.className = "statute-article-popup";

    var h = document.createElement("h3");
    h.className = "statute-article-popup__heading";
    h.textContent = parsed.displayTitle;
    root.appendChild(h);

    var p = document.createElement("p");
    p.className = "statute-article-popup__lead";
    p.textContent =
      "이 조문은 아직 앱에 수록되지 않았습니다. 아래 링크로 국가법령정보센터·위키문헌에서 전문을 확인할 수 있습니다.";
    root.appendChild(p);

    appendExternalLinks(root, parsed);
    body.appendChild(root);
  }

  function openModal() {
    var m = $("tag-dict-modal");
    if (m) {
      m.hidden = false;
      m.setAttribute("aria-hidden", "false");
    }
  }

  function closeModal() {
    var m = $("tag-dict-modal");
    if (m) {
      m.hidden = true;
      m.setAttribute("aria-hidden", "true");
    }
    CURRENT_ENTRY = null;
  }

  function syncAdminActionsVisibility() {
    var actions = $("tag-dict-modal-actions");
    if (!actions) return;
    actions.hidden = !isAdminViewer();
  }

  window.closeTagDictModal = closeModal;

  window.resolveTagDictionaryEntry = function (tag) {
    if (
      typeof firebase === "undefined" ||
      !firebase.apps ||
      !firebase.apps.length ||
      !firebase.functions
    ) {
      return Promise.reject(new Error("Firebase Functions를 사용할 수 없습니다."));
    }
    var region = window.FIREBASE_FUNCTIONS_REGION || "asia-northeast3";
    var fn = firebase.app().functions(region).httpsCallable("generateOrGetDictionaryEntry");
    return fn({ tag: tag }).then(function (res) {
      var d = res && res.data;
      if (!d || !d.ok) throw new Error("응답이 올바르지 않습니다.");
      return { kind: d.kind, record: d.record, source: d.source };
    });
  };

  window.openTagDictionaryLookup = function (rawTag) {
    var tag = String(rawTag || "")
      .replace(/^#/, "")
      .trim();
    var title = $("tag-dict-modal-title");
    var body = $("tag-dict-modal-body");
    var err = $("tag-dict-modal-error");
    var actions = $("tag-dict-modal-actions");
    if (!body) return;

    if (title) title.textContent = tag ? "#" + tag : "사전";
    body.innerHTML = "";
    if (err) {
      err.textContent = "";
      err.hidden = true;
    }
    if (actions) actions.hidden = true;
    CURRENT_ENTRY = null;

    if (!tag) return;

    var parsedStatute =
      typeof window.parseStatuteArticleTag === "function"
        ? window.parseStatuteArticleTag(tag)
        : null;
    if (parsedStatute) {
      if (title) title.textContent = parsedStatute.displayTitle;
      body.innerHTML = "";
      if (err) {
        err.textContent = "";
        err.hidden = true;
      }
      var block =
        typeof window.lookupStaticStatuteArticle === "function"
          ? window.lookupStaticStatuteArticle(parsedStatute)
          : null;
      if (block) renderStatuteStatic(body, parsedStatute, block);
      else renderStatuteFallback(body, parsedStatute);
      openModal();
      return;
    }

    var UI = window.DictionaryUI;
    if (!UI) {
      if (err) {
        err.textContent = "사전 모듈을 불러오지 못했습니다.";
        err.hidden = false;
      }
      openModal();
      return;
    }

    var asCase = UI.isLikelyCaseTag(tag);
    var cached = cacheGet(tag);
    if (cached && cached.kind && cached.record) {
      body.innerHTML = "";
      if (cached.kind === "case") UI.renderCaseResults(body, [cached.record]);
      else UI.renderTermResults(body, [cached.record]);
      CURRENT_ENTRY = { tag: tag, kind: cached.kind, record: cached.record };
      if (actions && isAdminViewer() && cached.kind === "term") actions.hidden = false;
      openModal();
      return;
    }

    var local = asCase ? UI.findCaseForTag(tag) : UI.findTermForTag(tag);

    if (local) {
      body.innerHTML = "";
      if (asCase) UI.renderCaseResults(body, [local]);
      else UI.renderTermResults(body, [local]);
      cacheSet(tag, { kind: asCase ? "case" : "term", record: local, source: "local" });
      CURRENT_ENTRY = { tag: tag, kind: asCase ? "case" : "term", record: local };
      if (actions && isAdminViewer() && !asCase) actions.hidden = false;
      openModal();
      return;
    }

    renderAiLoading(body, asCase ? "판례 해설 생성 중…" : "용어 해설 생성 중…");
    openModal();

    var user =
      typeof window.getHanlawUser === "function" ? window.getHanlawUser() : null;
    if (!user) {
      body.innerHTML = "";
      if (err) {
        err.textContent =
          "로컬·동기화된 사전에 없는 항목입니다. AI로 새로 만들려면 로그인하고, 서버에 GEMINI_API_KEY가 설정되어 있어야 합니다.";
        err.hidden = false;
      }
      return;
    }

    window
      .resolveTagDictionaryEntry(tag)
      .then(function (res) {
        body.innerHTML = "";
        cacheSet(tag, res);
        if (res.kind === "case") UI.renderCaseResults(body, [res.record]);
        else UI.renderTermResults(body, [res.record]);
        CURRENT_ENTRY = { tag: tag, kind: res.kind, record: res.record };
        if (actions && isAdminViewer() && res.kind === "term") actions.hidden = false;
      })
      .catch(function (e) {
        body.innerHTML = "";
        var msg = (e && e.message) || "처리에 실패했습니다.";
        if (e && e.code === "functions/not-found") {
          msg = "Cloud Functions가 배포되지 않았습니다.";
        }
        if (e && e.code === "functions/failed-precondition") {
          msg = e.message || msg;
        }
        if (err) {
          err.textContent = msg;
          err.hidden = false;
        }
      });
  };

  document.addEventListener("click", function (e) {
    var btn = e.target.closest(".feedback-tag--link");
    if (!btn) return;
    var t = btn.getAttribute("data-tag");
    if (t) window.openTagDictionaryLookup(t);
  });

  document.addEventListener("DOMContentLoaded", function () {
    syncAdminActionsVisibility();
    var m = $("tag-dict-modal");
    var c1 = $("tag-dict-modal-close");
    if (c1) c1.addEventListener("click", closeModal);
    if (m) {
      m.addEventListener("click", function (e) {
        if (e.target === m) closeModal();
      });
    }
    var delTerm = $("tag-dict-modal-delete-term");
    if (delTerm) {
      delTerm.addEventListener("click", function () {
        if (!isAdminViewer()) return;
        if (!CURRENT_ENTRY || CURRENT_ENTRY.kind !== "term") return;
        if (typeof window.deleteTermEntryFromFirestore !== "function") {
          var e1 = $("tag-dict-modal-error");
          if (e1) {
            e1.textContent = "용어 삭제 함수를 찾지 못했습니다.";
            e1.hidden = false;
          }
          return;
        }
        var rec = CURRENT_ENTRY.record || {};
        var docId = String(rec._docId || "").trim();
        var term = String(rec.term || "").trim();
        if (!docId && !term) return;
        if (!window.confirm("이 용어를 삭제할까요?")) return;
        delTerm.disabled = true;
        var err = $("tag-dict-modal-error");
        if (err) {
          err.textContent = "삭제 중...";
          err.hidden = false;
          err.classList.remove("admin-msg--error");
        }
        window
          .deleteTermEntryFromFirestore(docId || term, { rawDocId: !!docId })
          .then(function () {
            delete TAG_DICT_CACHE[normTagKey(CURRENT_ENTRY.tag || term)];
            closeModal();
            if (typeof window.openTagDictionaryLookup === "function") {
              window.setTimeout(function () {
                // 삭제 반영 확인을 위해 바로 다시 열지 않고 종료
              }, 0);
            }
          })
          .catch(function (e) {
            if (err) {
              err.textContent = (e && e.message) || "용어 삭제에 실패했습니다.";
              err.hidden = false;
              err.classList.add("admin-msg--error");
            }
          })
          .then(function () {
            delTerm.disabled = false;
          });
      });
    }
    window.addEventListener("app-auth", syncAdminActionsVisibility);
    window.addEventListener("membership-updated", syncAdminActionsVisibility);
  });
})();
