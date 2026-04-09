(function () {
  function rangeYears(from, to) {
    var y = [];
    for (var i = to; i >= from; i--) y.push(i);
    return y;
  }

  var Y = rangeYears(2019, 2027);

  window.EXAM_CATALOG = [
    { id: "lawyer", label: "변호사시험", sourceLabel: "변호사시험", years: Y.slice() },
    { id: "grade9", label: "국가공무원 9급", sourceLabel: "국가직 9급", years: Y.slice() },
    { id: "grade7", label: "국가공무원 7급", sourceLabel: "국가직 7급", years: Y.slice() },
    { id: "grade5", label: "국가공무원 5급·일반", sourceLabel: "국가직 5급·일반", years: Y.slice() },
    { id: "fire", label: "소방공무원", sourceLabel: "소방공무원", years: Y.slice() },
    { id: "police", label: "경찰공무원", sourceLabel: "경찰공무원", years: Y.slice() },
    { id: "local", label: "지방공무원", sourceLabel: "지방공무원", years: Y.slice() },
    { id: "customs", label: "세관·관세", sourceLabel: "세관·관세", years: Y.slice() },
    { id: "edu", label: "교육청 공무원", sourceLabel: "교육청 공무원", years: Y.slice() }
  ];

  window.getExamById = function (id) {
    for (var i = 0; i < window.EXAM_CATALOG.length; i++) {
      if (window.EXAM_CATALOG[i].id === id) return window.EXAM_CATALOG[i];
    }
    return null;
  };
})();
