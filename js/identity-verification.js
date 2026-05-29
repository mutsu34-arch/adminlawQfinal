(function () {
  var profileUnsub = null;
  var lastProfileUid = null;
  var IDENTITY_PENDING_KEY = "hanlaw_identity_pending";

  function gateEl() {
    return document.getElementById("screen-identity-gate");
  }

  function setGateMsg(text, isError) {
    var el = document.getElementById("identity-gate-msg");
    if (!el) return;
    el.textContent = text || "";
    el.hidden = !text;
    el.classList.toggle("auth-message--error", !!isError);
  }

  function setGateLoading(on) {
    var g = gateEl();
    if (!g) return;
    g.classList.toggle("identity-gate-overlay--loading", !!on);
    var btn = document.getElementById("btn-identity-gate-start");
    if (btn) btn.disabled = !!on;
  }

  function hideGate() {
    var g = gateEl();
    if (!g) return;
    g.hidden = true;
    g.setAttribute("aria-hidden", "true");
    setGateLoading(false);
    setGateMsg("", false);
  }

  function showGateForCheck() {
    var g = gateEl();
    if (!g) return;
    g.hidden = false;
    g.setAttribute("aria-hidden", "false");
    setGateLoading(true);
    setGateMsg("본인인증 상태를 확인하는 중…", false);
  }

  function showGateBlocking() {
    var g = gateEl();
    if (!g) return;
    g.hidden = false;
    g.setAttribute("aria-hidden", "false");
    setGateLoading(false);
    setGateMsg("", false);
  }

  function skipGateUser(user) {
    if (!user || user.isAnonymous) return true;
    if (user === window.__hanlawMockUser) return true;
    return false;
  }

  function isLocalhostHost() {
    try {
      var h = (window.location && window.location.hostname) || "";
      return h === "localhost" || h === "127.0.0.1";
    } catch (e) {
      return false;
    }
  }

  /**
   * 본인인증 게이트를 보이지 않게 할지(로그인·앱 사용은 가능, Firestore 프로필의 identityVerified 는 그대로).
   */
  function shouldBypassIdentityGate(user) {
    if (!user || user.isAnonymous) return true;
    if (user === window.__hanlawMockUser) return true;
    if (window.HANLAW_BYPASS_IDENTITY_GATE === true) return true;
    if (isLocalhostHost() && window.HANLAW_BYPASS_IDENTITY_GATE_ON_LOCALHOST !== false) return true;
    var email = "";
    try {
      email = user.email ? String(user.email).toLowerCase().trim() : "";
    } catch (e2) {
      email = "";
    }
    if (!email) return false;
    if (window.HANLAW_ADMIN_BYPASS_IDENTITY_GATE !== false) {
      var admins = window.ADMIN_EMAILS || [];
      for (var i = 0; i < admins.length; i++) {
        if (String(admins[i]).toLowerCase() === email) return true;
      }
    }
    var extra = window.HANLAW_IDENTITY_GATE_BYPASS_EMAILS || [];
    if (!Array.isArray(extra)) return false;
    for (var j = 0; j < extra.length; j++) {
      if (String(extra[j] || "").toLowerCase().trim() === email) return true;
    }
    return false;
  }

  function fns() {
    var region = window.FIREBASE_FUNCTIONS_REGION || "asia-northeast3";
    return firebase.app().functions(region);
  }

  function loadPortOneSdk() {
    if (
      window.HanlawPortoneCheckout &&
      typeof window.HanlawPortoneCheckout.loadPortOneSdk === "function"
    ) {
      return window.HanlawPortoneCheckout.loadPortOneSdk();
    }
    return Promise.reject(new Error("PortOne 결제 모듈을 불러올 수 없습니다."));
  }

  function callStart(purpose, email) {
    var payload = { purpose: purpose };
    if (purpose === "password_reset" && email) payload.email = String(email).trim().toLowerCase();
    return fns().httpsCallable("startIdentityChallenge")(payload);
  }

  function callFinish(challengeId, identityVerificationId) {
    var payload = { challengeId: challengeId };
    if (identityVerificationId) payload.identityVerificationId = String(identityVerificationId).trim();
    return fns().httpsCallable("finishIdentityChallenge")(payload);
  }

  function userFacingError(e) {
    var msg = e && e.message ? String(e.message) : "";
    if (!msg) return "본인인증에 실패했습니다. 잠시 후 다시 시도해 주세요.";
    if (/본인인증 채널|조건을 만족하는|ALL_CHANNELS|CHANNEL_NOT/i.test(msg)) {
      return (
        msg +
        " PortOne 채널 관리에서 채널 속성이 「본인인증」인 다날 채널 키를 사용 중인지 확인해 주세요. (결제용 채널 키는 사용할 수 없습니다.)"
      );
    }
    return msg;
  }

  function isIdentityRedirectPreferred() {
    try {
      var ua = String(navigator.userAgent || "");
      if (/Android|iPhone|iPad|iPod|Mobile|KAKAOTALK|NAVER|Line/i.test(ua)) return true;
      if (window.matchMedia && window.matchMedia("(max-width: 768px)").matches) return true;
    } catch (e) {}
    return false;
  }

  function buildIdentityRedirectUrl() {
    try {
      var u = new URL(window.location.href);
      u.searchParams.set("hanlaw_identity_return", "1");
      u.hash = "";
      return u.toString();
    } catch (e2) {
      return String(window.location.origin || "") + "/";
    }
  }

  function stashIdentityPending(challengeId, identityVerificationId) {
    try {
      sessionStorage.setItem(
        IDENTITY_PENDING_KEY,
        JSON.stringify({
          challengeId: String(challengeId || "").trim(),
          identityVerificationId: String(identityVerificationId || "").trim(),
          ts: Date.now()
        })
      );
    } catch (e) {}
  }

  function readIdentityPending() {
    try {
      var raw = sessionStorage.getItem(IDENTITY_PENDING_KEY);
      if (!raw) return null;
      var o = JSON.parse(raw);
      if (!o || !o.challengeId) return null;
      if (o.ts && Date.now() - o.ts > 20 * 60 * 1000) return null;
      return o;
    } catch (e) {
      return null;
    }
  }

  function clearIdentityPending() {
    try {
      sessionStorage.removeItem(IDENTITY_PENDING_KEY);
    } catch (e) {}
  }

  function cleanupIdentityReturnParams() {
    try {
      var u = new URL(window.location.href);
      ["hanlaw_identity_return", "identityVerificationId", "code", "message", "pgCode"].forEach(
        function (k) {
          u.searchParams.delete(k);
        }
      );
      window.history.replaceState({}, document.title, u.pathname + (u.search ? u.search : ""));
    } catch (e) {}
    clearIdentityPending();
  }

  function tryHandleIdentityRedirectReturn() {
    var u;
    try {
      u = new URL(window.location.href);
    } catch (e) {
      return Promise.resolve(false);
    }
    if (u.searchParams.get("hanlaw_identity_return") !== "1") return Promise.resolve(false);

    var pending = readIdentityPending();
    var errCode = u.searchParams.get("code");
    var errMsg = u.searchParams.get("message");
    if (errCode) {
      cleanupIdentityReturnParams();
      showGateBlocking();
      setGateMsg(userFacingError({ message: errMsg || errCode }), true);
      return Promise.resolve(true);
    }

    var ivId = String(u.searchParams.get("identityVerificationId") || "").trim();
    if (!ivId && pending) ivId = pending.identityVerificationId;
    if (!pending || !pending.challengeId || !ivId) {
      cleanupIdentityReturnParams();
      showGateBlocking();
      setGateMsg("본인인증 결과를 확인하지 못했습니다. 다시 시도해 주세요.", true);
      return Promise.resolve(true);
    }

    showGateBlocking();
    setGateLoading(true);
    setGateMsg("본인인증 결과를 확인하는 중…", false);
    return callFinish(pending.challengeId, ivId)
      .then(function () {
        setGateMsg("본인인증이 완료되었습니다.", false);
      })
      .catch(function (e) {
        setGateMsg(userFacingError(e), true);
      })
      .then(function () {
        setGateLoading(false);
        cleanupIdentityReturnParams();
      })
      .then(function () {
        return true;
      });
  }

  function openPortOneIdentity(portone, challengeId) {
    if (!portone || !portone.storeId || !portone.identityVerificationId) {
      return Promise.reject(new Error("본인인증을 시작할 수 없습니다."));
    }
    if (!portone.channelKey) {
      return Promise.reject(
        new Error(
          "본인인증 채널 키가 설정되지 않았습니다. PortOne에서 채널 속성 「본인인증」 다날 채널을 추가했는지 확인해 주세요."
        )
      );
    }
    return loadPortOneSdk().then(function (PortOne) {
      if (!PortOne || typeof PortOne.requestIdentityVerification !== "function") {
        throw new Error("본인인증 창을 열 수 없습니다. 잠시 후 다시 시도해 주세요.");
      }
      var payload = {
        storeId: portone.storeId,
        channelKey: portone.channelKey,
        identityVerificationId: portone.identityVerificationId
      };
      if (portone.bypass) payload.bypass = portone.bypass;
      var user = null;
      try {
        user = firebase.auth().currentUser;
      } catch (e0) {}
      if (user && user.uid) {
        payload.customer = { customerId: String(user.uid).slice(0, 20) };
      }
      var useRedirect = isIdentityRedirectPreferred();
      if (useRedirect) {
        stashIdentityPending(challengeId, portone.identityVerificationId);
        payload.redirectUrl = buildIdentityRedirectUrl();
      }
      return PortOne.requestIdentityVerification(payload).then(function (rsp) {
        if (useRedirect) {
          return { redirect: true };
        }
        if (rsp && rsp.code != null) {
          throw new Error(String(rsp.message || rsp.code || "본인인증이 취소되었습니다."));
        }
        return portone.identityVerificationId;
      });
    });
  }

  /**
   * PortOne 본인인증 창 → 서버 검증(finish). mockClientFinish 이면 개발용 모의 완료.
   */
  function runIdentityChain(purpose, email) {
    return callStart(purpose, email).then(function (res) {
      var d = (res && res.data) || {};
      var challengeId = d.challengeId;
      if (!challengeId) throw new Error("본인인증을 시작할 수 없습니다.");

      if (d.mockClientFinish === true && !d.portone) {
        return callFinish(challengeId).then(function (r2) {
          return (r2 && r2.data) || {};
        });
      }

      if (d.portone && d.portone.storeId && d.portone.identityVerificationId) {
        if (!d.portone.channelKey) {
          throw new Error(
            "본인인증 채널 키가 서버에 설정되지 않았습니다. functions/.env 의 PORTONE_CHANNEL_KEY_DANAL_IDENTITY 를 확인한 뒤 Functions를 재배포해 주세요."
          );
        }
        return openPortOneIdentity(d.portone, challengeId).then(function (ivId) {
          if (ivId && typeof ivId === "object" && ivId.redirect) {
            return { pendingRedirect: true };
          }
          return callFinish(challengeId, ivId || d.portone.identityVerificationId).then(function (r2) {
            return (r2 && r2.data) || {};
          });
        });
      }

      if (d.mockClientFinish === true) {
        return callFinish(challengeId).then(function (r2) {
          return (r2 && r2.data) || {};
        });
      }

      throw new Error("본인인증을 시작할 수 없습니다. 잠시 후 다시 시도해 주세요.");
    });
  }

  function updateSettingsIdentityFromData(data) {
    var block = document.getElementById("settings-identity-block");
    var nameEl = document.getElementById("settings-identity-name");
    var phoneEl = document.getElementById("settings-identity-phone");
    var uid = null;
    try {
      if (firebase.auth().currentUser) uid = firebase.auth().currentUser.uid;
    } catch (e) {}
    if (!block || !nameEl || !phoneEl) return;
    if (!uid) {
      block.hidden = true;
      return;
    }
    block.hidden = false;
    if (!data || !data.identityVerified) {
      nameEl.textContent = "미인증";
      phoneEl.textContent = "—";
      return;
    }
    nameEl.textContent = data.verifiedLegalName || "—";
    phoneEl.textContent = data.verifiedPhoneMasked || "—";
  }

  function applyProfileSnap(snap) {
    var data = snap && snap.exists ? snap.data() || {} : {};
    var verified = data.identityVerified === true;
    updateSettingsIdentityFromData(data);
    var u = null;
    try {
      u = firebase.auth().currentUser;
    } catch (e) {}
    if (verified || shouldBypassIdentityGate(u)) {
      hideGate();
    } else {
      showGateBlocking();
    }
    try {
      window.dispatchEvent(new CustomEvent("hanlaw-identity-updated", { detail: { verified: verified } }));
    } catch (e) {}
    return verified;
  }

  function unsubscribeProfile() {
    if (profileUnsub) {
      try {
        profileUnsub();
      } catch (e) {}
      profileUnsub = null;
    }
    lastProfileUid = null;
  }

  function subscribeIdentityProfile(user) {
    unsubscribeProfile();
    if (skipGateUser(user)) {
      hideGate();
      updateSettingsIdentityFromData(null);
      return;
    }
    if (typeof firebase === "undefined" || !firebase.firestore) {
      hideGate();
      return;
    }
    var uid = user.uid;
    lastProfileUid = uid;
    if (shouldBypassIdentityGate(user)) {
      hideGate();
    } else {
      showGateForCheck();
    }
    var ref = firebase.firestore().collection("hanlaw_user_profiles").doc(uid);
    profileUnsub = ref.onSnapshot(
      function (snap) {
        if (!firebase.auth().currentUser || firebase.auth().currentUser.uid !== uid) return;
        applyProfileSnap(snap);
      },
      function () {
        setGateMsg("프로필을 불러오지 못했습니다. 네트워크를 확인한 뒤 새로고침하세요.", true);
        setGateLoading(false);
      }
    );
  }

  function onIdentityGateStart() {
    var user = firebase.auth().currentUser;
    if (!user || skipGateUser(user)) return;
    var btn = document.getElementById("btn-identity-gate-start");
    if (btn) btn.disabled = true;
    setGateMsg("");
    setGateLoading(true);
    runIdentityChain("onboarding", null)
      .then(function (data) {
        if (data && data.pendingRedirect) {
          setGateMsg("본인인증 페이지로 이동합니다…", false);
          return;
        }
        setGateMsg("본인인증이 완료되었습니다.", false);
      })
      .catch(function (e) {
        setGateMsg(userFacingError(e), true);
      })
      .then(function () {
        setGateLoading(false);
        if (btn) btn.disabled = false;
      });
  }

  function onSettingsIdentityRefresh() {
    var user = firebase.auth().currentUser;
    if (!user || skipGateUser(user)) return;
    var msg = document.getElementById("settings-identity-msg");
    var btn = document.getElementById("btn-settings-identity-refresh");
    if (btn) btn.disabled = true;
    if (msg) {
      msg.textContent = "";
      msg.hidden = true;
    }
    runIdentityChain("contact_change", null)
      .then(function () {
        if (msg) {
          msg.textContent = "본인인증을 반영했습니다.";
          msg.hidden = false;
          msg.classList.remove("settings-nickname-msg--error");
        }
      })
      .catch(function (e) {
        var m = userFacingError(e);
        if (msg) {
          msg.textContent = m;
          msg.hidden = false;
          msg.classList.add("settings-nickname-msg--error");
        }
      })
      .then(function () {
        if (btn) btn.disabled = false;
      });
  }

  window.hanlawRunPasswordResetWithIdentity = function (api) {
    if (typeof firebase === "undefined" || !firebase.apps || !firebase.apps.length) {
      api.setAuthMessage("Firebase를 사용할 수 없습니다.", true);
      return;
    }
    var email = api.getLoginEmail();
    if (!email) {
      api.setAuthMessage("비밀번호를 재설정할 계정 이메일을 입력하세요.", true);
      return;
    }
    api.setAuthMessage("");
    api.setLoading(true);
    runIdentityChain("password_reset", email)
      .then(function (data) {
        var link = data && data.resetLink;
        if (link) {
          api.setAuthMessage("본인인증이 완료되었습니다. 잠시 후 비밀번호 재설정 페이지로 이동합니다.", false);
          setTimeout(function () {
            try {
              window.location.href = String(link);
            } catch (e2) {
              window.open(String(link), "_blank", "noopener,noreferrer");
            }
          }, 600);
        } else {
          api.setAuthMessage("재설정 링크를 받지 못했습니다. 잠시 후 다시 시도해 주세요.", true);
        }
      })
      .catch(function (e) {
        var msg = userFacingError(e);
        if (msg.indexOf("permission-denied") >= 0 || msg.indexOf("완료할 수 없습니다") >= 0) {
          api.setAuthMessage("해당 이메일로 가입된 계정이 없거나 요청을 완료할 수 없습니다.", true);
        } else {
          api.setAuthMessage(msg, true);
        }
      })
      .then(function () {
        api.setLoading(false);
      });
  };

  function bindGate() {
    var b1 = document.getElementById("btn-identity-gate-start");
    if (b1) b1.addEventListener("click", onIdentityGateStart);
    var b2 = document.getElementById("btn-identity-gate-logout");
    if (b2) {
      b2.addEventListener("click", function () {
        var lo = document.getElementById("btn-logout");
        if (lo) lo.click();
      });
    }
    var b3 = document.getElementById("btn-settings-identity-refresh");
    if (b3) b3.addEventListener("click", onSettingsIdentityRefresh);
  }

  function initIdentityModule() {
    bindGate();
    function afterAuthReady() {
      tryHandleIdentityRedirectReturn().then(function (handled) {
        if (handled) return;
        var u = firebase.auth().currentUser;
        if (u) subscribeIdentityProfile(u);
      });
    }
    if (typeof firebase !== "undefined" && firebase.auth) {
      firebase.auth().onAuthStateChanged(function (user) {
        if (!user || skipGateUser(user)) {
          subscribeIdentityProfile(user);
          return;
        }
        var u;
        try {
          u = new URL(window.location.href);
        } catch (e) {
          subscribeIdentityProfile(user);
          return;
        }
        if (u.searchParams.get("hanlaw_identity_return") === "1") {
          afterAuthReady();
          return;
        }
        subscribeIdentityProfile(user);
      });
      return;
    }
    afterAuthReady();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initIdentityModule);
  } else {
    initIdentityModule();
  }

  window.addEventListener("app-auth", function (ev) {
    var u = ev.detail && ev.detail.user;
    subscribeIdentityProfile(u);
  });
})();
