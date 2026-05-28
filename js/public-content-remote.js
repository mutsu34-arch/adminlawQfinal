/**
 * Firestore 공개 콘텐츠(published) — 안내 문구·퀴즈 배너·Q&A만 원격 반영
 * 용어·조문·판례·퀴즈 문항은 앱 사전·문항 DB와 동일하게 편집합니다.
 */
(function () {
  function buildDefaultConfig() {
    return {
      introLead:
        "로그인 없이 열람할 수 있는 핵심 자료입니다. 공개 퀴즈 5문항은 기본·상세 해설을 모두 공개합니다.",
      introDisclaimer:
        "아래는 앱 콘텐츠 구성을 반영한 공개 미리보기입니다. 관리자 업데이트·앱 개선에 따라 실제 회원용 화면의 문항·해설·사전·Q&A와 달라질 수 있습니다.",
      quizBanner: {
        title: "공개 퀴즈 5문항",
        lead: "OX 5문항을 로그인 없이 풀고, 기본·상세 해설(법리·함정·판례)을 모두 확인할 수 있습니다.",
        href: "/content/quiz-36.html"
      },
      qa: null
    };
  }

  function isLegacy36Text(s) {
    return /36\s*문항|36문항/i.test(String(s || ""));
  }

  function normalizeQuizBanner(remoteBanner, baseBanner) {
    baseBanner = baseBanner || buildDefaultConfig().quizBanner;
    var b = Object.assign({}, baseBanner, remoteBanner || {});
    if (isLegacy36Text(b.title)) b.title = baseBanner.title;
    if (isLegacy36Text(b.lead)) b.lead = baseBanner.lead;
    return b;
  }

  function normalizeIntro(remoteLead, baseLead) {
    var lead = remoteLead != null && String(remoteLead).trim() ? remoteLead : baseLead;
    if (isLegacy36Text(lead)) return baseLead;
    return lead;
  }

  function mergeConfig(remote) {
    var base = buildDefaultConfig();
    if (!remote || typeof remote !== "object") {
      window.HANLAW_PUBLIC_CONTENT_CONFIG = base;
      return base;
    }
    var cfg = {
      introLead: normalizeIntro(remote.introLead, base.introLead),
      introDisclaimer:
        remote.introDisclaimer != null && String(remote.introDisclaimer).trim()
          ? remote.introDisclaimer
          : base.introDisclaimer,
      quizBanner: normalizeQuizBanner(remote.quizBanner, base.quizBanner),
      qa: Array.isArray(remote.qa) && remote.qa.length ? remote.qa : null
    };
    window.HANLAW_PUBLIC_CONTENT_CONFIG = cfg;
    return cfg;
  }

  function fetchConfig() {
    if (typeof firebase === "undefined" || !firebase.app) return Promise.resolve(mergeConfig(null));
    var region = (window.FIREBASE_CONFIG && window.FIREBASE_CONFIG.functionsRegion) || "asia-northeast3";
    var fn = firebase.app().functions(region).httpsCallable("getPublicContentConfig");
    return fn({})
      .then(function (res) {
        return mergeConfig(res && res.data ? res.data.config : null);
      })
      .catch(function () {
        return mergeConfig(null);
      })
      .then(function (cfg) {
        if (window.HanlawPublicContentUI && typeof window.HanlawPublicContentUI.onConfigReady === "function") {
          window.HanlawPublicContentUI.onConfigReady(cfg);
        }
        return cfg;
      });
  }

  window.refreshHanlawPublicContentConfig = function () {
    return fetchConfig();
  };

  window.getHanlawPublicContentConfig = function () {
    return window.HANLAW_PUBLIC_CONTENT_CONFIG || buildDefaultConfig();
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", fetchConfig);
  } else {
    fetchConfig();
  }
})();
