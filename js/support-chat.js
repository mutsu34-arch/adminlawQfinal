/**
 * 하단 고객 문의 채팅 — Firestore hanlaw_support_chat/{thread}/messages
 * 전송: submitSupportChatMessage Callable / 실시간: onSnapshot (규칙은 firestore.rules 참고)
 * 이미지: 최대 3장·각 1MB 이하, Callable로 전달 후 Functions가 Storage에 저장합니다.
 */
(function () {
  var LS_ANON = "hanlaw_support_chat_anon_tid_v1";
  var unsub = null;
  var pendingImages = [];
  var MAX_CHAT_IMAGES = 3;
  var MAX_IMAGE_BYTES = 1024 * 1024;

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

  function isOurFirebaseStorageImageUrl(url) {
    try {
      var cfg = window.FIREBASE_CONFIG || {};
      var b = String(cfg.storageBucket || "");
      if (!b) return false;
      var u = String(url || "");
      return u.indexOf("https://firebasestorage.googleapis.com/v0/b/" + b + "/o/") === 0;
    } catch (e) {
      return false;
    }
  }

  function fillMessageBody(body, text, imageUrls) {
    body.innerHTML = "";
    var t = String(text || "").trim();
    if (t) {
      var span = document.createElement("span");
      span.className = "support-chat-msg__text";
      span.textContent = t;
      body.appendChild(span);
    }
    if (imageUrls && imageUrls.length) {
      for (var i = 0; i < imageUrls.length; i++) {
        var url = imageUrls[i];
        if (!isOurFirebaseStorageImageUrl(url)) continue;
        var img = document.createElement("img");
        img.src = url;
        img.alt = "첨부 이미지";
        img.className = "support-chat-msg__image";
        img.loading = "lazy";
        img.decoding = "async";
        body.appendChild(img);
      }
    }
    if (!body.childNodes.length) {
      body.textContent = "(내용 없음)";
    }
  }

  /**
   * @param {"customer"|"admin"} viewMode — 고객 화면: 내 말 오른쪽. 관리자: 고객 왼쪽·운영·AI 오른쪽.
   * @param {string[]} [imageUrls]
   */
  function buildMessageRow(sender, text, tsMs, viewMode, imageUrls) {
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
    fillMessageBody(body, text, imageUrls || []);
    msg.appendChild(body);
    wrap.appendChild(msg);

    var meta = document.createElement("div");
    meta.className = "support-chat-msg__meta";
    meta.textContent = formatTime(tsMs);
    wrap.appendChild(meta);

    row.appendChild(wrap);
    return row;
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
      var ts = d.createdAt && d.createdAt.toMillis ? d.createdAt.toMillis() : null;
      var urls = Array.isArray(d.imageUrls) ? d.imageUrls.map(String) : [];
      logEl.appendChild(buildMessageRow(sender, text, ts, "customer", urls));
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

  function clearPendingImages() {
    pendingImages.forEach(function (p) {
      if (p && p.url) {
        try {
          URL.revokeObjectURL(p.url);
        } catch (e) {}
      }
    });
    pendingImages = [];
    var box = $("support-chat-pending");
    if (box) {
      box.innerHTML = "";
      box.hidden = true;
    }
    var fi = $("support-chat-file");
    if (fi) fi.value = "";
  }

  function renderPendingThumbs() {
    var box = $("support-chat-pending");
    if (!box) return;
    box.innerHTML = "";
    if (!pendingImages.length) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    pendingImages.forEach(function (p, idx) {
      var wrap = document.createElement("div");
      wrap.className = "support-chat-pending__item";
      var img = document.createElement("img");
      img.className = "support-chat-pending__thumb";
      img.src = p.url;
      img.alt = "";
      var rm = document.createElement("button");
      rm.type = "button";
      rm.className = "support-chat-pending__remove";
      rm.setAttribute("aria-label", "첨부 취소");
      rm.textContent = "×";
      rm.addEventListener("click", function () {
        try {
          URL.revokeObjectURL(p.url);
        } catch (e) {}
        pendingImages = pendingImages.filter(function (x) {
          return x !== p;
        });
        renderPendingThumbs();
      });
      wrap.appendChild(img);
      wrap.appendChild(rm);
      box.appendChild(wrap);
    });
  }

  function addPendingFiles(fileList) {
    var errEl = $("support-chat-error");
    if (!fileList || !fileList.length) return;
    for (var i = 0; i < fileList.length; i++) {
      if (pendingImages.length >= MAX_CHAT_IMAGES) {
        if (errEl) {
          errEl.textContent = "이미지는 최대 " + MAX_CHAT_IMAGES + "장까지 첨부할 수 있습니다.";
          errEl.hidden = false;
        }
        break;
      }
      var f = fileList[i];
      if (!f || !/^image\/(jpeg|png|gif|webp)$/i.test(f.type)) {
        if (errEl) {
          errEl.textContent = "JPEG, PNG, GIF, WebP 이미지만 첨부할 수 있습니다.";
          errEl.hidden = false;
        }
        continue;
      }
      if (f.size > MAX_IMAGE_BYTES) {
        if (errEl) {
          errEl.textContent = "각 이미지는 1MB 이하만 첨부할 수 있습니다.";
          errEl.hidden = false;
        }
        continue;
      }
      var url = URL.createObjectURL(f);
      pendingImages.push({ file: f, url: url });
    }
    renderPendingThumbs();
  }

  function readFileAsDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () {
        resolve(String(fr.result || ""));
      };
      fr.onerror = function () {
        reject(new Error("파일을 읽지 못했습니다."));
      };
      fr.readAsDataURL(file);
    });
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
    clearPendingImages();
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
    clearPendingImages();
  }

  function submitMessage() {
    var ta = $("support-chat-input");
    var errEl = $("support-chat-error");
    var text = ta ? String(ta.value || "").trim() : "";
    if (!text && !pendingImages.length) {
      if (errEl) {
        errEl.textContent = "메시지를 입력하거나 이미지를 첨부해 주세요.";
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
    var sendBtn = $("support-chat-send");
    if (sendBtn) sendBtn.disabled = true;
    if (errEl) errEl.hidden = true;

    var files = pendingImages.map(function (p) {
      return p.file;
    });
    var chain = Promise.resolve([]);
    if (files.length) {
      chain = Promise.all(files.map(readFileAsDataUrl));
    }
    chain
      .then(function (dataUrls) {
        var payload = { message: text };
        if (tid.indexOf("user_") !== 0) {
          payload.threadId = tid;
        }
        if (dataUrls && dataUrls.length) {
          payload.images = dataUrls.map(function (d) {
            return { base64: d };
          });
        }
        return fn(payload);
      })
      .then(function () {
        if (ta) ta.value = "";
        clearPendingImages();
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
    var attach = $("support-chat-attach");
    var fileIn = $("support-chat-file");
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
    if (attach && fileIn) {
      attach.addEventListener("click", function () {
        fileIn.click();
      });
      fileIn.addEventListener("change", function (e) {
        var t = e.target;
        if (t && t.files && t.files.length) {
          addPendingFiles(t.files);
        }
        t.value = "";
      });
    }
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
