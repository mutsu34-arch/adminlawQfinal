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
    if (v === "kakaopay") return "kakaopay";
    if (v === "danal") return "danal";
    return "kpn";
  }

  function selectedDanalPayMethod() {
    var checked = document.querySelector('input[name="pricing-danal-paymethod"]:checked');
    var v = checked ? String(checked.value || "").trim().toUpperCase() : "";
    if (v === "MOBILE") return "MOBILE";
    return "CARD";
  }

  function buildReturnUrl(extraParams) {
    try {
      var u = new URL(window.location.href);
      u.searchParams.set("portone_return", "1");
      u.hash = "";
      if (extraParams && typeof extraParams === "object") {
        Object.keys(extraParams).forEach(function (k) {
          var v = extraParams[k];
          if (v != null && String(v).trim()) u.searchParams.set(k, String(v).trim());
        });
      }
      return u.toString();
    } catch (e) {
      return String(window.location.href || "").split("#")[0];
    }
  }

  function buildBillingReturnUrl(intentId, product) {
    return buildReturnUrl({
      portone_billing: "1",
      intentId: intentId,
      portone_product: product
    });
  }

  function stashBillingReturnContext(intentId, product) {
    try {
      sessionStorage.setItem(
        "hanlaw_portone_billing_ctx",
        JSON.stringify({
          intentId: String(intentId || "").trim(),
          product: String(product || "").trim(),
          ts: Date.now()
        })
      );
    } catch (e) {}
  }

  function readBillingReturnContext() {
    try {
      var raw = sessionStorage.getItem("hanlaw_portone_billing_ctx");
      if (!raw) return null;
      var ctx = JSON.parse(raw);
      if (!ctx || typeof ctx !== "object") return null;
      return ctx;
    } catch (e) {
      return null;
    }
  }

  function clearBillingReturnContext() {
    try {
      sessionStorage.removeItem("hanlaw_portone_billing_ctx");
    } catch (e) {}
  }

  function cleanupReturnParams() {
    try {
      var u = new URL(window.location.href);
      [
        "portone_return",
        "portone_billing",
        "portone_product",
        "intentId",
        "billingKey",
        "billing_key",
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
      clearBillingReturnContext();
    } catch (e) {}
  }

  function stashOnetimePaymentProduct(paymentId, product) {
    try {
      sessionStorage.setItem(
        "hanlaw_portone_pay_product_" + String(paymentId || "").trim(),
        String(product || "").trim()
      );
    } catch (e) {}
  }

  function readOnetimePaymentProduct(paymentId) {
    try {
      return sessionStorage.getItem("hanlaw_portone_pay_product_" + String(paymentId || "").trim()) || "";
    } catch (e) {
      return "";
    }
  }

  function completePaymentById(paymentId) {
    var region = window.FIREBASE_FUNCTIONS_REGION || "asia-northeast3";
    var complete = firebase.app().functions(region).httpsCallable("completePortOnePayment");
    var maxAttempts = 8;
    var attempt = 0;

    function tryOnce() {
      attempt += 1;
      return complete({ paymentId: paymentId }).catch(function (e) {
        var msg = e && e.message ? String(e.message) : "";
        var code = e && e.code ? String(e.code) : "";
        var retryable =
          attempt < maxAttempts &&
          (code === "functions/failed-precondition" || code === "functions/internal") &&
          (msg.indexOf("완료되지") >= 0 ||
            msg.indexOf("형식") >= 0 ||
            msg.indexOf("not found") >= 0 ||
            msg.indexOf("찾을 수 없") >= 0);
        if (!retryable) throw e;
        return new Promise(function (resolve) {
          window.setTimeout(resolve, 1200);
        }).then(tryOnce);
      });
    }

    return tryOnce();
  }

  function completeRecurringByBillingKey(intentId, billingKey) {
    var region = window.FIREBASE_FUNCTIONS_REGION || "asia-northeast3";
    var completeRecurring = firebase
      .app()
      .functions(region)
      .httpsCallable("completePortOneRecurringFirstPayment");
    return completeRecurring({ intentId: intentId, billingKey: billingKey });
  }

  function waitForAuthReady(retryCount, maxRetry) {
    if (typeof window.getHanlawUser === "function" && window.getHanlawUser()) {
      return Promise.resolve(true);
    }
    if (retryCount >= maxRetry) return Promise.resolve(false);
    return new Promise(function (resolve) {
      window.setTimeout(function () {
        resolve(waitForAuthReady(retryCount + 1, maxRetry));
      }, 500);
    });
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
    var m = window.APP_MEMBERSHIP || {};
    var usePayapp = !!(m && m.payappRebillActive);
    var fnName = usePayapp ? "cancelPayAppRebill" : "cancelPortOneRecurring";
    var fn = firebase.app().functions(region).httpsCallable(fnName);
    fn({})
      .then(function () {
        window.alert(usePayapp ? "페이앱 정기결제가 해지되었습니다." : "정기결제가 해지되었습니다.");
        try {
          window.dispatchEvent(
            new CustomEvent("app-auth", {
              detail: { user: typeof window.getHanlawUser === "function" ? window.getHanlawUser() : null }
            })
          );
        } catch (e) {}
      })
      .catch(function (e) {
        var msg = e && e.message ? String(e.message) : "정기결제 해지에 실패했습니다.";
        window.alert(msg);
      });
  }

  function tryHandleBillingRedirectReturn(u) {
    var billingKey = String(
      u.searchParams.get("billingKey") || u.searchParams.get("billing_key") || ""
    ).trim();
    var intentId = String(u.searchParams.get("intentId") || "").trim();
    var product = String(u.searchParams.get("portone_product") || "").trim();
    var ctx = readBillingReturnContext();
    if (!intentId && ctx) intentId = String(ctx.intentId || "").trim();
    if (!product && ctx) product = String(ctx.product || "").trim();

    if (!billingKey) {
      cleanupReturnParams();
      window.alert(
        "카드 등록 결과를 확인하지 못했습니다. 브라우저 팝업 차단을 해제한 뒤 다시 시도해 주세요."
      );
      return Promise.resolve();
    }
    if (!intentId) {
      cleanupReturnParams();
      window.alert("정기결제 준비 정보가 없습니다. 다시 시도해 주세요.");
      return Promise.resolve();
    }

    var dedupKey = "hanlaw_portone_billing_done_" + intentId;
    try {
      if (sessionStorage.getItem(dedupKey) === "1") {
        cleanupReturnParams();
        return Promise.resolve();
      }
      sessionStorage.setItem(dedupKey, "1");
    } catch (e) {}

    return completeRecurringByBillingKey(intentId, billingKey)
      .then(function () {
        cleanupReturnParams();
        return handlePaymentSuccess(product);
      })
      .catch(function (e) {
        try {
          sessionStorage.removeItem(dedupKey);
        } catch (_) {}
        cleanupReturnParams();
        var msg = e && e.message ? String(e.message) : "정기결제를 완료할 수 없습니다.";
        if (e && e.code === "functions/failed-precondition") msg = e.message || msg;
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
    var isBilling = u.searchParams.get("portone_billing") === "1";
    var paymentId = String(
      u.searchParams.get("paymentId") || u.searchParams.get("payment_id") || ""
    ).trim();
    var billingKey = String(
      u.searchParams.get("billingKey") || u.searchParams.get("billing_key") || ""
    ).trim();
    var code = String(u.searchParams.get("code") || "").trim();
    var message = String(u.searchParams.get("message") || "").trim();
    if (!hasReturn) return;
    if (!paymentId && !code && !isBilling && !billingKey) return;

    if (code) {
      cleanupReturnParams();
      window.alert(
        message ||
          (isBilling
            ? "카드 등록이 취소되었거나 실패했습니다."
            : "결제가 취소되었거나 실패했습니다.")
      );
      return;
    }

    if (redirectReturnInFlight) return;
    redirectReturnInFlight = true;

    waitForAuthReady(retryCount, maxRetry).then(function (ready) {
      if (!ready) {
        redirectReturnInFlight = false;
        return;
      }

      var done;
      if (isBilling || billingKey) {
        done = tryHandleBillingRedirectReturn(u);
      } else if (paymentId) {
        var dedupKey = "hanlaw_portone_return_done_" + paymentId;
        try {
          if (sessionStorage.getItem(dedupKey) === "1") {
            cleanupReturnParams();
            redirectReturnInFlight = false;
            return;
          }
          sessionStorage.setItem(dedupKey, "1");
        } catch (e) {}

        var productFromUrl = String(u.searchParams.get("portone_product") || "").trim();
        var productForSuccess =
          productFromUrl || readOnetimePaymentProduct(paymentId) || "";
        done = completePaymentById(paymentId)
          .then(function () {
            cleanupReturnParams();
            return handlePaymentSuccess(productForSuccess);
          })
          .catch(function (e) {
            try {
              sessionStorage.removeItem(dedupKey);
            } catch (_) {}
            cleanupReturnParams();
            var msg = e && e.message ? String(e.message) : "결제 완료 처리에 실패했습니다.";
            window.alert(msg);
          });
      } else {
        cleanupReturnParams();
        done = Promise.resolve();
      }

      Promise.resolve(done).then(function () {
        redirectReturnInFlight = false;
      });
    });
  }

  function startPortOneProduct(product) {
    if (!requireLoginAndFirebase()) return;
    var region = window.FIREBASE_FUNCTIONS_REGION || "asia-northeast3";
    var prepare = firebase.app().functions(region).httpsCallable("preparePortOnePayment");
    // 정기 구독권(recurring_*)은 빌링키 발급 -> 첫 결제(서버) 흐름으로 처리합니다.
    if (String(product || "").indexOf("recurring_") === 0) {
      var prepRecurring = firebase.app().functions(region).httpsCallable("preparePortOneRecurringBillingKey");
      var completeRecurring = firebase.app().functions(region).httpsCallable("completePortOneRecurringFirstPayment");
      var selectedPg = selectedPgProvider();
      if (selectedPg === "danal") {
        window.alert("다날은 현재 정기결제(자동결제)를 지원하지 않습니다. 단건 결제를 이용해 주세요.");
        return;
      }
      var recurringPayload = { product: product, pgProvider: selectedPg };
      if (selectedPg === "danal") {
        recurringPayload.payMethod = selectedDanalPayMethod();
      }
      prepRecurring(recurringPayload)
        .then(function (res) {
          var d = res && res.data;
          if (!d || !d.storeId || !d.channelKey || !d.issueId) throw new Error("서버에서 정기결제 정보를 받지 못했습니다.");
          var tr = d.recurringTransition || {};
          if (tr.remainingDays > 0 && tr.message) {
            var proceed = window.confirm(tr.message + "\n\n정기 구독을 계속 진행하시겠습니까?");
            if (!proceed) throw new Error("결제가 취소되었습니다.");
          }
          stashBillingReturnContext(d.intentId, product);
          return loadPortOneSdk().then(function (PortOne) {
            var user = window.getHanlawUser();
            var email = user && user.email ? String(user.email) : "";
            var issuePayload = {
              storeId: d.storeId,
              channelKey: d.channelKey,
              billingKeyMethod: d.billingKeyMethod || "CARD",
              issueId: d.issueId,
              issueName: d.issueName || "정기결제 카드 등록",
              customer: d.customer || {}
            };
            if (email) {
              issuePayload.customer = Object.assign({}, issuePayload.customer || {}, { email: email });
            }
            if (Number.isFinite(Number(d.displayAmount)) && Number(d.displayAmount) > 0) {
              issuePayload.displayAmount = Number(d.displayAmount);
            }
            if (d.currency) {
              issuePayload.currency = String(d.currency);
            }
            if (String(issuePayload.billingKeyMethod || "").toUpperCase() === "EASY_PAY") {
              var easyProvider = String(d.easyPayProvider || "KAKAOPAY").trim().toUpperCase();
              issuePayload.easyPay = { easyPayProvider: easyProvider || "KAKAOPAY" };
            }
            if (d.bypass) {
              issuePayload.bypass = d.bypass;
            }
            var pgLower = String(d.pgProvider || "").toLowerCase();
            // KPN(FirstPay) 빌링키: iframe 팝업 인증 실패 방지 — 단건과 같이 리다이렉트 권장
            if (cfg().preferRedirect === true && pgLower !== "kakaopay") {
              issuePayload.redirectUrl = buildBillingReturnUrl(d.intentId, product);
              issuePayload.forceRedirect = true;
            } else if (pgLower === "galaxia") {
              issuePayload.redirectUrl = buildBillingReturnUrl(d.intentId, product);
            }
            var isGalaxia = String(d.pgProvider || "").toLowerCase() === "galaxia";
            if (!isGalaxia && d.offerPeriod && d.offerPeriod.range && d.offerPeriod.range.from && d.offerPeriod.range.to) {
              issuePayload.offerPeriod = {
                range: {
                  from: String(d.offerPeriod.range.from),
                  to: String(d.offerPeriod.range.to)
                }
              };
            } else if (!isGalaxia && d.offerPeriod && d.offerPeriod.from && d.offerPeriod.to) {
              // 하위호환: 구 포맷 수신 시 range로 변환
              issuePayload.offerPeriod = {
                range: {
                  from: String(d.offerPeriod.from),
                  to: String(d.offerPeriod.to)
                }
              };
            }
            return PortOne.requestIssueBillingKey(issuePayload).then(function (rsp) {
              if (rsp && rsp.code != null) {
                throw new Error(String(rsp.message || rsp.code || "카드 등록이 취소되었습니다."));
              }
              var billingKey = rsp && rsp.billingKey ? String(rsp.billingKey) : "";
              if (!billingKey) throw new Error("빌링키를 발급받지 못했습니다.");
              return completeRecurring({ intentId: d.intentId, billingKey: billingKey });
            });
          });
        })
        .then(function () {
          return handlePaymentSuccess(product);
        })
        .catch(function (e) {
          try {
            console.error("[PortOne] recurring flow failed:", e);
          } catch (_) {}
          var msg = e && e.message ? String(e.message) : "정기결제를 완료할 수 없습니다.";
          if (e && e.code === "functions/failed-precondition") msg = e.message || msg;
          window.alert(msg);
        });
      return;
    }

    var selectedPg = selectedPgProvider();
    var preparePayload = { product: product, pgProvider: selectedPg };
    if (selectedPg === "danal") {
      preparePayload.payMethod = selectedDanalPayMethod();
    }
    prepare(preparePayload)
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
          if (d.customer && typeof d.customer === "object") {
            payload.customer = Object.assign({}, d.customer);
          }
          if (d.bypass) {
            payload.bypass = d.bypass;
          }
          if (d.offerPeriod && d.offerPeriod.range && d.offerPeriod.range.from && d.offerPeriod.range.to) {
            payload.offerPeriod = {
              range: {
                from: String(d.offerPeriod.range.from),
                to: String(d.offerPeriod.range.to)
              }
            };
          } else if (d.offerPeriod && d.offerPeriod.from && d.offerPeriod.to) {
            // 하위호환: 구 포맷 수신 시 range로 변환
            payload.offerPeriod = {
              range: {
                from: String(d.offerPeriod.from),
                to: String(d.offerPeriod.to)
              }
            };
          }
          if (payload.payMethod === "EASY_PAY") {
            var provider = String(d.easyPayProvider || "KAKAOPAY").trim().toUpperCase();
            payload.easyPay = { easyPayProvider: provider || "KAKAOPAY" };
          }
          if (cfg().preferRedirect === true && payload.payMethod !== "EASY_PAY") {
            payload.redirectUrl = buildReturnUrl({ portone_product: product });
            payload.forceRedirect = true;
          }
          stashOnetimePaymentProduct(d.paymentId, product);
          if (email) {
            payload.customer = Object.assign({}, payload.customer || {}, { email: email });
          }
          if (String(d.pgProvider || "").toLowerCase() === "galaxia") {
            payload.redirectUrl = buildReturnUrl();
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
