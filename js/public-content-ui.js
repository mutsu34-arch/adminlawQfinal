/**
 * 공개 콘텐츠(용어·조문·판례·Q&A) — 앱과 동일한 카드 UI + Firestore published 병합
 */
(function () {
  var TAB_LABELS = {
    quiz: "퀴즈",
    terms: "용어사전",
    statutes: "조문사전",
    cases: "판례사전",
    qa: "Q&A"
  };

  var RENDER_OPTS = {
    skipFavButton: true,
    skipNavBack: true,
    publicPreview: true
  };

  function indexData() {
    return window.HANLAW_PUBLIC_CONTENT_INDEX || {};
  }

  function publishedConfig() {
    if (typeof window.getHanlawPublicContentConfig === "function") {
      return window.getHanlawPublicContentConfig();
    }
    return null;
  }

  function isAdminUser() {
    var u = typeof window.getHanlawUser === "function" ? window.getHanlawUser() : null;
    if (!u || !u.email) return false;
    var emails = window.ADMIN_EMAILS || [];
    var mail = String(u.email).toLowerCase();
    for (var i = 0; i < emails.length; i++) {
      if (String(emails[i]).toLowerCase() === mail) return true;
    }
    return false;
  }

  function appendAdminEditButton(card, type, obj) {
    if (!isAdminUser() || !card || !obj) return;
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn--small btn--outline";
    btn.textContent = "수정";
    if (type === "term") {
      btn.setAttribute("data-admin-edit-term", "1");
      btn._term = obj;
    } else if (type === "statute") {
      btn.setAttribute("data-admin-edit-statute", "1");
      btn._statute = obj;
    } else if (type === "case") {
      btn.setAttribute("data-admin-edit-case", "1");
      btn._case = obj;
    } else if (type === "qa") {
      btn.setAttribute("data-admin-edit-public-qa", "1");
      btn._qaItem = obj;
    }
    card.appendChild(btn);
  }

  function esc(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function richHtml(text) {
    if (typeof window.formatHanlawRichParagraphsHtml === "function") {
      return window.formatHanlawRichParagraphsHtml(text || "");
    }
    return esc(text);
  }

  function applyIntroFromConfig() {
    var cfg = publishedConfig();
    if (!cfg) return;
    var lead = document.getElementById("public-content-intro-lead");
    var disc = document.getElementById("public-content-intro-disclaimer");
    if (lead && cfg.introLead) lead.textContent = cfg.introLead;
    if (disc && cfg.introDisclaimer) {
      disc.textContent = cfg.introDisclaimer;
    }
  }

  function appendDisclaimer(parent, opts) {
    opts = opts || {};
    if (!parent || parent.querySelector(".public-content-disclaimer")) return;
    var cfg = publishedConfig();
    var text =
      (cfg && cfg.introDisclaimer) ||
      "아래는 앱 콘텐츠 구성을 반영한 공개 미리보기입니다. 관리자 업데이트·앱 개선에 따라 실제 회원용 화면의 문항·해설·사전·Q&A와 달라질 수 있습니다.";
    var p = document.createElement("p");
    p.className = "public-content-disclaimer";
    p.setAttribute("role", "note");
    p.textContent = text;
    if (opts.compact) p.classList.add("public-content-disclaimer--compact");
    parent.insertBefore(p, parent.firstChild);
  }

  function resolveTerms() {
    var idx = indexData().terms || [];
    var UI = window.DictionaryUI;
    if (!UI || typeof UI.findTermForTag !== "function") return [];
    return idx
      .map(function (name) {
        return UI.findTermForTag(name);
      })
      .filter(Boolean);
  }

  function resolveStatutes() {
    var idx = indexData().statutes || [];
    var UI = window.DictionaryUI;
    if (!UI || typeof UI.findStatuteForKey !== "function") return [];
    return idx
      .map(function (key) {
        return UI.findStatuteForKey("statute:" + key, key);
      })
      .filter(Boolean);
  }

  function resolveCases() {
    var idx = indexData().cases || [];
    var UI = window.DictionaryUI;
    if (!UI || typeof UI.searchCases !== "function") return [];
    return idx
      .map(function (cite) {
        var found = UI.searchCases(cite);
        return found && found.length ? found[0] : null;
      })
      .filter(Boolean);
  }

  function qaItems() {
    var cfg = publishedConfig();
    if (cfg && cfg.qa) return cfg.qa;
    var list = indexData().qa;
    return Array.isArray(list) ? list : [];
  }

  function fillAnswerHtml(el, raw) {
    var text = String(raw || "");
    if (typeof window.formatHanlawAiAnswerHtml === "function") {
      el.className = "public-qa-item__answer-text quiz-ai-answer";
      el.innerHTML = window.formatHanlawAiAnswerHtml(text);
    } else {
      el.className = "public-qa-item__answer-text";
      el.textContent = text;
    }
  }

  function renderQaItem(container, item) {
    var article = document.createElement("article");
    article.className = "public-qa-item public-qa-item--preview";

    var thread = document.createElement("div");
    thread.className = "public-qa-item__thread";

    var stem = document.createElement("div");
    stem.className = "public-qa-item__stem";
    if (item.quizTopic) {
      var tp = document.createElement("p");
      tp.className = "public-qa-item__stem-topic";
      tp.textContent = "주제: " + item.quizTopic;
      stem.appendChild(tp);
    }
    var sk = document.createElement("span");
    sk.className = "public-qa-item__stem-kicker";
    sk.textContent = "퀴즈 지문";
    stem.appendChild(sk);
    var sp = document.createElement("p");
    sp.className = "public-qa-item__stem-text";
    sp.innerHTML = richHtml(item.quizStatement || "(지문 없음)");
    stem.appendChild(sp);
    thread.appendChild(stem);

    var userBlock = document.createElement("div");
    userBlock.className = "public-qa-item__user-block";
    var uqK = document.createElement("span");
    uqK.className = "public-qa-item__user-q-kicker";
    uqK.textContent = "회원 질문";
    userBlock.appendChild(uqK);
    var pq = document.createElement("p");
    pq.className = "public-qa-item__q";
    pq.innerHTML = richHtml(item.questionMessage || "");
    userBlock.appendChild(pq);
    thread.appendChild(userBlock);
    article.appendChild(thread);

    var ansWrap = document.createElement("div");
    ansWrap.className = "public-qa-item__answer-wrap public-qa-item__answer-wrap--open";
    var ansLabel = document.createElement("p");
    ansLabel.className = "public-qa-item__answer-label";
    ansLabel.textContent = "답변";
    ansWrap.appendChild(ansLabel);
    var ansBody = document.createElement("div");
    ansBody.className = "public-qa-item__answer-body";
    fillAnswerHtml(ansBody, item.answer);
    ansWrap.appendChild(ansBody);
    article.appendChild(ansWrap);

    var adminRow = document.createElement("div");
    adminRow.className = "quiz-admin-edit-toolbar";
    adminRow.style.marginTop = "10px";
    appendAdminEditButton(adminRow, "qa", item);
    if (adminRow.children.length) article.appendChild(adminRow);

    container.appendChild(article);
  }

  function renderQaList(container) {
    var items = qaItems();
    if (!items.length) {
      var empty = document.createElement("p");
      empty.className = "dict-empty";
      empty.textContent = "공개 Q&A 미리보기를 불러오지 못했습니다.";
      container.appendChild(empty);
      return;
    }
    var list = document.createElement("div");
    list.className = "public-qa-preview-list";
    items.forEach(function (item) {
      renderQaItem(list, item);
    });
    container.appendChild(list);
  }

  function renderQuizSection(container) {
    var cfg = publishedConfig();
    var banner = (cfg && cfg.quizBanner) || {};
    var title = banner.title || "공개 퀴즈 5문항";
    var lead =
      banner.lead ||
      "OX 5문항을 로그인 없이 풀고, 기본·상세 해설(법리·함정·판례)을 모두 확인할 수 있습니다. 수정은 앱 퀴즈와 동일한 관리자 수정 화면을 사용합니다.";
    if (/36\s*문항|36문항/i.test(title)) title = "공개 퀴즈 5문항";
    if (/36\s*문항|36문항/i.test(lead)) {
      lead =
        "OX 5문항을 로그인 없이 풀고, 기본·상세 해설(법리·함정·판례)을 모두 확인할 수 있습니다. 수정은 앱 퀴즈와 동일한 관리자 수정 화면을 사용합니다.";
    }
    var box = document.createElement("div");
    box.className = "public-quiz-banner card";
    box.innerHTML =
      "<h3 class=\"card__title\" style=\"margin:0 0 8px\">" +
      esc(title) +
      "</h3>" +
      "<p class=\"pricing-lead\" style=\"margin:0 0 10px\">" +
      esc(lead) +
      "</p>";
    if (isAdminUser()) {
      var adminRow = document.createElement("div");
      adminRow.className = "quiz-admin-edit-toolbar";
      adminRow.style.marginBottom = "10px";
      var btnBanner = document.createElement("button");
      btnBanner.type = "button";
      btnBanner.className = "btn btn--small btn--outline";
      btnBanner.textContent = "안내 문구 수정";
      btnBanner.addEventListener("click", function () {
        if (typeof window.openPublicQuizBannerEditModal === "function") {
          window.openPublicQuizBannerEditModal();
        }
      });
      adminRow.appendChild(btnBanner);
      box.appendChild(adminRow);
    }
    container.appendChild(box);
    var host = document.createElement("div");
    host.id = "public-content-quiz-host";
    host.className = "public-content-quiz-host";
    container.appendChild(host);
    if (window.HanlawPublicQuizInline && typeof window.HanlawPublicQuizInline.mount === "function") {
      window.HanlawPublicQuizInline.mount(host);
    }
  }

  function renderKind(root, kind) {
    if (!root) return;
    root.innerHTML = "";
    appendDisclaimer(root, { compact: true });

    if (kind === "quiz") {
      renderQuizSection(root);
      return;
    }

    if (window.HanlawPublicQuizInline && typeof window.HanlawPublicQuizInline.unmount === "function") {
      window.HanlawPublicQuizInline.unmount();
    }

    var UI = window.DictionaryUI;
    var listWrap = document.createElement("div");
    listWrap.className = "public-content-list";

    if (kind === "terms" && UI && typeof UI.renderTermResults === "function") {
      UI.renderTermResults(listWrap, resolveTerms(), RENDER_OPTS);
    } else if (kind === "statutes" && UI && typeof UI.renderStatuteResults === "function") {
      UI.renderStatuteResults(listWrap, resolveStatutes(), RENDER_OPTS);
    } else if (kind === "cases" && UI && typeof UI.renderCaseResults === "function") {
      UI.renderCaseResults(listWrap, resolveCases(), RENDER_OPTS);
    } else if (kind === "qa") {
      renderQaList(listWrap);
    } else {
      var miss = document.createElement("p");
      miss.className = "dict-empty";
      miss.textContent =
        "앱 사전 데이터를 불러오지 못했습니다. 페이지를 새로고침하거나 잠시 후 다시 시도해 주세요.";
      listWrap.appendChild(miss);
    }

    root.appendChild(listWrap);

    var cta = document.createElement("aside");
    cta.className = "public-content-cta";
    cta.innerHTML =
      "전체 " +
      esc(TAB_LABELS[kind] || "콘텐츠") +
      "·기출·AI 질문은 <a href=\"/\" rel=\"noopener\">행정법Q 앱</a> 회원가입·구독 후 이용하실 수 있습니다.";
    root.appendChild(cta);
  }

  function setActiveTab(wrap, kind) {
    if (!wrap) return;
    wrap.querySelectorAll("[data-public-tab]").forEach(function (btn) {
      var on = kind && btn.getAttribute("data-public-tab") === kind;
      btn.classList.toggle("btn--outline", !on);
      btn.classList.toggle("public-content-tab--active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
  }

  function showHub() {
    var panel = document.getElementById("panel-public");
    var root = document.getElementById("public-content-root");
    var tabs = document.getElementById("public-content-tabs");
    if (panel) panel.setAttribute("data-public-tab", "hub");
    applyIntroFromConfig();
    if (root) {
      root.innerHTML = "";
      var hint = document.createElement("p");
      hint.className = "dict-empty public-content-hub-hint";
      hint.textContent = "위에서 퀴즈·용어사전·조문사전·판례사전·Q&A 중 열람할 항목을 선택하세요.";
      root.appendChild(hint);
    }
    setActiveTab(tabs, null);
  }

  function bindTabs(wrap, root) {
    if (!wrap) return;
    wrap.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-public-tab]");
      if (!btn) return;
      var kind = btn.getAttribute("data-public-tab");
      if (!kind) return;
      var panel = document.getElementById("panel-public");
      if (panel) panel.setAttribute("data-public-tab", kind);
      setActiveTab(wrap, kind);
      renderKind(root, kind);
    });
  }

  function initPanel() {
    var panel = document.getElementById("panel-public");
    var root = document.getElementById("public-content-root");
    var tabs = document.getElementById("public-content-tabs");
    if (!panel || !root || !tabs) return;
    applyIntroFromConfig();
    bindTabs(tabs, root);
    var initial = panel.getAttribute("data-public-tab") || "hub";
    if (initial === "hub") {
      showHub();
      return;
    }
    setActiveTab(tabs, initial);
    renderKind(root, initial);
  }

  function initStandalonePage() {
    var root = document.getElementById("public-standalone-root");
    if (!root) return;
    var kind = root.getAttribute("data-kind") || "terms";
    var titleEl = document.getElementById("public-standalone-title");
    if (titleEl) titleEl.textContent = "공개 학습 콘텐츠 · " + (TAB_LABELS[kind] || "미리보기");
    renderKind(root, kind);
  }

  function onConfigReady() {
    applyIntroFromConfig();
    var panel = document.getElementById("panel-public");
    if (!panel || panel.hidden) return;
    var kind = panel.getAttribute("data-public-tab") || "hub";
    if (kind === "hub") {
      showHub();
      return;
    }
    var root = document.getElementById("public-content-root");
    if (root) renderKind(root, kind);
  }

  window.HanlawPublicContentUI = {
    renderKind: renderKind,
    initPanel: initPanel,
    initStandalonePage: initStandalonePage,
    showHub: showHub,
    onConfigReady: onConfigReady,
    setPanelTab: function (kind) {
      if (!kind || kind === "hub") {
        showHub();
        return;
      }
      var panel = document.getElementById("panel-public");
      var root = document.getElementById("public-content-root");
      var tabs = document.getElementById("public-content-tabs");
      if (panel) panel.setAttribute("data-public-tab", kind);
      if (tabs) setActiveTab(tabs, kind);
      if (root) renderKind(root, kind);
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      initPanel();
      initStandalonePage();
    });
  } else {
    initPanel();
    initStandalonePage();
  }
})();
