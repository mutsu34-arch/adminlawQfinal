(function () {
  var selectedId = null;
  var ticketsCache = [];

  function $(id) {
    return document.getElementById(id);
  }

  function isAdminUser(user) {
    if (!user || !user.email) return false;
    var emails = window.ADMIN_EMAILS || [];
    var mail = String(user.email).toLowerCase();
    for (var i = 0; i < emails.length; i++) {
      if (String(emails[i]).toLowerCase() === mail) return true;
    }
    return false;
  }

  function switchAdminTab(which) {
    var tabSingle = $("admin-tab-single");
    var tabJson = $("admin-tab-json");
    var tabExcel = $("admin-tab-excel");
    var tabLibrary = $("admin-tab-library");
    var tabInbox = $("admin-tab-inbox");
    var panelSingle = $("admin-panel-single");
    var panelJson = $("admin-panel-json");
    var panelExcel = $("admin-panel-excel");
    var panelLibrary = $("admin-panel-library");
    var panelInbox = $("admin-panel-inbox");
    function off() {
      [tabSingle, tabJson, tabExcel, tabLibrary, tabInbox].forEach(function (t) {
        if (t) t.classList.remove("admin-tab--active");
      });
      [panelSingle, panelJson, panelExcel, panelLibrary, panelInbox].forEach(function (p) {
        if (p) p.hidden = true;
      });
    }
    off();
    if (which === "json") {
      if (tabJson) tabJson.classList.add("admin-tab--active");
      if (panelJson) panelJson.hidden = false;
    } else if (which === "excel") {
      if (tabExcel) tabExcel.classList.add("admin-tab--active");
      if (panelExcel) panelExcel.hidden = false;
    } else if (which === "library") {
      if (tabLibrary) tabLibrary.classList.add("admin-tab--active");
      if (panelLibrary) panelLibrary.hidden = false;
      if (typeof window.loadAdminLibraryList === "function") window.loadAdminLibraryList();
    } else if (which === "inbox") {
      if (tabInbox) tabInbox.classList.add("admin-tab--active");
      if (panelInbox) panelInbox.hidden = false;
    } else {
      if (tabSingle) tabSingle.classList.add("admin-tab--active");
      if (panelSingle) panelSingle.hidden = false;
    }
  }

  function fmtStatus(s) {
    var map = {
      pending: "접수",
      ai_drafted: "AI초안",
      approved: "승인완료"
    };
    return map[s] || s || "-";
  }

  function renderList() {
    var listEl = $("admin-inbox-list");
    if (!listEl) return;
    listEl.innerHTML = "";
    if (!ticketsCache.length) {
      listEl.innerHTML = "<p class=\"admin-inbox-empty\">티켓이 없습니다.</p>";
      return;
    }
    ticketsCache.forEach(function (t) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className =
        "admin-inbox-row" + (selectedId === t.id ? " admin-inbox-row--active" : "");
      btn.innerHTML =
        "<span class=\"admin-inbox-row__type\">" +
        (t.type === "question" ? "질문" : t.type === "promotion" ? "홍보" : "신고") +
        "</span>" +
        "<span class=\"admin-inbox-row__status\">" +
        fmtStatus(t.status) +
        "</span>" +
        "<span class=\"admin-inbox-row__preview\">" +
        String(t.message || "").slice(0, 48) +
        (String(t.message || "").length > 48 ? "…" : "") +
        "</span>";
      btn.addEventListener("click", function () {
        selectedId = t.id;
        renderList();
        showDetail(t);
      });
      listEl.appendChild(btn);
    });
  }

  function showDetail(t) {
    var det = $("admin-inbox-detail");
    var meta = $("admin-inbox-meta");
    var msg = $("admin-inbox-message");
    var links = $("admin-inbox-links");
    var imgs = $("admin-inbox-images");
    var aiTa = $("admin-inbox-ai-draft");
    var replyTa = $("admin-inbox-reply");
    var msgAi = $("admin-inbox-msg-ai");
    if (!det) return;
    det.hidden = false;
    if (meta) {
      meta.textContent =
        (t.userNickname ? "닉네임: " + t.userNickname + " · " : "") +
        (t.userEmail || t.userId || "") +
        " · " +
        (t.id || "") +
        " · " +
        fmtStatus(t.status);
    }
    if (msg) msg.textContent = t.message || "";
    if (links) {
      links.innerHTML = "";
      (t.linkUrls || []).forEach(function (u) {
        var a = document.createElement("a");
        a.href = u;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.textContent = u;
        links.appendChild(a);
      });
    }
    if (imgs) {
      imgs.innerHTML = "";
      (t.imageUrls || []).forEach(function (url) {
        var a = document.createElement("a");
        a.href = url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.className = "admin-inbox-thumb-link";
        var im = document.createElement("img");
        im.src = url;
        im.alt = "첨부";
        im.className = "admin-inbox-thumb";
        a.appendChild(im);
        imgs.appendChild(a);
      });
    }
    if (aiTa) aiTa.value = t.aiDraft || "";
    if (replyTa) {
      replyTa.value = t.adminReply || t.aiDraft || "";
      if (t.userNickname && String(t.userNickname).trim()) {
        var nn = String(t.userNickname).trim();
        replyTa.placeholder =
          nn + "님께 답변합니다. (예: " + nn + "님, 안녕하세요. 문의 주신 내용은 …)";
      } else {
        replyTa.placeholder = "검토 후 수정한 뒤 승인하세요.";
      }
    }
    if (msgAi) {
      msgAi.textContent = "";
      msgAi.hidden = true;
    }
  }

  function loadTickets() {
    var user = typeof window.getHanlawUser === "function" ? window.getHanlawUser() : null;
    if (!user || !isAdminUser(user)) return;
    var db = firebase.firestore();
    db.collection("hanlaw_tickets")
      .orderBy("createdAt", "desc")
      .limit(80)
      .get()
      .then(function (snap) {
        ticketsCache = snap.docs.map(function (d) {
          var x = d.data();
          x.id = d.id;
          return x;
        });
        renderList();
        if (selectedId) {
          var found = ticketsCache.filter(function (x) { return x.id === selectedId; })[0];
          if (found) showDetail(found);
        }
      })
      .catch(function (e) {
        console.warn(e);
        ticketsCache = [];
        renderList();
      });
  }

  function bind() {
    var tabInbox = $("admin-tab-inbox");
    var tabSingle = $("admin-tab-single");
    var tabJson = $("admin-tab-json");
    var tabExcel = $("admin-tab-excel");
    var tabLibrary = $("admin-tab-library");
    if (tabSingle) {
      tabSingle.addEventListener("click", function () {
        switchAdminTab("single");
      });
    }
    if (tabJson) {
      tabJson.addEventListener("click", function () {
        switchAdminTab("json");
      });
    }
    if (tabExcel) {
      tabExcel.addEventListener("click", function () {
        switchAdminTab("excel");
      });
    }
    if (tabLibrary) {
      tabLibrary.addEventListener("click", function () {
        switchAdminTab("library");
      });
    }
    if (tabInbox) {
      tabInbox.addEventListener("click", function () {
        switchAdminTab("inbox");
        loadTickets();
      });
    }

    var btnAi = $("admin-btn-ai-draft");
    if (btnAi) {
      btnAi.addEventListener("click", function () {
        var user = typeof window.getHanlawUser === "function" ? window.getHanlawUser() : null;
        if (!isAdminUser(user)) return;
        var t = ticketsCache.filter(function (x) { return x.id === selectedId; })[0];
        if (!t) return;
        var msgAi = $("admin-inbox-msg-ai");
        if (msgAi) {
          msgAi.textContent = "AI 초안 생성 중…";
          msgAi.hidden = false;
        }
        window
          .fetchAIDraftForTicket(t)
          .then(function (draft) {
            var aiTa = $("admin-inbox-ai-draft");
            if (aiTa) aiTa.value = draft;
            return window.adminUpdateTicketDraft(t.id, draft);
          })
          .then(function () {
            if (msgAi) {
              msgAi.textContent = "초안이 저장되었습니다. 검토 후 답변란을 수정해 승인하세요.";
            }
            loadTickets();
          })
          .catch(function (e) {
            if (msgAi) {
              msgAi.textContent = (e && e.message) || "실패";
              msgAi.hidden = false;
            }
          });
      });
    }

    var btnApprove = $("admin-btn-approve-ticket");
    if (btnApprove) {
      btnApprove.addEventListener("click", function () {
        var user = typeof window.getHanlawUser === "function" ? window.getHanlawUser() : null;
        if (!isAdminUser(user) || !selectedId) return;
        var replyTa = $("admin-inbox-reply");
        var text = replyTa ? replyTa.value.trim() : "";
        if (!text) {
          window.alert("사용자에게 전달할 답변을 입력하세요.");
          return;
        }
        window
          .adminApproveTicket(selectedId, text, user.email || "")
          .then(function () {
            window.dispatchEvent(new CustomEvent("notifications-updated"));
            window.alert("승인되었으며 사용자 알림이 발송되었습니다.");
            loadTickets();
            var det = $("admin-inbox-detail");
            if (det) det.hidden = true;
            selectedId = null;
          })
          .catch(function (e) {
            window.alert((e && e.message) || "승인 처리 실패");
          });
      });
    }

    var btnRefresh = $("admin-inbox-refresh");
    if (btnRefresh) btnRefresh.addEventListener("click", loadTickets);

    window.addEventListener("support-ticket-created", function () {
      if ($("admin-panel-inbox") && !$("admin-panel-inbox").hidden) loadTickets();
    });
  }

  document.addEventListener("DOMContentLoaded", bind);
})();
