"use strict";

/** 선고일·행사일 등 YYYY. M. D. 가 줄바꿈으로 쪼개진 경우 한 줄로 복원 */
function fixBrokenDateNewlines(text) {
  let s = String(text || "").replace(/\r\n/g, "\n");
  for (let pass = 0; pass < 4; pass++) {
    const before = s;
    s = s.replace(/(\d{4})\.\s*\n+\s*(\d{1,2})\.\s*\n+\s*(\d{1,2})\./g, "$1. $2. $3.");
    s = s.replace(/(\d{4})\.\s*\n+\s*(\d{1,2})\.\s+(\d{1,2})\./g, "$1. $2. $3.");
    s = s.replace(/(\d{4})\.\s+(\d{1,2})\.\s*\n+\s*(\d{1,2})\./g, "$1. $2. $3.");
    s = s.replace(/(\d{4})\.\s*\n+\s*(\d{1,2})\.(?=[^\n]*\n[^\n]*\d{1,2}\.)/g, "$1. $2.");
    if (s === before) break;
  }
  return s;
}

function lineLooksLikeDateFragment(line) {
  const t = String(line || "").trim();
  return /^\d{1,4}\.$/.test(t) || /^\d{1,2}\.$/.test(t);
}

function blockLooksLikeIssueList(lines) {
  if (!lines.length) return false;
  let listLike = 0;
  for (let i = 0; i < lines.length; i++) {
    const ln = String(lines[i] || "").trim();
    if (!ln) continue;
    if (
      /^(?:첫|둘|셋|넷|다섯|여섯|일곱|여덟|아홉|열)(?:째)?\s*,/.test(ln) ||
      /^[\*\-•]\s+/.test(ln) ||
      /^\d{1,2}[\.\)]\s+/.test(ln)
    ) {
      listLike += 1;
    }
  }
  return listLike >= Math.max(2, Math.floor(lines.length / 2));
}

function collapseSpuriousSingleNewlines(text) {
  const blocks = String(text || "").split(/\n\n+/);
  const out = [];
  for (let b = 0; b < blocks.length; b++) {
    const lines = String(blocks[b] || "")
      .split("\n")
      .map((x) => String(x || "").trim())
      .filter(Boolean);
    if (lines.length <= 1) {
      out.push(lines[0] || "");
      continue;
    }
    if (blockLooksLikeIssueList(lines)) {
      out.push(lines.join("\n"));
      continue;
    }
    if (lines.some(lineLooksLikeDateFragment)) {
      out.push(lines.join(" "));
      continue;
    }
    let merged = lines[0];
    for (let i = 1; i < lines.length; i++) {
      const ln = lines[i];
      if (!/[.!?…)]$/.test(merged) || lineLooksLikeDateFragment(ln)) {
        merged += " " + ln;
      } else {
        merged += "\n" + ln;
      }
    }
    out.push(merged);
  }
  return out.join("\n\n");
}

/**
 * @param {string} raw
 * @param {{ preserveIssueList?: boolean }} [opts]
 */
function normalizeCaseProseText(raw, opts) {
  opts = opts || {};
  let s = String(raw || "").replace(/\r\n/g, "\n").trim();
  if (!s) return "";
  s = fixBrokenDateNewlines(s);
  if (!opts.preserveIssueList) {
    s = collapseSpuriousSingleNewlines(s);
  }
  return s.replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function normalizeCaseDictionaryFields(entry) {
  const src = entry && typeof entry === "object" ? entry : {};
  return {
    facts: normalizeCaseProseText(src.facts),
    issues: normalizeCaseProseText(src.issues, { preserveIssueList: true }),
    judgment: normalizeCaseProseText(src.judgment)
  };
}

function caseFieldsNeedNormalize(entry) {
  const next = normalizeCaseDictionaryFields(entry || {});
  return (
    next.facts !== String(entry && entry.facts ? entry.facts : "").trim() ||
    next.issues !== String(entry && entry.issues ? entry.issues : "").trim() ||
    next.judgment !== String(entry && entry.judgment ? entry.judgment : "").trim()
  );
}

module.exports = {
  fixBrokenDateNewlines,
  normalizeCaseProseText,
  normalizeCaseDictionaryFields,
  caseFieldsNeedNormalize
};
