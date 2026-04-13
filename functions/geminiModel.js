"use strict";

/**
 * Google AI Studio(@google/generative-ai)용 텍스트 생성 모델.
 * gemini-1.5-flash-latest 등 -latest 별칭은 v1beta에서 404가 나는 경우가 많음.
 */
const DEFAULT_GEMINI_MODEL = "gemini-2.0-flash";

/** primary 실패(404·단종) 시 순서대로 시도 */
const GEMINI_TEXT_MODEL_FALLBACKS = [
  "gemini-2.0-flash",
  "gemini-1.5-flash",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite"
];

function effectiveGeminiModelId() {
  const raw = String(process.env.GEMINI_MODEL || "").trim();
  if (!raw) return DEFAULT_GEMINI_MODEL;
  const low = raw.toLowerCase().replace(/\s+/g, "");
  if (low === "gemini-1.5-flash-latest" || low.endsWith("gemini-1.5-flash-latest")) {
    return "gemini-1.5-flash";
  }
  return raw;
}

/** 중복 제거된 시도 순서 (환경변수 우선 + 폴백) */
function uniqueGeminiModelCandidates() {
  const list = [];
  [effectiveGeminiModelId()].concat(GEMINI_TEXT_MODEL_FALLBACKS).forEach(function (m) {
    const s = String(m || "").trim();
    if (!s || list.indexOf(s) >= 0) return;
    list.push(s);
  });
  return list;
}

module.exports = {
  effectiveGeminiModelId,
  DEFAULT_GEMINI_MODEL,
  GEMINI_TEXT_MODEL_FALLBACKS,
  uniqueGeminiModelCandidates
};
