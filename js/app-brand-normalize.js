/**
 * 알림·티켓 초안 표시 시 구 앱명을 행정법Q로 통일 (functions/appBrandNormalize.js 와 동일 규칙)
 */
(function () {
  function normalizeAppBrandInText(text) {
    var out = String(text || "");
    if (!out) return out;

    out = out.replace(
      /['"『「]?\s*한국\s*행정법\s*퀴즈\s*['"』」]?\s*(웹\s*앱|웹앱|앱)?/gi,
      "행정법Q"
    );
    out = out.replace(/한국\s*행정법\s*퀴즈/gi, "행정법Q");
    out = out.replace(/한국행정법퀴즈/gi, "행정법Q");

    out = out.replace(/저희\s+['"]?행정법Q['"]?\s*(웹\s*앱|웹앱|앱)?에/gi, '"행정법Q"에');
    out = out.replace(/저희\s+['"]?행정법Q['"]?\s*(웹\s*앱|웹앱|앱)?을/gi, '"행정법Q"를');
    out = out.replace(/['"]?행정법Q['"]?\s*(웹\s*앱|웹앱|앱)/gi, "행정법Q");

    return out;
  }

  window.normalizeHanlawAppBrandInText = normalizeAppBrandInText;
})();
