(function () {
  var TICKET_CACHE = [];
  var unsub = null;
  var currentFilter = null;

  function $(id) {
    return document.getElementById(id);
  }

  function requireUser() {
    var user = typeof window.getHanlawUser === "function" ? window.getHanlawUser() : null;
    if (!user) {
      window.alert("로그인 후 이용할 수 있습니다.");
      return null;
    }
    return user;
  }

  function statusLabel(status) {
    if (status === "approved") return "답변 등록됨";
    if (status === "ai_drafted") return "검토 중";
    return "접수됨";
  }

  function formatWhen(ts) {
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

  function truncate(s, n) {
    var t = String(s || "");
    if (t.length <= n) return t;
    return t.slice(0, n) + "…";
  }

  function closeDrawer() {
    var drawer = $("dashboard-tickets-drawer");
    if (drawer) drawer.hidden = true;
    currentFilter = null;
  }

  function renderDrawerList() {
    var listEl = $("dashboard-tickets-drawer-list");
    var titleEl = $("dashboard-tickets-drawer-title");
    if (!listEl || !titleEl) return;

    titleEl.textContent =
      currentFilter === "report" ? "나의 신고내역" : "나의 질문내역";

    var filtered = TICKET_CACHE.filter(function (t) {
      return t.type === currentFilter;
    });

    listEl.innerHTML = "";
    if (!filtered.length) {
      var empty = document.createElement("p");
      empty.className = "dashboard-ticket-empty";
      empty.textContent =
        currentFilter === "report"
          ? "아직 제출한 오류 신고가 없습니다."
          : "아직 제출한 질문이 없습니다.";
      listEl.appendChild(empty);
      return;
    }

    for (var i = 0; i < filtered.length; i++) {
      listEl.appendChild(renderTicketCard(filtered[i]));
    }
  }

  function renderTicketCard(t) {
    var art = document.createElement("article");
    art.className = "dashboard-ticket-item";

    var meta = document.createElement("p");
    meta.className = "dashboard-ticket-item__meta";
    var st = document.createElement("span");
    st.className = "dashboard-ticket-item__status";
    st.textContent = statusLabel(t.status);
    meta.appendChild(st);
    meta.appendChild(document.createTextNode(" · " + formatWhen(t.createdAt)));
    art.appendChild(meta);

    var msg = document.createElement("p");
    msg.className = "dashboard-ticket-item__message";
    msg.textContent = truncate(t.message, 2000);
    art.appendChild(msg);

    var qc = t.quizContext;
    if (qc && typeof qc === "object") {
      var parts = [];
      if (qc.topic) parts.push("주제: " + qc.topic);
      if (qc.questionId) parts.push("문항 ID: " + qc.questionId);
      if (parts.length) {
        var ctx = document.createElement("p");
        ctx.className = "dashboard-ticket-item__context";
        ctx.textContent = parts.join(" · ");
        art.appendChild(ctx);
      }
    }

    if (t.adminReply && String(t.adminReply).trim()) {
      var rep = document.createElement("div");
      rep.className = "dashboard-ticket-item__reply";
      var lab = document.createElement("span");
      lab.className = "dashboard-ticket-item__reply-label";
      lab.textContent = "답변";
      rep.appendChild(lab);
      var body = document.createElement("p");
      body.className = "dashboard-ticket-item__reply-body";
      body.textContent = String(t.adminReply).trim();
      rep.appendChild(body);
      art.appendChild(rep);
    }

    return art;
  }

  function openDrawer(filter) {
    currentFilter = filter;
    var drawer = $("dashboard-tickets-drawer");
    if (drawer) {
      drawer.hidden = false;
      renderDrawerList();
      drawer.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }

  function bindTickets(user) {
    if (unsub) {
      unsub();
      unsub = null;
    }
    TICKET_CACHE = [];
    closeDrawer();
    if (!user || typeof window.subscribeUserTickets !== "function") return;
    unsub = window.subscribeUserTickets(user.uid, function (list) {
      TICKET_CACHE = list;
      if (currentFilter) renderDrawerList();
    });
  }

  function initDom() {
    var br = $("dashboard-my-reports");
    var bq = $("dashboard-my-questions");
    var bc = $("dashboard-buy-question-credits");
    var bx = $("dashboard-tickets-drawer-close");

    if (br) {
      br.addEventListener("click", function () {
        if (!requireUser()) return;
        openDrawer("report");
      });
    }
    if (bq) {
      bq.addEventListener("click", function () {
        if (!requireUser()) return;
        openDrawer("question");
      });
    }
    if (bc) {
      bc.addEventListener("click", function () {
        if (!requireUser()) return;
        if (typeof window.goToQuestionPacksSection === "function") {
          window.goToQuestionPacksSection();
        }
      });
    }
    if (bx) bx.addEventListener("click", closeDrawer);
  }

  window.addEventListener("app-auth", function (e) {
    var user = e.detail ? e.detail.user : null;
    bindTickets(user);
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      initDom();
      bindTickets(
        typeof window.getHanlawUser === "function" ? window.getHanlawUser() : null
      );
    });
  } else {
    initDom();
    bindTickets(typeof window.getHanlawUser === "function" ? window.getHanlawUser() : null);
  }
})();
