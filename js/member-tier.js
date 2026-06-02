(function () {
  var COLLECTION = "hanlaw_members";
  var unsub = null;

  function normalizeEllyDailyTier(raw) {
    var t = String(raw || "basic").toLowerCase();
    if (t === "super" || t === "ultra") return t;
    return "basic";
  }

  window.APP_MEMBERSHIP = {
    tier: "free",
    paidUntil: null,
    ellyDailyTier: "basic",
    loading: false,
    payappRebillActive: false,
    portoneRecurringActive: false,
    canCancelRecurring: false,
    canRefundOneMonth: false,
    isAdmin: false,
    recurringCancelled: false,
    recurringCancelledAt: null
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

  function openRefundRequest() {
    var m = window.APP_MEMBERSHIP || {};
    if (!m || m.tier !== "paid" || !m.canRefundOneMonth) {
      window.alert(
        "환불 요청은 1개월 구독권(자동 정기 결제가 아닌 경우)으로 결제한 회원에게 표시됩니다. 정기 결제 해지는 대시보드의 「정기결제 해지」를 이용해 주세요. 그 외 문의는 하단 고객 채팅으로 남겨 주세요."
      );
      return;
    }
    if (typeof window.openHanlawTicketModal === "function") {
      window.openHanlawTicketModal("refund");
      window.setTimeout(function () {
        var body = $("ticket-modal-body");
        if (body && !String(body.value || "").trim()) {
          body.value =
            "[환불 요청]\n" +
            "상품: 1개월 이용권\n" +
            "결제일: \n" +
            "요청 사유: \n" +
            "연락 가능한 이메일: ";
          try {
            body.dispatchEvent(new Event("input", { bubbles: true }));
          } catch (_) {}
        }
      }, 0);
      return;
    }
    window.open("/legal/refund-policy.html", "_blank", "noopener,noreferrer");
  }

  function updateDom() {
    var m = window.APP_MEMBERSHIP;
    var tier = m.tier || "free";
    var isAdmin = !!m.isAdmin;
    var label = isAdmin ? "관리자" : membershipLabel(tier);
    var dashLabel = isAdmin ? "관리자 · 유료권한" : membershipLabel(tier);

    var badge = $("user-membership");
    if (badge) {
      badge.textContent = label;
      badge.classList.remove("user-membership--free", "user-membership--paid");
      badge.classList.add(tier === "paid" ? "user-membership--paid" : "user-membership--free");
      badge.hidden = false;
    }

    var dash = $("dashboard-membership");
    if (dash) {
      dash.textContent = dashLabel;
      dash.classList.remove("dashboard-membership--free", "dashboard-membership--paid", "dashboard-membership--admin");
      if (isAdmin) {
        dash.classList.add("dashboard-membership--admin");
      } else {
        dash.classList.add(tier === "paid" ? "dashboard-membership--paid" : "dashboard-membership--free");
      }
    }

    var adminNote = $("dashboard-membership-admin-note");
    if (adminNote) {
      adminNote.hidden = !isAdmin;
    }

    var hint = $("dashboard-membership-hint");
    if (hint) {
      hint.hidden = isAdmin || tier === "paid";
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

    var rebillWrap = $("dashboard-portone-recurring-cancel-wrap");
    var rebillBtn = $("dashboard-portone-recurring-cancel-btn");
    var cancelledWrap = $("dashboard-recurring-cancelled-wrap");
    var cancelledAtEl = $("dashboard-recurring-cancelled-at");
    var pricingWrap = $("dashboard-goto-pricing-wrap");
    var refundWrap = $("dashboard-one-month-refund-wrap");
    var refundBtn = $("dashboard-one-month-refund-btn");
    var showCancel = tier === "paid" && !!m.canCancelRecurring;
    var showRecurringCancelled = tier === "paid" && !!m.recurringCancelled;
    var showGotoPricing = showRecurringCancelled;
    var showRefund = tier === "paid" && !!m.canRefundOneMonth;
    if (rebillWrap) {
      rebillWrap.hidden = !showCancel;
    }
    if (rebillBtn) {
      rebillBtn.disabled = !showCancel;
    }
    if (cancelledWrap) {
      cancelledWrap.hidden = !showRecurringCancelled;
    }
    if (cancelledAtEl) {
      if (showRecurringCancelled && m.recurringCancelledAt) {
        cancelledAtEl.textContent =
          "해지 신청일: " +
          m.recurringCancelledAt.toLocaleDateString("ko-KR", {
            year: "numeric",
            month: "long",
            day: "numeric"
          }) +
          " · 다음 결제일부터 자동 청구되지 않습니다.";
        cancelledAtEl.hidden = false;
      } else {
        cancelledAtEl.textContent = "다음 결제일부터 자동 청구되지 않습니다.";
        cancelledAtEl.hidden = !showRecurringCancelled;
      }
    }
    if (pricingWrap) {
      pricingWrap.hidden = !showGotoPricing;
    }
    if (refundWrap) {
      refundWrap.hidden = !showRefund;
    }
    if (refundBtn) {
      refundBtn.disabled = !showRefund;
    }
  }

  function parseCancelledAt(d) {
    if (!d) return null;
    var ts =
      d.portoneRecurringCancelledAt ||
      d.payappRebillCancelledAt ||
      null;
    if (ts && typeof ts.toDate === "function") return ts.toDate();
    return null;
  }

  function hadRecurringHistory(d) {
    if (!d) return false;
    var recurringProduct = String(d.portoneRecurringProduct || "").trim();
    var lastPlan = String(d.lastPortonePlanKey || "").trim();
    return (
      recurringProduct.indexOf("recurring_") === 0 ||
      lastPlan === "portone_recurring_1m" ||
      !!String(d.portoneBillingKey || "").trim() ||
      !!String(d.payappRebillCancelledNo || "").trim() ||
      !!(d.payappRebillCancelledAt && typeof d.payappRebillCancelledAt.toDate === "function")
    );
  }

  function applySnapshot(docSnap) {
    var paidUntil = null;
    var tier = "free";
    var d = null;
    if (docSnap.exists) {
      d = docSnap.data();
      tier = resolveTier(d);
      if (tier === "paid" && d.paidUntil && typeof d.paidUntil.toMillis === "function") {
        paidUntil = d.paidUntil;
      }
    }
    // 관리자 계정은 항상 유료 권한으로 처리
    var u = typeof window.getHanlawUser === "function" ? window.getHanlawUser() : null;
    var rebillActive = !!(d && d.payappRebillNo);
    var recurringStatus = String((d && d.portoneRecurringStatus) || "").trim().toLowerCase();
    var autoRenewEnabled = !!(d && d.portoneAutoRenewEnabled === true);
    var portoneRecurringActive =
      tier === "paid" &&
      autoRenewEnabled &&
      recurringStatus !== "cancelled";
    var canCancelRecurring = tier === "paid" && (portoneRecurringActive || rebillActive);
    var recurringCancelled =
      tier === "paid" &&
      !canCancelRecurring &&
      (recurringStatus === "cancelled" ||
        !!(d && d.payappRebillCancelledAt) ||
        (hadRecurringHistory(d) && !autoRenewEnabled && !rebillActive));
    var recurringCancelledAt = recurringCancelled ? parseCancelledAt(d) : null;
    var product = String(
      (d && d.lastPortoneProduct) ||
        (d && d.portoneProduct) ||
        (d && d.portoneRecurringProduct) ||
        ""
    ).trim();
    var planLabel = String((d && d.portonePlanLabel) || "").trim();
    var lastPlan = String((d && d.lastPortonePlanKey) || "").trim();
    var hadOneMonth = !!(d && d.portoneOneMonthPurchase === true);
    var canRefundOneMonth =
      tier === "paid" &&
      !canCancelRecurring &&
      (hadOneMonth ||
        product.indexOf("one_month_") === 0 ||
        planLabel === "portone_1m" ||
        lastPlan === "portone_1m");
    var ellyTier = "basic";
    if (d && tier === "paid") {
      ellyTier = normalizeEllyDailyTier(d.ellyDailyTier);
    }
    var isAdmin = isAdminEmail(u);
    if (isAdmin) {
      tier = "paid";
      paidUntil = null;
      rebillActive = false;
      portoneRecurringActive = false;
      canCancelRecurring = false;
      canRefundOneMonth = false;
      recurringCancelled = false;
      recurringCancelledAt = null;
      ellyTier = "ultra";
    }
    window.APP_MEMBERSHIP = {
      tier: tier,
      paidUntil: paidUntil,
      ellyDailyTier: ellyTier,
      loading: false,
      payappRebillActive: rebillActive,
      portoneRecurringActive: portoneRecurringActive,
      canCancelRecurring: canCancelRecurring,
      canRefundOneMonth: canRefundOneMonth,
      isAdmin: isAdmin,
      recurringCancelled: recurringCancelled,
      recurringCancelledAt: recurringCancelledAt
    };
    updateDom();
    window.dispatchEvent(
      new CustomEvent("membership-updated", { detail: window.APP_MEMBERSHIP })
    );
  }

  function resetMembership() {
    window.APP_MEMBERSHIP = {
      tier: "free",
      paidUntil: null,
      ellyDailyTier: "basic",
      loading: false,
      payappRebillActive: false,
      portoneRecurringActive: false,
      canCancelRecurring: false,
      canRefundOneMonth: false,
      isAdmin: false,
      recurringCancelled: false,
      recurringCancelledAt: null
    };
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
    var rebillWrapReset = $("dashboard-portone-recurring-cancel-wrap");
    if (rebillWrapReset) rebillWrapReset.hidden = true;
    var rebillBtnReset = $("dashboard-portone-recurring-cancel-btn");
    if (rebillBtnReset) rebillBtnReset.disabled = true;
    var cancelledWrapReset = $("dashboard-recurring-cancelled-wrap");
    if (cancelledWrapReset) cancelledWrapReset.hidden = true;
    var pricingWrapReset = $("dashboard-goto-pricing-wrap");
    if (pricingWrapReset) pricingWrapReset.hidden = true;
    var refundWrapReset = $("dashboard-one-month-refund-wrap");
    if (refundWrapReset) refundWrapReset.hidden = true;
    var refundBtnReset = $("dashboard-one-month-refund-btn");
    if (refundBtnReset) refundBtnReset.disabled = true;
    var adminNoteReset = $("dashboard-membership-admin-note");
    if (adminNoteReset) adminNoteReset.hidden = true;
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
      window.APP_MEMBERSHIP = {
        tier: "paid",
        paidUntil: null,
        ellyDailyTier: "ultra",
        loading: false,
        payappRebillActive: false,
        portoneRecurringActive: false,
        canCancelRecurring: false,
        canRefundOneMonth: false,
        isAdmin: true,
        recurringCancelled: false,
        recurringCancelledAt: null
      };
      updateDom();
      window.dispatchEvent(
        new CustomEvent("membership-updated", { detail: window.APP_MEMBERSHIP })
      );
      return;
    }

    var db = getDb();
    if (!db) {
      window.APP_MEMBERSHIP = {
        tier: "free",
        paidUntil: null,
        ellyDailyTier: "basic",
        loading: false,
        payappRebillActive: false,
        portoneRecurringActive: false,
        canCancelRecurring: false,
        canRefundOneMonth: false
      };
      updateDom();
      return;
    }

    window.APP_MEMBERSHIP = {
      tier: "free",
      paidUntil: null,
      ellyDailyTier: "basic",
      loading: true,
      payappRebillActive: false,
      portoneRecurringActive: false,
      canCancelRecurring: false,
      canRefundOneMonth: false
    };
    updateDom();

    unsub = db
      .collection(COLLECTION)
      .doc(user.uid)
      .onSnapshot(applySnapshot, function (err) {
        console.warn("회원 등급 로드 실패:", err);
        window.APP_MEMBERSHIP = {
          tier: "free",
          paidUntil: null,
          ellyDailyTier: "basic",
          loading: false,
          payappRebillActive: false,
          portoneRecurringActive: false,
          canCancelRecurring: false,
          canRefundOneMonth: false
        };
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
    var pricingBtn = $("dashboard-goto-pricing-btn");
    if (pricingBtn) pricingBtn.addEventListener("click", goPricingPanel);
    var refundBtn = $("dashboard-one-month-refund-btn");
    if (refundBtn) refundBtn.addEventListener("click", openRefundRequest);
  });
})();
