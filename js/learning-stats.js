(function () {
  var LS_VER = "v2";
  var LS_PREFIX = "hanlaw_learning_" + LS_VER + "_";

  var attUnsub = null;
  var attendancePointsSnap = null;
  var pointLogUnsub = null;
  /** null | "loading" | "err" | Array<{ id: string, delta: number, label: string, createdAt: * }> */
  var pointLogRows = null;

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

  function formatPointLogTime(ts) {
    try {
      if (!ts || typeof ts.toDate !== "function") return "—";
      return ts.toDate().toLocaleString("ko-KR", {
        timeZone: "Asia/Seoul",
        dateStyle: "medium",
        timeStyle: "short"
      });
    } catch (e) {
      return "—";
    }
  }

  function renderMyPointsSection(uid) {
    var wrap = document.getElementById("dashboard-my-points");
    if (!wrap) return;
    var lo = document.getElementById("dashboard-my-points-loggedout");
    var body = document.getElementById("dashboard-my-points-body");
    if (!uid) {
      if (lo) lo.hidden = false;
      if (body) body.hidden = true;
      return;
    }
    if (lo) lo.hidden = true;
    if (body) body.hidden = false;

    var bal = document.getElementById("dashboard-my-points-balance");
    if (bal) {
      if (!attendancePointsSnap || attendancePointsSnap === "loading") {
        bal.textContent = "불러오는 중…";
      } else if (attendancePointsSnap === "err") {
        bal.textContent = "—";
      } else {
        bal.textContent = String(Math.max(0, parseInt(attendancePointsSnap, 10) || 0));
      }
    }

    var listEl = document.getElementById("dashboard-point-log-list");
    var emptyEl = document.getElementById("dashboard-point-log-empty");
    var errEl = document.getElementById("dashboard-point-log-err");
    if (errEl) {
      errEl.hidden = true;
      errEl.textContent = "";
    }

    if (!listEl) return;

    if (pointLogRows === "loading") {
      listEl.innerHTML = "";
      var p = document.createElement("p");
      p.className = "dashboard-point-log-loading";
      p.textContent = "내역을 불러오는 중…";
      listEl.appendChild(p);
      if (emptyEl) emptyEl.hidden = true;
      return;
    }

    if (pointLogRows === "err") {
      listEl.innerHTML = "";
      if (emptyEl) emptyEl.hidden = true;
      if (errEl) {
        errEl.textContent = "포인트 내역을 불러오지 못했습니다.";
        errEl.hidden = false;
      }
      return;
    }

    if (!pointLogRows || !pointLogRows.length) {
      listEl.innerHTML = "";
      if (emptyEl) emptyEl.hidden = false;
      return;
    }

    if (emptyEl) emptyEl.hidden = true;
    listEl.innerHTML = "";
    pointLogRows.forEach(function (row) {
      var item = document.createElement("div");
      item.className = "dashboard-point-log__row";
      item.setAttribute("role", "listitem");
      var t = document.createElement("span");
      t.className = "dashboard-point-log__time";
      t.textContent = formatPointLogTime(row.createdAt);
      var lab = document.createElement("span");
      lab.className = "dashboard-point-log__label";
      lab.textContent = row.label || "포인트 변경";
      var d = document.createElement("span");
      var delta = Math.trunc(Number(row.delta)) || 0;
      d.className =
        "dashboard-point-log__delta" +
        (delta >= 0 ? " dashboard-point-log__delta--plus" : " dashboard-point-log__delta--minus");
      d.textContent = (delta > 0 ? "+" : "") + delta.toLocaleString("ko-KR") + "점";
      item.appendChild(t);
      item.appendChild(lab);
      item.appendChild(d);
      listEl.appendChild(item);
    });
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
      renderMyPointsSection(null);
      return;
    }

    if (lo) lo.hidden = true;
    if (body) body.hidden = false;

    renderMyPointsSection(uid);

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

    var ptsElly =
      typeof window.HANLAW_ATTENDANCE_POINTS_PER_ELLY_CREDIT === "number"
        ? window.HANLAW_ATTENDANCE_POINTS_PER_ELLY_CREDIT
        : 500;
    var attConvertSection = document.getElementById("dashboard-point-convert-section");
    function setConvertDisabled(btn, minPts) {
      if (!btn) return;
      if (
        !uid ||
        !attendancePointsSnap ||
        attendancePointsSnap === "loading" ||
        attendancePointsSnap === "err"
      ) {
        btn.disabled = true;
      } else {
        var pts = Math.max(0, parseInt(attendancePointsSnap, 10) || 0);
        btn.disabled = pts < minPts;
      }
    }
    if (attConvertSection) {
      attConvertSection.querySelectorAll("[data-elly-convert-count]").forEach(function (b) {
        var cnt = parseInt(b.getAttribute("data-elly-convert-count"), 10) || 1;
        setConvertDisabled(b, cnt * ptsElly);
        if (cnt === 1) {
          b.textContent = "엘리 질문권 1건 (" + ptsElly.toLocaleString("ko-KR") + "점)";
        } else {
          b.textContent = cnt + "건 (" + (cnt * ptsElly).toLocaleString("ko-KR") + "점)";
        }
      });
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
    var accCard = document.getElementById("dashboard-accuracy-card");
    var accMeterFill = document.getElementById("dashboard-accuracy-meter-fill");
    if (acc) {
      var tq = state.totalAnswered || 0;
      var tc = state.totalCorrect || 0;
      var pct = tq ? Math.round((tc / tq) * 100) : 0;
      acc.textContent = tq ? pct + "%" : "—";
      if (accMeterFill) accMeterFill.style.width = tq ? pct + "%" : "0%";
      if (accCard) accCard.classList.toggle("dashboard-stat-card--no-data", !tq);
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

  function subscribePointLog(uid) {
    if (pointLogUnsub) {
      pointLogUnsub();
      pointLogUnsub = null;
    }
    pointLogRows = null;
    if (!uid || typeof firebase === "undefined" || !firebase.firestore) {
      renderLearningDashboard();
      return;
    }
    pointLogRows = "loading";
    renderLearningDashboard();
    var q = firebase
      .firestore()
      .collection("hanlaw_attendance_rewards")
      .doc(uid)
      .collection("point_log")
      .orderBy("createdAt", "desc")
      .limit(50);
    pointLogUnsub = q.onSnapshot(
      function (snap) {
        pointLogRows = [];
        snap.forEach(function (doc) {
          var d = doc.data() || {};
          pointLogRows.push({
            id: doc.id,
            delta: d.delta,
            label: d.label != null ? String(d.label) : "",
            createdAt: d.createdAt
          });
        });
        renderLearningDashboard();
      },
      function () {
        pointLogRows = "err";
        renderLearningDashboard();
      }
    );
  }

  function subscribeAttendancePoints(uid) {
    if (attUnsub) {
      attUnsub();
      attUnsub = null;
    }
    attendancePointsSnap = null;
    if (!uid || typeof firebase === "undefined" || !firebase.firestore) {
      attendancePointsSnap = null;
      subscribePointLog(null);
      renderLearningDashboard();
      return;
    }
    attendancePointsSnap = "loading";
    subscribePointLog(uid);
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

  function bindPointLogToggle() {
    var toggle = document.getElementById("dashboard-point-log-toggle");
    var region = document.getElementById("dashboard-point-log-region");
    if (!toggle || !region || toggle.dataset.bound === "1") return;
    toggle.dataset.bound = "1";
    toggle.addEventListener("click", function () {
      var nextOpen = region.hidden;
      region.hidden = !nextOpen;
      toggle.setAttribute("aria-expanded", nextOpen ? "true" : "false");
    });
  }

  function ptsEllyMin() {
    return typeof window.HANLAW_ATTENDANCE_POINTS_PER_ELLY_CREDIT === "number"
      ? window.HANLAW_ATTENDANCE_POINTS_PER_ELLY_CREDIT
      : 500;
  }

  var ALLOWED_ELLY_DASHBOARD_COUNTS = [1, 5, 10, 20, 30];

  function bindAttendanceConvert() {
    var msg = document.getElementById("dashboard-attendance-convert-msg");
    var section = document.getElementById("dashboard-point-convert-section");

    function handleErr(err) {
      var t = err && err.message ? err.message : "전환에 실패했습니다.";
      if (t === "INTERNAL" || t.indexOf("internal") >= 0) {
        t = "전환 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.";
      }
      if (msg) {
        msg.textContent = t;
        msg.hidden = false;
      }
    }

    if (section && section.dataset.ellyConvertBound !== "1") {
      section.dataset.ellyConvertBound = "1";
      section.addEventListener("click", function (e) {
        var btn = e.target.closest("[data-elly-convert-count]");
        if (!btn || !section.contains(btn)) return;
        if (typeof window.convertAttendancePointsToEllyCreditCallable !== "function") {
          if (msg) {
            msg.textContent = "기능을 불러오지 못했습니다.";
            msg.hidden = false;
          }
          return;
        }
        var need = ptsEllyMin();
        var count = parseInt(btn.getAttribute("data-elly-convert-count"), 10) || 1;
        if (ALLOWED_ELLY_DASHBOARD_COUNTS.indexOf(count) < 0) return;
        var cost = need * count;
        var ptsNow = Math.max(0, parseInt(attendancePointsSnap, 10) || 0);
        var ask = window.confirm(
          "포인트를 엘리(AI) 질문권으로 전환할까요?\n\n" +
            "- 차감 포인트: " +
            cost.toLocaleString("ko-KR") +
            "점\n" +
            "- 지급: 엘리 질문권 " +
            count +
            "건(구독 일일 한도 소진 후 차감)\n" +
            "- 유효기간: 전환 시점부터 1개월(한 건으로 합산된 건수)\n" +
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
        var allBtns = section.querySelectorAll("[data-elly-convert-count]");
        for (var bi = 0; bi < allBtns.length; bi++) {
          allBtns[bi].disabled = true;
        }
        if (msg) msg.hidden = true;
        window
          .convertAttendancePointsToEllyCreditCallable({ count: count })
          .then(function (data) {
            if (msg) {
              var leftPts =
                data && data.attendancePoints != null
                  ? Math.max(0, parseInt(data.attendancePoints, 10) || 0)
                  : null;
              msg.textContent =
                "엘리(AI) 질문권 " +
                count +
                "건이 추가되었습니다. " +
                (leftPts == null
                  ? ""
                  : "(남은 포인트: " + leftPts.toLocaleString("ko-KR") + "점) ") +
                "전환한 시점부터 1개월간 사용할 수 있습니다.";
              msg.hidden = false;
            }
          })
          .catch(handleErr)
          .finally(function () {
            renderLearningDashboard();
          });
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      bindNav();
      bindPointLogToggle();
      bindAttendanceConvert();
      var u = currentUid();
      subscribeAttendancePoints(u);
      renderLearningDashboard();
      if (u) startTimer();
    });
  } else {
    bindNav();
    bindPointLogToggle();
    bindAttendanceConvert();
    var u0 = currentUid();
    subscribeAttendancePoints(u0);
    renderLearningDashboard();
    if (u0) startTimer();
  }
})();
