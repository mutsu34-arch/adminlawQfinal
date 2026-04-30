/**
 * PortOne V2 결제창 — 한국결제네트웍스(KPN) 등 채널은 콘솔 채널 키로 지정
 * @see https://help.portone.io/content/kpn
 */
(function () {
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

  function startPortOneProduct(product) {
    if (!requireLoginAndFirebase()) return;
    var region = window.FIREBASE_FUNCTIONS_REGION || "asia-northeast3";
    var prepare = firebase.app().functions(region).httpsCallable("preparePortOnePayment");
    prepare({ product: product })
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
          if (email) {
            payload.customer = { email: email };
          }
          return PortOne.requestPayment(payload).then(function (rsp) {
            if (rsp && rsp.code != null) {
              throw new Error(String(rsp.message || rsp.code || "결제가 취소되었습니다."));
            }
            var complete = firebase.app().functions(region).httpsCallable("completePortOnePayment");
            return complete({ paymentId: d.paymentId });
          });
        });
      })
      .then(function () {
        window.alert("결제가 완료되었습니다. 잠시 후 요금제·대시보드에 반영됩니다.");
        try {
          window.dispatchEvent(new CustomEvent("membership-updated"));
        } catch (e) {}
      })
      .catch(function (e) {
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
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
