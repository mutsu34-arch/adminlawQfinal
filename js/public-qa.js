(function () {
  var COLL = "hanlaw_qa_public";
  var unsub = null;

  function getDb() {
    try {
      return firebase.firestore();
    } catch (e) {
      return null;
    }
  }

  function isLoggedIn() {
    var u = typeof window.getHanlawUser === "function" ? window.getHanlawUser() : null;
    return !!(u && u.email);
  }

  function publicViewerKey() {
    try {
      var k = localStorage.getItem("hanlaw_public_viewer_key");
      if (k) return String(k);
      var nk = "guest_" + Math.random().toString(36).slice(2, 12);
      localStorage.setItem("hanlaw_public_viewer_key", nk);
      return nk;
    } catch (e) {
      return "guest_fallback";
    }
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

  function stripReply(s) {
    if (typeof window.stripHanlawReplyListMarkers === "function") {
      return window.stripHanlawReplyListMarkers(s);
    }
    return String(s || "");
  }

  function fillAnswerArea(ansBody, r) {
    ansBody.innerHTML = "";
    var hasQuiz =
      (r.quizTopic && String(r.quizTopic).trim()) ||
      (r.quizStatement && String(r.quizStatement).trim()) ||
      (r.questionId && String(r.questionId).trim() && isAdminViewer());
    if (hasQuiz) {
      var qb = document.createElement("div");
      qb.className = "public-qa-item__quiz";
      if (r.quizTopic && String(r.quizTopic).trim()) {
        var tp = document.createElement("p");
        tp.className = "public-qa-item__quiz-meta";
        tp.textContent = "주제: " + String(r.quizTopic).trim();
        qb.appendChild(tp);
      }
      if (r.quizStatement && String(r.quizStatement).trim()) {
        var sl = document.createElement("span");
        sl.className = "public-qa-item__quiz-label";
        sl.textContent = "해당 퀴즈 지문";
        qb.appendChild(sl);
        var st = document.createElement("p");
        st.className = "public-qa-item__quiz-text quiz-ai-answer";
        var stmt = String(r.quizStatement).trim();
        if (typeof window.formatHanlawRichParagraphsHtml === "function") {
          st.innerHTML = window.formatHanlawRichParagraphsHtml(stmt);
        } else {
          st.textContent = stmt;
        }
        qb.appendChild(st);
      }
      if (r.questionId && String(r.questionId).trim() && isAdminViewer()) {
        var idp = document.createElement("p");
        idp.className = "public-qa-item__quiz-meta public-qa-item__quiz-meta--admin";
        idp.textContent = "문항 ID: " + String(r.questionId).trim();
        qb.appendChild(idp);
      }
      ansBody.appendChild(qb);
    }
    var ansP = document.createElement("div");
    ansP.className = "public-qa-item__answer-text quiz-ai-answer";
    var ansRaw = stripReply(r.answer || "");
    if (typeof window.formatHanlawAiAnswerHtml === "function") {
      ansP.innerHTML = window.formatHanlawAiAnswerHtml(ansRaw);
    } else {
      ansP.textContent = ansRaw;
    }
    ansBody.appendChild(ansP);
  }

  function renderEmpty(on) {
    var empty = document.getElementById("public-qa-empty");
    if (empty) empty.hidden = !on;
  }

  function setLoginHint(on) {
    var h = document.getElementById("public-qa-login-hint");
    if (!h) return;
    if (on) {
      h.textContent =
        "[무료 체험 중] 비회원은 공개 Q&A를 최대 5개까지 열람할 수 있습니다. 현재 최신 5개만 표시됩니다. 더 많은 Q&A와 검색은 로그인 후 이용해 주세요.";
    } else {
      h.textContent = "";
    }
    h.hidden = !on;
  }

  function setSearchStatus(text, show) {
    var el = document.getElementById("public-qa-search-status");
    if (!el) return;
    el.textContent = text || "";
    el.hidden = !show;
  }

  function setClearBtnVisible(on) {
    var b = document.getElementById("public-qa-search-clear");
    if (b) b.hidden = !on;
  }

  /**
   * @param {HTMLElement} listEl
   * @param {string} tid
   * @param {string|{questionMessage?:string,quizTopic?:string,quizStatement?:string}} row
   */
  function appendPublicQaItem(listEl, tid, row) {
    var qtext =
      typeof row === "string"
        ? row
        : String((row && row.questionMessage) || "").trim() || "(내용 없음)";
    var quizTopic =
      row && typeof row === "object" && row.quizTopic ? String(row.quizTopic).trim() : "";
    var quizStatement =
      row && typeof row === "object" && row.quizStatement
        ? String(row.quizStatement).trim()
        : "";

    var article = document.createElement("article");
    article.className = "public-qa-item";
    article.setAttribute("data-ticket-id", tid);

    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "public-qa-item__toggle";
    btn.setAttribute("aria-expanded", "false");

    if (quizTopic || quizStatement) {
      var thread = document.createElement("div");
      thread.className = "public-qa-item__thread";

      var stem = document.createElement("div");
      stem.className = "public-qa-item__stem";
      if (quizTopic) {
        var tp = document.createElement("p");
        tp.className = "public-qa-item__stem-topic";
        tp.textContent = "주제: " + quizTopic;
        stem.appendChild(tp);
      }
      if (quizStatement) {
        var sk = document.createElement("span");
        sk.className = "public-qa-item__stem-kicker";
        sk.textContent = "퀴즈 지문";
        stem.appendChild(sk);
        var sp = document.createElement("p");
        sp.className = "public-qa-item__stem-text quiz-ai-answer";
        if (typeof window.formatHanlawRichParagraphsHtml === "function") {
          sp.innerHTML = window.formatHanlawRichParagraphsHtml(quizStatement);
        } else {
          sp.textContent = quizStatement;
        }
        stem.appendChild(sp);
      }
      thread.appendChild(stem);

      var userBlock = document.createElement("div");
      userBlock.className = "public-qa-item__user-block";
      var uqK = document.createElement("span");
      uqK.className = "public-qa-item__user-q-kicker";
      uqK.textContent = "회원 질문";
      userBlock.appendChild(uqK);
      var pq = document.createElement("p");
      pq.className = "public-qa-item__q quiz-ai-answer";
      if (typeof window.formatHanlawRichParagraphsHtml === "function") {
        pq.innerHTML = window.formatHanlawRichParagraphsHtml(qtext);
      } else {
        pq.textContent = qtext;
      }
      userBlock.appendChild(pq);
      thread.appendChild(userBlock);

      btn.appendChild(thread);
    } else {
      var pqSolo = document.createElement("p");
      pqSolo.className = "public-qa-item__q public-qa-item__q--solo quiz-ai-answer";
      if (typeof window.formatHanlawRichParagraphsHtml === "function") {
        pqSolo.innerHTML = window.formatHanlawRichParagraphsHtml(qtext);
      } else {
        pqSolo.textContent = qtext;
      }
      btn.appendChild(pqSolo);
    }

    var hint = document.createElement("span");
    hint.className = "public-qa-item__hint";
    hint.textContent =
      tid.indexOf("elly_") === 0 ? "눌러서 엘리(AI) 답변 보기" : "눌러서 변호사 답변 보기";
    btn.appendChild(hint);

    var ansWrap = document.createElement("div");
    ansWrap.className = "public-qa-item__answer-wrap";
    ansWrap.hidden = true;

    var ansBody = document.createElement("div");
    ansBody.className = "public-qa-item__answer-body";
    ansWrap.appendChild(ansBody);

    var statusLine = document.createElement("p");
    statusLine.className = "public-qa-item__status";
    statusLine.hidden = true;
    ansWrap.appendChild(statusLine);

    article.appendChild(btn);
    article.appendChild(ansWrap);

    var loading = false;
    var loaded = false;

    btn.addEventListener("click", function () {
      if (loading) return;
      var open = btn.getAttribute("aria-expanded") === "true";
      if (open) {
        btn.setAttribute("aria-expanded", "false");
        ansWrap.hidden = true;
        return;
      }
      if (loaded) {
        btn.setAttribute("aria-expanded", "true");
        ansWrap.hidden = false;
        return;
      }
      if (typeof firebase === "undefined" || !firebase.functions) {
        ansBody.innerHTML = "";
        var noFn = document.createElement("p");
        noFn.textContent = "Cloud Functions를 사용할 수 없습니다.";
        ansBody.appendChild(noFn);
        statusLine.hidden = true;
        btn.setAttribute("aria-expanded", "true");
        ansWrap.hidden = false;
        return;
      }
      loading = true;
      ansBody.innerHTML = "";
      var loadP = document.createElement("p");
      loadP.className = "public-qa-item__loading";
      loadP.textContent = "불러오는 중…";
      ansBody.appendChild(loadP);
      statusLine.hidden = true;
      btn.setAttribute("aria-expanded", "true");
      ansWrap.hidden = false;

      var region = window.FIREBASE_FUNCTIONS_REGION || "asia-northeast3";
      firebase
        .app()
        .functions(region)
        .httpsCallable("revealLawyerQaAnswer")({ ticketId: tid, viewerKey: publicViewerKey() })
        .then(function (res) {
          var r = res && res.data ? res.data : {};
          loading = false;
          loaded = true;
          fillAnswerArea(ansBody, r);
          statusLine.hidden = false;
          if (r.selfView) {
            statusLine.textContent = "본인이 올린 질문입니다.";
          } else if (r.pointsAwardedToAsker > 0) {
            statusLine.textContent =
              "이 답변을 처음 확인하셨습니다. 질문을 올리신 분에게 출석 포인트 " +
              r.pointsAwardedToAsker +
              "점이 지급되었습니다.";
          } else {
            statusLine.textContent =
              "이미 이 답변을 확인한 기록이 있습니다. 질문자 포인트는 회원당 최초 1회만 지급됩니다.";
          }
        })
        .catch(function (err) {
          loading = false;
          loaded = false;
          var msg =
            (err && (err.message || err.code)) || "답변을 불러오지 못했습니다.";
          ansBody.innerHTML = "";
          var ep = document.createElement("p");
          ep.textContent = msg;
          ansBody.appendChild(ep);
          statusLine.hidden = true;
        });
    });

    listEl.appendChild(article);
  }

  function exitSearchMode() {
    setSearchStatus("", false);
    setClearBtnVisible(false);
    var inp = document.getElementById("public-qa-search-input");
    if (inp) inp.value = "";
  }

  function runPublicQaSearch() {
    var listEl = document.getElementById("public-qa-list");
    var inp = document.getElementById("public-qa-search-input");
    if (!listEl || !inp) return;
    var q = String(inp.value || "").trim();
    if (q.length < 2) {
      window.alert("검색어는 2글자 이상 입력하세요.");
      return;
    }
    if (!isLoggedIn()) {
      window.alert("검색은 로그인 후 이용할 수 있습니다.");
      return;
    }
    if (typeof firebase === "undefined" || !firebase.functions) {
      window.alert("Cloud Functions를 사용할 수 없습니다.");
      return;
    }

    if (unsub) {
      unsub();
      unsub = null;
    }
    listEl.innerHTML = '<p class="public-qa-loading-msg" aria-live="polite">검색 중…</p>';
    renderEmpty(false);
    setClearBtnVisible(true);

    var region = window.FIREBASE_FUNCTIONS_REGION || "asia-northeast3";
    firebase
      .app()
      .functions(region)
      .httpsCallable("searchLawyerQa")({ query: q })
      .then(function (res) {
        var data = res && res.data ? res.data : {};
        var matches = data.matches || [];
        listEl.innerHTML = "";
        if (!matches.length) {
          renderEmpty(true);
          setSearchStatus(
            "검색 결과가 없습니다. (최근 공개 " + (data.scanned || 0) + "건 중 검색)",
            true
          );
          return;
        }
        renderEmpty(false);
        matches.forEach(function (m) {
          appendPublicQaItem(listEl, m.ticketId, m);
        });
        setSearchStatus(
          "검색 결과 " +
            matches.length +
            "건 (최근 공개 " +
            (data.scanned || 0) +
            "건 중 질문·답변 본문 일치)",
          true
        );
      })
      .catch(function (err) {
        listEl.innerHTML =
          '<p class="public-qa-error">' +
          ((err && err.message) || "검색에 실패했습니다.") +
          "</p>";
        setSearchStatus("", false);
        console.error(err);
      });
  }

  function startList() {
    exitSearchMode();

    var listEl = document.getElementById("public-qa-list");
    if (!listEl) return;
    if (unsub) {
      unsub();
      unsub = null;
    }
    listEl.innerHTML = "";
    renderEmpty(false);

    setLoginHint(!isLoggedIn());

    var d = getDb();
    if (!d) {
      listEl.innerHTML = '<p class="public-qa-error">Firestore를 사용할 수 없습니다.</p>';
      return;
    }

    var cap = isLoggedIn() ? 100 : 5;
    unsub = d
      .collection(COLL)
      .where("communityVisible", "==", true)
      .orderBy("publishedAt", "desc")
      .limit(cap)
      .onSnapshot(
        function (snap) {
          listEl.innerHTML = "";
          if (!snap.docs.length) {
            renderEmpty(true);
            return;
          }
          renderEmpty(false);
          snap.docs.forEach(function (doc) {
            var data = doc.data();
            var tid = doc.id;
            var qtext = String(data.questionMessage || "").trim() || "(내용 없음)";
            appendPublicQaItem(listEl, tid, {
              questionMessage: qtext,
              quizTopic: data.quizTopic,
              quizStatement: data.quizStatement
            });
          });
        },
        function (err) {
          var detail =
            err && (err.code || err.message)
              ? String(err.code || "") + " " + String(err.message || "")
              : "";
          var extra =
            err && String(err.code || "").indexOf("permission") >= 0
              ? " 로컬의 firestore.rules를 Firebase에 배포했는지 확인하세요. (예: firebase deploy --only firestore:rules)"
              : "";
          listEl.innerHTML =
            '<p class="public-qa-error">목록을 불러오지 못했습니다. ' +
            (detail ? "(" + detail.trim() + ") " : "") +
            "인덱스·규칙을 확인해 주세요." +
            extra +
            "</p>";
          console.error(err);
        }
      );
  }

  function initSearchUi() {
    var btn = document.getElementById("public-qa-search-btn");
    var clr = document.getElementById("public-qa-search-clear");
    var inp = document.getElementById("public-qa-search-input");
    if (btn) {
      btn.addEventListener("click", function () {
        runPublicQaSearch();
      });
    }
    if (clr) {
      clr.addEventListener("click", function () {
        startList();
      });
    }
    if (inp) {
      inp.addEventListener("keydown", function (e) {
        if (e.key === "Enter") {
          e.preventDefault();
          runPublicQaSearch();
        }
      });
    }
  }

  window.refreshHanlawPublicQa = startList;

  window.addEventListener("app-auth", function () {
    startList();
  });

  window.addEventListener("hanlaw-public-qa-refresh", function () {
    startList();
  });

  document.addEventListener("DOMContentLoaded", function () {
    initSearchUi();
    startList();
    try {
      if (typeof firebase !== "undefined" && firebase.auth) {
        firebase.auth().onAuthStateChanged(function () {
          startList();
        });
      }
    } catch (e) {}
  });
})();
