 (function () {
  function normHeaderKey(k) {
    return String(k == null ? "" : k).replace(/^\uFEFF/, "").trim().toLowerCase().replace(/\s/g, "");
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
    if (/haekyung|haekyeong|kcg|coastguard/.test(compact)) return "haekyung";
    if (/police|cop/.test(compact)) return "police";
    if (/local/.test(compact)) return "local";
    if (/customs|tariff/.test(compact)) return "customs";
    if (/edu|education/.test(compact)) return "edu";
    if (/국가(직|공무원)?9급|^9급$|행정9급|국가9급|국가직9급/.test(ns)) return "grade9";
    if (/국가(직|공무원)?7급|^7급$/.test(ns) && !/9급/.test(ns)) return "grade7";
    if (/국가(직|공무원)?5급|^5급$|일반직|5급일반/.test(ns)) return "grade5";
    if (/소방/.test(ns)) return "fire";
    if (/해경|해양경찰/.test(ns)) return "haekyung";
    if (/경찰/.test(ns)) return "police";
    if (/지방/.test(ns)) return "local";
    if (/세관|관세/.test(ns)) return "customs";
    if (/교육청|교육공무원/.test(ns)) return "edu";
    if (/행정사/.test(ns)) return "haesaeng";
    if (/haesaeng|haengjeongsa|admin_sa|adminsa/.test(compact)) return "haesaeng";
    if (/^[a-z0-9_-]+$/.test(compact) && compact.length >= 2 && compact.length <= 64) return compact;
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

  function downloadWorkbookSafe(wb, filename) {
    var safeName = String(filename || "template.xlsx").trim() || "template.xlsx";
    try {
      XLSX.writeFile(wb, safeName);
      return true;
    } catch (err) {
      try {
        var out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
        var blob = new Blob(
          [out],
          { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }
        );
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url;
        a.download = safeName;
        document.body.appendChild(a);
        a.click();
        window.setTimeout(function () {
          try {
            document.body.removeChild(a);
          } catch (_) {}
          URL.revokeObjectURL(url);
        }, 0);
        return true;
      } catch (fallbackErr) {
        console.warn("엑셀 샘플 다운로드 실패:", fallbackErr);
        window.alert("샘플 파일 다운로드에 실패했습니다. 브라우저 다운로드 권한을 확인해 주세요.");
        return false;
      }
    }
  }

  function downloadQuizTemplate() {
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
    downloadWorkbookSafe(wb, "hanlaw_questions_template_v2.xlsx");
  }

  function parseBoolCell(v) {
    if (v === true || v === false) return v;
    var s = String(v == null ? "" : v).trim().toUpperCase();
    if (!s) return null;
    if (s === "O" || s === "TRUE" || s === "Y" || s === "1" || s === "참") return true;
    if (s === "X" || s === "FALSE" || s === "N" || s === "0" || s === "거짓") return false;
    return null;
  }

  function splitComma(v) {
    var s = String(v == null ? "" : v).trim();
    if (!s) return [];
    return s
      .split(/[,;#]/g)
      .map(function (x) { return String(x || "").trim(); })
      .filter(Boolean);
  }

  function parseOxSet(mapped, maxItems) {
    var out = [];
    for (var i = 1; i <= maxItems; i++) {
      var st = String(mapped["ox" + i + "_statement"] || "").trim();
      var ans = parseBoolCell(mapped["ox" + i + "_answer"]);
      var ex = String(mapped["ox" + i + "_explanation"] || "").trim();
      if (!st && ans == null && !ex) continue;
      if (!st || ans == null || !ex) continue;
      out.push({ statement: st, answer: ans, explanation: ex, explanationBasic: ex });
    }
    return out;
  }

  function genericRowsFromWorkbook(buffer) {
    if (typeof XLSX === "undefined") throw new Error("엑셀 라이브러리(xlsx)를 불러오지 못했습니다.");
    var wb = XLSX.read(buffer, { type: "array" });
    if (!wb.SheetNames || !wb.SheetNames.length) throw new Error("시트가 없습니다.");
    var first = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json(first, { defval: "", raw: false });
  }

  var TERM_HEADER_TO_FIELD = {
    term: "term",
    용어: "term",
    aliases: "aliases",
    동의어: "aliases",
    별칭: "aliases",
    definition: "definition",
    정의: "definition",
    설명: "definition"
  };

  var CASE_HEADER_TO_FIELD = {
    citation: "citation",
    사건표기: "citation",
    사건번호: "citation",
    title: "title",
    제목: "title",
    사건명: "title",
    facts: "facts",
    사실관계: "facts",
    issues: "issues",
    쟁점: "issues",
    judgment: "judgment",
    판단: "judgment",
    결론: "judgment",
    casefulltext: "caseFullText",
    판례전문: "caseFullText",
    searchkeys: "searchKeys",
    검색키: "searchKeys",
    topickeywords: "topicKeywords",
    주제키워드: "topicKeywords",
    casenoteurl: "casenoteUrl",
    jiscntntssrno: "jisCntntsSrno",
    scourtportalurl: "scourtPortalUrl"
  };

  var STATUTE_HEADER_TO_FIELD = {
    docid: "docId",
    statutekey: "statuteKey",
    조문키: "statuteKey",
    heading: "heading",
    표제: "heading",
    body: "body",
    본문: "body",
    sourcenote: "sourceNote",
    출처: "sourceNote"
  };

  function mapByHeader(rawRow, headerMap) {
    var o = {};
    Object.keys(rawRow || {}).forEach(function (k) {
      var nk = normHeaderKey(k);
      var field = headerMap[nk] || null;
      if (!field && /^ox[1-9]_(statement|answer|explanation)$/.test(nk)) field = nk;
      if (!field) return;
      o[field] = rawRow[k];
    });
    return o;
  }

  function parseWorkbookToTerms(buffer) {
    var rows = genericRowsFromWorkbook(buffer);
    var out = [];
    for (var i = 0; i < rows.length; i++) {
      var m = mapByHeader(rows[i], TERM_HEADER_TO_FIELD);
      var term = String(m.term || "").trim();
      var definition = String(m.definition || "").trim();
      if (!term && !definition) continue;
      if (!term || !definition) throw new Error(i + 2 + "번째 행: term/definition은 필수입니다.");
      out.push({
        term: term,
        definition: definition,
        aliases: splitComma(m.aliases),
        oxQuizzes: parseOxSet(m, 3)
      });
    }
    return out;
  }

  function parseWorkbookToCases(buffer) {
    var rows = genericRowsFromWorkbook(buffer);
    var out = [];
    for (var i = 0; i < rows.length; i++) {
      var m = mapByHeader(rows[i], CASE_HEADER_TO_FIELD);
      var citation = String(m.citation || "").trim();
      if (!citation) {
        if (!String(m.title || "").trim() && !String(m.facts || "").trim()) continue;
        throw new Error(i + 2 + "번째 행: citation(사건 표기)은 필수입니다.");
      }
      out.push({
        citation: citation,
        title: String(m.title || "").trim(),
        facts: String(m.facts || "").trim(),
        issues: String(m.issues || "").trim(),
        judgment: String(m.judgment || "").trim(),
        caseFullText: String(m.caseFullText || "").trim(),
        searchKeys: splitComma(m.searchKeys),
        topicKeywords: splitComma(m.topicKeywords),
        casenoteUrl: String(m.casenoteUrl || "").trim(),
        jisCntntsSrno: String(m.jisCntntsSrno || "").trim(),
        scourtPortalUrl: String(m.scourtPortalUrl || "").trim(),
        oxQuizzes: parseOxSet(m, 5)
      });
    }
    return out;
  }

  function parseWorkbookToStatutes(buffer) {
    var rows = genericRowsFromWorkbook(buffer);
    var out = [];
    for (var i = 0; i < rows.length; i++) {
      var m = mapByHeader(rows[i], STATUTE_HEADER_TO_FIELD);
      var statuteKey = String(m.statuteKey || "").trim();
      var body = String(m.body || "").trim();
      if (!statuteKey && !body) continue;
      if (!statuteKey || !body) throw new Error(i + 2 + "번째 행: statuteKey/body는 필수입니다.");
      out.push({
        docId: String(m.docId || "").trim(),
        entry: {
          statuteKey: statuteKey,
          heading: String(m.heading || "").trim(),
          body: body,
          sourceNote: String(m.sourceNote || "").trim(),
          oxQuizzes: parseOxSet(m, 3)
        }
      });
    }
    return out;
  }

  function downloadTermTemplate() {
    if (typeof XLSX === "undefined") return window.alert("xlsx 라이브러리를 불러온 뒤 다시 시도하세요.");
    var head = [
      "term", "aliases", "definition",
      "ox1_statement", "ox1_answer", "ox1_explanation",
      "ox2_statement", "ox2_answer", "ox2_explanation",
      "ox3_statement", "ox3_answer", "ox3_explanation"
    ];
    var row = [
      "기속행위",
      "기속 처분,재량과 대비",
      "행정청에게 법규가 단 하나의 법적 효과만을 허용하는 행위",
      "기속행위에서는 행정청이 법규상 선택 재량을 갖지 않는다.", "O", "기속행위는 요건 충족 시 처분 내용이 법규로 확정된다.",
      "", "", "",
      "", "", ""
    ];
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([head, row]), "용어사전");
    downloadWorkbookSafe(wb, "hanlaw_dict_terms_template.xlsx");
  }

  function downloadCaseTemplate() {
    if (typeof XLSX === "undefined") return window.alert("xlsx 라이브러리를 불러온 뒤 다시 시도하세요.");
    var head = [
      "citation", "title", "facts", "issues", "judgment",
      "caseFullText", "searchKeys", "topicKeywords", "casenoteUrl", "jisCntntsSrno", "scourtPortalUrl",
      "ox1_statement", "ox1_answer", "ox1_explanation"
    ];
    var row = [
      "대법원 2024두12345",
      "처분성 판단 기준",
      "행정청의 내부지침 통보가 문제된 사안",
      "내부지침 통보가 항고소송 대상 처분인지",
      "외부에 직접 법효과를 발생시키지 않아 처분성이 부정됨",
      "",
      "처분성,항고소송,법효과",
      "행정소송,처분성",
      "",
      "",
      "",
      "내부지침이라도 항상 처분성이 인정된다.",
      "X",
      "외부적 구속력과 직접적 법효과 유무를 기준으로 판단한다."
    ];
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([head, row]), "판례사전");
    downloadWorkbookSafe(wb, "hanlaw_dict_cases_template.xlsx");
  }

  function downloadStatuteTemplate() {
    if (typeof XLSX === "undefined") return window.alert("xlsx 라이브러리를 불러온 뒤 다시 시도하세요.");
    var head = [
      "docId", "statuteKey", "heading", "body", "sourceNote",
      "ox1_statement", "ox1_answer", "ox1_explanation"
    ];
    var row = [
      "haengjeongsosongbeop_12",
      "행정소송법 제12조",
      "제12조(원고적격)",
      "취소소송은 처분등의 취소 또는 변경을 구할 법률상 이익이 있는 자가 제기할 수 있다.",
      "행정소송법",
      "원고적격은 법률상 이익이 있는지 여부로 판단한다.",
      "O",
      "조문의 문언이 '법률상 이익'을 기준으로 규정하고 있다."
    ];
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([head, row]), "조문사전");
    downloadWorkbookSafe(wb, "hanlaw_dict_statutes_template.xlsx");
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
    var kindEl = document.getElementById("admin-excel-kind");
    var fileEl = document.getElementById("admin-excel-file");
    var dropEl = document.getElementById("admin-excel-dropzone");
    var btnUp = document.getElementById("admin-btn-excel-upload");
    var btnTpl = document.getElementById("admin-btn-excel-template");
    var btnTplStatute = document.getElementById("admin-btn-excel-template-statute");
    var btnTplTerm = document.getElementById("admin-btn-excel-template-term");
    var btnTplCase = document.getElementById("admin-btn-excel-template-case");
    var msgEl = document.getElementById("admin-msg-excel");
    var helpQuiz = document.getElementById("admin-excel-help-quiz");
    var helpStatute = document.getElementById("admin-excel-help-statute");
    var helpTerm = document.getElementById("admin-excel-help-term");
    var helpCase = document.getElementById("admin-excel-help-case");

    function selectedKind() {
      var v = kindEl && kindEl.value ? String(kindEl.value) : "quiz";
      if (v === "term" || v === "case" || v === "statute") return v;
      return "quiz";
    }

    function refreshHelp() {
      var k = selectedKind();
      if (helpQuiz) helpQuiz.hidden = k !== "quiz";
      if (helpStatute) helpStatute.hidden = k !== "statute";
      if (helpTerm) helpTerm.hidden = k !== "term";
      if (helpCase) helpCase.hidden = k !== "case";
      var wrapEnrich = document.getElementById("admin-excel-quiz-enrich-wrap");
      var helpPartial = document.getElementById("admin-excel-help-quiz-partial");
      if (wrapEnrich) wrapEnrich.hidden = k !== "quiz";
      if (helpPartial) helpPartial.hidden = k !== "quiz";
    }

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
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var k = selectedKind();
          if (k === "quiz") {
            if (typeof window.adminStageQuizBatch !== "function") {
              setMsg(msgEl, "검수 업로드 함수를 불러오지 못했습니다.", true);
              return;
            }
            var questions = dedupeQuestionIdsInOrder(parseWorkbookToQuestions(new Uint8Array(reader.result)));
            if (!questions.length) {
              setMsg(msgEl, "유효한 데이터 행이 없습니다. 퀴즈 샘플 엑셀 형식을 사용해 주세요.", true);
              return;
            }
            var enrichEl = document.getElementById("admin-excel-quiz-enrich-prompt");
            var enrichPrompt = enrichEl ? String(enrichEl.value || "").trim() : "";
            setMsg(msgEl, questions.length + "건 검수대기 등록 중(AI 보강 포함)…", false);
            window
              .adminStageQuizBatch(questions, {
                enrichWhenIncomplete: true,
                enrichPrompt: enrichPrompt
              })
              .then(function (res) {
              var okCount = parseInt(res && res.okCount, 10) || 0;
              var failRows = (res && res.failRows) || [];
              if (okCount > 0) applyScopeToUploaded(questions);
              var msg = okCount + "건이 검수대기로 등록되었습니다.";
              if (failRows.length) msg += " 실패 " + failRows.length + "건(예: " + failRows[0].index + "행 " + failRows[0].reason + ")";
              setMsg(msgEl, msg + " '검수·승인' 탭에서 승인하면 퀴즈에 반영됩니다.", false);
              fileEl.value = "";
            }).catch(function (e) {
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
            return;
          }

          if (k === "term" || k === "case") {
            if (typeof window.adminStageDictBatch !== "function") {
              setMsg(msgEl, "사전 스테이징 함수가 없습니다. Functions/클라이언트를 배포해 주세요.", true);
              return;
            }
            var rows = k === "term" ? parseWorkbookToTerms(new Uint8Array(reader.result)) : parseWorkbookToCases(new Uint8Array(reader.result));
            if (!rows.length) return setMsg(msgEl, "유효한 데이터 행이 없습니다. 샘플 형식을 확인해 주세요.", true);
            setMsg(msgEl, rows.length + "건 검수대기 등록 중…", false);
            window.adminStageDictBatch(k, rows).then(function (res2) {
              var okCount2 = parseInt(res2 && res2.okCount, 10) || 0;
              var failRows2 = (res2 && res2.failRows) || [];
              var label = k === "term" ? "용어사전" : "판례사전";
              var msg2 = label + " " + okCount2 + "건이 검수대기로 등록되었습니다.";
              if (failRows2.length) msg2 += " 실패 " + failRows2.length + "건(예: " + failRows2[0].index + "행 " + failRows2[0].reason + ")";
              setMsg(msgEl, msg2 + " '검수·승인' 탭에서 승인하면 반영됩니다.", false);
              fileEl.value = "";
            }).catch(function (e2) {
              setMsg(msgEl, (e2 && e2.message) || "검수대기 등록 실패", true);
            });
            return;
          }

          var statutes = parseWorkbookToStatutes(new Uint8Array(reader.result));
          if (!statutes.length) return setMsg(msgEl, "유효한 데이터 행이 없습니다. 샘플 형식을 확인해 주세요.", true);
          if (typeof window.saveLegalStatuteRemote !== "function") {
            return setMsg(msgEl, "조문 저장 함수를 찾지 못했습니다.", true);
          }
          setMsg(msgEl, statutes.length + "건 조문 저장 중…", false);
          var seq = Promise.resolve();
          var saved = 0;
          statutes.forEach(function (row) {
            seq = seq.then(function () {
              return window.saveLegalStatuteRemote(row.entry, row.docId).then(function () {
                saved += 1;
              });
            });
          });
          seq.then(function () {
            setMsg(msgEl, "조문사전 " + saved + "건이 즉시 반영되었습니다.", false);
            fileEl.value = "";
            try {
              window.dispatchEvent(new CustomEvent("dict-remote-updated"));
            } catch (e3) {}
          }).catch(function (e4) {
            setMsg(msgEl, (e4 && e4.message) || "조문 저장 실패", true);
          });
        } catch (e) {
          setMsg(msgEl, (e && e.message) || "파일을 읽지 못했습니다.", true);
        }
      };
      reader.readAsArrayBuffer(file);
    }

    if (btnTpl) {
      btnTpl.addEventListener("click", downloadQuizTemplate);
    }
    if (btnTplStatute) {
      btnTplStatute.addEventListener("click", downloadStatuteTemplate);
    }
    if (btnTplTerm) {
      btnTplTerm.addEventListener("click", downloadTermTemplate);
    }
    if (btnTplCase) {
      btnTplCase.addEventListener("click", downloadCaseTemplate);
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
    if (kindEl) kindEl.addEventListener("change", refreshHelp);
    refreshHelp();
  });
})();
