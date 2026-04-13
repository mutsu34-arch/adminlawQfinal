(function () {
  window.__HANLAW_NICKNAME = "";

  window.getHanlawNickname = function () {
    return window.__HANLAW_NICKNAME || "";
  };

  var unsub = null;
  /** 같은 uid 로 subscribeProfile 이 반복 호출될 때(토큰 갱신 등) 입력란을 비우지 않도록 */
  var lastProfileUidSubscribed = null;

  function setMsg(text, isError) {
    var el = document.getElementById("settings-nickname-msg");
    if (!el) return;
    el.textContent = text || "";
    el.hidden = !text;
    el.classList.toggle("settings-nickname-msg--error", !!isError);
  }

  function applyToInput(nick) {
    var input = document.getElementById("settings-nickname");
    if (input) input.value = nick || "";
  }

  function renderCurrentNickname(nick) {
    var el = document.getElementById("settings-nickname-current");
    if (!el) return;
    var n = String(nick || "").trim();
    el.textContent = n || "사용자";
  }

  function syncBlockVisible(uid) {
    var block = document.getElementById("settings-nickname-block");
    var input = document.getElementById("settings-nickname");
    var btn = document.getElementById("btn-settings-nickname-save");
    var guestHint = document.getElementById("settings-nickname-guest-hint");
    var loggedHint = document.getElementById("settings-nickname-hint-loggedin");
    var loggedIn = !!uid;
    if (block) {
      block.hidden = false;
      block.removeAttribute("hidden");
    }
    if (input) {
      if (loggedIn) {
        input.removeAttribute("disabled");
        input.disabled = false;
        input.readOnly = false;
      } else {
        input.disabled = true;
        input.setAttribute("disabled", "disabled");
      }
    }
    if (btn) {
      if (loggedIn) {
        btn.removeAttribute("disabled");
        btn.disabled = false;
      } else {
        btn.disabled = true;
        btn.setAttribute("disabled", "disabled");
      }
    }
    var btnRm = document.getElementById("btn-settings-nickname-remove");
    if (btnRm) {
      if (loggedIn) {
        btnRm.removeAttribute("disabled");
        btnRm.disabled = false;
      } else {
        btnRm.disabled = true;
        btnRm.setAttribute("disabled", "disabled");
      }
    }
    if (guestHint) guestHint.hidden = loggedIn;
    if (loggedHint) loggedHint.hidden = !loggedIn;
  }

  /** 설정 패널을 연 직후·외부에서 호출 (인증 타이밍 이슈로 입력이 막힐 때) */
  function refreshNicknameFormState() {
    syncBlockVisible(!!getProfileUid());
  }

  window.refreshHanlawNicknameFormState = refreshNicknameFormState;

  function subscribeProfile(uid) {
    syncBlockVisible(!!uid);
    if (!uid) {
      if (unsub) {
        unsub();
        unsub = null;
      }
      lastProfileUidSubscribed = null;
      window.__HANLAW_NICKNAME = "";
      applyToInput("");
      renderCurrentNickname("");
      return;
    }
    if (uid === lastProfileUidSubscribed && unsub) {
      return;
    }
    lastProfileUidSubscribed = uid;
    if (unsub) {
      unsub();
      unsub = null;
    }
    window.__HANLAW_NICKNAME = "";
    applyToInput("");
    if (typeof firebase === "undefined" || !firebase.firestore) return;
    var ref = firebase.firestore().collection("hanlaw_user_profiles").doc(uid);
    unsub = ref.onSnapshot(
      function (snap) {
        var nick = "";
        if (snap.exists) {
          var d = snap.data();
          nick = d && typeof d.nickname === "string" ? d.nickname.trim() : "";
        }
        window.__HANLAW_NICKNAME = nick;
        applyToInput("");
        renderCurrentNickname(nick);
        window.dispatchEvent(new CustomEvent("hanlaw-nickname-updated", { detail: { nickname: nick } }));
      },
      function () {
        window.__HANLAW_NICKNAME = "";
        applyToInput("");
        renderCurrentNickname("");
      }
    );
  }

  function submitNicknameToServer(trimmed) {
    var raw = trimmed == null ? "" : String(trimmed).trim();
    var btnSave = document.getElementById("btn-settings-nickname-save");
    var btnDel = document.getElementById("btn-settings-nickname-remove");
    if (typeof firebase === "undefined" || !firebase.functions || !firebase.apps || !firebase.apps.length) {
      setMsg("Firebase를 사용할 수 없습니다.", true);
      return;
    }
    var region = window.FIREBASE_FUNCTIONS_REGION || "asia-northeast3";
    var fn = firebase.app().functions(region).httpsCallable("setUserNickname");
    if (btnSave) btnSave.disabled = true;
    if (btnDel) btnDel.disabled = true;
    setMsg("");
    function applyDeletedUi() {
      window.__HANLAW_NICKNAME = "";
      applyToInput("");
      renderCurrentNickname("");
      setMsg("닉네임을 삭제했습니다. 상단 인사말은 「사용자 님」으로 표시됩니다.");
    }

    function tryDeleteWithFirestoreFallback() {
      try {
        var uid = getProfileUid();
        if (!uid || typeof firebase === "undefined" || !firebase.firestore) return Promise.reject(new Error("no-fallback"));
        var fv = firebase.firestore.FieldValue;
        if (!fv || typeof fv.delete !== "function" || typeof fv.serverTimestamp !== "function") {
          return Promise.reject(new Error("no-fallback"));
        }
        var ref = firebase.firestore().collection("hanlaw_user_profiles").doc(uid);
        return ref
          .set(
            {
              nickname: fv.delete(),
              updatedAt: fv.serverTimestamp()
            },
            { merge: true }
          )
          .then(function () {
            applyDeletedUi();
          });
      } catch (e2) {
        return Promise.reject(e2);
      }
    }

    fn({ nickname: raw })
      .then(function (res) {
        var data = res && res.data;
        var nick = data && typeof data.nickname === "string" ? data.nickname : "";
        window.__HANLAW_NICKNAME = nick;
        applyToInput("");
        renderCurrentNickname(nick);
        if (nick) {
          setMsg("저장했습니다.");
        } else {
          applyDeletedUi();
        }
      })
      .catch(function (e) {
        var msg = (e && e.message) ? String(e.message) : "저장에 실패했습니다.";
        var oldServerDeleteReject =
          raw === "" &&
          (msg.indexOf("닉네임을 입력하세요") >= 0 || msg.indexOf("invalid-argument") >= 0);
        if (oldServerDeleteReject) {
          return tryDeleteWithFirestoreFallback().catch(function () {
            setMsg(
              "삭제 요청은 갔지만 서버가 구버전이라 반영되지 않았습니다. Functions를 최신으로 배포한 뒤 다시 시도해 주세요.",
              true
            );
          });
        }
        setMsg(msg, true);
      })
      .then(function () {
        refreshNicknameFormState();
      });
  }

  function saveNickname() {
    var input = document.getElementById("settings-nickname");
    var raw = input ? String(input.value || "").trim() : "";
    if (!raw) {
      setMsg("닉네임을 입력하세요.", true);
      return;
    }
    submitNicknameToServer(raw);
  }

  function removeNickname() {
    if (
      !window.confirm(
        "저장된 닉네임을 삭제하고 상단 인사말을 「사용자 님」으로 표시할까요?"
      )
    ) {
      return;
    }
    submitNicknameToServer("");
  }

  function bind() {
    var btn = document.getElementById("btn-settings-nickname-save");
    if (btn) btn.addEventListener("click", saveNickname);
    var btnRm = document.getElementById("btn-settings-nickname-remove");
    if (btnRm) btnRm.addEventListener("click", removeNickname);
    var input = document.getElementById("settings-nickname");
    if (input) {
      input.addEventListener("keydown", function (e) {
        if (e.key === "Enter") {
          e.preventDefault();
          saveNickname();
        }
      });
    }
    var panelSettings = document.getElementById("panel-settings");
    if (panelSettings) {
      panelSettings.addEventListener(
        "pointerdown",
        function () {
          setTimeout(refreshNicknameFormState, 0);
        },
        true
      );
    }
  }

  /**
   * getHanlawUser(목업 포함) 우선, 없으면 firebase.auth().currentUser 직접.
   * 일부 타이밍에서 브리지와 Auth 상태가 한 틱 어긋나면 입력란이 비활성으로 남는 문제를 막습니다.
   */
  function getProfileUid() {
    try {
      if (typeof window.getHanlawUser === "function") {
        var u = window.getHanlawUser();
        if (u && u.uid) return u.uid;
      }
    } catch (e) {}
    try {
      if (typeof firebase !== "undefined" && firebase.auth) {
        var cu = firebase.auth().currentUser;
        if (cu && cu.uid) return cu.uid;
      }
    } catch (e2) {}
    return null;
  }

  function onAuth() {
    subscribeProfile(getProfileUid());
  }

  function observeSettingsPanel() {
    var panel = document.getElementById("panel-settings");
    if (!panel || typeof MutationObserver === "undefined") return;
    var mo = new MutationObserver(function () {
      if (!panel.hidden) refreshNicknameFormState();
    });
    mo.observe(panel, { attributes: true, attributeFilter: ["hidden", "class"] });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      bind();
      observeSettingsPanel();
      onAuth();
    });
  } else {
    bind();
    observeSettingsPanel();
    onAuth();
  }

  try {
    if (typeof firebase !== "undefined" && firebase.auth) {
      firebase.auth().onAuthStateChanged(function () {
        onAuth();
      });
    }
  } catch (e) {}

  window.addEventListener("app-auth", function () {
    onAuth();
    setTimeout(refreshNicknameFormState, 0);
  });
})();
