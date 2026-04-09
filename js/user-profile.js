(function () {
  window.__HANLAW_NICKNAME = "";

  window.getHanlawNickname = function () {
    return window.__HANLAW_NICKNAME || "";
  };

  var unsub = null;

  function setMsg(text, isError) {
    var el = document.getElementById("dashboard-nickname-msg");
    if (!el) return;
    el.textContent = text || "";
    el.hidden = !text;
    el.classList.toggle("dashboard-nickname-msg--error", !!isError);
  }

  function applyToInput(nick) {
    var input = document.getElementById("dashboard-nickname");
    if (input) input.value = nick || "";
  }

  function syncBlockVisible(uid) {
    var block = document.getElementById("dashboard-nickname-block");
    if (block) block.hidden = !uid;
  }

  function subscribeProfile(uid) {
    if (unsub) {
      unsub();
      unsub = null;
    }
    window.__HANLAW_NICKNAME = "";
    applyToInput("");
    syncBlockVisible(!!uid);
    if (!uid || typeof firebase === "undefined" || !firebase.firestore) return;
    var ref = firebase.firestore().collection("hanlaw_user_profiles").doc(uid);
    unsub = ref.onSnapshot(
      function (snap) {
        var nick = "";
        if (snap.exists) {
          var d = snap.data();
          nick = d && typeof d.nickname === "string" ? d.nickname.trim() : "";
        }
        window.__HANLAW_NICKNAME = nick;
        applyToInput(nick);
        window.dispatchEvent(new CustomEvent("hanlaw-nickname-updated", { detail: { nickname: nick } }));
      },
      function () {
        window.__HANLAW_NICKNAME = "";
        applyToInput("");
      }
    );
  }

  function saveNickname() {
    var input = document.getElementById("dashboard-nickname");
    var btn = document.getElementById("btn-dashboard-nickname-save");
    var raw = input ? String(input.value || "").trim() : "";
    if (!raw) {
      setMsg("닉네임을 입력하세요.", true);
      return;
    }
    if (typeof firebase === "undefined" || !firebase.functions || !firebase.apps || !firebase.apps.length) {
      setMsg("Firebase를 사용할 수 없습니다.", true);
      return;
    }
    var region = window.FIREBASE_FUNCTIONS_REGION || "asia-northeast3";
    var fn = firebase.app().functions(region).httpsCallable("setUserNickname");
    if (btn) btn.disabled = true;
    setMsg("");
    fn({ nickname: raw })
      .then(function (res) {
        var data = res && res.data;
        if (data && data.nickname) {
          window.__HANLAW_NICKNAME = data.nickname;
          applyToInput(data.nickname);
          setMsg("저장했습니다.");
        } else {
          setMsg("저장했습니다.");
        }
      })
      .catch(function (e) {
        var msg = (e && e.message) ? String(e.message) : "저장에 실패했습니다.";
        setMsg(msg, true);
      })
      .then(function () {
        if (btn) btn.disabled = false;
      });
  }

  function bind() {
    var btn = document.getElementById("btn-dashboard-nickname-save");
    if (btn) btn.addEventListener("click", saveNickname);
    var input = document.getElementById("dashboard-nickname");
    if (input) {
      input.addEventListener("keydown", function (e) {
        if (e.key === "Enter") {
          e.preventDefault();
          saveNickname();
        }
      });
    }
  }

  function onAuth() {
    var uid = null;
    try {
      if (firebase.auth && firebase.auth().currentUser) uid = firebase.auth().currentUser.uid;
    } catch (e) {}
    subscribeProfile(uid);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      bind();
      onAuth();
    });
  } else {
    bind();
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
  });
})();
