(function () {
  function normHeaderKey(k) {
    return String(k == null ? "" : k)
      .replace(/^\uFEFF/, "")
      .trim()
      .toLowerCase()
      .replace(/\s/g, "");
  }

  var HEADER_TO_FIELD = {
    id: "id",
    문항id: "id",
    문항_id: "id",
    문항번호: "id",
    문제번호: "id",
    questionid: "id",
    question_id: "id",
    examid: "examId",
    exam_id: "examId",
    시험id: "examId",
    시험코드: "examId",
    시험종류: "examId",
    year: "year",
    연도: "year",
    exam: "exam",
    시험: "exam",
    시험표기: "exam",
    topic: "topic",
    주제: "topic",
    단원: "topic",
    statement: "statement",
    문제: "statement",
    본문: "statement",
    진술: "statement",
    answer: "answer",
    정답: "answer",
    ox: "answer",
    explanation: "explanation",
    해설: "explanation",
    explanationbasic: "explanationBasic",
    기본해설: "explanationBasic",
    detail: "detail",
    상세해설: "detail",
    상세: "detail",
    detailed_explanation: "detail",
    detailedexplanation: "detail",
    상세해설json: "detail",
    legal: "legal",
    법리: "legal",
    법리근거: "legal",
    trap: "trap",
    함정: "trap",
    함정포인트: "trap",
    precedent: "precedent",
    판례: "precedent",
    판례요지: "precedent",
    판례요약: "precedent",
    법리해설: "legal",
    함정요약: "trap",
    tags: "tags",
    태그: "tags",
    importance: "importance",
    중요도: "importance",
    difficulty: "difficulty",
    난이도: "difficulty"
  };

  /**
   * "문항 ID (id)", "단원·주제 (topic)"처럼 끝에 (영문키)가 붙은 헤더를 인식한다.
   */
  function resolveHeaderToField(nk) {
    if (!nk) return null;
    var field = HEADER_TO_FIELD[nk];
    if (field) return field;
    if (nk.indexOf("exam") === 0 && nk.indexOf("id") >= 0) return "examId";
    var m = nk.match(/\(([^)]+)\)\s*$/);
    if (m) {
      var inner = normHeaderKey(m[1]);
      field = HEADER_TO_FIELD[inner];
      if (field) return field;
    }
    return null;
  }

  function mapHeaders(rawRow) {
    var o = {};
    Object.keys(rawRow).forEach(function (k) {
      var nk = normHeaderKey(k);
      var field = resolveHeaderToField(nk);
      if (!field) return;
      var v = rawRow[k];
      if (v != null && typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean") {
        v = String(v);
      }
      o[field] = v;
    });
    return o;
  }

  function parseAnswerCell(v) {
    if (v === true || v === false) return v;
    if (typeof v === "number") {
      if (v === 1) return true;
      if (v === 0) return false;
    }
    var s = String(v == null ? "" : v)
      .trim()
      .toUpperCase();
    if (s === "TRUE" || s === "O" || s === "참" || s === "Y" || s === "1") return true;
    if (s === "FALSE" || s === "X" || s === "거짓" || s === "N" || s === "0") return false;
    return null;
  }

  function parseScaleCell(v) {
    if (v == null || v === "") return null;
    if (typeof v === "number" && isFinite(v)) {
      var n = Math.floor(v);
      if (n < 1) return 1;
      if (n > 5) return 5;
      return n;
    }
    var s = String(v).trim();
    if (!s) return null;
    var onlyNum = parseInt(s, 10);
    if (!isNaN(onlyNum)) {
      if (onlyNum < 1) return 1;
      if (onlyNum > 5) return 5;
      return onlyNum;
    }
    var u = s.toUpperCase();
    if (u === "상" || u === "HIGH" || u === "H") return 5;
    if (u === "중" || u === "MID" || u === "M") return 3;
    if (u === "하" || u === "LOW" || u === "L") return 1;
    var starCnt = (s.match(/★/g) || []).length;
    if (starCnt >= 1) return Math.min(5, starCnt);
    return null;
  }

  function headerCellToField(cell) {
    return resolveHeaderToField(normHeaderKey(cell));
  }

  /**
   * 첫 줄이 제목·빈 줄인 경우를 위해, AOA로 헤더 행( id·statement 열이 있는 행 )을 찾는다.
   */
  function findHeaderRowIndex(aoa) {
    var max = Math.min(aoa.length, 30);
    for (var r = 0; r < max; r++) {
      var row = aoa[r] || [];
      var hasId = false;
      var hasStmt = false;
      for (var c = 0; c < row.length; c++) {
        var f = headerCellToField(row[c]);
        if (f === "id") hasId = true;
        if (f === "statement") hasStmt = true;
      }
      if (hasId && hasStmt) return r;
    }
    return -1;
  }

  function buildRowObject(headerRow, dataRow) {
    var obj = {};
    if (!headerRow || !dataRow) return obj;
    var len = Math.max(headerRow.length, dataRow.length);
    for (var c = 0; c < len; c++) {
      var field = headerCellToField(headerRow[c]);
      if (!field) continue;
      var v = dataRow[c];
      if (v != null && typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean") {
        v = String(v);
      }
      obj[field] = v;
    }
    return obj;
  }

  function parseSheetWithHeaderDetection(sheet) {
    var aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false });
    if (!aoa.length) return [];
    var hr = findHeaderRowIndex(aoa);
    if (hr < 0) return [];
    var out = [];
    for (var r = hr + 1; r < aoa.length; r++) {
      var mapped = buildRowObject(aoa[hr], aoa[r]);
      if (!String(mapped.id || "").trim() && !String(mapped.statement || "").trim()) continue;
      out.push(rowToQuestion(mapped));
    }
    return out;
  }

  function rowToQuestion(mapped) {
    var yearVal = mapped.year;
    if (typeof yearVal !== "number") {
      yearVal = parseInt(String(yearVal || "").trim(), 10);
    }
    var tags = mapped.tags;
    if (tags != null && typeof tags === "string") {
      tags = tags
        .split(/[,;#]/g)
        .map(function (x) { return x.trim(); })
        .filter(Boolean);
    } else if (!Array.isArray(tags)) {
      tags = null;
    }
    var detail = mapped.detail;
    if (detail != null && typeof detail === "string" && String(detail).trim()) {
      try {
        detail = JSON.parse(detail);
      } catch (e) {
        var utils = window.AdminQuestionUtils;
        var parsed =
          utils && utils.parseDetailJson ? utils.parseDetailJson(String(mapped.detail)) : undefined;
        if (parsed && typeof parsed === "object") {
          detail = parsed;
        } else {
          // detail 열에 JSON 대신 일반 텍스트를 넣은 경우도 상세해설로 살린다.
          detail = { legal: String(mapped.detail).trim() };
        }
      }
    }
    if (!detail || typeof detail !== "object") detail = {};
    if (mapped.legal != null && String(mapped.legal).trim()) detail.legal = String(mapped.legal).trim();
    if (mapped.trap != null && String(mapped.trap).trim()) detail.trap = String(mapped.trap).trim();
    if (mapped.precedent != null && String(mapped.precedent).trim()) detail.precedent = String(mapped.precedent).trim();

    var q = {
      id: String(mapped.id || "").trim(),
      examId: String(mapped.examId || "").trim(),
      year: isNaN(yearVal) ? null : yearVal,
      exam:
        mapped.exam != null && String(mapped.exam).trim()
          ? String(mapped.exam).trim()
          : String(mapped.examId || "").trim(),
      topic: String(mapped.topic || "").trim(),
      statement: String(mapped.statement || "").trim(),
      answer: parseAnswerCell(mapped.answer),
      explanation: String(mapped.explanation || "").trim()
    };
    var eb = mapped.explanationBasic;
    if (eb != null && String(eb).trim()) q.explanationBasic = String(eb).trim();
    if (detail && (detail.legal || detail.trap || detail.precedent)) q.detail = detail;
    if (tags && tags.length) q.tags = tags;
    var im = parseScaleCell(mapped.importance);
    if (im != null) q.importance = im;
    var df = parseScaleCell(mapped.difficulty);
    if (df != null) q.difficulty = df;
    return applyExcelImportDefaults(q);
  }

  /**
   * 엑셀에 "국가공무원 9급" 등 한글 표기가 들어온 경우 exam-catalog id로 통일.
   * 인식 실패 시 빈 문자열 → 아래에서 기본 examId 적용.
   */
  function normalizeExamIdFromExcel(raw) {
    var s = String(raw == null ? "" : raw).trim();
    if (!s) return "";
    var compact = s.replace(/\s/g, "").toLowerCase();
    if (/^[a-z0-9_-]+$/.test(compact) && typeof window.getExamById === "function") {
      if (window.getExamById(compact)) return compact;
    }
    var ns = s.replace(/\s/g, "");
    if (/변호사|법조/.test(ns) || /^bar$/i.test(compact)) return "lawyer";
    // 영문/슬러그 변형 (예: 2024-guk-9, national9, civil-9 등)
    if (/(^|[^a-z])lawyer($|[^a-z])|bar/.test(compact)) return "lawyer";
    if (/grade[_-]?9|guk[_-]?9|national[_-]?9|civil[_-]?9|9[_-]?grade/.test(compact)) return "grade9";
    if (/grade[_-]?7|guk[_-]?7|national[_-]?7|civil[_-]?7|7[_-]?grade/.test(compact)) return "grade7";
    if (/grade[_-]?5|guk[_-]?5|national[_-]?5|civil[_-]?5|5[_-]?grade/.test(compact)) return "grade5";
    if (/fire/.test(compact)) return "fire";
    if (/police|cop/.test(compact)) return "police";
    if (/local/.test(compact)) return "local";
    if (/customs|tariff/.test(compact)) return "customs";
    if (/edu|education/.test(compact)) return "edu";
    if (/국가(직|공무원)?9급|^9급$|행정9급|국가9급|국가직9급/.test(ns)) return "grade9";
    if (/국가(직|공무원)?7급|^7급$/.test(ns) && !/9급/.test(ns)) return "grade7";
    if (/국가(직|공무원)?5급|^5급$|일반직|5급일반/.test(ns)) return "grade5";
    if (/소방/.test(ns)) return "fire";
    if (/경찰/.test(ns)) return "police";
    if (/지방/.test(ns)) return "local";
    if (/세관|관세/.test(ns)) return "customs";
    if (/교육청|교육공무원/.test(ns)) return "edu";
    return "";
  }

  /** 엑셀에 시험·연도 열이 비어 있을 때 firebase-config 의 기본값 적용 */
  function applyExcelImportDefaults(q) {
    var rawExam = String(q.examId || "").trim();
    var normExam = normalizeExamIdFromExcel(rawExam);
    if (normExam) {
      q.examId = normExam;
    } else if (!rawExam) {
      var scopeEx =
        window.APP_SCOPE &&
        Array.isArray(window.APP_SCOPE.examIds) &&
        window.APP_SCOPE.examIds.length === 1
          ? String(window.APP_SCOPE.examIds[0] || "").trim().toLowerCase()
          : "";
      var ex =
        scopeEx ||
        (window.HANLAW_EXCEL_DEFAULT_EXAM_ID != null
          ? String(window.HANLAW_EXCEL_DEFAULT_EXAM_ID).trim().toLowerCase()
          : "lawyer");
      q.examId = ex || "lawyer";
    } else {
      // examId가 채워져 있어도 catalog에 없는 값이면 exam(시험표기)로 재판정
      var lowered = rawExam.toLowerCase();
      var validCatalog = false;
      if (typeof window.getExamById === "function") {
        validCatalog = !!window.getExamById(lowered);
      }
      if (!validCatalog) {
        var byExamLabel = normalizeExamIdFromExcel(q.exam);
        if (byExamLabel) {
          q.examId = byExamLabel;
        } else {
          q.examId = lowered;
        }
      } else {
        q.examId = lowered;
      }
    }
    if (q.year == null || q.year === "" || (typeof q.year === "number" && isNaN(q.year))) {
      var scopeYear =
        window.APP_SCOPE &&
        Array.isArray(window.APP_SCOPE.years) &&
        window.APP_SCOPE.years.length === 1
          ? parseInt(window.APP_SCOPE.years[0], 10)
          : NaN;
      var y = !isNaN(scopeYear) ? scopeYear : window.HANLAW_EXCEL_DEFAULT_YEAR;
      if (typeof y !== "number" || isNaN(y)) {
        y = new Date().getFullYear();
      }
      q.year = y;
    }
    return q;
  }

  /**
   * 같은 id가 여러 행이면 Firestore 문서가 덮어써져 한 건만 남습니다. 2번째부터 id__3 형태로 바꿉니다.
   */
  function dedupeQuestionIdsInOrder(questions) {
    var counts = {};
    for (var i = 0; i < questions.length; i++) {
      var q = questions[i];
      var id = String(q.id || "").trim();
      if (!id) continue;
      if (!counts[id]) {
        counts[id] = 1;
        continue;
      }
      counts[id]++;
      q.id = id + "__" + counts[id];
    }
    return questions;
  }

  function parseWorkbookToQuestions(buffer) {
    if (typeof XLSX === "undefined") throw new Error("엑셀 라이브러리(xlsx)를 불러오지 못했습니다.");
    var wb = XLSX.read(buffer, { type: "array" });
    if (!wb.SheetNames || !wb.SheetNames.length) throw new Error("시트가 없습니다.");

    var si;
    for (si = 0; si < wb.SheetNames.length; si++) {
      var sheet = wb.Sheets[wb.SheetNames[si]];
      var detected = parseSheetWithHeaderDetection(sheet);
      if (detected.length) return detected;
    }

    for (si = 0; si < wb.SheetNames.length; si++) {
      var sheet2 = wb.Sheets[wb.SheetNames[si]];
      var rows = XLSX.utils.sheet_to_json(sheet2, { defval: "", raw: false });
      var out = [];
      for (var i = 0; i < rows.length; i++) {
        var mapped = mapHeaders(rows[i]);
        if (!String(mapped.id || "").trim() && !String(mapped.statement || "").trim()) continue;
        out.push(rowToQuestion(mapped));
      }
      if (out.length) return out;
    }
    return [];
  }

  function downloadTemplate() {
    if (typeof XLSX === "undefined") {
      window.alert("xlsx 라이브러리를 불러온 뒤 다시 시도하세요.");
      return;
    }
    var defaultExamId =
      window.HANLAW_EXCEL_DEFAULT_EXAM_ID != null
        ? String(window.HANLAW_EXCEL_DEFAULT_EXAM_ID).trim().toLowerCase()
        : "grade9";
    var defaultYear =
      window.HANLAW_EXCEL_DEFAULT_YEAR != null &&
      !isNaN(parseInt(window.HANLAW_EXCEL_DEFAULT_YEAR, 10))
        ? parseInt(window.HANLAW_EXCEL_DEFAULT_YEAR, 10)
        : new Date().getFullYear();
    var examLabel = defaultExamId;
    if (typeof window.getExamById === "function") {
      var ex = window.getExamById(defaultExamId);
      if (ex) examLabel = ex.sourceLabel || ex.label || defaultExamId;
    }
    var head = [
      "id",
      "examId",
      "year",
      "exam",
      "topic",
      "statement",
      "answer",
      "explanation",
      "explanationBasic",
      "legal",
      "trap",
      "precedent",
      "detail",
      "tags",
      "importance",
      "difficulty"
    ];
    var row1 = [
      "excel-sample-1",
      defaultExamId,
      defaultYear,
      examLabel,
      "행정소송",
      "예시 진술문 1) 처분성 판단에 관한 설명이다.",
      "X",
      "예시 해설 1) 처분성은 항고소송의 대상성과 연결됩니다.",
      "",
      "처분의 직접적 권리의무 변동 여부를 중심으로 본다.",
      "내부지침·사실행위를 처분으로 오인하기 쉽다.",
      "대법원 판례 취지를 함께 확인한다.",
      "",
      "처분성,항고소송",
      4,
      3
    ];
    var row2 = [
      "excel-sample-2",
      defaultExamId,
      defaultYear,
      examLabel,
      "행정작용법",
      "예시 진술문 2) 기속행위와 재량행위를 구분해 판단한다.",
      "O",
      "예시 해설 2) 재량권 일탈·남용 심사는 비례원칙과 연결됩니다.",
      "핵심: 재량권 일탈·남용 여부를 본다.",
      "재량행위라도 비례원칙·평등원칙 위반이면 위법이 된다.",
      "기속행위와 재량행위를 혼동하면 오답으로 이어진다.",
      "재량권 일탈·남용 관련 대표 판례를 확인한다.",
      "{\"legal\":\"비례원칙\",\"trap\":\"기속/재량 혼동\",\"precedent\":\"대표 판례를 확인\"}",
      "재량행위,비례원칙",
      3,
      2
    ];
    var ws = XLSX.utils.aoa_to_sheet([head, row1, row2]);

    var catalog = window.EXAM_CATALOG || [];
    var examIdRows = [["examId(입력값)", "화면 표시명"]];
    if (catalog.length) {
      for (var ci = 0; ci < catalog.length; ci++) {
        examIdRows.push([
          catalog[ci].id,
          catalog[ci].sourceLabel || catalog[ci].label || catalog[ci].id
        ]);
      }
    } else {
      examIdRows.push(["grade9", "국가직 9급"]);
      examIdRows.push(["grade7", "국가직 7급"]);
      examIdRows.push(["grade5", "국가직 5급·일반"]);
      examIdRows.push(["lawyer", "변호사시험"]);
    }

    var guide = [
      ["hanlaw_questions_template_v2 작성 가이드"],
      [""],
      ["[가장 중요] examId는 반드시 아래 코드만 입력하세요."],
      ["잘못된 예", "2024-guk-9, 국가직9급, guk9, 9급"],
      ["올바른 예", "grade9"],
      [""],
      ["필수 열", "id, examId, year, topic, statement, answer, explanation"],
      ["answer 허용값", "O/X, 참/거짓, TRUE/FALSE, 1/0"],
      ["중요도·난이도 허용값", "1~5 권장 (또는 상/중/하, ★ 표기 가능)"],
      ["상세해설 입력 권장", "legal(법리근거), trap(함정포인트), precedent(판례요지) 열에 각각 입력"],
      ["detail(JSON) 열", "선택입니다. legal/trap/precedent를 쓰면 JSON 없이도 상세해설이 표시됩니다."],
      ["year 형식", "숫자만 (예: 2024)"],
      ["현재 기본값(빈칸 보정)", "examId=" + defaultExamId + ", year=" + defaultYear],
      ["표시 주의", "퀴즈에는 현재 선택한 시험·연도와 일치하는 문항만 표시됩니다."],
      ["권장", "샘플 파일의 헤더 이름을 바꾸지 말고 그대로 사용하세요."]
    ];
    var wsGuide = XLSX.utils.aoa_to_sheet(guide);
    var wsExamIds = XLSX.utils.aoa_to_sheet(examIdRows);
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "문항");
    XLSX.utils.book_append_sheet(wb, wsGuide, "작성가이드");
    XLSX.utils.book_append_sheet(wb, wsExamIds, "examId코드표");
    XLSX.writeFile(wb, "hanlaw_questions_template_v2.xlsx");
  }

  function setMsg(el, text, isError) {
    if (!el) return;
    el.textContent = text || "";
    el.classList.toggle("admin-msg--error", !!isError);
    el.hidden = !text;
  }

  /**
   * 업로드 직후 "문항이 안 보임"을 막기 위해,
   * 업로드된 문항의 examId/year로 학습 범위를 즉시 맞춘다.
   */
  function applyScopeToUploaded(questions) {
    if (!window.APP_SCOPE || !Array.isArray(questions) || !questions.length) return;
    var examSet = {};
    var yearSet = {};
    for (var i = 0; i < questions.length; i++) {
      var q = questions[i] || {};
      var ex = String(q.examId || "").trim().toLowerCase();
      var y = parseInt(q.year, 10);
      if (ex) examSet[ex] = true;
      if (!isNaN(y)) yearSet[y] = true;
    }
    var examIds = Object.keys(examSet);
    var years = Object.keys(yearSet)
      .map(function (x) { return Number(x); })
      .sort(function (a, b) { return b - a; });
    if (!examIds.length || !years.length) return;

    window.APP_SCOPE.examIds = examIds;
    window.APP_SCOPE.years = years;
    try {
      localStorage.setItem(
        "hanlaw_scope_v3",
        JSON.stringify({
          examIds: examIds,
          years: years
        })
      );
    } catch (e) {}
    window.dispatchEvent(new CustomEvent("study-scope-change"));
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

  document.addEventListener("DOMContentLoaded", function () {
    var fileEl = document.getElementById("admin-excel-file");
    var dropEl = document.getElementById("admin-excel-dropzone");
    var btnUp = document.getElementById("admin-btn-excel-upload");
    var btnTpl = document.getElementById("admin-btn-excel-template");
    var msgEl = document.getElementById("admin-msg-excel");

    function setSelectedFile(file) {
      if (!fileEl || !file) return;
      try {
        var dt = new DataTransfer();
        dt.items.add(file);
        fileEl.files = dt.files;
      } catch (e) {
        // 일부 브라우저/환경에서는 file input files 대입이 막힐 수 있다.
      }
    }

    function processSelectedFile(file) {
      var user = typeof window.getHanlawUser === "function" ? window.getHanlawUser() : null;
      if (!isAdminUser(user)) {
        setMsg(msgEl, "관리자만 업로드할 수 있습니다.", true);
        return;
      }
      if (!file) {
        setMsg(msgEl, ".xlsx 파일을 선택하세요.", true);
        return;
      }
      var name = (file.name || "").toLowerCase();
      if (name.indexOf(".xlsx") === -1 && name.indexOf(".xls") === -1) {
        setMsg(msgEl, "엑셀 파일(.xlsx 또는 .xls)만 지원합니다.", true);
        return;
      }
      var validate = window.AdminQuestionUtils && window.AdminQuestionUtils.validateCore;
      if (!validate) {
        setMsg(msgEl, "검증 모듈을 불러오지 못했습니다.", true);
        return;
      }

      var reader = new FileReader();
      reader.onload = function () {
        try {
          var questions = dedupeQuestionIdsInOrder(
            parseWorkbookToQuestions(new Uint8Array(reader.result))
          );
          if (!questions.length) {
            setMsg(
              msgEl,
              "유효한 데이터 행이 없습니다. ① 첫 줄(또는 그 아래 줄)에 열 이름이 있어야 하며, 반드시 id·statement(또는 문항id·문제·본문 등 인식되는 이름)와 데이터가 있어야 합니다. ② 상단에 제목 행만 있고 헤더가 2행째인 경우도 자동 인식합니다. ③ 「샘플 엑셀 내려받기」로 만든 파일 형식을 권장합니다.",
              true
            );
            return;
          }
          var ok = [];
          for (var i = 0; i < questions.length; i++) {
            var err = validate(questions[i]);
            if (err) {
              setMsg(msgEl, i + 2 + "번째 행(헤더 제외): " + err, true);
              return;
            }
            ok.push(questions[i]);
          }
          setMsg(msgEl, ok.length + "건 검수대기 등록 중…", false);
          window
            .adminStageQuizBatch(ok)
            .then(function (res) {
              var okCount = parseInt(res && res.okCount, 10) || 0;
              var failRows = (res && res.failRows) || [];
              if (okCount > 0) applyScopeToUploaded(ok.slice(0, okCount));
              var msg = okCount + "건이 검수대기로 등록되었습니다.";
              if (failRows.length) {
                msg += " 실패 " + failRows.length + "건(예: " + failRows[0].index + "행 " + failRows[0].reason + ")";
              }
              setMsg(msgEl, msg + " '검수·승인' 탭에서 승인하면 퀴즈에 반영됩니다.", false);
              fileEl.value = "";
            })
            .catch(function (e) {
              var code = e && (e.code || (e.details && e.details.code)) ? String(e.code || e.details.code) : "";
              var msg = (e && e.message) || "";
              if (msg.toUpperCase() === "INTERNAL" || code.indexOf("internal") >= 0) {
                msg =
                  "서버 함수에서 오류가 발생했습니다. 최신 Functions 배포가 필요할 수 있습니다. " +
                  "관리자에게 firebase deploy --only functions 실행 여부를 확인해 주세요.";
              } else if (code.indexOf("not-found") >= 0) {
                msg = "검수 업로드 함수가 배포되지 않았습니다. firebase deploy --only functions 를 먼저 실행해 주세요.";
              } else if (code.indexOf("permission-denied") >= 0) {
                msg = "관리자 계정 권한이 없습니다. ADMIN_EMAILS 설정을 확인해 주세요.";
              }
              setMsg(
                msgEl,
                msg || "검수대기 등록 실패. Functions/권한을 확인하세요.",
                true
              );
            });
        } catch (e) {
          setMsg(msgEl, (e && e.message) || "파일을 읽지 못했습니다.", true);
        }
      };
      reader.readAsArrayBuffer(file);
    }

    if (btnTpl) {
      btnTpl.addEventListener("click", downloadTemplate);
    }

    if (btnUp && fileEl) {
      btnUp.addEventListener("click", function () {
        processSelectedFile(fileEl.files && fileEl.files[0]);
      });
    }

    if (dropEl && fileEl) {
      function setDropActive(on) {
        dropEl.classList.toggle("admin-excel-dropzone--active", !!on);
      }
      ["dragenter", "dragover"].forEach(function (evt) {
        dropEl.addEventListener(evt, function (e) {
          e.preventDefault();
          e.stopPropagation();
          setDropActive(true);
        });
      });
      ["dragleave", "drop"].forEach(function (evt) {
        dropEl.addEventListener(evt, function (e) {
          e.preventDefault();
          e.stopPropagation();
          setDropActive(false);
        });
      });
      dropEl.addEventListener("drop", function (e) {
        var files = (e.dataTransfer && e.dataTransfer.files) || [];
        var f = files[0];
        if (!f) return;
        setSelectedFile(f);
        processSelectedFile(f);
      });
      dropEl.addEventListener("click", function () {
        fileEl.click();
      });
      dropEl.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          fileEl.click();
        }
      });
      fileEl.addEventListener("change", function () {
        var f = fileEl.files && fileEl.files[0];
        if (f) {
          setMsg(msgEl, "선택됨: " + (f.name || ""), false);
        }
      });
    }
  });
})();
