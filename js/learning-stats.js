(function () {
  var LS_VER = "v2";
  var LS_PREFIX = "hanlaw_learning_" + LS_VER + "_";

  var attUnsub = null;
  var attendancePointsSnap = null;

  var tickTimer = null;
  var lastTickMs = 0;
  var pendingSec = 0;
  var SAVE_EVERY_SEC = 25;

  function currentUid() {
    try {
      if (typeof window.getHanlawUser === "function") {
        var u = window.getHanlawUser();
        if (u) return u.uid;
      }
    } catch (e) {}
    return null;
  }

  function storageKey() {
    var uid = currentUid();
    return LS_PREFIX + (uid || "anon");
  }

  function kstYmdFromMs(ms) {
    return new Date(ms).toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
  }

  function kstTodayYmd() {
    return kstYmdFromMs(Date.now());
  }

  function defaultState() {
    return {
      totalAnswered: 0,
      totalCorrect: 0,
      byTopic: {},
      daily: {}
    };
  }

  function load() {
    try {
      var raw = localStorage.getItem(storageKey());
      if (!raw) return defaultState();
      var o = JSON.parse(raw);
      if (!o || typeof o !== "object") return defaultState();
      if (!o.daily) o.daily = {};
      if (!o.byTopic) o.byTopic = {};
      return o;
    } catch (e) {
      return defaultState();
    }
  }

  function pruneDaily(state) {
    var keys = Object.keys(state.daily).sort();
    if (keys.length <= 420) return;
    var drop = keys.length - 400;
    for (var i = 0; i < drop; i++) {
      delete state.daily[keys[i]];
    }
  }

  function save(state) {
    try {
      pruneDaily(state);
      localStorage.setItem(storageKey(), JSON.stringify(state));
    } catch (e) {}
    window.dispatchEvent(new CustomEvent("learning-stats-updated"));
  }

  function ensureDay(state, ymd) {
    if (!state.daily[ymd]) {
      state.daily[ymd] = { sec: 0, q: 0, corr: 0, att: 0 };
    }
    return state.daily[ymd];
  }

  function flushPendingTime() {
    if (pendingSec < 1) return;
    var uid = currentUid();
    if (!uid) {
      pendingSec = 0;
      return;
    }
    var add = pendingSec;
    pendingSec = 0;
    var state = load();
    var ymd = kstTodayYmd();
    var d = ensureDay(state, ymd);
    d.sec = (d.sec || 0) + add;
    save(state);
  }

  function tick() {
    var uid = currentUid();
    var shell = document.getElementById("app-shell");
    if (!uid || !shell || shell.hidden || document.visibilityState !== "visible") {
      lastTickMs = 0;
      return;
    }
    var now = Date.now();
    if (!lastTickMs) {
      lastTickMs = now;
      return;
    }
    var delta = (now - lastTickMs) / 1000;
    lastTickMs = now;
    if (delta < 0 || delta > 120) return;
    pendingSec += delta;
    if (pendingSec >= SAVE_EVERY_SEC) {
      flushPendingTime();
    }
  }

  function startTimer() {
    if (tickTimer) return;
    lastTickMs = Date.now();
    tickTimer = setInterval(tick, 5000);
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("beforeunload", onUnload);
  }

  function stopTimer() {
    if (tickTimer) {
      clearInterval(tickTimer);
      tickTimer = null;
    }
    document.removeEventListener("visibilitychange", onVis);
    window.removeEventListener("beforeunload", onUnload);
    lastTickMs = 0;
    flushPendingTime();
  }

  function onVis() {
    if (document.visibilityState === "hidden") {
      flushPendingTime();
      lastTickMs = 0;
    } else {
      lastTickMs = Date.now();
    }
  }

  function onUnload() {
    flushPendingTime();
  }

  function formatDuration(sec) {
    sec = Math.floor(sec || 0);
    if (sec < 60) return sec + "초";
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    if (m < 60) return m + "분 " + (s ? s + "초" : "").trim();
    var h = Math.floor(m / 60);
    m = m % 60;
    return h + "시간 " + (m ? m + "분" : "");
  }

  function sumWeekSeconds(state) {
    var sum = 0;
    for (var i = 0; i < 7; i++) {
      var ymd = kstYmdFromMs(Date.now() - i * 86400000);
      var d = state.daily[ymd];
      if (d && d.sec) sum += d.sec;
    }
    return sum;
  }

  function computeStreak(state) {
    var start = 0;
    var today = kstTodayYmd();
    var td = state.daily[today];
    if (!td || !(td.q > 0)) {
      start = 1;
    }
    var streak = 0;
    for (var i = start; i < 400; i++) {
      var ymd = kstYmdFromMs(Date.now() - i * 86400000);
      var d = state.daily[ymd];
      if (d && d.q > 0) streak++;
      else break;
    }
    return streak;
  }

  function weaknessTopics(state, limit) {
    var list = [];
    for (var t in state.byTopic) {
      var o = state.byTopic[t];
      var a = o.a || 0;
      var c = o.c || 0;
      if (a < 2) continue;
      list.push({
        topic: t,
        answered: a,
        correct: c,
        rate: c / a
      });
    }
    list.sort(function (x, y) {
      return x.rate - y.rate;
    });
    return list.slice(0, limit || 5);
  }

  function renderLearningDashboard() {
    var uid = currentUid();
    if (!document.getElementById("dashboard-learning")) return;

    var lo = document.getElementById("dashboard-learning-loggedout");
    var body = document.getElementById("dashboard-learning-body");
    if (!uid) {
      if (lo) lo.hidden = false;
      if (body) body.hidden = true;
      return;
    }

    if (lo) lo.hidden = true;
    if (body) body.hidden = false;

    var state = load();
    var today = kstTodayYmd();
    var day = ensureDay(state, today);

    var streakEl = document.getElementById("dashboard-streak");
    if (streakEl) streakEl.textContent = String(computeStreak(state));

    var attPtsEl = document.getElementById("dashboard-attendance-points");
    if (attPtsEl) {
      if (!uid) {
        attPtsEl.textContent = "—";
      } else if (!attendancePointsSnap || attendancePointsSnap === "loading") {
        attPtsEl.textContent = "불러오는 중…";
      } else if (attendancePointsSnap === "err") {
        attPtsEl.textContent = "—";
      } else {
        attPtsEl.textContent = String(
          Math.max(0, parseInt(attendancePointsSnap, 10) || 0)
        );
      }
    }

    var attConvertBtn = document.getElementById("btn-dashboard-attendance-convert");
    if (attConvertBtn) {
      if (
        !uid ||
        !attendancePointsSnap ||
        attendancePointsSnap === "loading" ||
        attendancePointsSnap === "err"
      ) {
        attConvertBtn.disabled = true;
      } else {
        var pts = Math.max(0, parseInt(attendancePointsSnap, 10) || 0);
        attConvertBtn.disabled = pts < 3000;
      }
    }

    var row = document.getElementById("dashboard-attendance-row");
    if (row) {
      row.innerHTML = "";
      for (var i = 6; i >= 0; i--) {
        var ymd = kstYmdFromMs(Date.now() - i * 86400000);
        var d = state.daily[ymd];
        var on = d && (d.att || (d.q && d.q > 0));
        var cell = document.createElement("div");
        cell.className = "attendance-cell" + (on ? " attendance-cell--on" : "");
        var label = document.createElement("span");
        label.className = "attendance-cell__dow";
        var parts = ymd.split("-");
        label.textContent = parts[1] + "/" + parts[2];
        var stamp = document.createElement("span");
        stamp.className = "attendance-cell__stamp";
        stamp.textContent = on ? "도장" : "·";
        stamp.setAttribute("aria-label", on ? ymd + " 출석" : ymd + " 미출석");
        cell.appendChild(label);
        cell.appendChild(stamp);
        row.appendChild(cell);
      }
    }

    var tt = document.getElementById("dashboard-time-today");
    if (tt) tt.textContent = formatDuration(day.sec || 0);
    var tw = document.getElementById("dashboard-time-week");
    if (tw) tw.textContent = formatDuration(sumWeekSeconds(state));

    var ta = document.getElementById("dashboard-total-answered");
    if (ta) ta.textContent = String(state.totalAnswered || 0);
    var acc = document.getElementById("dashboard-accuracy");
    if (acc) {
      var tq = state.totalAnswered || 0;
      var tc = state.totalCorrect || 0;
      acc.textContent = tq ? Math.round((tc / tq) * 100) + "%" : "—";
    }

    var weak = document.getElementById("dashboard-weakness");
    if (weak) {
      weak.innerHTML = "";
      var items = weaknessTopics(state, 6);
      if (!items.length) {
        var li0 = document.createElement("p");
        li0.className = "dashboard-weakness-empty";
        li0.textContent =
          "주제별로 최소 2문항 이상 풀면 오답이 많은 순으로 약점이 표시됩니다.";
        weak.appendChild(li0);
      } else {
        items.forEach(function (it) {
          var p = document.createElement("p");
          p.className = "dashboard-weakness-item";
          var wrong = it.answered - it.correct;
          p.textContent =
            it.topic +
            ": " +
            it.answered +
            "문항 중 정답 " +
            it.correct +
            " (정답률 " +
            Math.round(it.rate * 100) +
            "%, 오답 " +
            wrong +
            ")";
          weak.appendChild(p);
        });
      }
    }
  }

  window.LearningStats = {
    recordQuizAnswer: function (topic, isCorrect) {
      var uid = currentUid();
      if (!uid) return;
      var state = load();
      state.totalAnswered = (state.totalAnswered || 0) + 1;
      if (isCorrect) state.totalCorrect = (state.totalCorrect || 0) + 1;
      var t = topic && String(topic).trim() ? String(topic).trim() : "기타";
      if (!state.byTopic[t]) state.byTopic[t] = { a: 0, c: 0 };
      state.byTopic[t].a++;
      if (isCorrect) state.byTopic[t].c++;
      var ymd = kstTodayYmd();
      var d = ensureDay(state, ymd);
      d.q = (d.q || 0) + 1;
      if (isCorrect) d.corr = (d.corr || 0) + 1;
      save(state);
    },

    markAttendance: function () {
      /* 예전: 앱 접속만으로 출석. 현재는 퀴즈 1문제 이상 풀이 시에만 출석·포인트(서버) 반영. */
    },

    flushTime: flushPendingTime,
    renderDashboard: renderLearningDashboard
  };

  function subscribeAttendancePoints(uid) {
    if (attUnsub) {
      attUnsub();
      attUnsub = null;
    }
    attendancePointsSnap = null;
    if (!uid || typeof firebase === "undefined" || !firebase.firestore) {
      attendancePointsSnap = null;
      renderLearningDashboard();
      return;
    }
    attendancePointsSnap = "loading";
    renderLearningDashboard();
    var ref = firebase.firestore().collection("hanlaw_attendance_rewards").doc(uid);
    attUnsub = ref.onSnapshot(
      function (snap) {
        if (!snap.exists) {
          attendancePointsSnap = "0";
        } else {
          var d = snap.data();
          attendancePointsSnap = String(Math.max(0, parseInt(d.attendancePoints, 10) || 0));
        }
        renderLearningDashboard();
      },
      function () {
        attendancePointsSnap = "err";
        renderLearningDashboard();
      }
    );
  }

  window.addEventListener("app-auth", function (e) {
    stopTimer();
    flushPendingTime();
    var user = e.detail && e.detail.user;
    if (user) {
      startTimer();
    }
    subscribeAttendancePoints(user ? user.uid : null);
    renderLearningDashboard();
  });

  window.addEventListener("learning-stats-updated", renderLearningDashboard);

  function bindNav() {
    var btn = document.querySelector('.nav-main__btn[data-panel="dashboard"]');
    if (btn) {
      btn.addEventListener("click", function () {
        setTimeout(renderLearningDashboard, 60);
      });
    }
  }

  function bindAttendanceConvert() {
    var btn = document.getElementById("btn-dashboard-attendance-convert");
    var msg = document.getElementById("dashboard-attendance-convert-msg");
    if (!btn || btn.dataset.bound === "1") return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", function () {
      if (typeof window.convertAttendancePointsToQuestionCreditCallable !== "function") {
        if (msg) {
          msg.textContent = "기능을 불러오지 못했습니다.";
          msg.hidden = false;
        }
        return;
      }
      var ptsNow = Math.max(0, parseInt(attendancePointsSnap, 10) || 0);
      var ask = window.confirm(
        "출석 포인트를 질문권으로 전환할까요?\n\n" +
          "- 차감 포인트: 3,000점\n" +
          "- 지급 질문권: 1건\n" +
          "- 유효기간: 전환 시점부터 1년\n" +
          "- 현재 포인트: " +
          ptsNow.toLocaleString("ko-KR") +
          "점"
      );
      if (!ask) {
        if (msg) {
          msg.textContent = "전환을 취소했습니다.";
          msg.hidden = false;
        }
        return;
      }
      btn.disabled = true;
      if (msg) msg.hidden = true;
      window
        .convertAttendancePointsToQuestionCreditCallable()
        .then(function (data) {
          if (msg) {
            var leftPts =
              data && data.attendancePoints != null
                ? Math.max(0, parseInt(data.attendancePoints, 10) || 0)
                : null;
            msg.textContent =
              "질문권 1건이 추가되었습니다. " +
              (leftPts == null ? "" : "(남은 출석 포인트: " + leftPts.toLocaleString("ko-KR") + "점) ") +
              "전환한 시점부터 1년간 사용할 수 있습니다.";
            msg.hidden = false;
          }
          window.dispatchEvent(new CustomEvent("question-credits-updated"));
        })
        .catch(function (err) {
          var t =
            err && err.message
              ? err.message
              : "전환에 실패했습니다.";
          if (t === "INTERNAL" || t.indexOf("internal") >= 0) {
            t = "전환 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.";
          }
          if (msg) {
            msg.textContent = t;
            msg.hidden = false;
          }
        })
        .finally(function () {
          renderLearningDashboard();
        });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      bindNav();
      bindAttendanceConvert();
      var u = currentUid();
      subscribeAttendancePoints(u);
      renderLearningDashboard();
      if (u) startTimer();
    });
  } else {
    bindNav();
    bindAttendanceConvert();
    var u0 = currentUid();
    subscribeAttendancePoints(u0);
    renderLearningDashboard();
    if (u0) startTimer();
  }
})();
