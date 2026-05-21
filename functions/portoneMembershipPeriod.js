"use strict";

const { addCalendarMonthsKst } = require("./kstCalendar");

const MS_PER_DAY = 86400000;

/**
 * 유료 만료일이 미래면 그 시점부터, 아니면 now부터 1개월(이용·다음 청구) 연장의 기준 시각.
 */
function membershipStackBaseMs(mdata, nowMs) {
  const now = Number(nowMs) || Date.now();
  let base = now;
  if (
    mdata &&
    mdata.membershipTier === "paid" &&
    mdata.paidUntil &&
    typeof mdata.paidUntil.toMillis === "function"
  ) {
    base = Math.max(now, mdata.paidUntil.toMillis());
  }
  return base;
}

/** KST 기준 잔여 일수(올림). paidUntilMs <= now 이면 0 */
function remainingPaidDaysKstCeil(paidUntilMs, nowMs) {
  const until = Number(paidUntilMs) || 0;
  const now = Number(nowMs) || Date.now();
  if (until <= now) return 0;
  return Math.ceil((until - now) / MS_PER_DAY);
}

function paidUntilMillis(mdata) {
  if (!mdata || !mdata.paidUntil || typeof mdata.paidUntil.toMillis !== "function") return 0;
  return mdata.paidUntil.toMillis();
}

/** 단건 이용권 잔여 + 아직 정기 자동결제 미가입 상태 */
function hasActiveSinglePeriod(mdata, nowMs) {
  const now = Number(nowMs) || Date.now();
  const until = paidUntilMillis(mdata);
  if (!mdata || mdata.membershipTier !== "paid" || until <= now) return false;
  if (mdata.portoneAutoRenewEnabled === true) return false;
  if (mdata.portoneOneMonthPurchase === true) return true;
  return String(mdata.lastPortonePlanKey || "").trim() === "portone_1m";
}

function formatDateKst(ms) {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "long",
    day: "numeric"
  }).format(new Date(ms));
}

function computeStackedPaidUntilMs(mdata, nowMs, months) {
  const base = membershipStackBaseMs(mdata, nowMs);
  return addCalendarMonthsKst(base, Math.max(1, parseInt(String(months), 10) || 1));
}

function buildRecurringTransitionPreview(mdata, nowMs) {
  const now = Number(nowMs) || Date.now();
  const activeSingle = hasActiveSinglePeriod(mdata, now);
  const until = paidUntilMillis(mdata);
  const remainingDays = activeSingle ? remainingPaidDaysKstCeil(until, now) : 0;
  const nextBillingAtMs = computeStackedPaidUntilMs(mdata, now, 1);
  const nextBillingAtFormatted = formatDateKst(nextBillingAtMs);
  let message = "";
  if (remainingDays > 0) {
    message =
      "현재 단건 이용권이 " +
      remainingDays +
      "일 남아 있습니다. 지금 정기 구독을 시작하시면 첫 정기 요금은 오늘 결제되며, " +
      "이용 기간과 다음 자동결제일은 단건 만료일을 반영해 연장됩니다. " +
      "다음 자동결제 예정일: " +
      nextBillingAtFormatted +
      ".";
  }
  return {
    activeSingle,
    remainingDays,
    nextBillingAtMs,
    nextBillingAtFormatted,
    message
  };
}

module.exports = {
  membershipStackBaseMs,
  remainingPaidDaysKstCeil,
  hasActiveSinglePeriod,
  computeStackedPaidUntilMs,
  buildRecurringTransitionPreview
};
