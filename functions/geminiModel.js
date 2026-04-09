"use strict";

/** 비용 우선 기본: 1.5 Flash. 신규 키는 gemini-2.0-flash 404 — 구 환경변수 보정 */
const DEFAULT_GEMINI_MODEL = "gemini-1.5-flash-latest";

function effectiveGeminiModelId() {
  const raw = String(process.env.GEMINI_MODEL || "").trim();
  if (!raw) return DEFAULT_GEMINI_MODEL;
  const low = raw.toLowerCase().replace(/\s+/g, "");
  if (low === "gemini-2.0-flash" || low.indexOf("gemini-2.0-flash") === 0) {
    return DEFAULT_GEMINI_MODEL;
  }
  return raw;
}

module.exports = { effectiveGeminiModelId, DEFAULT_GEMINI_MODEL };
