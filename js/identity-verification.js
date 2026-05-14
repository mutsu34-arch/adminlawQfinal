(function () {
  var profileUnsub = null;
  var lastProfileUid = null;

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

  function callStart(purpose, email) {
    var payload = { purpose: purpose };
    if (purpose === "password_reset" && email) payload.email = String(email).trim().toLowerCase();
    return fns().httpsCallable("startIdentityChallenge")(payload);
  }

  function callFinish(challengeId) {
    return fns().httpsCallable("finishIdentityChallenge")({ challengeId: challengeId });
  }

  /**
   * 모의 모드: 시작 직후 finish 한 번 호출. 실연동 시 표준창·웹훅 후 finish 호출로 교체.
   */
  function runIdentityChain(purpose, email) {
    return callStart(purpose, email).then(function (res) {
      var d = (res && res.data) || {};
      var challengeId = d.challengeId;
      if (!challengeId) throw new Error("challengeId 없음");
      if (!d.mockClientFinish) {
        throw new Error(
          "서버에서 모의 본인인증이 비활성입니다. Functions 환경변수 HANLAW_IDENTITY_MOCK=1 후 배포하거나, 다날·포트원 본인확인 연동을 완료하세요."
        );
      }
      return callFinish(challengeId).then(function (r2) {
        return (r2 && r2.data) || {};
      });
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
    runIdentityChain("onboarding", null)
      .then(function () {
        setGateMsg("본인인증이 완료되었습니다.", false);
      })
      .catch(function (e) {
        var msg = e && e.message ? String(e.message) : "본인인증에 실패했습니다.";
        setGateMsg(msg, true);
      })
      .then(function () {
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
        var m = e && e.message ? String(e.message) : "본인인증에 실패했습니다.";
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
        var msg = e && e.message ? String(e.message) : "요청에 실패했습니다.";
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

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindGate);
  } else {
    bindGate();
  }

  try {
    if (typeof firebase !== "undefined" && firebase.auth) {
      firebase.auth().onAuthStateChanged(function (user) {
        subscribeIdentityProfile(user);
      });
    }
  } catch (e) {}

  window.addEventListener("app-auth", function (ev) {
    var u = ev.detail && ev.detail.user;
    subscribeIdentityProfile(u);
  });
})();
