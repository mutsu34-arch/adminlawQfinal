"use strict";

/**
 * 한국시간(Asia/Seoul, UTC+9 고정) 달력 기준 월 가산.
 * JS Date#setMonth(UTC)와 달리 1·3·5·7·8·10·12월 일수·윤년을 반영합니다.
 */

function isLeapYear(y) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function daysInMonth(year, month1to12) {
  const dm = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return dm[month1to12 - 1];
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

/** 서울 벽시계 시각을 해당 순간의 UTC epoch(ms)로 변환 */
function kstWallToUtcMs(y, mo, d, h, mi, s) {
  const iso = `${y}-${pad2(mo)}-${pad2(d)}T${pad2(h)}:${pad2(mi)}:${pad2(s)}+09:00`;
  return Date.parse(iso);
}

/**
 * fromMs 시각을 한국시간으로 풀어 같은 시·분·초를 유지한 채 deltaMonths개월 뒤의 순간(ms).
 * (예: 1월 31일 + 1개월 → 2월 말일까지 자동 클램프)
 */
function addCalendarMonthsKst(fromMs, deltaMonths) {
  const add = Math.max(0, parseInt(String(deltaMonths), 10) || 0);
  if (add === 0) return fromMs;

  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });

  const partsOf = (ms) => {
    const o = {};
    for (const x of f.formatToParts(new Date(ms))) {
      if (x.type !== "literal") o[x.type] = x.value;
    }
    return {
      y: parseInt(o.year, 10),
      mo: parseInt(o.month, 10),
      d: parseInt(o.day, 10),
      h: parseInt(o.hour, 10),
      mi: parseInt(o.minute, 10),
      s: parseInt(o.second, 10)
    };
  };

  const t = partsOf(fromMs);
  let y = t.y;
  let mo = t.mo + add;
  while (mo > 12) {
    mo -= 12;
    y += 1;
  }
  const dim = daysInMonth(y, mo);
  const d = Math.min(t.d, dim);
  return kstWallToUtcMs(y, mo, d, t.h, t.mi, t.s);
}

function subtractCalendarMonthsKst(fromMs, deltaMonths) {
  const sub = Math.max(0, parseInt(String(deltaMonths), 10) || 0);
  if (sub === 0) return fromMs;

  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });

  const partsOf = (ms) => {
    const o = {};
    for (const x of f.formatToParts(new Date(ms))) {
      if (x.type !== "literal") o[x.type] = x.value;
    }
    return {
      y: parseInt(o.year, 10),
      mo: parseInt(o.month, 10),
      d: parseInt(o.day, 10),
      h: parseInt(o.hour, 10),
      mi: parseInt(o.minute, 10),
      s: parseInt(o.second, 10)
    };
  };

  const t = partsOf(fromMs);
  let y = t.y;
  let mo = t.mo - sub;
  while (mo < 1) {
    mo += 12;
    y -= 1;
  }
  const dim = daysInMonth(y, mo);
  const d = Math.min(t.d, dim);
  return kstWallToUtcMs(y, mo, d, t.h, t.mi, t.s);
}

/** KST 달력일 기준 inclusive 일수 (시작·종료일 모두 포함) */
function daysInclusiveKst(startMs, endMs) {
  const start = Math.min(startMs, endMs);
  const end = Math.max(startMs, endMs);
  const dayKey = (ms) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(new Date(ms));
  const a = dayKey(start);
  const b = dayKey(end);
  if (a === b) return 1;
  const parse = (s) => {
    const p = String(s).split("-");
    return Date.UTC(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10)) / 86400000;
  };
  return Math.max(1, Math.floor(parse(b) - parse(a)) + 1);
}

function formatDateKstShort(ms) {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "long",
    day: "numeric"
  }).format(new Date(ms));
}

module.exports = {
  addCalendarMonthsKst,
  subtractCalendarMonthsKst,
  daysInclusiveKst,
  formatDateKstShort
};
