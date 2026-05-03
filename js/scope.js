(function () {
  var STORAGE_V3 = "hanlaw_scope_v3";
  var STORAGE_V2 = "hanlaw_scope_v2";
  var LEGACY_V1 = "hanlaw_scope_v1";

  /**
   * 시험·연도는 항상 배열로 관리한다.
   * - 전체 선택: 해당 카탈로그(또는 허용 연도)의 모든 항목이 배열에 들어 있음.
   * - 전체 버튼이 켜진 상태에서 다시 누르면 해당 축은 [] (전부 해제).
   */
  window.APP_SCOPE = {
    examIds: [],
    years: [],
    questionSource: "past_only"
  };

  function finiteNumber(n) {
    return typeof n === "number" && isFinite(n);
  }

  function getExamById(id) {
    return typeof window.getExamById === "function" ? window.getExamById(id) : null;
  }

  function allCatalogExamIds() {
    return (window.EXAM_CATALOG || []).map(function (e) {
      return e.id;
    });
  }

  /** 카탈로그 전 시험의 기출 연도 합집합(내림차순). 시험 미선택 시 연도 UI·토글 허용 범위로 사용 */
  function unionYearsAllCatalog() {
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

  function isAllExamsSelected() {
    var cat = window.EXAM_CATALOG || [];
    var ids = window.APP_SCOPE.examIds;
    if (!cat.length) return false;
    if (!Array.isArray(ids) || ids.length !== cat.length) return false;
    var seen = {};
    var i;
    for (i = 0; i < ids.length; i++) seen[ids[i]] = true;
    for (i = 0; i < cat.length; i++) {
      if (!seen[cat[i].id]) return false;
    }
    return true;
  }

  function isAllYearsSelected(allowed) {
    var ys = window.APP_SCOPE.years;
    if (!allowed || !allowed.length) return false;
    if (!Array.isArray(ys) || ys.length !== allowed.length) return false;
    var seen = {};
    var i;
    for (i = 0; i < ys.length; i++) seen[ys[i]] = true;
    for (i = 0; i < allowed.length; i++) {
      if (!seen[allowed[i]]) return false;
    }
    return true;
  }

  window.isScopeAllExamsSelected = isAllExamsSelected;
  window.isScopeAllYearsSelected = isAllYearsSelected;

  function loadRaw() {
    try {
      var r3 = localStorage.getItem(STORAGE_V3);
      if (r3) return { tag: "v3", o: JSON.parse(r3) };
      var r2 = localStorage.getItem(STORAGE_V2);
      if (r2) return { tag: "v2", o: JSON.parse(r2) };
      var r1 = localStorage.getItem(LEGACY_V1);
      if (r1) return { tag: "v1", o: JSON.parse(r1) };
    } catch (e) {}
    return null;
  }

  function save() {
    try {
      localStorage.setItem(
        STORAGE_V3,
        JSON.stringify({
          examIds: window.APP_SCOPE.examIds,
          years: window.APP_SCOPE.years,
          questionSource: window.APP_SCOPE.questionSource
        })
      );
      try {
        localStorage.removeItem(STORAGE_V2);
        localStorage.removeItem(LEGACY_V1);
      } catch (e2) {}
    } catch (e) {}
  }

  function validateExamIds() {
    if (!Array.isArray(window.APP_SCOPE.examIds)) window.APP_SCOPE.examIds = [];
    var seen = {};
    var out = [];
    window.APP_SCOPE.examIds.forEach(function (id) {
      if (!id || seen[id] || !getExamById(id)) return;
      seen[id] = true;
      out.push(id);
    });
    window.APP_SCOPE.examIds = out;
  }

  /**
   * 연도 칩·토글에 허용되는 연도(내림차순).
   * 시험이 하나도 없으면 카탈로그 전체 연도(시험 선택 전에도 연도 버튼을 쓸 수 있게 함).
   */
  window.getYearsForStudyScope = function () {
    var ids = window.APP_SCOPE.examIds;
    if (!Array.isArray(ids) || !ids.length) {
      return unionYearsAllCatalog();
    }
    var set = {};
    ids.forEach(function (id) {
      var ex = getExamById(id);
      if (ex && ex.years) {
        ex.years.forEach(function (y) {
          set[y] = true;
        });
      }
    });
    return Object.keys(set)
      .map(Number)
      .sort(function (a, b) {
        return b - a;
      });
  };

  function validateYears() {
    if (!Array.isArray(window.APP_SCOPE.years)) window.APP_SCOPE.years = [];
    var allowed = window.getYearsForStudyScope();
    var seen = {};
    var out = [];
    window.APP_SCOPE.years.forEach(function (y) {
      var n = Number(y);
      if (!finiteNumber(n) || seen[n] || allowed.indexOf(n) < 0) return;
      seen[n] = true;
      out.push(n);
    });
    out.sort(function (a, b) {
      return b - a;
    });
    window.APP_SCOPE.years = out;
  }

  function applyV3(o) {
    window.APP_SCOPE.examIds = Array.isArray(o.examIds) ? o.examIds.slice() : [];
    window.APP_SCOPE.years = Array.isArray(o.years) ? o.years.slice() : [];
    window.APP_SCOPE.questionSource =
      String(o && o.questionSource ? o.questionSource : "past_only") === "include_expected"
        ? "include_expected"
        : "past_only";
    validateExamIds();
    validateYears();
  }

  function migrateV2Shape(o) {
    var examIds;
    if (Array.isArray(o.examIds) && o.examIds.length) {
      examIds = o.examIds.slice();
    } else if (o.examId && typeof o.examId === "string") {
      examIds = [o.examId];
    } else if (o.examIds === null) {
      examIds = allCatalogExamIds().slice();
    } else {
      examIds = allCatalogExamIds().slice();
    }
    window.APP_SCOPE.examIds = examIds;
    validateExamIds();

    var allowed = window.getYearsForStudyScope();
    var years;
    if (Array.isArray(o.years) && o.years.length) {
      years = o.years.slice();
    } else if (o.years === null || o.years === undefined) {
      years = allowed.slice();
    } else if (Object.prototype.hasOwnProperty.call(o, "year")) {
      years =
        o.year === null || o.year === undefined ? allowed.slice() : [o.year];
    } else {
      years = allowed.slice();
    }
    window.APP_SCOPE.years = years;
    validateYears();
    window.APP_SCOPE.questionSource = "past_only";
  }

  /** 저장값이 없을 때: 개별 클릭이 곧바로 ‘추가 선택’이 되도록 빈 범위로 시작 */
  function defaultEmptyScope() {
    window.APP_SCOPE.examIds = [];
    window.APP_SCOPE.years = [];
  }

  function emitScopeChange() {
    window.dispatchEvent(new CustomEvent("study-scope-change"));
  }

  /** 문항 뱅크·시험 카탈로그 갱신 후 저장 범위에서 사라진 시험·연도를 정리합니다. */
  window.revalidateStudyScopeAgainstCatalog = function () {
    validateExamIds();
    validateYears();
    save();
    emitScopeChange();
  };

  window.initStudyScope = function () {
    var pack = loadRaw();
    if (!pack) {
      defaultEmptyScope();
    } else if (pack.tag === "v3") {
      applyV3(pack.o || {});
    } else {
      migrateV2Shape(pack.o || {});
    }
    if (!window.APP_SCOPE.examIds.length) {
      window.APP_SCOPE.years = [];
    }
    validateExamIds();
    validateYears();
    save();
  };

  /**
   * 전체 시험: 모두 선택됨 → 전부 해제([]). 그 외 → 카탈로그 전부 선택.
   * 시험을 모두 해제하면 연도도 [].
   */
  window.toggleStudyExamsAll = function () {
    if (isAllExamsSelected()) {
      window.APP_SCOPE.examIds = [];
      window.APP_SCOPE.years = [];
    } else {
      window.APP_SCOPE.examIds = allCatalogExamIds().slice();
    }
    validateExamIds();
    validateYears();
    save();
    emitScopeChange();
  };

  window.toggleStudyExam = function (examId) {
    examId = String(examId || "").trim();
    if (!examId) return;
    if (!Array.isArray(window.APP_SCOPE.examIds)) window.APP_SCOPE.examIds = [];
    var ids = window.APP_SCOPE.examIds;
    var i = ids.indexOf(examId);
    if (i >= 0) ids.splice(i, 1);
    else ids.push(examId);
    validateExamIds();
    if (!window.APP_SCOPE.examIds.length) {
      window.APP_SCOPE.years = [];
    }
    validateYears();
    save();
    emitScopeChange();
  };

  /**
   * 전체 연도: 허용 연도 전부 선택됨 → 연도 []. 그 외 → 허용 연도 전부 배열로 선택.
   */
  window.toggleStudyYearsAll = function () {
    var allowed = window.getYearsForStudyScope();
    if (!allowed.length) {
      window.APP_SCOPE.years = [];
      save();
      emitScopeChange();
      return;
    }
    if (isAllYearsSelected(allowed)) {
      window.APP_SCOPE.years = [];
    } else {
      window.APP_SCOPE.years = allowed.slice();
    }
    save();
    emitScopeChange();
  };

  window.toggleStudyYear = function (yearNum) {
    var y = Number(yearNum);
    if (!finiteNumber(y)) return;
    var allowed = window.getYearsForStudyScope();
    if (allowed.indexOf(y) < 0) return;
    if (!Array.isArray(window.APP_SCOPE.years)) window.APP_SCOPE.years = [];
    var ys = window.APP_SCOPE.years;
    var i = -1;
    var k;
    for (k = 0; k < ys.length; k++) {
      if (Number(ys[k]) === y) {
        i = k;
        break;
      }
    }
    if (i >= 0) ys.splice(i, 1);
    else {
      ys.push(y);
      ys.sort(function (a, b) {
        return b - a;
      });
    }
    validateYears();
    save();
    emitScopeChange();
  };

  /**
   * 즐겨찾기 등에서 시험·연도 범위를 한 번에 반영할 때 사용합니다.
   * @param {{ examIds?: string[], years?: number[] }} o
   */
  window.applyStudyScopeFromObject = function (o) {
    if (!o || typeof o !== "object") return;
    applyV3({
      examIds: o.examIds,
      years: o.years,
      questionSource: o.questionSource
    });
    save();
    emitScopeChange();
  };

  window.getStudyQuestionSource = function () {
    return window.APP_SCOPE && window.APP_SCOPE.questionSource === "include_expected"
      ? "include_expected"
      : "past_only";
  };

  window.setStudyQuestionSource = function (mode) {
    var next = String(mode || "").trim() === "include_expected" ? "include_expected" : "past_only";
    if (!window.APP_SCOPE) window.APP_SCOPE = { examIds: [], years: [], questionSource: next };
    if (window.APP_SCOPE.questionSource === next) return;
    window.APP_SCOPE.questionSource = next;
    save();
    emitScopeChange();
  };

  window.getScopeSummaryText = function () {
    var examPart;
    var ids = window.APP_SCOPE.examIds;
    if (!Array.isArray(ids) || !ids.length) {
      examPart = "시험 미선택";
    } else {
      var labels = ids.map(function (id) {
        var ex = getExamById(id);
        return ex ? ex.label : id;
      });
      examPart = labels.join(", ");
    }
    var ys = window.APP_SCOPE.years;
    var yPart;
    if (!Array.isArray(ys) || !ys.length) {
      yPart = "연도 미선택";
    } else {
      yPart = ys
        .slice()
        .sort(function (a, b) {
          return b - a;
        })
        .map(function (y) {
          return y + "년";
        })
        .join(", ");
    }
    var src =
      window.getStudyQuestionSource && window.getStudyQuestionSource() === "include_expected"
        ? "예상 포함"
        : "기출만";
    return examPart + " · " + yPart + " · " + src;
  };

  if (window.EXAM_CATALOG && window.EXAM_CATALOG.length) {
    window.initStudyScope();
  }
})();
