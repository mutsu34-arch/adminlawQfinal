(function () {
  var COLLECTION = "hanlaw_members";
  var unsub = null;

  window.APP_MEMBERSHIP = {
    tier: "free",
    paidUntil: null,
    loading: false
  };

  function getDb() {
    if (typeof firebase === "undefined" || !firebase.apps || !firebase.apps.length) return null;
    try {
      return firebase.firestore();
    } catch (e) {
      return null;
    }
  }

  function isAdminEmail(user) {
    if (!user || !user.email) return false;
    var emails = window.ADMIN_EMAILS || [];
    var mail = String(user.email).toLowerCase();
    for (var i = 0; i < emails.length; i++) {
      if (String(emails[i]).toLowerCase() === mail) return true;
    }
    return false;
  }

  function resolveTier(data) {
    if (!data || data.membershipTier !== "paid") return "free";
    var until = data.paidUntil;
    if (until && typeof until.toMillis === "function") {
      if (until.toMillis() < Date.now()) return "free";
    }
    return "paid";
  }

  function membershipLabel(tier) {
    return tier === "paid" ? "유료회원" : "무료회원";
  }

  function $(id) {
    return document.getElementById(id);
  }

  function goPricingPanel() {
    var navBtn = document.querySelector('.nav-main__btn[data-panel="pricing"]');
    if (navBtn) navBtn.click();
  }

  function updateDom() {
    var m = window.APP_MEMBERSHIP;
    var tier = m.tier || "free";
    var label = membershipLabel(tier);

    var badge = $("user-membership");
    if (badge) {
      badge.textContent = label;
      badge.classList.remove("user-membership--free", "user-membership--paid");
      badge.classList.add(tier === "paid" ? "user-membership--paid" : "user-membership--free");
      badge.hidden = false;
    }

    var dash = $("dashboard-membership");
    if (dash) {
      dash.textContent = label;
      dash.classList.remove("dashboard-membership--free", "dashboard-membership--paid");
      dash.classList.add(tier === "paid" ? "dashboard-membership--paid" : "dashboard-membership--free");
    }

    var hint = $("dashboard-membership-hint");
    if (hint) {
      hint.hidden = tier === "paid";
    }

    var untilEl = $("dashboard-membership-until");
    if (untilEl) {
      if (tier === "paid" && m.paidUntil && typeof m.paidUntil.toDate === "function") {
        untilEl.textContent =
          "이용 기한: " +
          m.paidUntil.toDate().toLocaleDateString("ko-KR", {
            year: "numeric",
            month: "long",
            day: "numeric"
          });
        untilEl.hidden = false;
      } else {
        untilEl.textContent = "";
        untilEl.hidden = true;
      }
    }
  }

  function applySnapshot(docSnap) {
    var paidUntil = null;
    var tier = "free";
    if (docSnap.exists) {
      var d = docSnap.data();
      tier = resolveTier(d);
      if (tier === "paid" && d.paidUntil && typeof d.paidUntil.toMillis === "function") {
        paidUntil = d.paidUntil;
      }
    }
    // 관리자 계정은 항상 유료 권한으로 처리
    var u = typeof window.getHanlawUser === "function" ? window.getHanlawUser() : null;
    if (isAdminEmail(u)) {
      tier = "paid";
      paidUntil = null;
    }
    window.APP_MEMBERSHIP = {
      tier: tier,
      paidUntil: paidUntil,
      loading: false
    };
    updateDom();
    window.dispatchEvent(
      new CustomEvent("membership-updated", { detail: window.APP_MEMBERSHIP })
    );
  }

  function resetMembership() {
    window.APP_MEMBERSHIP = { tier: "free", paidUntil: null, loading: false };
    var badge = $("user-membership");
    if (badge) {
      badge.textContent = "";
      badge.hidden = true;
    }
    var dash = $("dashboard-membership");
    if (dash) {
      dash.textContent = "—";
      dash.classList.remove("dashboard-membership--free", "dashboard-membership--paid");
    }
    var hint = $("dashboard-membership-hint");
    if (hint) hint.hidden = true;
    var untilEl = $("dashboard-membership-until");
    if (untilEl) {
      untilEl.textContent = "";
      untilEl.hidden = true;
    }
    window.dispatchEvent(
      new CustomEvent("membership-updated", { detail: window.APP_MEMBERSHIP })
    );
  }

  window.isPaidMember = function () {
    return window.APP_MEMBERSHIP && window.APP_MEMBERSHIP.tier === "paid";
  };

  function subscribeMember(user) {
    if (unsub) {
      unsub();
      unsub = null;
    }
    if (!user) {
      resetMembership();
      return;
    }

    // 관리자 계정은 Firestore 문서와 무관하게 즉시 유료 적용
    if (isAdminEmail(user)) {
      window.APP_MEMBERSHIP = { tier: "paid", paidUntil: null, loading: false };
      updateDom();
      window.dispatchEvent(
        new CustomEvent("membership-updated", { detail: window.APP_MEMBERSHIP })
      );
      return;
    }

    var db = getDb();
    if (!db) {
      window.APP_MEMBERSHIP = { tier: "free", paidUntil: null, loading: false };
      updateDom();
      return;
    }

    window.APP_MEMBERSHIP = { tier: "free", paidUntil: null, loading: true };
    updateDom();

    unsub = db
      .collection(COLLECTION)
      .doc(user.uid)
      .onSnapshot(applySnapshot, function (err) {
        console.warn("회원 등급 로드 실패:", err);
        window.APP_MEMBERSHIP = { tier: "free", paidUntil: null, loading: false };
        updateDom();
      });
  }

  window.addEventListener("app-auth", function (e) {
    subscribeMember(e.detail ? e.detail.user : null);
  });

  try {
    if (typeof firebase !== "undefined" && firebase.apps && firebase.apps.length && firebase.auth) {
      firebase.auth().onAuthStateChanged(function () {
        subscribeMember(typeof window.getHanlawUser === "function" ? window.getHanlawUser() : null);
      });
    }
  } catch (e) {}

  subscribeMember(typeof window.getHanlawUser === "function" ? window.getHanlawUser() : null);

  document.addEventListener("DOMContentLoaded", function () {
    var b = $("dashboard-goto-pricing");
    if (b) b.addEventListener("click", goPricingPanel);
  });
})();
