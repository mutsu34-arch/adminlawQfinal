(function () {
  var el = {};

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

  function showPanel(panelId) {
    document.querySelectorAll(".panel").forEach(function (p) {
      var on = p.id === "panel-" + panelId;
      p.classList.toggle("panel--active", on);
      p.hidden = !on;
    });
    document.querySelectorAll(".nav-main__btn").forEach(function (b) {
      var pid = b.getAttribute("data-panel");
      b.classList.toggle("nav-main__btn--active", pid === panelId);
      b.setAttribute("aria-current", pid === panelId ? "page" : "false");
    });
    closeSidebar();
  }

  function onNavClick(e) {
    var btn = e.target.closest(".nav-main__btn");
    if (!btn || btn.hidden) return;
    var panel = btn.getAttribute("data-panel");
    if (panel === "admin") {
      var u = typeof window.getHanlawUser === "function" ? window.getHanlawUser() : null;
      if (!isAdminUser(u)) {
        showPanel("quiz");
        return;
      }
    }
    if (panel) showPanel(panel);
  }

  function scopeAllExams() {
    return typeof window.isScopeAllExamsSelected === "function"
      ? window.isScopeAllExamsSelected()
      : false;
  }

  function scopeAllYears(allowedYearList) {
    return typeof window.isScopeAllYearsSelected === "function"
      ? window.isScopeAllYearsSelected(allowedYearList)
      : false;
  }

  function renderExamList() {
    var ul = el.sidebarExams;
    if (!ul || !Array.isArray(window.EXAM_CATALOG)) return;
    ul.innerHTML = "";
    var liAll = document.createElement("li");
    var btnAll = document.createElement("button");
    btnAll.type = "button";
    btnAll.className = "sidebar__exam sidebar__exam--all";
    btnAll.id = "btn-sidebar-exam-all";
    btnAll.setAttribute("data-exam-all", "1");
    btnAll.setAttribute("aria-pressed", "false");
    btnAll.textContent = "전체 시험";
    btnAll.addEventListener("click", function (e) {
      e.stopPropagation();
      if (typeof window.toggleStudyExamsAll === "function") window.toggleStudyExamsAll();
    });
    liAll.appendChild(btnAll);
    ul.appendChild(liAll);
    el.btnExamAll = btnAll;

    window.EXAM_CATALOG.forEach(function (exam) {
      var li = document.createElement("li");
      var b = document.createElement("button");
      b.type = "button";
      b.className = "sidebar__exam";
      b.setAttribute("data-exam-id", exam.id);
      b.textContent = exam.label;
      b.addEventListener("click", function (e) {
        e.stopPropagation();
        if (typeof window.toggleStudyExam === "function") window.toggleStudyExam(exam.id);
      });
      li.appendChild(b);
      ul.appendChild(li);
    });
  }

  /** getYearsForStudyScope 실패·빈 값 대비: 카탈로그 기준 연도 목록 */
  function unionYearsFromCatalog() {
    var set = {};
    (window.EXAM_CATALOG || []).forEach(function (ex) {
      (ex.years || []).forEach(function (y) {
        set[y] = true;
      });
    });
    return Object.keys(set)
      .map(Number)
      .sort(function (a, b) {
        return b - a;
      });
  }

  function yearChipActive(ys, yearVal) {
    if (!Array.isArray(ys)) return false;
    var n = Number(yearVal);
    var j;
    for (j = 0; j < ys.length; j++) {
      if (Number(ys[j]) === n) return true;
    }
    return false;
  }

  function renderYearChips() {
    var wrap = el.sidebarYearsWrap;
    var container = el.sidebarYears;
    if (!wrap || !container) return;
    var yearList =
      typeof window.getYearsForStudyScope === "function"
        ? window.getYearsForStudyScope()
        : [];
    if (!yearList.length) {
      yearList = unionYearsFromCatalog();
    }
    if (!yearList.length) {
      wrap.setAttribute("hidden", "");
      wrap.hidden = true;
      return;
    }
    wrap.removeAttribute("hidden");
    wrap.hidden = false;
    container.innerHTML = "";
    var yearsAll = scopeAllYears(yearList);
    container.classList.toggle("sidebar__year-chips--all-selected", yearsAll);

    function addChip(label, yearVal, isAll) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "sidebar__year";
      var ys = window.APP_SCOPE.years;
      var active = isAll ? yearsAll : yearChipActive(ys, yearVal);
      if (active) btn.classList.add("sidebar__year--active");
      btn.setAttribute("aria-pressed", active ? "true" : "false");
      btn.textContent = label;
      if (isAll) btn.setAttribute("data-years-all", "1");
      else btn.setAttribute("data-study-year", String(yearVal));
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        if (isAll) {
          if (typeof window.toggleStudyYearsAll === "function") window.toggleStudyYearsAll();
        } else if (typeof window.toggleStudyYear === "function") {
          window.toggleStudyYear(yearVal);
        }
      });
      container.appendChild(btn);
    }

    addChip("전체 연도", null, true);
    yearList.forEach(function (y) {
      addChip(String(y) + "년", y, false);
    });
  }

  function syncSidebarHighlight() {
    var ids = window.APP_SCOPE.examIds;
    var examsAll = scopeAllExams();
    if (el.btnExamAll) {
      if (examsAll) {
        el.btnExamAll.classList.add("sidebar__exam--active");
      } else {
        el.btnExamAll.classList.remove("sidebar__exam--active");
      }
      el.btnExamAll.setAttribute("aria-pressed", examsAll ? "true" : "false");
    }
    if (el.sidebarExams) {
      el.sidebarExams.classList.toggle("sidebar__exams--all-selected", examsAll);
    }
    var scopeRoot = el.sidebar || document.getElementById("app-sidebar");
    var examBtns = scopeRoot
      ? scopeRoot.querySelectorAll("#sidebar-exams .sidebar__exam[data-exam-id]")
      : document.querySelectorAll("#sidebar-exams .sidebar__exam[data-exam-id]");
    examBtns.forEach(function (b) {
      var id = b.getAttribute("data-exam-id");
      var on = Array.isArray(ids) && ids.indexOf(id) >= 0;
      if (on) {
        b.classList.add("sidebar__exam--active");
      } else {
        b.classList.remove("sidebar__exam--active");
      }
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    renderYearChips();
  }

  function updateScopeSummary() {
    if (el.scopeSummary) {
      el.scopeSummary.textContent = "공부 범위: " + window.getScopeSummaryText();
    }
    if (el.scopeSummaryQuiz) {
      el.scopeSummaryQuiz.textContent = window.getScopeSummaryText();
    }
  }

  function eventTargetElement(ev) {
    var t = ev.target;
    if (!t) return null;
    if (t.nodeType === 1) return t;
    return t.parentElement || null;
  }

  function setBackdrop(on) {
    if (!el.backdrop) return;
    el.backdrop.hidden = !on;
    el.backdrop.setAttribute("aria-hidden", on ? "false" : "true");
  }

  function toggleSidebar() {
    if (!el.sidebar) return;
    el.sidebar.classList.toggle("sidebar--open");
    setBackdrop(el.sidebar.classList.contains("sidebar--open"));
  }

  function closeSidebar() {
    if (el.sidebar) el.sidebar.classList.remove("sidebar--open");
    setBackdrop(false);
  }

  window.addEventListener("study-scope-change", function () {
    syncSidebarHighlight();
    updateScopeSummary();
  });

  window.addEventListener("app-auth", function (e) {
    var user = e.detail ? e.detail.user : null;
    var adminBtn = $("nav-btn-admin");
    if (adminBtn) {
      var show = isAdminUser(user);
      adminBtn.hidden = !show;
      if (!show) {
        var adminPanel = document.getElementById("panel-admin");
        if (adminPanel && !adminPanel.hidden) {
          showPanel("quiz");
        }
      }
    }
  });

  document.addEventListener("DOMContentLoaded", function () {
    el.sidebar = $("app-sidebar");
    el.sidebarExams = $("sidebar-exams");
    el.sidebarYearsWrap = $("sidebar-years-wrap");
    el.sidebarYears = $("sidebar-years");
    el.scopeSummary = $("scope-summary");
    el.scopeSummaryQuiz = $("scope-summary-quiz");
    el.btnSidebarToggle = $("btn-sidebar-toggle");
    el.backdrop = $("sidebar-backdrop");

    var nav = $("nav-main");
    if (nav) nav.addEventListener("click", onNavClick);

    renderExamList();
    syncSidebarHighlight();
    updateScopeSummary();

    if (el.btnSidebarToggle && el.sidebar) {
      el.btnSidebarToggle.addEventListener("click", toggleSidebar);
    }

    if (el.backdrop) {
      el.backdrop.addEventListener("click", closeSidebar);
    }

    if (el.sidebar) {
      el.sidebar.addEventListener("click", function (e) {
        var t = eventTargetElement(e);
        if (
          t &&
          typeof t.closest === "function" &&
          window.matchMedia("(max-width: 900px)").matches &&
          t.closest(".sidebar__year, .sidebar__exam")
        ) {
          closeSidebar();
        }
      });
    }

    var adminBtn0 = $("nav-btn-admin");
    if (adminBtn0) {
      var u0 = typeof window.getHanlawUser === "function" ? window.getHanlawUser() : null;
      adminBtn0.hidden = !isAdminUser(u0);
      if (!isAdminUser(u0)) {
        var adminPanel0 = document.getElementById("panel-admin");
        if (adminPanel0 && !adminPanel0.hidden) showPanel("quiz");
      }
    }
  });
})();
