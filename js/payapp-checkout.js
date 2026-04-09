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
    if (d.checkretry) P.setParam("checkretry", d.checkretry);
    if (d.charset) P.setParam("charset", d.charset);
    P.payrequest();
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

  function startPayAppSubscription(plan) {
    if (!requireLoginAndFirebase()) return;
    var region = window.FIREBASE_FUNCTIONS_REGION || "asia-northeast3";
    var fn = firebase.app().functions(region).httpsCallable("getPayAppSubscriptionCheckout");
    fn({ plan: plan })
      .then(function (res) {
        var d = res && res.data;
        if (!d || !d.userid || !d.feedbackUrl) {
          throw new Error("서버 응답이 올바르지 않습니다.");
        }
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

  function bind() {
    document.querySelectorAll("[data-payapp-pack]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var pack = parseInt(btn.getAttribute("data-payapp-pack") || "0", 10);
        if (pack !== 1 && pack !== 10) return;
        startPayAppPack(pack);
      });
    });
    document.querySelectorAll("[data-payapp-sub]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var plan = btn.getAttribute("data-payapp-sub") || "";
        if (plan !== "monthly" && plan !== "yearly" && plan !== "twoYear") return;
        startPayAppSubscription(plan);
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }
})();
