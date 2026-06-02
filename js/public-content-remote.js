/**
 * Firestore 공개 콘텐츠 — 안내 문구·주간 스냅샷(탭별 5건) 원격 반영
 */
(function () {
  function buildDefaultConfig() {
    return {
      introLead:
        "로그인 없이 열람할 수 있는 핵심 자료입니다. 매주 앱 DB에서 선정한 5건씩 미리보기를 제공하며, 공개 퀴즈는 기본·상세 해설을 모두 공개합니다.",
      introDisclaimer: "",
      quizBanner: {
        title: "공개 퀴즈 5문항",
        lead: "OX 5문항을 로그인 없이 풀고, 기본·상세 해설(법리·함정·판례)을 모두 확인할 수 있습니다.",
        href: "/content/quiz-36.html"
      },
      weeklySnapshot: null,
      weekKey: "",
      validUntil: null,
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
    var weeklySnapshot =
      remote.weeklySnapshot && typeof remote.weeklySnapshot === "object" ? remote.weeklySnapshot : null;
    var cfg = {
      introLead: normalizeIntro(remote.introLead, base.introLead),
      introDisclaimer:
        remote.introDisclaimer != null && String(remote.introDisclaimer).trim()
          ? remote.introDisclaimer
          : base.introDisclaimer,
      quizBanner: normalizeQuizBanner(remote.quizBanner, base.quizBanner),
      weeklySnapshot: weeklySnapshot,
      weekKey: weeklySnapshot && weeklySnapshot.weekKey ? weeklySnapshot.weekKey : "",
      validUntil: weeklySnapshot && weeklySnapshot.validUntil ? weeklySnapshot.validUntil : null,
      qa:
        weeklySnapshot && Array.isArray(weeklySnapshot.qa) && weeklySnapshot.qa.length
          ? weeklySnapshot.qa
          : Array.isArray(remote.qa) && remote.qa.length
            ? remote.qa
            : null
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
