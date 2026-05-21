"use strict";

/**
 * AI 초안·관리자 답변 등에서 구 앱명(한국행정법 퀴즈 등)을 행정법Q로 통일합니다.
 */
function normalizeAppBrandInText(text) {
  let out = String(text || "");
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

module.exports = { normalizeAppBrandInText };
