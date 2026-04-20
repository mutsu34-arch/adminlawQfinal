/**
 * PayApp 결제창 연동 — https://docs.payapp.kr/dev_center01.html
 * · 일반: payapp-lite.js (setParam → payrequest)
 * · 월 구독 정기결제: setParam → rebill (정기결제 요청 JS)
 * · 금액·상품명·feedbackurl 등은 Cloud Functions(getPayApp*)에서 내려줍니다.
 */
(function () {
  var scriptPromise = null;

  function loadPayAppLite() {
    if (typeof window.PayApp !== "undefined" && window.PayApp && typeof window.PayApp.payrequest === "function") {
      return Promise.resolve();
    }
    if (scriptPromise) return scriptPromise;
    scriptPromise = new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = "https://lite.payapp.kr/public/api/v2/payapp-lite.js";
      s.async = true;
      s.onload = function () {
        resolve();
      };
      s.onerror = function () {
        reject(new Error("페이앱 스크립트를 불러오지 못했습니다."));
      };
      document.head.appendChild(s);
    });
    return scriptPromise;
  }

  /** 결제 완료 후 사용자 브라우저 복귀 URL(쿼리/해시 제거해 중복 방지) */
  function defaultReturnUrl() {
    try {
      var u = new URL(window.location.href);
      u.hash = "";
      return u.toString();
    } catch (e) {
      return String(window.location.href || "").split("#")[0];
    }
  }

  function applyPayAppParams(d) {
    var P = window.PayApp;
    if (!P || typeof P.setParam !== "function" || typeof P.payrequest !== "function") {
      throw new Error("PayApp API를 사용할 수 없습니다.");
    }
    P.setParam("userid", d.userid);
    P.setParam("shopname", d.shopname || "행정법Q");
    P.setParam("goodname", d.goodname || "");
    P.setParam("price", String(d.price));
    P.setParam("feedbackurl", d.feedbackUrl);
    P.setParam("var1", d.var1 || "");
    P.setParam("var2", d.var2 != null ? String(d.var2) : "");
    var buyerShow =
      d.buyerDisplay != null && String(d.buyerDisplay).trim()
        ? String(d.buyerDisplay).trim()
        : d.var1 != null && String(d.var1) !== ""
          ? String(d.var1)
          : "";
    if (buyerShow) {
      P.setParam("buyerid", buyerShow);
    }
    if (d.recvemail) {
      P.setParam("recvemail", String(d.recvemail).trim());
    }
    var memo = d.memo != null ? String(d.memo).trim() : "";
    if (memo) {
      P.setParam("memo", memo);
    }
    var ret = (d.returnUrl && String(d.returnUrl).trim()) || defaultReturnUrl();
    if (ret) {
      P.setParam("returnurl", ret);
    }
    if (d.checkretry) P.setParam("checkretry", d.checkretry);
    if (d.charset) {
      var cs = String(d.charset).toLowerCase();
      if (cs && cs !== "utf-8") P.setParam("charset", d.charset);
    }
    if (d.recvphone) P.setParam("recvphone", String(d.recvphone));
    P.payrequest();
  }

  /** 월 정기구독 — 페이앱 정기결제 요청(JS) PayApp.rebill() */
  function applyPayAppRebillParams(d) {
    var P = window.PayApp;
    if (!P || typeof P.setParam !== "function" || typeof P.rebill !== "function") {
      throw new Error("PayApp 정기결제(rebill) API를 사용할 수 없습니다.");
    }
    P.setParam("userid", d.userid);
    P.setParam("goodname", d.goodname || "");
    P.setParam("goodprice", String(d.goodprice));
    P.setParam("recvphone", d.recvphone);
    P.setParam("feedbackurl", d.feedbackUrl);
    if (d.failUrl) P.setParam("failurl", d.failUrl);
    P.setParam("var1", d.var1 || "");
    if (d.var2 != null) P.setParam("var2", String(d.var2));
    var buyerShowR =
      d.buyerDisplay != null && String(d.buyerDisplay).trim()
        ? String(d.buyerDisplay).trim()
        : d.var1 != null && String(d.var1) !== ""
          ? String(d.var1)
          : "";
    if (buyerShowR) {
      P.setParam("buyerid", buyerShowR);
    }
    if (d.recvemail) {
      P.setParam("recvemail", String(d.recvemail).trim());
    }
    var memo = d.memo != null ? String(d.memo).trim() : "";
    if (memo) P.setParam("memo", memo);
    if (d.smsuse) P.setParam("smsuse", d.smsuse);
    P.setParam("rebillCycleType", d.rebillCycleType || "Month");
    P.setParam("rebillCycleMonth", String(d.rebillCycleMonth != null ? d.rebillCycleMonth : "15"));
    P.setParam("rebillExpire", d.rebillExpire || "");
    if (d.checkretry) P.setParam("checkretry", d.checkretry);
    if (d.charset) {
      var csr = String(d.charset).toLowerCase();
      if (csr && csr !== "utf-8") P.setParam("charset", d.charset);
    }
    var ret = (d.returnUrl && String(d.returnUrl).trim()) || defaultReturnUrl();
    if (ret) P.setParam("returnurl", ret);
    P.rebill();
  }

  /** 정기결제용 휴대폰 (페이앱 필수) — 한 번 입력하면 세션에 저장 */
  function getRecvPhoneForRebill() {
    try {
      var s = sessionStorage.getItem("hanlaw_payapp_recvphone");
      if (s) {
        var d0 = String(s).replace(/\D/g, "");
        if (d0.length >= 10 && d0.length <= 11 && d0.indexOf("01") === 0) return d0;
      }
    } catch (e) {}
    var raw = window.prompt(
      "월 정기구독은 페이앱 정기결제 안내를 위해 휴대폰 번호가 필요합니다.\n숫자만 입력하세요. (예: 01012345678)",
      ""
    );
    if (!raw) return "";
    var digits = String(raw).replace(/\D/g, "");
    if (digits.length < 10 || digits.length > 11 || digits.indexOf("01") !== 0) {
      window.alert("올바른 휴대폰 번호(010…)를 입력해 주세요.");
      return "";
    }
    try {
      sessionStorage.setItem("hanlaw_payapp_recvphone", digits);
    } catch (e2) {}
    return digits;
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

  function enrichCheckoutPayload(d) {
    if (!d || typeof d !== "object") return d;
    d.returnUrl = d.returnUrl || defaultReturnUrl();
    d.memo = d.memo != null ? d.memo : "행정법Q 웹결제";
    return d;
  }

  function startPayAppPack(pack) {
    if (!requireLoginAndFirebase()) return;
    var region = window.FIREBASE_FUNCTIONS_REGION || "asia-northeast3";
    var fn = firebase.app().functions(region).httpsCallable("getPayAppQuestionPackCheckout");
    fn({ pack: pack })
      .then(function (res) {
        var d = res && res.data;
        if (!d || !d.userid || !d.feedbackUrl) {
          throw new Error("서버 응답이 올바르지 않습니다.");
        }
        enrichCheckoutPayload(d);
        return loadPayAppLite().then(function () {
          applyPayAppParams(d);
        });
      })
      .catch(function (e) {
        var msg = (e && e.message) ? String(e.message) : "결제를 시작할 수 없습니다.";
        if (e && e.code === "functions/failed-precondition") {
          msg = e.message || msg;
        }
        window.alert(msg);
      });
  }

  function startPayAppEllyPack(pack) {
    if (!requireLoginAndFirebase()) return;
    var region = window.FIREBASE_FUNCTIONS_REGION || "asia-northeast3";
    var fn = firebase.app().functions(region).httpsCallable("getPayAppEllyQuestionPackCheckout");
    fn({ pack: pack })
      .then(function (res) {
        var d = res && res.data;
        if (!d || !d.userid || !d.feedbackUrl) {
          throw new Error("서버 응답이 올바르지 않습니다.");
        }
        enrichCheckoutPayload(d);
        return loadPayAppLite().then(function () {
          applyPayAppParams(d);
        });
      })
      .catch(function (e) {
        var msg = e && e.message ? String(e.message) : "결제를 시작할 수 없습니다.";
        if (e && e.code === "functions/failed-precondition") {
          msg = e.message || msg;
        }
        window.alert(msg);
      });
  }

  function startPayAppSubscription(plan) {
    if (!requireLoginAndFirebase()) return;
    var payload = { plan: plan };
    if (plan === "monthly") {
      var phone = getRecvPhoneForRebill();
      if (!phone) return;
      payload.recvphone = phone;
    }
    var region = window.FIREBASE_FUNCTIONS_REGION || "asia-northeast3";
    var fn = firebase.app().functions(region).httpsCallable("getPayAppSubscriptionCheckout");
    fn(payload)
      .then(function (res) {
        var d = res && res.data;
        if (!d || !d.userid || !d.feedbackUrl) {
          throw new Error("서버 응답이 올바르지 않습니다.");
        }
        enrichCheckoutPayload(d);
        return loadPayAppLite().then(function () {
          if (d.payMode === "rebill") {
            applyPayAppRebillParams(d);
          } else {
            applyPayAppParams(d);
          }
        });
      })
      .catch(function (e) {
        var msg = (e && e.message) ? String(e.message) : "결제를 시작할 수 없습니다.";
        if (e && e.code === "functions/failed-precondition") {
          msg = e.message || msg;
        }
        window.alert(msg);
      });
  }

  function bind() {
    document.body.addEventListener("click", function (e) {
      var packBtn = e.target && e.target.closest ? e.target.closest("[data-payapp-pack]") : null;
      if (packBtn) {
        var pack = parseInt(packBtn.getAttribute("data-payapp-pack") || "0", 10);
        if (pack === 1 || pack === 10) {
          e.preventDefault();
          startPayAppPack(pack);
        }
        return;
      }
      var ellyPackBtn = e.target && e.target.closest ? e.target.closest("[data-payapp-elly-pack]") : null;
      if (ellyPackBtn) {
        var ep = parseInt(ellyPackBtn.getAttribute("data-payapp-elly-pack") || "0", 10);
        if (ep === 10 || ep === 50 || ep === 100) {
          e.preventDefault();
          startPayAppEllyPack(ep);
        }
        return;
      }
      var subBtn = e.target && e.target.closest ? e.target.closest("[data-payapp-sub]") : null;
      if (subBtn) {
        var plan = subBtn.getAttribute("data-payapp-sub") || "";
        if (
          plan === "monthly" ||
          plan === "yearly" ||
          plan === "twoYear" ||
          plan === "nonrenew1m" ||
          plan === "nonrenew3m" ||
          plan === "nonrenew6m"
        ) {
          e.preventDefault();
          startPayAppSubscription(plan);
        }
      }
    });

    var dashBuy = document.getElementById("dashboard-buy-question-credits");
    if (dashBuy) {
      dashBuy.addEventListener("click", function () {
        startPayAppPack(1);
      });
    }

    var docBtn = document.getElementById("btn-payapp-docs");
    if (docBtn) {
      docBtn.addEventListener("click", function () {
        var u =
          (window.PAYAPP_CONFIG && window.PAYAPP_CONFIG.docsUrl) ||
          "https://docs.payapp.kr/dev_center01.html";
        window.open(u, "_blank", "noopener,noreferrer");
      });
    }
    var refundBtn = document.getElementById("btn-payapp-refund-contact");
    if (refundBtn) {
      refundBtn.addEventListener("click", function () {
        var cfg = window.PAYAPP_CONFIG || {};
        var email = (cfg.merchantSupportEmail || "").trim();
        if (email) {
          window.location.href =
            "mailto:" +
            email +
            "?subject=" +
            encodeURIComponent("[행정법Q] 환불·결제 문의");
          return;
        }
        window.open(
          cfg.docsUrl || "https://docs.payapp.kr/dev_center01.html",
          "_blank",
          "noopener,noreferrer"
        );
      });
    }

    var rebillCancelBtn = document.getElementById("dashboard-payapp-rebill-cancel");
    if (rebillCancelBtn) {
      rebillCancelBtn.addEventListener("click", function () {
        if (typeof firebase === "undefined" || !firebase.functions || !firebase.apps || !firebase.apps.length) {
          window.alert("Firebase를 사용할 수 없습니다.");
          return;
        }
        if (typeof window.getHanlawUser !== "function" || !window.getHanlawUser()) {
          window.alert("로그인 후 이용할 수 있습니다.");
          return;
        }
        if (
          !window.confirm(
            "월 구독(PayApp 정기결제)을 해지할까요? 다음 자동 결제 주기부터 청구되지 않습니다. 이미 납부한 기간의 혜택은 유지됩니다."
          )
        ) {
          return;
        }
        var region = window.FIREBASE_FUNCTIONS_REGION || "asia-northeast3";
        var fn = firebase.app().functions(region).httpsCallable("cancelPayAppRebill");
        fn({})
          .then(function () {
            window.alert("정기결제 해지가 처리되었습니다.");
            try {
              sessionStorage.removeItem("hanlaw_payapp_recvphone");
            } catch (e) {}
          })
          .catch(function (e) {
            var msg = e && e.message ? String(e.message) : "해지 처리에 실패했습니다.";
            if (e && e.code === "functions/failed-precondition") msg = e.message || msg;
            if (e && e.code === "functions/internal") msg = e.message || msg;
            window.alert(msg);
          });
      });
    }
  }

  window.HanlawPayAppCheckout = {
    loadPayAppLite: loadPayAppLite,
    startPayAppPack: startPayAppPack,
    startPayAppEllyPack: startPayAppEllyPack,
    startPayAppSubscription: startPayAppSubscription,
    applyPayAppRebillParams: applyPayAppRebillParams
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }
})();
