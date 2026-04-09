(function () {
  var unsub = null;

  function kstYearMonth(d) {
    d = d || new Date();
    var fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit"
    });
    var parts = fmt.formatToParts(d);
    var y = "";
    var m = "";
    for (var i = 0; i < parts.length; i++) {
      if (parts[i].type === "year") y = parts[i].value;
      if (parts[i].type === "month") m = parts[i].value;
    }
    return y + "-" + m;
  }

  function isPaidMember() {
    return window.APP_MEMBERSHIP && window.APP_MEMBERSHIP.tier === "paid";
  }

  function sumPurchasedBatches(batches, nowMs) {
    if (!batches || !batches.length) return 0;
    var n = 0;
    for (var i = 0; i < batches.length; i++) {
      var b = batches[i];
      var exp = b.expiresAt;
      var expMs = exp && exp.toMillis ? exp.toMillis() : 0;
      if (expMs < nowMs) continue;
      n += Math.max(0, parseInt(b.amount, 10) || 0);
    }
    return n;
  }

  function computeState(walletSnap) {
    var paid = isPaidMember();
    var periodKey = kstYearMonth();
    var monthlyUsed = 0;
    var batches = [];
    if (walletSnap && walletSnap.exists) {
      var d = walletSnap.data();
      batches = Array.isArray(d.batches) ? d.batches : [];
      if (d.monthlyPeriodKey === periodKey) {
        monthlyUsed = parseInt(d.monthlyUsed, 10) || 0;
      }
    }
    var monthlyRemaining = paid ? Math.max(0, 4 - monthlyUsed) : 0;
    var nowMs = Date.now();
    var purchased = sumPurchasedBatches(batches, nowMs);
    return {
      loading: false,
      periodKey: periodKey,
      paid: paid,
      monthlyUsed: monthlyUsed,
      monthlyRemaining: monthlyRemaining,
      purchased: purchased,
      total: monthlyRemaining + purchased
    };
  }

  window.__QUESTION_CREDIT_STATE = {
    loading: true,
    periodKey: "",
    paid: false,
    monthlyUsed: 0,
    monthlyRemaining: 0,
    purchased: 0,
    total: 0
  };

  function renderDashboard() {
    var el = document.getElementById("dashboard-question-credits");
    if (!el) return;
    var s = window.__QUESTION_CREDIT_STATE;
    if (s.loading) {
      el.textContent = "불러오는 중…";
      return;
    }
    var parts = [];
    if (s.paid) {
      parts.push("이번 달(한국시간) 구독 포함 " + s.monthlyRemaining + " / 4건 남음");
    } else {
      parts.push("구독 월간 질문권: 없음(유료 구독 시 매월 4건)");
    }
    parts.push("구매 잔여 " + s.purchased + "건(결제일 기준 1년 유효)");
    parts.push("사용 가능 합계 " + s.total + "건");
    el.textContent = parts.join(" · ");
  }

  function subscribeWallet(uid) {
    if (unsub) {
      unsub();
      unsub = null;
    }
    if (!uid || typeof firebase === "undefined" || !firebase.firestore) {
      window.__QUESTION_CREDIT_STATE = computeState(null);
      window.__QUESTION_CREDIT_STATE.loading = false;
      renderDashboard();
      window.dispatchEvent(new CustomEvent("question-credits-updated"));
      return;
    }
    window.__QUESTION_CREDIT_STATE.loading = true;
    renderDashboard();
    var ref = firebase.firestore().collection("hanlaw_question_wallet").doc(uid);
    unsub = ref.onSnapshot(
      function (snap) {
        window.__QUESTION_CREDIT_STATE = computeState(snap);
        renderDashboard();
        window.dispatchEvent(new CustomEvent("question-credits-updated"));
      },
      function () {
        window.__QUESTION_CREDIT_STATE = computeState(null);
        window.__QUESTION_CREDIT_STATE.loading = false;
        renderDashboard();
        window.dispatchEvent(new CustomEvent("question-credits-updated"));
      }
    );
  }

  window.waitForQuestionCreditState = function (callback) {
    var s = window.__QUESTION_CREDIT_STATE;
    if (!s.loading) {
      callback(s);
      return;
    }
    var t0 = Date.now();
    var id = setInterval(function () {
      s = window.__QUESTION_CREDIT_STATE;
      if (!s.loading || Date.now() - t0 > 8000) {
        clearInterval(id);
        callback(s);
      }
    }, 80);
  };

  window.consumeQuestionCreditCallable = function () {
    if (typeof firebase === "undefined" || !firebase.app || !firebase.functions) {
      return Promise.reject(new Error("Firebase Functions를 불러오지 못했습니다."));
    }
    var region = window.FIREBASE_FUNCTIONS_REGION || "asia-northeast3";
    var fn = firebase.app().functions(region).httpsCallable("consumeQuestionCredit");
    return fn({}).then(function (res) {
      var data = res && res.data;
      if (data && data.ok) return data;
      throw new Error("질문권 차감에 실패했습니다.");
    });
  };

  /** 퀴즈 맥락 + 사용자 질문 → Gemini (일 4회 한도는 서버에서 적용). */
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

  /** 퀴즈 1문제 풀이 후 호출. 실제 Firebase 로그인(목업 제외)일 때만 성공합니다. */
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

  /** 출석 포인트 3,000점 → 질문권 1건(전환 시점부터 1년 유효). */
  window.convertAttendancePointsToQuestionCreditCallable = function () {
    if (typeof firebase === "undefined" || !firebase.app || !firebase.functions) {
      return Promise.reject(new Error("Firebase Functions를 불러오지 못했습니다."));
    }
    var region = window.FIREBASE_FUNCTIONS_REGION || "asia-northeast3";
    var fn = firebase.app().functions(region).httpsCallable("convertAttendancePointsToQuestionCredit");
    return fn({}).then(function (res) {
      return res && res.data ? res.data : {};
    });
  };

  function syncWalletFromUser() {
    var user = typeof window.getHanlawUser === "function" ? window.getHanlawUser() : null;
    subscribeWallet(user ? user.uid : null);
  }

  function bindAuth() {
    try {
      if (firebase.apps && firebase.apps.length) {
        firebase.auth().onAuthStateChanged(function () {
          syncWalletFromUser();
        });
      }
    } catch (e) {
      window.__QUESTION_CREDIT_STATE.loading = false;
      renderDashboard();
    }
    window.addEventListener("app-auth", function () {
      syncWalletFromUser();
    });
    syncWalletFromUser();
  }

  window.addEventListener("membership-updated", function () {
    var user = typeof window.getHanlawUser === "function" ? window.getHanlawUser() : null;
    if (!user || typeof firebase === "undefined" || !firebase.firestore) return;
    firebase
      .firestore()
      .collection("hanlaw_question_wallet")
      .doc(user.uid)
      .get()
      .then(function (snap) {
        window.__QUESTION_CREDIT_STATE = computeState(snap);
        renderDashboard();
        window.dispatchEvent(new CustomEvent("question-credits-updated"));
      })
      .catch(function () {});
  });

  function goQuestionPacks() {
    var navBtn = document.querySelector('.nav-main__btn[data-panel="pricing"]');
    if (navBtn) navBtn.click();
    setTimeout(function () {
      var sec = document.getElementById("pricing-question-packs");
      if (sec) sec.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
  }

  window.goToQuestionPacksSection = goQuestionPacks;

  function initDom() {
    var b = document.getElementById("dashboard-goto-question-packs");
    if (b) b.addEventListener("click", goQuestionPacks);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      initDom();
      bindAuth();
    });
  } else {
    initDom();
    bindAuth();
  }
})();
