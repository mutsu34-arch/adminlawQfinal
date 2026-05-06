/**
 * PortOne V2 결제창 — 한국결제네트웍스(KPN) 등 채널은 콘솔 채널 키로 지정
 * @see https://help.portone.io/content/kpn
 */
(function () {
  var redirectReturnRetryTimer = null;
  var redirectReturnInFlight = false;

  function cfg() {
    return window.PORTONE_CONFIG || {};
  }

  function isEnabled() {
    return cfg().enabled === true;
  }

  var portoneScriptPromise = null;

  function loadPortOneSdk() {
    if (typeof window.PortOne !== "undefined" && window.PortOne && typeof window.PortOne.requestPayment === "function") {
      return Promise.resolve(window.PortOne);
    }
    if (portoneScriptPromise) return portoneScriptPromise;
    portoneScriptPromise = new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = String(cfg().sdkUrl || "https://cdn.portone.io/v2/browser-sdk.js");
      s.async = true;
      s.onload = function () {
        if (window.PortOne && typeof window.PortOne.requestPayment === "function") {
          resolve(window.PortOne);
        } else {
          reject(new Error("PortOne SDK를 초기화할 수 없습니다."));
        }
      };
      s.onerror = function () {
        reject(new Error("PortOne 스크립트를 불러오지 못했습니다."));
      };
      document.head.appendChild(s);
    });
    return portoneScriptPromise;
  }

  function requireLoginAndFirebase() {
    if (typeof firebase === "undefined" || !firebase.functions || !firebase.apps || !firebase.apps.length) {
      window.alert("Firebase를 사용할 수 없습니다.");
      return false;
    }
    if (typeof window.getHanlawUser !== "function" || !window.getHanlawUser()) {
      window.alert("로그인 후 이용할 수 있습니다.");
      return false;
    }
    return true;
  }

  function selectedPgProvider() {
    var checked = document.querySelector('input[name="pricing-pg"]:checked');
    var v = checked ? String(checked.value || "").trim().toLowerCase() : "";
    if (v === "galaxia") return "galaxia";
    return "kpn";
  }

  function buildReturnUrl() {
    try {
      var u = new URL(window.location.href);
      u.searchParams.set("portone_return", "1");
      u.hash = "";
      return u.toString();
    } catch (e) {
      return String(window.location.href || "").split("#")[0];
    }
  }

  function cleanupReturnParams() {
    try {
      var u = new URL(window.location.href);
      [
        "portone_return",
        "paymentId",
        "payment_id",
        "code",
        "message",
        "pgCode",
        "transactionType"
      ].forEach(function (k) {
        u.searchParams.delete(k);
      });
      window.history.replaceState({}, document.title, u.pathname + (u.search ? u.search : ""));
    } catch (e) {}
  }

  function completePaymentById(paymentId) {
    var region = window.FIREBASE_FUNCTIONS_REGION || "asia-northeast3";
    var complete = firebase.app().functions(region).httpsCallable("completePortOnePayment");
    return complete({ paymentId: paymentId });
  }

  function isPaidMembershipNow() {
    var m = window.APP_MEMBERSHIP || {};
    return m.tier === "paid";
  }

  function navigatePanel(panelId) {
    if (typeof window.hanlawNavigateToPanel === "function") {
      window.hanlawNavigateToPanel(panelId, { syncUrl: true });
      return;
    }
    var navBtn = document.querySelector('.nav-main__btn[data-panel="' + panelId + '"]');
    if (navBtn && !navBtn.hidden) navBtn.click();
  }

  function closePaymentSuccessModal() {
    var modal = document.getElementById("payment-success-modal");
    if (!modal) return;
    modal.hidden = true;
    modal.setAttribute("aria-hidden", "true");
  }

  function openPaymentSuccessModal(detail) {
    var modal = document.getElementById("payment-success-modal");
    var msg = document.getElementById("payment-success-message");
    var member = document.getElementById("payment-success-membership");
    if (!modal || !msg) {
      window.alert((detail && detail.message) || "결제가 완료되었습니다.");
      return;
    }
    msg.textContent = (detail && detail.message) || "결제가 완료되었습니다.";
    if (member) {
      if (detail && detail.membershipText) {
        member.textContent = detail.membershipText;
        member.hidden = false;
      } else {
        member.textContent = "";
        member.hidden = true;
      }
    }
    modal.hidden = false;
    modal.setAttribute("aria-hidden", "false");
  }

  function waitForMembershipReflection(expectPaid, timeoutMs) {
    if (!expectPaid) return Promise.resolve(false);
    return new Promise(function (resolve) {
      var done = false;
      var timer = null;
      function finish(v) {
        if (done) return;
        done = true;
        if (timer) clearTimeout(timer);
        window.removeEventListener("membership-updated", onUpdated);
        resolve(!!v);
      }
      function onUpdated(e) {
        var d = (e && e.detail) || window.APP_MEMBERSHIP || {};
        if (d && d.tier === "paid") finish(true);
      }
      if (isPaidMembershipNow()) {
        resolve(true);
        return;
      }
      window.addEventListener("membership-updated", onUpdated);
      try {
        window.dispatchEvent(
          new CustomEvent("app-auth", {
            detail: { user: typeof window.getHanlawUser === "function" ? window.getHanlawUser() : null }
          })
        );
      } catch (e) {}
      timer = setTimeout(function () {
        finish(isPaidMembershipNow());
      }, Math.max(1500, Number(timeoutMs) || 8000));
    });
  }

  function isSubscriptionProduct(product) {
    var p = String(product || "");
    return p.indexOf("one_month_") === 0 || p.indexOf("recurring_") === 0;
  }

  function handlePaymentSuccess(product) {
    var expectPaid = isSubscriptionProduct(product);
    return waitForMembershipReflection(expectPaid, 9000).then(function (isPaid) {
      var membershipText = "";
      if (isPaid) {
        membershipText = "회원 등급이 유료회원으로 반영되었습니다.";
      } else if (expectPaid) {
        membershipText = "결제는 성공했습니다. 회원 등급은 잠시 후 자동 반영됩니다.";
      }
      openPaymentSuccessModal({
        message: "결제가 완료되었습니다. 아래 버튼에서 바로 학습을 이어가세요.",
        membershipText: membershipText
      });
      try {
        window.dispatchEvent(new CustomEvent("membership-updated"));
      } catch (e) {}
    });
  }

  function cancelRecurring() {
    if (!requireLoginAndFirebase()) return;
    if (!window.confirm("정기결제를 해지하시겠습니까? 다음 결제일부터 자동청구가 중단됩니다.")) return;
    var region = window.FIREBASE_FUNCTIONS_REGION || "asia-northeast3";
    var fn = firebase.app().functions(region).httpsCallable("cancelPortOneRecurring");
    fn({})
      .then(function () {
        window.alert("정기결제가 해지되었습니다.");
      })
      .catch(function (e) {
        var msg = e && e.message ? String(e.message) : "정기결제 해지에 실패했습니다.";
        window.alert(msg);
      });
  }

  function tryHandleRedirectReturn(attempt) {
    var retryCount = Number(attempt) || 0;
    var maxRetry = 20;
    if (typeof firebase === "undefined" || !firebase.functions || !firebase.apps || !firebase.apps.length) return;
    var u;
    try {
      u = new URL(window.location.href);
    } catch (e) {
      return;
    }
    var hasReturn = u.searchParams.get("portone_return") === "1";
    var paymentId = String(
      u.searchParams.get("paymentId") || u.searchParams.get("payment_id") || ""
    ).trim();
    var code = String(u.searchParams.get("code") || "").trim();
    var message = String(u.searchParams.get("message") || "").trim();
    if (!hasReturn || (!paymentId && !code)) return;

    if (code) {
      cleanupReturnParams();
      window.alert(message || "결제가 취소되었거나 실패했습니다.");
      return;
    }
    if (!paymentId) {
      cleanupReturnParams();
      return;
    }

    // 리다이렉트 직후에는 auth 복원이 늦어질 수 있으므로 짧게 재시도합니다.
    if (typeof window.getHanlawUser !== "function" || !window.getHanlawUser()) {
      if (retryCount < maxRetry) {
        if (redirectReturnRetryTimer) window.clearTimeout(redirectReturnRetryTimer);
        redirectReturnRetryTimer = window.setTimeout(function () {
          tryHandleRedirectReturn(retryCount + 1);
        }, 500);
      }
      return;
    }

    if (redirectReturnInFlight) return;
    redirectReturnInFlight = true;

    // 새로고침 등으로 중복 완료 호출을 막습니다.
    var dedupKey = "hanlaw_portone_return_done_" + paymentId;
    try {
      if (sessionStorage.getItem(dedupKey) === "1") {
        cleanupReturnParams();
        redirectReturnInFlight = false;
        return;
      }
      sessionStorage.setItem(dedupKey, "1");
    } catch (e) {}

    completePaymentById(paymentId)
      .then(function () {
        cleanupReturnParams();
        return handlePaymentSuccess("");
      })
      .catch(function (e) {
        try {
          sessionStorage.removeItem(dedupKey);
        } catch (_) {}
        cleanupReturnParams();
        var msg = e && e.message ? String(e.message) : "결제 완료 처리에 실패했습니다.";
        window.alert(msg);
      })
      .then(function () {
        redirectReturnInFlight = false;
      });
  }

  function startPortOneProduct(product) {
    if (!requireLoginAndFirebase()) return;
    var region = window.FIREBASE_FUNCTIONS_REGION || "asia-northeast3";
    var prepare = firebase.app().functions(region).httpsCallable("preparePortOnePayment");
    prepare({ product: product, pgProvider: selectedPgProvider() })
      .then(function (res) {
        var d = res && res.data;
        if (!d || !d.paymentId || !d.storeId || !d.channelKey) {
          throw new Error("서버에서 결제 정보를 받지 못했습니다.");
        }
        return loadPortOneSdk().then(function (PortOne) {
          var user = window.getHanlawUser();
          var email = user && user.email ? String(user.email) : "";
          var payload = {
            storeId: d.storeId,
            channelKey: d.channelKey,
            paymentId: d.paymentId,
            orderName: d.orderName,
            totalAmount: d.totalAmount,
            currency: d.currency || "CURRENCY_KRW",
            payMethod: d.payMethod || "CARD"
          };
          if (payload.payMethod === "EASY_PAY") {
            var provider = String(d.easyPayProvider || "KAKAOPAY").trim().toUpperCase();
            payload.easyPay = { easyPayProvider: provider || "KAKAOPAY" };
          }
          if (cfg().preferRedirect === true && payload.payMethod !== "EASY_PAY") {
            payload.redirectUrl = buildReturnUrl();
            payload.forceRedirect = true;
          }
          if (email) {
            payload.customer = { email: email };
          }
          return PortOne.requestPayment(payload).then(function (rsp) {
            // redirectUrl 모드에서는 이 then이 실행되지 않을 수 있습니다.
            if (rsp && rsp.code != null) {
              throw new Error(String(rsp.message || rsp.code || "결제가 취소되었습니다."));
            }
            return completePaymentById(d.paymentId);
          });
        });
      })
      .then(function () {
        return handlePaymentSuccess(product);
      })
      .catch(function (e) {
        try {
          console.error("[PortOne] requestPayment failed:", e);
        } catch (_) {}
        var msg = e && e.message ? String(e.message) : "결제를 완료할 수 없습니다.";
        if (e && e.code === "functions/failed-precondition") msg = e.message || msg;
        window.alert(msg);
      });
  }

  function bindPortOneProductClicks() {
    document.body.addEventListener(
      "click",
      function (e) {
        if (!isEnabled()) return;
        var target =
          e.target && e.target.closest ? e.target.closest("[data-portone-product]") : null;
        if (!target) return;
        var product = String(target.getAttribute("data-portone-product") || "").trim();
        if (!product) return;
        e.preventDefault();
        e.stopPropagation();
        startPortOneProduct(product);
      },
      true
    );
  }

  window.HanlawPortoneCheckout = {
    isEnabled: isEnabled,
    startPortOneProduct: startPortOneProduct
  };

  function init() {
    bindPortOneProductClicks();
    tryHandleRedirectReturn();
    window.addEventListener("app-auth", function () {
      tryHandleRedirectReturn();
    });
    var cancelBtn = document.getElementById("dashboard-portone-recurring-cancel-btn");
    if (cancelBtn) cancelBtn.addEventListener("click", cancelRecurring);
    var closeBtn = document.getElementById("payment-success-close");
    if (closeBtn) closeBtn.addEventListener("click", closePaymentSuccessModal);
    var goDashboardBtn = document.getElementById("payment-success-go-dashboard");
    if (goDashboardBtn) {
      goDashboardBtn.addEventListener("click", function () {
        closePaymentSuccessModal();
        navigatePanel("dashboard");
      });
    }
    var goQuizBtn = document.getElementById("payment-success-go-quiz");
    if (goQuizBtn) {
      goQuizBtn.addEventListener("click", function () {
        closePaymentSuccessModal();
        navigatePanel("quiz");
      });
    }
    var modal = document.getElementById("payment-success-modal");
    if (modal) {
      modal.addEventListener("click", function (e) {
        if (e.target === modal) closePaymentSuccessModal();
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
