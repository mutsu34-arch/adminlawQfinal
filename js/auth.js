(function () {
  var auth = null;
  var googleProvider = null;

  var el = {
    shell: document.getElementById("app-shell"),
    authScreen: document.getElementById("screen-auth"),
    tabLogin: document.getElementById("auth-tab-login"),
    tabSignup: document.getElementById("auth-tab-signup"),
    panelLogin: document.getElementById("auth-panel-login"),
    panelSignup: document.getElementById("auth-panel-signup"),
    loginEmail: document.getElementById("login-email"),
    loginPassword: document.getElementById("login-password"),
    btnLogin: document.getElementById("btn-email-login"),
    btnGoogle: document.getElementById("btn-google-login"),
    btnGoogleSignup: document.getElementById("btn-google-signup"),
    btnReset: document.getElementById("btn-password-reset"),
    signupEmail: document.getElementById("signup-email"),
    signupPassword: document.getElementById("signup-password"),
    signupPassword2: document.getElementById("signup-password2"),
    signupAgreeAll: document.getElementById("signup-agree-all"),
    signupAgreeTerms: document.getElementById("signup-agree-terms"),
    signupAgreePrivacy: document.getElementById("signup-agree-privacy"),
    btnSignup: document.getElementById("btn-email-signup"),
    authMsg: document.getElementById("auth-message"),
    configWarn: document.getElementById("auth-config-warn"),
    userBar: document.getElementById("user-bar"),
    userEmail: document.getElementById("user-email"),
    btnLogout: document.getElementById("btn-logout"),
    btnOpenAuth: document.getElementById("btn-open-auth"),
    btnAuthClose: document.getElementById("btn-auth-close"),
    notifWrap: document.getElementById("header-notif-wrap")
  };

  function isConfigReady() {
    var c = window.FIREBASE_CONFIG || {};
    if (!c.apiKey || !c.projectId) return false;
    if (String(c.apiKey).indexOf("YOUR_") === 0) return false;
    return true;
  }

  function updateFirebaseHeaderHint() {
    var h = document.getElementById("header-firebase-hint");
    if (!h) return;
    if (typeof firebase === "undefined") {
      h.hidden = false;
      h.textContent =
        "Firebase SDK를 불러오지 못했습니다. 네트워크와 스크립트 로드 순서를 확인하세요.";
      return;
    }
    if (!isConfigReady()) {
      h.hidden = false;
      h.textContent =
        "Firebase가 아직 설정되지 않았습니다. 로그인·문항 동기화는 js/firebase-config.js를 채운 뒤 이용하세요. 퀴즈·사전은 먼저 둘러보실 수 있습니다.";
      return;
    }
    h.hidden = true;
    h.textContent = "";
  }

  function setAuthMessage(text, isError) {
    el.authMsg.textContent = text || "";
    el.authMsg.classList.toggle("auth-message--error", !!isError);
    el.authMsg.hidden = !text;
  }

  /** 저장된 닉네임만 사용. 없으면 호칭은 「사용자」(이메일·displayName으로 대체하지 않음) */
  function pickGreetingName(user) {
    if (!user) return "";
    if (typeof window.getHanlawNickname === "function") {
      var n = String(window.getHanlawNickname() || "").trim();
      if (n) return n;
    }
    return "사용자";
  }

  function renderUserGreeting(user) {
    if (!el.userEmail) return;
    if (!user) {
      el.userEmail.textContent = "로그인 전 (퀴즈·사전은 둘러보기 가능)";
      return;
    }
    var name = pickGreetingName(user);
    el.userEmail.textContent = name + " 님, 반갑습니다.";
  }

  function firebaseErrorToKo(err) {
    if (!err || !err.code) return err && err.message ? err.message : "요청에 실패했습니다.";
    var map = {
      "auth/email-already-in-use": "이미 사용 중인 이메일입니다.",
      "auth/invalid-email": "이메일 형식이 올바르지 않습니다.",
      "auth/operation-not-allowed": "콘솔에서 해당 로그인 방식을 켜 주세요.",
      "auth/weak-password": "비밀번호는 6자 이상으로 설정하세요.",
      "auth/user-disabled": "비활성화된 계정입니다.",
      "auth/user-not-found": "이메일 또는 비밀번호가 올바르지 않습니다.",
      "auth/wrong-password": "이메일 또는 비밀번호가 올바르지 않습니다.",
      "auth/invalid-credential": "이메일 또는 비밀번호가 올바르지 않습니다.",
      "auth/too-many-requests": "시도가 너무 많습니다. 잠시 후 다시 시도하세요.",
      "auth/popup-closed-by-user": "팝업이 닫혀 로그인이 취소되었습니다.",
      "auth/cancelled-popup-request": "이미 다른 로그인 창이 열려 있습니다.",
      "auth/network-request-failed": "네트워크 오류입니다. 연결을 확인하세요."
    };
    return map[err.code] || err.message || "오류가 발생했습니다.";
  }

  function showTabs(isLogin) {
    el.tabLogin.classList.toggle("auth-tab--active", isLogin);
    el.tabSignup.classList.toggle("auth-tab--active", !isLogin);
    el.panelLogin.hidden = !isLogin;
    el.panelSignup.hidden = isLogin;
    setAuthMessage("");
  }

  function closeAuthOverlay() {
    el.authScreen.hidden = true;
    el.authScreen.setAttribute("aria-hidden", "true");
    setAuthMessage("");
  }

  function openAuthOverlay() {
    el.authScreen.hidden = false;
    el.authScreen.setAttribute("aria-hidden", "false");
    if (!el.configWarn) return;
    if (typeof firebase === "undefined") {
      el.configWarn.textContent =
        "Firebase SDK를 불러오지 못했습니다. 네트워크와 script 순서를 확인하세요.";
      el.configWarn.hidden = false;
    } else if (!isConfigReady()) {
      el.configWarn.textContent =
        "js/firebase-config.js에 Firebase 웹 앱 설정값을 입력한 뒤 새로고침하세요. 로컬 테스트 시 http://localhost 로 여는 것을 권장합니다.";
      el.configWarn.hidden = false;
    } else {
      el.configWarn.hidden = true;
    }
  }

  function showApp(user) {
    closeAuthOverlay();
    if (window.__hanlawMockUser && user !== window.__hanlawMockUser) {
      window.__hanlawMockUser = null;
    }
    el.shell.hidden = false;
    el.userBar.hidden = false;
    updateFirebaseHeaderHint();
    if (user) {
      el.userBar.classList.remove("user-bar--guest");
      el.userBar.classList.add("user-bar--logged");
      renderUserGreeting(user);
      if (el.btnOpenAuth) el.btnOpenAuth.hidden = true;
      if (el.btnLogout) el.btnLogout.hidden = false;
      if (el.notifWrap) el.notifWrap.hidden = false;
    }
    window.dispatchEvent(new CustomEvent("app-auth", { detail: { user: user } }));
    if (user && typeof window.loadRemoteQuestions === "function") {
      window.loadRemoteQuestions();
    }
  }

  /** 익명 세션은 게스트 UI 유지, 실제 계정만 로그인 상태 표시 */
  function dispatchGuestAuthEvent() {
    var evtUser = null;
    try {
      if (typeof firebase !== "undefined" && firebase.auth) {
        var cu = firebase.auth().currentUser;
        if (cu && cu.isAnonymous) evtUser = cu;
      }
    } catch (e) {}
    window.dispatchEvent(new CustomEvent("app-auth", { detail: { user: evtUser } }));
  }

  function createMockAdminUser() {
    var email = String(window.MOCK_ADMIN_EMAIL || "admin@mock.hanlaw.local").toLowerCase();
    return {
      uid: "mock-admin-uid",
      email: email,
      displayName: "목업 관리자",
      emailVerified: true,
      isAnonymous: false,
      getIdToken: function () {
        return Promise.resolve("mock-id-token");
      },
      getIdTokenResult: function () {
        return Promise.resolve({ token: "mock-id-token" });
      }
    };
  }

  function showGuestShell() {
    window.__hanlawMockUser = null;
    closeAuthOverlay();
    el.shell.hidden = false;
    el.userBar.hidden = false;
    el.userBar.classList.add("user-bar--guest");
    el.userBar.classList.remove("user-bar--logged");
    renderUserGreeting(null);
    if (el.btnOpenAuth) el.btnOpenAuth.hidden = false;
    try {
      var cu = typeof firebase !== "undefined" && firebase.auth ? firebase.auth().currentUser : null;
      if (el.btnLogout) el.btnLogout.hidden = !(cu && cu.isAnonymous);
    } catch (e) {
      if (el.btnLogout) el.btnLogout.hidden = true;
    }
    if (el.notifWrap) el.notifWrap.hidden = true;
    updateFirebaseHeaderHint();
    dispatchGuestAuthEvent();
  }

  function setLoading(on) {
    [el.btnLogin, el.btnSignup, el.btnGoogle, el.btnGoogleSignup, el.btnReset].forEach(function (b) {
      if (b) b.disabled = on;
    });
  }

  function initFirebase() {
    if (typeof firebase === "undefined") {
      el.configWarn.textContent =
        "Firebase SDK를 불러오지 못했습니다. 네트워크와 script 순서를 확인하세요.";
      el.configWarn.hidden = true;
      return false;
    }
    if (!isConfigReady()) {
      el.configWarn.textContent =
        "js/firebase-config.js에 apiKey·projectId가 비어 있거나 YOUR_ 플레이스홀더입니다. 저장 후 새로고침하세요.";
      el.configWarn.hidden = false;
      return false;
    }
    el.configWarn.hidden = true;
    try {
      if (typeof window.ensureHanlawFirebaseApp === "function") {
        if (!window.ensureHanlawFirebaseApp()) return false;
      } else if (!firebase.apps.length) {
        firebase.initializeApp(window.FIREBASE_CONFIG);
      }
      auth = firebase.auth();
      googleProvider = new firebase.auth.GoogleAuthProvider();
      return true;
    } catch (e) {
      el.configWarn.textContent = "Firebase 초기화 실패: " + (e.message || String(e));
      el.configWarn.hidden = false;
      return false;
    }
  }

  function onEmailLogin() {
    if (!auth) {
      setAuthMessage("Firebase 설정(js/firebase-config.js)을 먼저 완료해 주세요.", true);
      return;
    }
    var email = el.loginEmail.value.trim();
    var password = el.loginPassword.value;
    setAuthMessage("");
    setLoading(true);
    auth
      .signInWithEmailAndPassword(email, password)
      .catch(function (err) {
        setAuthMessage(firebaseErrorToKo(err), true);
      })
      .then(function () {
        setLoading(false);
      });
  }

  function onEmailSignup() {
    if (!auth) {
      setAuthMessage("Firebase 설정(js/firebase-config.js)을 먼저 완료해 주세요.", true);
      return;
    }
    var email = el.signupEmail.value.trim();
    var p1 = el.signupPassword.value;
    var p2 = el.signupPassword2.value;
    setAuthMessage("");
    if (!isSignupConsentOk()) {
      setAuthMessage("회원가입을 위해 이용약관과 개인정보처리방침 동의가 필요합니다.", true);
      return;
    }
    if (p1.length < 6) {
      setAuthMessage("비밀번호는 6자 이상이어야 합니다.", true);
      return;
    }
    if (p1 !== p2) {
      setAuthMessage("비밀번호 확인이 일치하지 않습니다.", true);
      return;
    }
    setLoading(true);
    auth
      .createUserWithEmailAndPassword(email, p1)
      .catch(function (err) {
        setAuthMessage(firebaseErrorToKo(err), true);
      })
      .then(function () {
        setLoading(false);
      });
  }

  function isSignupConsentOk() {
    var termsOk = !!(el.signupAgreeTerms && el.signupAgreeTerms.checked);
    var privacyOk = !!(el.signupAgreePrivacy && el.signupAgreePrivacy.checked);
    return termsOk && privacyOk;
  }

  function onGoogleSignup() {
    if (!isSignupConsentOk()) {
      setAuthMessage("회원가입을 위해 이용약관과 개인정보처리방침 동의가 필요합니다.", true);
      return;
    }
    onGoogleLogin();
  }

  function bindSignupConsent() {
    var all = el.signupAgreeAll;
    var terms = el.signupAgreeTerms;
    var privacy = el.signupAgreePrivacy;
    if (!all || !terms || !privacy) return;

    function syncAllFromChildren() {
      all.checked = terms.checked && privacy.checked;
    }

    all.addEventListener("change", function () {
      var on = !!all.checked;
      terms.checked = on;
      privacy.checked = on;
    });
    terms.addEventListener("change", syncAllFromChildren);
    privacy.addEventListener("change", syncAllFromChildren);
    syncAllFromChildren();
  }

  function onGoogleLogin() {
    if (!auth) {
      setAuthMessage("Firebase 설정(js/firebase-config.js)을 먼저 완료해 주세요.", true);
      return;
    }
    setAuthMessage("");
    setLoading(true);
    auth
      .signInWithPopup(googleProvider)
      .catch(function (err) {
        setAuthMessage(firebaseErrorToKo(err), true);
      })
      .then(function () {
        setLoading(false);
      });
  }

  function onPasswordReset() {
    if (!auth) {
      setAuthMessage("Firebase 설정(js/firebase-config.js)을 먼저 완료해 주세요.", true);
      return;
    }
    var email = el.loginEmail.value.trim();
    if (!email) {
      setAuthMessage("비밀번호를 받을 이메일을 위 칸에 입력하세요.", true);
      showTabs(true);
      return;
    }
    setAuthMessage("");
    setLoading(true);
    auth
      .sendPasswordResetEmail(email)
      .then(function () {
        setAuthMessage("재설정 메일을 보냈습니다. 받은편지함을 확인하세요.", false);
      })
      .catch(function (err) {
        setAuthMessage(firebaseErrorToKo(err), true);
      })
      .then(function () {
        setLoading(false);
      });
  }

  function onLogout() {
    if (window.__hanlawMockUser) {
      window.__hanlawMockUser = null;
      showGuestShell();
      if (typeof window.hanlawAfterLogout === "function") window.hanlawAfterLogout();
      return;
    }
    if (!auth) return;
    window.__hanlawLoggingOut = true;
    auth.signOut().catch(function () {
      window.__hanlawLoggingOut = false;
    });
  }

  el.tabLogin.addEventListener("click", function () {
    showTabs(true);
  });
  el.tabSignup.addEventListener("click", function () {
    showTabs(false);
  });
  el.btnLogin.addEventListener("click", onEmailLogin);
  el.btnSignup.addEventListener("click", onEmailSignup);
  el.btnGoogle.addEventListener("click", onGoogleLogin);
  if (el.btnGoogleSignup) el.btnGoogleSignup.addEventListener("click", onGoogleSignup);
  if (el.btnReset) el.btnReset.addEventListener("click", onPasswordReset);
  el.btnLogout.addEventListener("click", onLogout);
  if (el.btnOpenAuth) {
    if (window.USE_MOCK_ADMIN_LOGIN) {
      el.btnOpenAuth.textContent = "목업 로그인 (관리자)";
    }
    el.btnOpenAuth.addEventListener("click", function () {
      if (window.USE_MOCK_ADMIN_LOGIN) {
        window.__hanlawMockUser = createMockAdminUser();
        showApp(window.__hanlawMockUser);
        return;
      }
      openAuthOverlay();
    });
  }
  if (el.btnAuthClose) {
    el.btnAuthClose.addEventListener("click", function () {
      closeAuthOverlay();
    });
  }
  if (el.authScreen) {
    el.authScreen.addEventListener("click", function (e) {
      if (e.target === el.authScreen) closeAuthOverlay();
    });
  }

  el.loginPassword.addEventListener("keydown", function (e) {
    if (e.key === "Enter") onEmailLogin();
  });
  el.signupPassword2.addEventListener("keydown", function (e) {
    if (e.key === "Enter") onEmailSignup();
  });
  bindSignupConsent();

  var ok = initFirebase();
  if (ok && auth) {
    auth.onAuthStateChanged(function (user) {
      if (user && !user.isAnonymous) {
        showApp(user);
      } else {
        showGuestShell();
        if (window.__hanlawLoggingOut) {
          window.__hanlawLoggingOut = false;
          if (typeof window.hanlawAfterLogout === "function") window.hanlawAfterLogout();
        }
      }
    });
  } else {
    showGuestShell();
  }

  window.addEventListener("hanlaw-nickname-updated", function () {
    var u = null;
    try {
      if (auth && auth.currentUser) u = auth.currentUser;
      else if (typeof window.getHanlawUser === "function") u = window.getHanlawUser();
    } catch (e) {}
    if (u) renderUserGreeting(u);
  });
})();
