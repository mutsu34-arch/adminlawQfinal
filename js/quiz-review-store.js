/**
 * 자동 복습: 문항별 시도 기록(시각·정오·본퀴즈/복습), 복습 대기열, 마스터(연속 3회 정답) 처리.
 * 사용자별 localStorage (로그인 시 uid, 비로그인 anon).
 */
(function () {
  var STORE_VER = "v1";
  var PREFIX = "hanlaw_quiz_review_" + STORE_VER + "_";
  var LS_ENABLED = "hanlaw_auto_review_enabled_" + STORE_VER;

  function currentUid() {
    try {
      if (typeof window.getHanlawUser === "function") {
        var u = window.getHanlawUser();
        if (u) return u.uid;
      }
    } catch (e) {}
    return null;
  }

  function storeKey() {
    return PREFIX + (currentUid() || "anon");
  }

  function defaultStore() {
    return {
      byQuestion: {},
      queue: []
    };
  }

  function loadStore() {
    try {
      var raw = localStorage.getItem(storeKey());
      if (!raw) return defaultStore();
      var o = JSON.parse(raw);
      if (!o || typeof o !== "object") return defaultStore();
      if (!o.byQuestion) o.byQuestion = {};
      if (!Array.isArray(o.queue)) o.queue = [];
      return o;
    } catch (e) {
      return defaultStore();
    }
  }

  function saveStore(st) {
    try {
      localStorage.setItem(storeKey(), JSON.stringify(st));
    } catch (e) {}
  }

  function countConsecutiveCorrectFromEnd(attempts) {
    var n = 0;
    for (var i = attempts.length - 1; i >= 0; i--) {
      if (attempts[i].ok) n++;
      else break;
    }
    return n;
  }

  function isEnabled() {
    try {
      return localStorage.getItem(LS_ENABLED) === "1";
    } catch (e) {
      return false;
    }
  }

  function setEnabled(v) {
    try {
      if (v) localStorage.setItem(LS_ENABLED, "1");
      else localStorage.removeItem(LS_ENABLED);
    } catch (e) {}
  }

  /**
   * @returns {{ mastered: boolean, inQueue: boolean }}
   */
  function recordAnswer(questionId, isCorrect, context) {
    var qid = String(questionId || "").trim();
    if (!qid) return { mastered: false, inQueue: false };

    var st = loadStore();
    if (!st.byQuestion[qid]) st.byQuestion[qid] = { attempts: [] };
    var rec = st.byQuestion[qid];
    rec.attempts.push({
      t: Date.now(),
      ok: !!isCorrect,
      ctx: context === "review" ? "review" : "main"
    });

    var inQueue = st.queue.indexOf(qid) >= 0;
    var mastered = false;

    if (!isCorrect) {
      if (st.queue.indexOf(qid) < 0) st.queue.push(qid);
    } else if (inQueue) {
      var consec = countConsecutiveCorrectFromEnd(rec.attempts);
      if (consec >= 3) {
        st.queue = st.queue.filter(function (id) {
          return id !== qid;
        });
        mastered = true;
      }
    }

    saveStore(st);
    return { mastered: mastered, inQueue: st.queue.indexOf(qid) >= 0 };
  }

  function getAttempts(questionId) {
    var st = loadStore();
    var qid = String(questionId || "").trim();
    var rec = st.byQuestion[qid];
    return rec && Array.isArray(rec.attempts) ? rec.attempts.slice() : [];
  }

  function pickNextReviewId(bankIds) {
    var st = loadStore();
    if (bankIds && bankIds.length) {
      var set = {};
      for (var i = 0; i < bankIds.length; i++) set[bankIds[i]] = true;
      for (var j = 0; j < st.queue.length; j++) {
        var id = st.queue[j];
        if (set[id]) return id;
      }
      return null;
    }
    return st.queue.length ? st.queue[0] : null;
  }

  function hasReviewCandidates(bankIds) {
    return pickNextReviewId(bankIds) != null;
  }

  function formatAttemptLine(a) {
    var d = new Date(a.t);
    var when = d.toLocaleString("ko-KR", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
    var where = a.ctx === "review" ? "복습 팝업" : "본 퀴즈";
    var res = a.ok ? "정답" : "오답";
    return when + " · " + res + " (" + where + ")";
  }

  /** 사람이 읽기 쉬운 시도 요약 (연속 오답·교차 포함) */
  function buildHistorySummaryHtml(attempts) {
    if (!attempts.length) {
      return "<p class=\"review-history__empty\">아직 기록된 풀이 이력이 없습니다.</p>";
    }
    var sorted = attempts.slice().sort(function (a, b) {
      return a.t - b.t;
    });
    var lines = sorted.map(function (a) {
      return formatAttemptLine(a);
    });
    var ul = document.createElement("ul");
    ul.className = "review-history__list";
    for (var i = 0; i < lines.length; i++) {
      var li = document.createElement("li");
      li.textContent = lines[i];
      ul.appendChild(li);
    }
    var wrap = document.createElement("div");
    wrap.className = "review-history";
    var h = document.createElement("p");
    h.className = "review-history__title";
    h.textContent = "이 문항 풀이 이력";
    wrap.appendChild(h);
    wrap.appendChild(ul);
    return wrap.outerHTML;
  }

  window.QuizReviewStore = {
    isEnabled: isEnabled,
    setEnabled: setEnabled,
    recordAnswer: recordAnswer,
    getAttempts: getAttempts,
    pickNextReviewId: pickNextReviewId,
    hasReviewCandidates: hasReviewCandidates,
    buildHistorySummaryHtml: buildHistorySummaryHtml
  };

  window.addEventListener("app-auth", function () {
    /* uid 변경 시 저장소 키만 바뀜 — 별도 마이그레이션 없음 */
  });
})();
