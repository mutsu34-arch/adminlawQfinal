(function () {
  var TICKET_CACHE = [];
  var unsub = null;
  var currentFilter = null;
  var searchDebTimer = null;
  var SEARCH_DEB_MS = 220;

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

  function isAdminViewer() {
    var u = typeof window.getHanlawUser === "function" ? window.getHanlawUser() : null;
    if (!u || !u.email) return false;
    var emails = window.ADMIN_EMAILS || [];
    var mail = String(u.email).toLowerCase();
    for (var i = 0; i < emails.length; i++) {
      if (String(emails[i]).toLowerCase() === mail) return true;
    }
    return false;
  }

  function findStatementFromBank(questionId) {
    if (!questionId || !window.QUESTION_BANK || !window.QUESTION_BANK.length) return "";
    var id = String(questionId).trim();
    for (var i = 0; i < window.QUESTION_BANK.length; i++) {
      var q = window.QUESTION_BANK[i];
      if (q && String(q.id) === id) return String(q.statement || "").trim();
    }
    return "";
  }

  function resolveQuizStatement(qc) {
    if (!qc || typeof qc !== "object") return "";
    var s = String(qc.statement || "").trim();
    if (s) return s;
    return findStatementFromBank(qc.questionId);
  }

  function formatReplyForDisplay(s) {
    if (typeof window.stripHanlawReplyListMarkers === "function") {
      return window.stripHanlawReplyListMarkers(s);
    }
    return String(s || "");
  }

  function getSearchQuery() {
    var el = $("dashboard-tickets-search");
    return el ? String(el.value || "").trim().toLowerCase() : "";
  }

  function haystackForTicket(t) {
    var parts = [];
    parts.push(String(t.message || ""));
    parts.push(String(t.adminReply || ""));
    parts.push(String(t.type || ""));
    var qc = t.quizContext;
    if (qc && typeof qc === "object") {
      parts.push(String(qc.topic || ""));
      parts.push(String(qc.questionId || ""));
      parts.push(String(qc.statement || ""));
      parts.push(resolveQuizStatement(qc));
    }
    return parts.join("\n").toLowerCase();
  }

  function ticketMatchesSearch(t, q) {
    if (!q) return true;
    return haystackForTicket(t).indexOf(q) !== -1;
  }

  function syncTabUi(filter) {
    var br = $("dashboard-my-reports");
    var bq = $("dashboard-my-questions");
    var tabs = [br, bq];
    for (var i = 0; i < tabs.length; i++) {
      var btn = tabs[i];
      if (!btn) continue;
      var f = btn.getAttribute("data-filter");
      var isActive = !!filter && f === filter;
      btn.setAttribute("aria-selected", isActive ? "true" : "false");
      btn.classList.toggle("dashboard-inquiry-tab--active", isActive);
    }
  }

  function closeDrawer() {
    var drawer = $("dashboard-tickets-drawer");
    if (drawer) drawer.hidden = true;
    currentFilter = null;
    syncTabUi(null);
    var search = $("dashboard-tickets-search");
    if (search) search.value = "";
  }

  function renderDrawerList() {
    var listEl = $("dashboard-tickets-drawer-list");
    var titleEl = $("dashboard-tickets-drawer-title");
    if (!listEl || !titleEl) return;

    titleEl.textContent =
      currentFilter === "report" ? "나의 신고내역" : "나의 질문내역";

    var q = getSearchQuery();
    var ofType = TICKET_CACHE.filter(function (t) {
      return t.type === currentFilter;
    });
    var filtered = ofType.filter(function (t) {
      return ticketMatchesSearch(t, q);
    });

    listEl.innerHTML = "";
    if (!filtered.length) {
      var empty = document.createElement("p");
      empty.className = "dashboard-ticket-empty";
      if (ofType.length && q) {
        empty.textContent = "검색 조건에 맞는 항목이 없습니다.";
      } else {
        empty.textContent =
          currentFilter === "report"
            ? "아직 제출한 오류 신고가 없습니다."
            : "아직 제출한 질문이 없습니다.";
      }
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

    var qc = t.quizContext;
    var stmtText = qc && typeof qc === "object" ? resolveQuizStatement(qc) : "";
    var msgTrim = String(t.message || "").trim();
    var hasQuiz = !!stmtText;
    var hasMsg = !!msgTrim;

    var bodyEl = document.createElement("div");
    bodyEl.className = "dashboard-ticket-item__body";
    if (hasQuiz && hasMsg) {
      bodyEl.classList.add("dashboard-ticket-item__body--split");
    }

    if (hasQuiz) {
      var quizBox = document.createElement("div");
      quizBox.className = "dashboard-ticket-item__quiz";
      var quizLab = document.createElement("span");
      quizLab.className = "dashboard-ticket-item__quiz-label";
      quizLab.textContent = "해당 퀴즈 지문";
      quizBox.appendChild(quizLab);
      var quizP = document.createElement("div");
      quizP.className = "dashboard-ticket-item__quiz-text quiz-ai-answer";
      if (typeof window.formatHanlawRichParagraphsHtml === "function") {
        quizP.innerHTML = window.formatHanlawRichParagraphsHtml(stmtText);
      } else {
        quizP.textContent = stmtText;
      }
      quizBox.appendChild(quizP);
      bodyEl.appendChild(quizBox);
    }

    if (hasMsg) {
      var msg = document.createElement("div");
      msg.className = "dashboard-ticket-item__message quiz-ai-answer";
      var msgTrunc = truncate(msgTrim, 2000);
      if (typeof window.formatHanlawRichParagraphsHtml === "function") {
        msg.innerHTML = window.formatHanlawRichParagraphsHtml(msgTrunc);
      } else {
        msg.textContent = msgTrunc;
      }
      bodyEl.appendChild(msg);
    }

    if (hasQuiz || hasMsg) {
      art.appendChild(bodyEl);
    }

    if (qc && typeof qc === "object") {
      var parts = [];
      if (qc.topic) parts.push("주제: " + qc.topic);
      if (qc.questionId && isAdminViewer()) {
        parts.push("문항 ID: " + qc.questionId);
      }
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
      var body = document.createElement("div");
      body.className = "dashboard-ticket-item__reply-body quiz-ai-answer";
      var repRaw = formatReplyForDisplay(String(t.adminReply).trim());
      if (typeof window.formatHanlawAiAnswerHtml === "function") {
        body.innerHTML = window.formatHanlawAiAnswerHtml(repRaw);
      } else {
        body.textContent = repRaw;
      }
      rep.appendChild(body);
      art.appendChild(rep);
    }

    return art;
  }

  function openDrawer(filter) {
    if (currentFilter !== filter) {
      var search = $("dashboard-tickets-search");
      if (search) search.value = "";
    }
    currentFilter = filter;
    syncTabUi(filter);
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

    var searchEl = $("dashboard-tickets-search");
    if (searchEl) {
      searchEl.addEventListener("input", function () {
        if (!currentFilter) return;
        clearTimeout(searchDebTimer);
        searchDebTimer = setTimeout(function () {
          renderDrawerList();
        }, SEARCH_DEB_MS);
      });
    }
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
