(function () {
  function rangeYears(from, to) {
    var y = [];
    for (var i = to; i >= from; i--) y.push(i);
    return y;
  }

  function cloneExamEntry(ex) {
    return {
      id: ex.id,
      label: ex.label,
      sourceLabel: ex.sourceLabel != null ? ex.sourceLabel : ex.label,
      years: Array.isArray(ex.years) ? ex.years.slice() : []
    };
  }

  var Y = rangeYears(2019, 2028);

  var EXAM_CATALOG_STATIC_ENTRIES = [
    { id: "lawyer", label: "변호사시험", sourceLabel: "변호사시험", years: Y.slice() },
    { id: "grade9", label: "국가공무원 9급", sourceLabel: "국가직 9급", years: Y.slice() },
    { id: "grade7", label: "국가공무원 7급", sourceLabel: "국가직 7급", years: Y.slice() },
    { id: "grade5", label: "국가공무원 5급·일반", sourceLabel: "국가직 5급·일반", years: Y.slice() },
    { id: "fire", label: "소방공무원", sourceLabel: "소방공무원", years: Y.slice() },
    { id: "police", label: "경찰공무원", sourceLabel: "경찰공무원", years: Y.slice() },
    {
      id: "haekyung",
      label: "해양경찰 승진",
      sourceLabel: "해경 승진",
      years: Y.slice()
    },
    { id: "local", label: "지방공무원", sourceLabel: "지방공무원", years: Y.slice() },
    { id: "customs", label: "세관·관세", sourceLabel: "세관·관세", years: Y.slice() },
    { id: "edu", label: "교육청 공무원", sourceLabel: "교육청 공무원", years: Y.slice() }
  ];

  window.EXAM_CATALOG_BASE = EXAM_CATALOG_STATIC_ENTRIES.map(cloneExamEntry);

  var BASE_IDS = {};
  window.EXAM_CATALOG_BASE.forEach(function (b) {
    BASE_IDS[b.id] = true;
  });

  function parseYearFromQuestion(q) {
    if (!q || q.year == null || q.year === "") return NaN;
    var yn =
      typeof q.year === "number" && isFinite(q.year)
        ? Math.floor(q.year)
        : parseInt(String(q.year).trim(), 10);
    return isNaN(yn) ? NaN : yn;
  }

  function humanizeExamIdForLabel(id) {
    var s = String(id || "").trim();
    if (!s) return "기타 시험";
    var t = s.replace(/_/g, " ").replace(/-/g, " ").replace(/\s+/g, " ").trim();
    if (!t) return "기타 시험";
    return t;
  }

  function pickTopLabel(labelCounts, examId) {
    var bestL = "";
    var bestN = 0;
    var k;
    for (k in labelCounts) {
      if (!Object.prototype.hasOwnProperty.call(labelCounts, k)) continue;
      var n = labelCounts[k];
      if (typeof n === "number" && n > bestN) {
        bestN = n;
        bestL = k;
      }
    }
    if (bestL) return bestL;
    return humanizeExamIdForLabel(examId);
  }

  function yearsMapToSortedDesc(yearsMap) {
    return Object.keys(yearsMap)
      .map(Number)
      .filter(function (n) {
        return isFinite(n);
      })
      .sort(function (a, b) {
        return b - a;
      });
  }

  function aggregateFromBank(bank) {
    var agg = {};
    for (var i = 0; i < bank.length; i++) {
      var q = bank[i];
      if (!q || q.hidden === true) continue;
      var id = String(q.examId || "")
        .trim()
        .toLowerCase();
      if (!id) continue;
      var yn = parseYearFromQuestion(q);
      if (!isFinite(yn) || yn < 1990 || yn > 2100) continue;
      if (!agg[id]) {
        agg[id] = { years: {}, labelCounts: {} };
      }
      agg[id].years[yn] = true;
      var lab = String(q.exam || "").trim();
      if (lab) {
        agg[id].labelCounts[lab] = (agg[id].labelCounts[lab] || 0) + 1;
      }
    }
    return agg;
  }

  /**
   * QUESTION_BANK(정적+원격 합본)을 기준으로 시험 목록·각 시험의 연도 칩을 재구성합니다.
   * - 정의된 기본 시험: 뱅크에 문항이 있으면 해당 시험 연도만 반영, 없으면 기본 연도 표 유지
   * - 뱅크에만 있는 examId: 시험명은 문항의 exam 열 최빈값(없으면 id 가독화)
   */
  window.refreshExamCatalogFromQuestionBank = function () {
    var bank = Array.isArray(window.QUESTION_BANK) ? window.QUESTION_BANK : [];
    var agg = aggregateFromBank(bank);
    var out = [];

    window.EXAM_CATALOG_BASE.forEach(function (base) {
      var a = agg[base.id];
      var fromBank = a ? yearsMapToSortedDesc(a.years) : [];
      out.push({
        id: base.id,
        label: base.label,
        sourceLabel: base.sourceLabel,
        years: fromBank.length ? fromBank : base.years.slice()
      });
    });

    var extraIds = Object.keys(agg)
      .filter(function (id) {
        return id && !BASE_IDS[id];
      })
      .sort(function (x, y) {
        return pickTopLabel(agg[y].labelCounts, y).localeCompare(
          pickTopLabel(agg[x].labelCounts, x),
          "ko"
        ) || x.localeCompare(y);
      });

    for (var ei = 0; ei < extraIds.length; ei++) {
      var xid = extraIds[ei];
      var ax = agg[xid];
      var ylist = yearsMapToSortedDesc(ax.years);
      if (!ylist.length) continue;
      var lbl = pickTopLabel(ax.labelCounts, xid);
      out.push({
        id: xid,
        label: lbl,
        sourceLabel: lbl,
        years: ylist
      });
    }

    window.EXAM_CATALOG = out;
  };

  window.EXAM_CATALOG = window.EXAM_CATALOG_BASE.map(cloneExamEntry);

  window.getExamById = function (id) {
    var want = String(id || "")
      .trim()
      .toLowerCase();
    for (var i = 0; i < window.EXAM_CATALOG.length; i++) {
      if (window.EXAM_CATALOG[i].id === want) return window.EXAM_CATALOG[i];
    }
    return null;
  };
})();
