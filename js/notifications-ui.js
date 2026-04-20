(function () {
  var unsub = null;
  var unsubAdmin = null;
  /** 대시보드 알림 목록 펼침 상태(데이터 갱신 시 유지) */
  var dashboardNotifsExpanded = false;

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

  function formatNotifTime(ts) {
    if (!ts || typeof ts.toDate !== "function") return "일시 미상";
    try {
      return ts.toDate().toLocaleString("ko-KR", {
        dateStyle: "medium",
        timeStyle: "short"
      });
    } catch (e) {
      return "일시 미상";
    }
  }

  /**
   * 단일 알림 행(헤더 드롭다운·대시보드 목록 공통)
   */
  function appendNotifRow(container, n, isAdminPending) {
    var row = document.createElement("div");
    row.className = "notif-item" + (n.read === false ? " notif-item--unread" : "");
    var t = document.createElement("strong");
    t.className = "notif-item__title";
    t.textContent = n.title || "알림";

    var timeEl = document.createElement("p");
    timeEl.className = "notif-item__time";
    timeEl.textContent = formatNotifTime(n.createdAt);

    var hint = document.createElement("p");
    hint.className = "notif-item__hint";
    hint.textContent = "눌러서 상세 답변 보기";
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
    var canToggle = !isAdminPending && !!String(bodyRaw || "").trim();
    if (canToggle) {
      b.hidden = true;
      row.classList.add("notif-item--collapsible");
      row.tabIndex = 0;
      row.setAttribute("role", "button");
      row.setAttribute("aria-expanded", "false");
    }
    row.appendChild(t);
    row.appendChild(timeEl);
    if (canToggle) row.appendChild(hint);
    row.appendChild(b);
    if (canToggle) {
      var toggleBody = function () {
        var open = row.getAttribute("aria-expanded") === "true";
        var next = !open;
        row.setAttribute("aria-expanded", next ? "true" : "false");
        b.hidden = !next;
        hint.textContent = next ? "접어서 숨기기" : "눌러서 상세 답변 보기";
        if (next && n._docId && n.read === false && typeof window.markNotificationRead === "function") {
          window.markNotificationRead(n._docId).then(function () {});
        }
      };
      row.addEventListener("click", function () {
        toggleBody();
      });
      row.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          toggleBody();
        }
      });
    }
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
      appendNotifRow(container, n, isAdminPending);
    });
  }

  function dashboardToggleLabel(unread, total, expanded) {
    var parts = [];
    if (unread > 0) {
      parts.push("확인하지 않은 알림 " + unread + "건");
      if (total > unread) {
        parts.push("전체 " + total + "건");
      }
    } else if (total > 0) {
      parts.push("읽지 않은 알림이 없습니다");
      parts.push("전체 " + total + "건");
    }
    return parts.join(" · ") + " — " + (expanded ? "접기" : "알림 목록 펼치기");
  }

  function renderDashboardNotifications(container, items) {
    if (!container) return;
    container.innerHTML = "";
    if (!items.length) {
      container.innerHTML = "<p class=\"notif-empty\">알림이 없습니다.</p>";
      return;
    }
    var unread = items.filter(function (x) {
      return x.read === false;
    }).length;
    var total = items.length;

    var wrap = document.createElement("div");
    wrap.className = "dashboard-notifs";

    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn--outline dashboard-notifs__toggle";
    btn.setAttribute("aria-expanded", dashboardNotifsExpanded ? "true" : "false");
    btn.textContent = dashboardToggleLabel(unread, total, dashboardNotifsExpanded);

    var panel = document.createElement("div");
    panel.className = "dashboard-notifs__panel";
    panel.hidden = !dashboardNotifsExpanded;
    panel.setAttribute("aria-label", "알림 목록");

    items.forEach(function (n) {
      appendNotifRow(panel, n, false);
    });

    btn.addEventListener("click", function () {
      dashboardNotifsExpanded = !dashboardNotifsExpanded;
      panel.hidden = !dashboardNotifsExpanded;
      btn.setAttribute("aria-expanded", dashboardNotifsExpanded ? "true" : "false");
      btn.textContent = dashboardToggleLabel(unread, total, dashboardNotifsExpanded);
    });

    wrap.appendChild(btn);
    wrap.appendChild(panel);
    container.appendChild(wrap);
  }

  function startUserNotifs(user) {
    if (unsub) {
      unsub();
      unsub = null;
    }
    if (!user || typeof window.subscribeUserNotifications !== "function") {
      renderList($("notif-dropdown-list"), [], false);
      renderDashboardNotifications($("dashboard-notifications"), []);
      setBadge($("notif-badge"), 0);
      return;
    }
    unsub = window.subscribeUserNotifications(user.uid, function (list) {
      var unread = list.filter(function (x) {
        return x.read === false;
      }).length;
      setBadge($("notif-badge"), unread);
      renderList($("notif-dropdown-list"), list, false);
      renderDashboardNotifications($("dashboard-notifications"), list);
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
