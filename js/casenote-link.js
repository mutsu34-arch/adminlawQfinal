/**
 * 판례 외부 링크 URL 생성(케이스노트 UI 등에서 사용).
 * - 케이스노트(casenote.kr): 사건번호 기준 직접 URL(`/법원명/사건번호`) 또는 검색 URL. 전문은 사건번호로 조회 가능.
 * - scourtList / scourtPortal: dict-panels 등에서 직접 쓰지 않지만, 데이터·다른 화면용으로 유지.
 */
(function () {
  var CASENOTE_ORIGIN = "https://casenote.kr";
  var SCOURT_LX_LIST =
    "https://lx.scourt.go.kr/search/precedent/get/list";
  /** 판례·종합검색 진입(사건번호 미지정 시 사용자가 포털에서 검색) */
  var SCOURT_PORTAL_PRECEDENT =
    "https://portal.scourt.go.kr/pgp/main.on?w2xPath=PGP1010M01";

  var HIGH_COURTS = [
    "서울고등법원",
    "부산고등법원",
    "대구고등법원",
    "광주고등법원",
    "대전고등법원",
    "수원고등법원",
    "인천고등법원",
    "울산고등법원",
    "창원고등법원",
    "청주고등법원",
    "전주고등법원",
    "춘천고등법원"
  ];

  function normalizeCaseNoToken(str) {
    var compact = String(str || "").replace(/\s/g, "");
    var hm = compact.match(/(\d{4}헌[가바마]\d+)/);
    if (hm) return hm[1];
    var m = compact.match(/(\d{2,4})([가-힣]{1,3})(\d{2,7})/);
    if (m) return m[1] + m[2] + m[3];
    return null;
  }

  function inferCourtFromCitation(citation, token) {
    var cit = String(citation || "");
    if (/헌법재판소|헌재/.test(cit)) return "헌법재판소";
    if (token && /\d{4}헌[가바마]/.test(token)) return "헌법재판소";
    for (var i = 0; i < HIGH_COURTS.length; i++) {
      if (cit.indexOf(HIGH_COURTS[i]) >= 0) return HIGH_COURTS[i];
    }
    if (/고등법원/.test(cit)) {
      var m = cit.match(/([\w가-힣]+고등법원)/);
      if (m) return m[1];
    }
    if (/행정법원/.test(cit)) {
      var em = cit.match(/([\w가-힣]+행정법원)/);
      if (em) return em[1];
    }
    if (/지방법원/.test(cit)) {
      var dm = cit.match(/([\w가-힣]+지방법원)/);
      if (dm) return dm[1];
    }
    if (/대법원|대법/.test(cit)) return "대법원";
    return "대법원";
  }

  function pickTokenFromCase(caseObj) {
    var keys = (caseObj && caseObj.searchKeys) || [];
    var citation = (caseObj && caseObj.citation) || "";
    var i;
    var t;
    for (i = 0; i < keys.length; i++) {
      t = normalizeCaseNoToken(keys[i]);
      if (t) return t;
    }
    t = normalizeCaseNoToken(citation);
    if (t) return t;
    return null;
  }

  function searchQueryForCase(caseObj) {
    var token = pickTokenFromCase(caseObj);
    if (token) return token;
    var keys = (caseObj && caseObj.searchKeys) || [];
    if (keys.length) return String(keys[0]).trim();
    var cit = (caseObj && caseObj.citation) || "";
    return cit.slice(0, 120).trim() || "판례";
  }

  /**
   * 대법원 법고을 판례 검색 결과 URL(로그인 없이 목록·전문 조회 가능한 공공 경로).
   * 헌재 사건은 tab_idx=2.
   */
  function buildScourtLawListUrl(caseObj) {
    var citation = (caseObj && caseObj.citation) || "";
    var token = pickTokenFromCase(caseObj);
    var searchTxt = token || searchQueryForCase(caseObj);
    if (!searchTxt) return null;
    var isConst =
      /헌법재판소|헌재/.test(citation) ||
      (token && /\d{4}헌[가바마]/.test(token));
    var q =
      "search_txt=" +
      encodeURIComponent(searchTxt) +
      "&page_no=1&display=20&search_mode=simple";
    if (isConst) {
      q += "&tab_idx=2";
    } else {
      q += "&order_by=des&order_column=d&tab_idx=0";
    }
    return SCOURT_LX_LIST + "?" + q;
  }

  /**
   * 사법정보공개포털(종합법률정보) URL.
   * - scourtPortalUrl: 전체 URL 직접 지정
   * - jisCntntsSrno: 전문 화면 일련번호(예: 2026000032838)
   * - 없으면 판례 검색 화면으로 안내
   */
  function buildScourtPortalUrl(caseObj) {
    var explicit =
      caseObj &&
      caseObj.scourtPortalUrl &&
      String(caseObj.scourtPortalUrl).indexOf("http") === 0
        ? String(caseObj.scourtPortalUrl).trim()
        : null;
    if (explicit) return explicit;
    var sr = caseObj && caseObj.jisCntntsSrno;
    if (sr != null && String(sr).replace(/\s/g, "").length) {
      var s = String(sr).replace(/\s/g, "");
      return (
        "https://portal.scourt.go.kr/pgp/main.on?w2xPath=PGP1011M04&jisCntntsSrno=" +
        encodeURIComponent(s) +
        "&c=900&srchwd=*&rnum=1&pgDvs=1"
      );
    }
    return SCOURT_PORTAL_PRECEDENT;
  }

  /**
   * @returns {{ direct: string|null, search: string, court: string|null, token: string|null, scourtList: string|null, scourtPortal: string }}
   */
  function buildCasenoteCaseLinks(caseObj) {
    var explicit =
      caseObj &&
      caseObj.casenoteUrl &&
      String(caseObj.casenoteUrl).indexOf("http") === 0
        ? String(caseObj.casenoteUrl).trim()
        : null;

    var token = pickTokenFromCase(caseObj);
    var citation = (caseObj && caseObj.citation) || "";
    var court = token ? inferCourtFromCitation(citation, token) : null;
    var direct = explicit;
    if (!direct && token && court) {
      direct =
        CASENOTE_ORIGIN +
        "/" +
        encodeURIComponent(court) +
        "/" +
        encodeURIComponent(token);
    }
    var search =
      CASENOTE_ORIGIN + "/search?q=" + encodeURIComponent(searchQueryForCase(caseObj));

    return {
      direct: direct,
      search: search,
      court: court,
      token: token,
      scourtList: buildScourtLawListUrl(caseObj),
      scourtPortal: buildScourtPortalUrl(caseObj)
    };
  }

  window.buildCasenoteCaseLinks = buildCasenoteCaseLinks;
})();
