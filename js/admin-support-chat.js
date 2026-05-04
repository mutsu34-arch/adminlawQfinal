/**
 * 관리자 패널 — 하단 고객 채팅 스레드 목록·메시지·운영자 답장 (Callable)
 */
(function () {
  var selectedThreadId = null;
  var threadsCache = [];

  function $(id) {
    return document.getElementById(id);
  }

  function region() {
    return window.FIREBASE_FUNCTIONS_REGION || "asia-northeast3";
  }

  function callable(name) {
    if (typeof firebase === "undefined" || !firebase.app || !firebase.functions) return null;
    return firebase.app().functions(region()).httpsCallable(name);
  }

  function setMsg(text, isError) {
    var el = $("admin-support-chat-msg");
    if (!el) return;
    el.textContent = text || "";
    el.classList.toggle("admin-msg--error", !!isError);
    el.hidden = !text;
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

  function renderThreadList() {
    var listEl = $("admin-support-chat-list");
    if (!listEl) return;
    listEl.innerHTML = "";
    if (!threadsCache.length) {
      listEl.innerHTML = "<p class=\"admin-inbox-empty\">스레드가 없습니다.</p>";
      return;
    }
    threadsCache.forEach(function (t) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className =
        "admin-inbox-row" + (selectedThreadId === t.threadId ? " admin-inbox-row--active" : "");
      var ch = t.channel === "member" ? "회원" : "익명";
      var prev = String(t.preview || "").slice(0, 56);
      if (String(t.preview || "").length > 56) prev += "…";
      btn.innerHTML =
        "<span class=\"admin-inbox-row__type\">" +
        ch +
        "</span>" +
        "<span class=\"admin-inbox-row__status\">" +
        (t.lastMessageAtMs ? formatTime(t.lastMessageAtMs) : "-") +
        "</span>" +
        "<span class=\"admin-inbox-row__preview\">" +
        (t.userEmail ? String(t.userEmail).slice(0, 40) + " · " : "") +
        prev +
        "</span>";
      btn.addEventListener("click", function () {
        selectedThreadId = t.threadId;
        renderThreadList();
        loadMessagesForThread(t.threadId);
      });
      listEl.appendChild(btn);
    });
  }

  function buildMessageRow(sender, text, tsMs, viewMode) {
    var isMine =
      viewMode === "customer"
        ? sender === "user"
        : sender === "assistant" || sender === "staff";

    var row = document.createElement("div");
    row.className = "support-chat-row" + (isMine ? " support-chat-row--mine" : " support-chat-row--them");

    var wrap = document.createElement("div");
    wrap.className = "support-chat-bubble-wrap";

    var labelText = "";
    if (viewMode === "customer") {
      if (!isMine) {
        if (sender === "assistant") labelText = "AI 안내";
        else if (sender === "staff") labelText = "운영팀";
      }
    } else {
      if (!isMine && sender === "user") labelText = "고객";
      if (isMine) {
        if (sender === "assistant") labelText = "AI 안내";
        else if (sender === "staff") labelText = "운영팀";
      }
    }

    if (labelText) {
      var lab = document.createElement("div");
      lab.className = "support-chat-msg__sender";
      lab.textContent = labelText;
      wrap.appendChild(lab);
    }

    var role = sender === "staff" ? "staff" : sender === "assistant" ? "assistant" : "user";
    var msg = document.createElement("div");
    msg.className = "support-chat-msg support-chat-msg--" + role;

    var body = document.createElement("div");
    body.className = "support-chat-msg__body";
    body.textContent = String(text || "");
    msg.appendChild(body);
    wrap.appendChild(msg);

    var meta = document.createElement("div");
    meta.className = "support-chat-msg__meta";
    meta.textContent = formatTime(tsMs);
    wrap.appendChild(meta);

    row.appendChild(wrap);
    return row;
  }

  function renderMessages(messages) {
    var logEl = $("admin-support-chat-log");
    if (!logEl) return;
    logEl.innerHTML = "";
    (messages || []).forEach(function (m) {
      var sender = m.sender || "user";
      logEl.appendChild(buildMessageRow(sender, String(m.text || ""), m.createdAtMs, "admin"));
    });
    logEl.scrollTop = logEl.scrollHeight;
  }

  function loadMessagesForThread(threadId) {
    var det = $("admin-support-chat-detail");
    var meta = $("admin-support-chat-meta");
    var replyTa = $("admin-support-chat-reply");
    var fn = callable("adminGetSupportChatMessages");
    if (!fn) {
      setMsg("Firebase Functions를 불러오지 못했습니다.", true);
      return;
    }
    setMsg("불러오는 중…", false);
    if (det) det.hidden = false;
    if (meta) meta.textContent = threadId || "";
    if (replyTa) replyTa.value = "";
    fn({ threadId: threadId })
      .then(function (res) {
        setMsg("", false);
        var data = (res && res.data) || {};
        renderMessages(data.messages || []);
      })
      .catch(function (e) {
        setMsg((e && e.message) || String(e), true);
        renderMessages([]);
      });
  }

  function loadAdminSupportChatList() {
    var fn = callable("adminListSupportChatThreads");
    if (!fn) {
      setMsg("Firebase Functions를 불러오지 못했습니다.", true);
      return;
    }
    setMsg("목록 불러오는 중…", false);
    fn()
      .then(function (res) {
        setMsg("", false);
        var data = (res && res.data) || {};
        threadsCache = data.threads || [];
        if (selectedThreadId) {
          var still = threadsCache.some(function (x) {
            return x.threadId === selectedThreadId;
          });
          if (!still) selectedThreadId = null;
        }
        renderThreadList();
        if (selectedThreadId) {
          loadMessagesForThread(selectedThreadId);
        } else {
          var det = $("admin-support-chat-detail");
          if (det) det.hidden = true;
          var logEl = $("admin-support-chat-log");
          if (logEl) logEl.innerHTML = "";
        }
      })
      .catch(function (e) {
        threadsCache = [];
        renderThreadList();
        setMsg((e && e.message) || String(e), true);
      });
  }

  function sendStaffReply() {
    if (!selectedThreadId) {
      setMsg("스레드를 먼저 선택하세요.", true);
      return;
    }
    var replyTa = $("admin-support-chat-reply");
    var text = replyTa ? String(replyTa.value || "").trim() : "";
    if (!text) {
      setMsg("답장 내용을 입력하세요.", true);
      return;
    }
    var fn = callable("adminReplySupportChat");
    if (!fn) {
      setMsg("Firebase Functions를 불러오지 못했습니다.", true);
      return;
    }
    var btn = $("admin-support-chat-send");
    if (btn) btn.disabled = true;
    setMsg("", false);
    fn({ threadId: selectedThreadId, message: text })
      .then(function () {
        if (replyTa) replyTa.value = "";
        loadAdminSupportChatList();
      })
      .catch(function (e) {
        setMsg((e && e.message) || String(e), true);
      })
      .finally(function () {
        if (btn) btn.disabled = false;
      });
  }

  function bind() {
    var refresh = $("admin-support-chat-refresh");
    var send = $("admin-support-chat-send");
    if (refresh) {
      refresh.addEventListener("click", function () {
        loadAdminSupportChatList();
      });
    }
    if (send) send.addEventListener("click", sendStaffReply);
  }

  window.loadAdminSupportChatList = loadAdminSupportChatList;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }
})();
