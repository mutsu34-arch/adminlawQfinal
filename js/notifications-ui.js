(function () {
  var unsub = null;
  var unsubAdmin = null;

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

  function setBadge(el, n) {
    if (!el) return;
    if (n > 0) {
      el.textContent = n > 99 ? "99+" : String(n);
      el.hidden = false;
    } else {
      el.textContent = "";
      el.hidden = true;
    }
  }

  function renderList(container, items, isAdminPending) {
    if (!container) return;
    container.innerHTML = "";
    if (!items.length) {
      container.innerHTML =
        "<p class=\"notif-empty\">" +
        (isAdminPending ? "처리 대기 건이 없습니다." : "알림이 없습니다.") +
        "</p>";
      return;
    }
    items.forEach(function (n) {
      var row = document.createElement("div");
      row.className = "notif-item" + (n.read === false ? " notif-item--unread" : "");
      var t = document.createElement("strong");
      t.className = "notif-item__title";
      t.textContent = n.title || "알림";
      var b = document.createElement("p");
      b.className = "notif-item__body";
      var bodyRaw = n.body || "";
      if (
        n.type === "질문 답변" &&
        typeof window.stripHanlawReplyListMarkers === "function"
      ) {
        bodyRaw = window.stripHanlawReplyListMarkers(bodyRaw);
      }
      b.className = "notif-item__body quiz-ai-answer";
      if (typeof window.formatHanlawRichParagraphsHtml === "function") {
        b.innerHTML = window.formatHanlawRichParagraphsHtml(bodyRaw);
      } else {
        b.textContent = bodyRaw;
      }
      row.appendChild(t);
      row.appendChild(b);
      if (n._docId && n.read === false && !isAdminPending) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "btn btn--link notif-item__read";
        btn.textContent = "읽음";
        btn.addEventListener("click", function (e) {
          e.stopPropagation();
          window.markNotificationRead(n._docId).then(function () {});
        });
        row.appendChild(btn);
      }
      container.appendChild(row);
    });
  }

  function startUserNotifs(user) {
    if (unsub) {
      unsub();
      unsub = null;
    }
    if (!user || typeof window.subscribeUserNotifications !== "function") {
      renderList($("notif-dropdown-list"), [], false);
      renderList($("dashboard-notifications"), [], false);
      setBadge($("notif-badge"), 0);
      return;
    }
    unsub = window.subscribeUserNotifications(user.uid, function (list) {
      var unread = list.filter(function (x) { return x.read === false; }).length;
      setBadge($("notif-badge"), unread);
      renderList($("notif-dropdown-list"), list, false);
      renderList($("dashboard-notifications"), list, false);
    });
  }

  function startAdminPending(user) {
    if (unsubAdmin) {
      unsubAdmin();
      unsubAdmin = null;
    }
    var badgeAdmin = $("admin-nav-badge");
    if (!user || !isAdminUser(user) || typeof window.subscribePendingTicketCountForAdmin !== "function") {
      setBadge(badgeAdmin, 0);
      return;
    }
    unsubAdmin = window.subscribePendingTicketCountForAdmin(function (count) {
      setBadge(badgeAdmin, count);
    });
  }

  function toggleDropdown() {
    var d = $("notif-dropdown");
    if (!d) return;
    d.hidden = !d.hidden;
    d.setAttribute("aria-hidden", d.hidden ? "true" : "false");
  }

  window.addEventListener("app-auth", function (e) {
    var user = e.detail && e.detail.user;
    startUserNotifs(user);
    startAdminPending(user);
  });

  window.addEventListener("support-ticket-created", function () {
    var user = typeof window.getHanlawUser === "function" ? window.getHanlawUser() : null;
    startAdminPending(user);
  });

  window.addEventListener("notifications-updated", function () {
    var user = typeof window.getHanlawUser === "function" ? window.getHanlawUser() : null;
    startUserNotifs(user);
  });

  document.addEventListener("DOMContentLoaded", function () {
    var btn = $("btn-header-notifications");
    var drop = $("notif-dropdown");
    if (btn && drop) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        toggleDropdown();
      });
      document.addEventListener("click", function () {
        if (!drop.hidden) {
          drop.hidden = true;
          drop.setAttribute("aria-hidden", "true");
        }
      });
      drop.addEventListener("click", function (e) {
        e.stopPropagation();
      });
    }
    var u0 = typeof window.getHanlawUser === "function" ? window.getHanlawUser() : null;
    startUserNotifs(u0);
    startAdminPending(u0);
  });
})();
