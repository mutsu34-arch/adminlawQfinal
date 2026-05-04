(function () {
  /** 서버와 동기: 엘리(AI) 질문권 1건 전환에 필요한 출석 포인트(기본 500). */
  window.HANLAW_ATTENDANCE_POINTS_PER_ELLY_CREDIT = 500;

  function goPricingPanel() {
    var navBtn = document.querySelector('.nav-main__btn[data-panel="pricing"]');
    if (navBtn) navBtn.click();
  }

  /** 요금제 패널 상단(구독 플랜)으로 스크롤 */
  function scrollPricingSubscription() {
    setTimeout(function () {
      var sec = document.getElementById("pricing-subscription-anchor");
      if (sec) sec.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
  }

  window.goToEllyQuestionPacksSection = function () {
    goPricingPanel();
    setTimeout(function () {
      var extra = document.getElementById("pricing-elly-extra");
      if (extra) extra.scrollIntoView({ behavior: "smooth", block: "start" });
      else scrollPricingSubscription();
    }, 80);
  };

  /** 과거 링크 호환 */
  window.goToQuestionPacksSection = function () {
    goPricingPanel();
    scrollPricingSubscription();
  };

  window.goToDashboardPointConvertSection = function () {
    var navBtn = document.querySelector('.nav-main__btn[data-panel="dashboard"]');
    if (navBtn) navBtn.click();
    setTimeout(function () {
      var sec = document.getElementById("dashboard-point-convert-section");
      if (sec) sec.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
  };

  /** 퀴즈 맥락 + 사용자 질문 → Gemini (일일 한도는 서버에서 구독 플랜 기준 적용). */
  window.quizAskGeminiCallable = function (payload) {
    if (typeof firebase === "undefined" || !firebase.app || !firebase.functions) {
      return Promise.reject(new Error("Firebase Functions를 불러오지 못했습니다."));
    }
    var region = window.FIREBASE_FUNCTIONS_REGION || "asia-northeast3";
    var fn = firebase.app().functions(region).httpsCallable("quizAskGemini");
    return fn(payload || {}).then(function (res) {
      return res && res.data ? res.data : {};
    });
  };

  window.recordQuizAttendanceCallable = function () {
    if (typeof firebase === "undefined" || !firebase.app || !firebase.functions) {
      return Promise.reject(new Error("Firebase Functions를 불러오지 못했습니다."));
    }
    var region = window.FIREBASE_FUNCTIONS_REGION || "asia-northeast3";
    var fn = firebase.app().functions(region).httpsCallable("recordQuizAttendance");
    return fn({}).then(function (res) {
      return res && res.data ? res.data : {};
    });
  };

  /** @param {{ count?: number }} [payload] count: 1|5|10|20|30, 기본 1 */
  window.convertAttendancePointsToEllyCreditCallable = function (payload) {
    if (typeof firebase === "undefined" || !firebase.app || !firebase.functions) {
      return Promise.reject(new Error("Firebase Functions를 불러오지 못했습니다."));
    }
    var region = window.FIREBASE_FUNCTIONS_REGION || "asia-northeast3";
    var fn = firebase.app().functions(region).httpsCallable("convertAttendancePointsToEllyCredit");
    var body = {};
    if (payload && payload.count != null) body.count = payload.count;
    return fn(body).then(function (res) {
      return res && res.data ? res.data : {};
    });
  };

  function initDom() {
    document.querySelectorAll("[data-go-dashboard-point-convert]").forEach(function (el) {
      el.addEventListener("click", function () {
        window.goToDashboardPointConvertSection();
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initDom);
  } else {
    initDom();
  }
})();
