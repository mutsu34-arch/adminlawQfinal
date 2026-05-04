/**
 * 하단 고객 문의 채팅 — Firestore hanlaw_support_chat/{thread}/messages
 * 전송: submitSupportChatMessage Callable / 실시간: onSnapshot (규칙은 firestore.rules 참고)
 */
(function () {
  var LS_ANON = "hanlaw_support_chat_anon_tid_v1";
  var unsub = null;

  function $(id) {
    return document.getElementById(id);
  }

  function randomUUID() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      return crypto.randomUUID().toLowerCase();
    }
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      var v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function threadIdForViewer() {
    try {
      if (typeof firebase !== "undefined" && firebase.auth) {
        var u = firebase.auth().currentUser;
        if (u && u.uid) return "user_" + u.uid;
      }
    } catch (e) {}
    var tid = null;
    try {
      tid = localStorage.getItem(LS_ANON);
    } catch (e2) {}
    if (!tid || !/^anon_[0-9a-f-]{36}$/.test(tid)) {
      tid = "anon_" + randomUUID();
      try {
        localStorage.setItem(LS_ANON, tid);
      } catch (e3) {}
    }
    return tid;
  }

  function formatTime(ms) {
    if (ms == null || !isFinite(ms)) return "";
    try {
      return new Date(ms).toLocaleString("ko-KR", {
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit"
      });
    } catch (e) {
      return "";
    }
  }

  function renderMessages(snap) {
    var logEl = $("support-chat-log");
    if (!logEl) return;
    logEl.innerHTML = "";
    var docs = snap.docs ? snap.docs.slice() : [];
    docs.sort(function (a, b) {
      var da = a.data() || {};
      var db = b.data() || {};
      var ta = da.createdAt && da.createdAt.toMillis ? da.createdAt.toMillis() : 0;
      var tb = db.createdAt && db.createdAt.toMillis ? db.createdAt.toMillis() : 0;
      return ta - tb;
    });
    for (var i = 0; i < docs.length; i++) {
      var d = docs[i].data() || {};
      var text = String(d.text || "");
      var sender = d.sender || "user";
      var div = document.createElement("div");
      var roleClass =
        sender === "staff"
          ? " support-chat-msg--staff"
          : sender === "assistant"
            ? " support-chat-msg--assistant"
            : " support-chat-msg--user";
      div.className = "support-chat-msg" + roleClass;
      var meta = document.createElement("div");
      meta.className = "support-chat-msg__meta";
      var ts = d.createdAt && d.createdAt.toMillis ? d.createdAt.toMillis() : null;
      meta.textContent = formatTime(ts);
      var body = document.createElement("div");
      body.className = "support-chat-msg__body";
      body.textContent = text;
      div.appendChild(meta);
      div.appendChild(body);
      logEl.appendChild(div);
    }
    logEl.scrollTop = logEl.scrollHeight;
  }

  function stopListen() {
    if (unsub) {
      try {
        unsub();
      } catch (e) {}
      unsub = null;
    }
  }

  function startListen() {
    stopListen();
    var tid = threadIdForViewer();
    try {
      if (typeof firebase === "undefined" || !firebase.firestore) return;
      var q = firebase
        .firestore()
        .collection("hanlaw_support_chat")
        .doc(tid)
        .collection("messages")
        .orderBy("createdAt", "asc")
        .limit(200);
      unsub = q.onSnapshot(
        function (snap) {
          renderMessages(snap);
        },
        function (err) {
          var errEl = $("support-chat-error");
          if (errEl) {
            errEl.textContent = (err && err.message) || "채팅을 불러오지 못했습니다.";
            errEl.hidden = false;
          }
        }
      );
    } catch (e2) {
      var errEl2 = $("support-chat-error");
      if (errEl2) {
        errEl2.textContent = "채팅 연결에 실패했습니다.";
        errEl2.hidden = false;
      }
    }
  }

  function openModal() {
    var m = $("support-chat-modal");
    if (!m) return;
    m.hidden = false;
    m.setAttribute("aria-hidden", "false");
    var err = $("support-chat-error");
    if (err) {
      err.textContent = "";
      err.hidden = true;
    }
    startListen();
    var ta = $("support-chat-input");
    if (ta) {
      setTimeout(function () {
        ta.focus();
      }, 80);
    }
  }

  function closeModal() {
    var m = $("support-chat-modal");
    if (!m) return;
    m.hidden = true;
    m.setAttribute("aria-hidden", "true");
    stopListen();
  }

  function submitMessage() {
    var ta = $("support-chat-input");
    var errEl = $("support-chat-error");
    var text = ta ? String(ta.value || "").trim() : "";
    if (!text) {
      if (errEl) {
        errEl.textContent = "메시지를 입력해 주세요.";
        errEl.hidden = false;
      }
      return;
    }
    if (typeof firebase === "undefined" || !firebase.app || !firebase.functions) {
      if (errEl) {
        errEl.textContent = "Firebase를 불러오지 못했습니다.";
        errEl.hidden = false;
      }
      return;
    }
    var region = window.FIREBASE_FUNCTIONS_REGION || "asia-northeast3";
    var fn = firebase.app().functions(region).httpsCallable("submitSupportChatMessage");
    var tid = threadIdForViewer();
    var payload = { message: text };
    if (tid.indexOf("user_") !== 0) {
      payload.threadId = tid;
    }
    var sendBtn = $("support-chat-send");
    if (sendBtn) sendBtn.disabled = true;
    if (errEl) errEl.hidden = true;
    fn(payload)
      .then(function () {
        if (ta) ta.value = "";
      })
      .catch(function (e) {
        var msg = (e && e.message) || String(e);
        if (errEl) {
          errEl.textContent = msg;
          errEl.hidden = false;
        }
      })
      .finally(function () {
        if (sendBtn) sendBtn.disabled = false;
      });
  }

  function bind() {
    var m = $("support-chat-modal");
    var fab = $("support-chat-fab");
    var footerBtn = $("footer-open-support-chat");
    var closeBtn = $("support-chat-modal-close");
    var dismiss = $("support-chat-modal-dismiss");
    var send = $("support-chat-send");
    if (fab) fab.addEventListener("click", openModal);
    if (footerBtn) footerBtn.addEventListener("click", openModal);
    if (closeBtn) closeBtn.addEventListener("click", closeModal);
    if (dismiss) dismiss.addEventListener("click", closeModal);
    if (m) {
      m.addEventListener("click", function (e) {
        if (e.target === m) closeModal();
      });
    }
    if (send) send.addEventListener("click", submitMessage);
    var ta = $("support-chat-input");
    if (ta) {
      ta.addEventListener("keydown", function (e) {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          submitMessage();
        }
      });
    }

    try {
      if (typeof firebase !== "undefined" && firebase.auth) {
        firebase.auth().onAuthStateChanged(function () {
          if ($("support-chat-modal") && !$("support-chat-modal").hidden) {
            startListen();
          }
        });
      }
    } catch (e) {}
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }
})();
