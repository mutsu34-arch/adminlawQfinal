(function () {
  var TICKET_CACHE = [];
  var ELLY_ASK_CACHE = [];
  var unsub = null;
  var unsubElly = null;
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

  function haystackForEllyAsk(x) {
    return [
      String(x.userQuestion || ""),
      String(x.answerPreview || x.answerFull || ""),
      String(x.quizStatement || ""),
      String(x.quizTopic || ""),
      String(x.questionId || ""),
      findStatementFromBank(x.questionId),
      String(x.mode || "")
    ]
      .join("\n")
      .toLowerCase();
  }

  function ticketMatchesSearch(t, q) {
    if (!q) return true;
    return haystackForTicket(t).indexOf(q) !== -1;
  }

  function ellyAskMatchesSearch(x, q) {
    if (!q) return true;
    return haystackForEllyAsk(x).indexOf(q) !== -1;
  }

  function syncTabUi(filter) {
    document.querySelectorAll(".dashboard-inquiry-tab[data-filter]").forEach(function (btn) {
      var f = btn.getAttribute("data-filter");
      var isActive = !!filter && f === filter;
      btn.setAttribute("aria-selected", isActive ? "true" : "false");
      btn.classList.toggle("dashboard-inquiry-tab--active", isActive);
    });
  }

  function closeDrawer() {
    var drawer = $("dashboard-tickets-drawer");
    if (drawer) drawer.hidden = true;
    currentFilter = null;
    syncTabUi(null);
    var search = $("dashboard-tickets-search");
    if (search) search.value = "";
  }

  function drawerTitleForFilter(f) {
    if (f === "report") return "나의 신고내역";
    if (f === "question") return "나의 질문내역 (변호사)";
    if (f === "suggestion") return "나의 개선 의견";
    if (f === "elly") return "엘리(AI) 질문 내역";
    return "";
  }

  function emptyMessageForFilter(f, ofTypeLen, hasSearch) {
    if (ofTypeLen && hasSearch) return "검색 조건에 맞는 항목이 없습니다.";
    if (f === "report") return "아직 제출한 오류 신고가 없습니다.";
    if (f === "question") return "아직 제출한 질문이 없습니다.";
    if (f === "suggestion") return "아직 제출한 개선 의견이 없습니다.";
    if (f === "elly") return "아직 엘리(AI) 질문 기록이 없습니다. (이후 질문부터 여기에 쌓입니다.)";
    return "항목이 없습니다.";
  }

  function renderDrawerList() {
    var listEl = $("dashboard-tickets-drawer-list");
    var titleEl = $("dashboard-tickets-drawer-title");
    if (!listEl || !titleEl) return;

    titleEl.textContent = drawerTitleForFilter(currentFilter);

    var q = getSearchQuery();
    var ofType;
    if (currentFilter === "elly") {
      ofType = ELLY_ASK_CACHE.slice();
    } else {
      ofType = TICKET_CACHE.filter(function (t) {
        return t.type === currentFilter;
      });
    }

    var filtered =
      currentFilter === "elly"
        ? ofType.filter(function (x) {
            return ellyAskMatchesSearch(x, q);
          })
        : ofType.filter(function (t) {
            return ticketMatchesSearch(t, q);
          });

    listEl.innerHTML = "";
    if (!filtered.length) {
      var empty = document.createElement("p");
      empty.className = "dashboard-ticket-empty";
      empty.textContent = emptyMessageForFilter(currentFilter, ofType.length, !!q);
      listEl.appendChild(empty);
      return;
    }

    for (var i = 0; i < filtered.length; i++) {
      if (currentFilter === "elly") {
        listEl.appendChild(renderEllyAskCard(filtered[i]));
      } else {
        listEl.appendChild(renderTicketCard(filtered[i]));
      }
    }
  }

  function renderEllyAskCard(x) {
    var art = document.createElement("article");
    art.className = "dashboard-ticket-item dashboard-elly-ask-item";
    var ellyAskId = String(x._docId || "").trim();

    var meta = document.createElement("p");
    meta.className = "dashboard-ticket-item__meta";
    var st = document.createElement("span");
    st.className = "dashboard-ticket-item__status";
    st.textContent = "생성됨";
    meta.appendChild(st);
    meta.appendChild(document.createTextNode(" · " + formatWhen(x.createdAt)));
    art.appendChild(meta);

    var stmtText =
      String(x.quizStatement || "").trim() || findStatementFromBank(x.questionId);
    var msgTrim = String(x.userQuestion || "").trim();
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
      quizLab.textContent =
        x.mode === "dictionary" ? "사전 본문·맥락" : "해당 퀴즈 지문";
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

    var topicParts = [];
    if (x.quizTopic && String(x.quizTopic).trim()) {
      topicParts.push("주제: " + String(x.quizTopic).trim());
    }
    if (x.questionId && String(x.questionId).trim() && isAdminViewer()) {
      topicParts.push("문항 ID: " + String(x.questionId).trim());
    }
    if (topicParts.length) {
      var topicLine = document.createElement("p");
      topicLine.className = "dashboard-ticket-item__context";
      topicLine.textContent = topicParts.join(" · ");
      art.appendChild(topicLine);
    }

    var answerText = String(x.answerPreview || x.answerFull || "").trim();
    if (answerText) {
      var aLab = document.createElement("span");
      aLab.className = "dashboard-ticket-item__reply-label";
      aLab.textContent = "AI 답변";
      var aWrap = document.createElement("div");
      aWrap.className = "dashboard-ticket-item__reply";
      aWrap.appendChild(aLab);
      var aBody = document.createElement("div");
      aBody.className = "dashboard-ticket-item__reply-body quiz-ai-answer";
      var apTrunc = truncate(answerText, 4000);
      if (typeof window.formatHanlawAiAnswerHtml === "function") {
        aBody.innerHTML = window.formatHanlawAiAnswerHtml(apTrunc);
      } else {
        aBody.textContent = apTrunc;
      }
      aWrap.appendChild(aBody);
      art.appendChild(aWrap);

      if (ellyAskId) {
        var pubStateElly = x.qaCommunityPublished === true;
        var qaBoxElly = document.createElement("div");
        qaBoxElly.className = "dashboard-ticket-item__qa-community";

        if (!pubStateElly) {
          var hintElly = document.createElement("p");
          hintElly.className = "dashboard-ticket-item__qa-hint";
          hintElly.textContent =
            "공개하면 다른 회원이 Q&A에서 이 질문과 엘리(AI) 답변을 열람할 수 있습니다. 다른 사람이 처음으로 답변을 펼쳐 볼 때 질문자에게 출석 포인트 200점이 적립될 수 있습니다.";
          qaBoxElly.appendChild(hintElly);

          var pubBtnElly = document.createElement("button");
          pubBtnElly.type = "button";
          pubBtnElly.className = "btn btn--secondary btn--small dashboard-ticket-item__qa-publish-btn";
          pubBtnElly.textContent = "질문답변 공개하기";
          pubBtnElly.addEventListener("click", function () {
            if (!requireUser()) return;
            if (typeof firebase === "undefined" || !firebase.functions) {
              window.alert("Cloud Functions를 사용할 수 없습니다.");
              return;
            }
            pubBtnElly.disabled = true;
            var regionE = window.FIREBASE_FUNCTIONS_REGION || "asia-northeast3";
            firebase
              .app()
              .functions(regionE)
              .httpsCallable("publishEllyQaCommunity")({ ellyAskId: ellyAskId })
              .then(function () {
                try {
                  window.dispatchEvent(new CustomEvent("hanlaw-public-qa-refresh"));
                } catch (e) {}
                if (typeof window.refreshHanlawPublicQa === "function") {
                  window.refreshHanlawPublicQa();
                }
              })
              .catch(function (err) {
                window.alert((err && err.message) || "공개 처리에 실패했습니다.");
              })
              .then(function () {
                pubBtnElly.disabled = false;
              });
          });
          qaBoxElly.appendChild(pubBtnElly);
        } else {
          var doneElly = document.createElement("p");
          doneElly.className = "dashboard-ticket-item__qa-done";
          doneElly.textContent = "이 질문과 답변은 Q&A에 공개된 상태입니다.";
          qaBoxElly.appendChild(doneElly);

          var unpubElly = document.createElement("button");
          unpubElly.type = "button";
          unpubElly.className = "btn btn--outline btn--small dashboard-ticket-item__qa-publish-btn";
          unpubElly.textContent = "비공개로 전환하기";
          unpubElly.addEventListener("click", function () {
            if (!requireUser()) return;
            if (typeof firebase === "undefined" || !firebase.functions) {
              window.alert("Cloud Functions를 사용할 수 없습니다.");
              return;
            }
            unpubElly.disabled = true;
            var regionU = window.FIREBASE_FUNCTIONS_REGION || "asia-northeast3";
            firebase
              .app()
              .functions(regionU)
              .httpsCallable("unpublishEllyQaCommunity")({ ellyAskId: ellyAskId })
              .then(function () {
                try {
                  window.dispatchEvent(new CustomEvent("hanlaw-public-qa-refresh"));
                } catch (e) {}
                if (typeof window.refreshHanlawPublicQa === "function") {
                  window.refreshHanlawPublicQa();
                }
              })
              .catch(function (err) {
                window.alert((err && err.message) || "비공개 전환에 실패했습니다.");
              })
              .then(function () {
                unpubElly.disabled = false;
              });
          });
          qaBoxElly.appendChild(unpubElly);
        }

        art.appendChild(qaBoxElly);
      }
    }

    return art;
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
      quizLab.textContent = t.type === "suggestion" ? "관련 퀴즈 지문" : "해당 퀴즈 지문";
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

    if (String(t.type || "").toLowerCase() === "question" && !(t.adminReply && String(t.adminReply).trim())) {
      var qaBoxPending = document.createElement("div");
      qaBoxPending.className = "dashboard-ticket-item__qa-community";
      var allowFuturePending = t.qaAllowFutureCommunity !== false;
      var pendingMsg = document.createElement("p");
      pendingMsg.className = "dashboard-ticket-item__qa-hint";
      pendingMsg.textContent = allowFuturePending
        ? "변호사 답변이 등록되면 여기에서 Q&A 공개 여부를 최종 결정할 수 있습니다."
        : "접수 시 Q&A 게시판 공개를 선택하지 않았습니다. 이 질문은 답변 후에도 공개 버튼이 나타나지 않습니다.";
      qaBoxPending.appendChild(pendingMsg);
      art.appendChild(qaBoxPending);
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

      if (String(t.type || "").toLowerCase() === "question") {
        var ticketIdForQa = t.id || t._docId || "";
        var pubState = t.qaCommunityPublished;
        var allowFuture = t.qaAllowFutureCommunity !== false;
        var isPublished = pubState === true;
        var showPublishBtn = !isPublished && allowFuture;

        var qaBox = document.createElement("div");
        qaBox.className = "dashboard-ticket-item__qa-community";

        if (!isPublished && !allowFuture) {
          var declinedP = document.createElement("p");
          declinedP.className = "dashboard-ticket-item__qa-declined";
          declinedP.textContent =
            "접수 시 Q&A 게시판 공개를 선택하지 않아, 이 질문은 목록에 올리지 않습니다.";
          qaBox.appendChild(declinedP);
        } else if (showPublishBtn) {
          var hintP = document.createElement("p");
          hintP.className = "dashboard-ticket-item__qa-hint";
          hintP.textContent =
            "공개하면 다른 회원이 Q&A에서 이 질문과 답변을 열람할 수 있습니다. 다른 사람이 처음으로 답변을 펼쳐 볼 때 질문자에게 출석 포인트가 적립될 수 있습니다.";
          qaBox.appendChild(hintP);

          var pubBtn = document.createElement("button");
          pubBtn.type = "button";
          pubBtn.className = "btn btn--secondary btn--small dashboard-ticket-item__qa-publish-btn";
          pubBtn.textContent = "질문답변 공개하기";
          pubBtn.addEventListener("click", function () {
            if (!requireUser()) return;
            if (!ticketIdForQa) {
              window.alert("티켓 정보를 찾을 수 없습니다.");
              return;
            }
            if (typeof firebase === "undefined" || !firebase.functions) {
              window.alert("Cloud Functions를 사용할 수 없습니다.");
              return;
            }
            pubBtn.disabled = true;
            var region = window.FIREBASE_FUNCTIONS_REGION || "asia-northeast3";
            firebase
              .app()
              .functions(region)
              .httpsCallable("publishLawyerQaCommunity")({ ticketId: ticketIdForQa })
              .then(function () {
                try {
                  window.dispatchEvent(new CustomEvent("hanlaw-public-qa-refresh"));
                } catch (e) {}
                if (typeof window.refreshHanlawPublicQa === "function") {
                  window.refreshHanlawPublicQa();
                }
              })
              .catch(function (err) {
                window.alert((err && err.message) || "공개 처리에 실패했습니다.");
              })
              .then(function () {
                pubBtn.disabled = false;
              });
          });
          qaBox.appendChild(pubBtn);
        } else {
          var doneP = document.createElement("p");
          doneP.className = "dashboard-ticket-item__qa-done";
          doneP.textContent = "이 질문과 답변은 Q&A에 공개된 상태입니다.";
          qaBox.appendChild(doneP);

          var unpubBtn = document.createElement("button");
          unpubBtn.type = "button";
          unpubBtn.className = "btn btn--outline btn--small dashboard-ticket-item__qa-publish-btn";
          unpubBtn.textContent = "비공개로 전환하기";
          unpubBtn.addEventListener("click", function () {
            if (!requireUser()) return;
            if (!ticketIdForQa) {
              window.alert("티켓 정보를 찾을 수 없습니다.");
              return;
            }
            if (typeof firebase === "undefined" || !firebase.functions) {
              window.alert("Cloud Functions를 사용할 수 없습니다.");
              return;
            }
            unpubBtn.disabled = true;
            var region2 = window.FIREBASE_FUNCTIONS_REGION || "asia-northeast3";
            firebase
              .app()
              .functions(region2)
              .httpsCallable("unpublishLawyerQaCommunity")({ ticketId: ticketIdForQa })
              .then(function () {
                try {
                  window.dispatchEvent(new CustomEvent("hanlaw-public-qa-refresh"));
                } catch (e) {}
                if (typeof window.refreshHanlawPublicQa === "function") {
                  window.refreshHanlawPublicQa();
                }
              })
              .catch(function (err) {
                window.alert((err && err.message) || "비공개 전환에 실패했습니다.");
              })
              .then(function () {
                unpubBtn.disabled = false;
              });
          });
          qaBox.appendChild(unpubBtn);
        }

        art.appendChild(qaBox);
      }
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
    if (unsubElly) {
      unsubElly();
      unsubElly = null;
    }
    TICKET_CACHE = [];
    ELLY_ASK_CACHE = [];
    closeDrawer();
    if (!user) return;

    if (typeof window.subscribeUserTickets === "function") {
      unsub = window.subscribeUserTickets(user.uid, function (list) {
        TICKET_CACHE = list;
        if (currentFilter && currentFilter !== "elly") renderDrawerList();
      });
    }

    if (typeof window.subscribeUserEllyAsks === "function") {
      unsubElly = window.subscribeUserEllyAsks(user.uid, function (list) {
        ELLY_ASK_CACHE = list;
        if (currentFilter === "elly") renderDrawerList();
      });
    }
  }

  function initDom() {
    var tabs = document.querySelector(".dashboard-inquiry-tabs");
    if (tabs) {
      tabs.addEventListener("click", function (e) {
        var btn = e.target.closest(".dashboard-inquiry-tab[data-filter]");
        if (!btn) return;
        var f = btn.getAttribute("data-filter");
        if (!f) return;
        if (!requireUser()) return;
        openDrawer(f);
      });
    }

    var bc = $("dashboard-buy-question-credits");
    var bx = $("dashboard-tickets-drawer-close");

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
