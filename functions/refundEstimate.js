"use strict";

const { getFirestore } = require("firebase-admin/firestore");
const {
  addCalendarMonthsKst,
  subtractCalendarMonthsKst,
  daysInclusiveKst,
  formatDateKstShort
} = require("./kstCalendar");

function tierFromProductKey(product) {
  const p = String(product || "");
  if (/_basic/.test(p)) return "basic";
  if (/_super/.test(p)) return "super";
  if (/_ultra/.test(p)) return "ultra";
  return "basic";
}

function oneMonthListPriceKrwByTier(tier) {
  const t = String(tier || "basic").toLowerCase();
  if (t === "super") {
    return Math.max(1000, parseInt(process.env.PORTONE_KRW_1M_SUPER || "18000", 10) || 18000);
  }
  if (t === "ultra") {
    return Math.max(1000, parseInt(process.env.PORTONE_KRW_1M_ULTRA || "24000", 10) || 24000);
  }
  return Math.max(1000, parseInt(process.env.PORTONE_KRW_1M_BASIC || "12000", 10) || 12000);
}

function oneMonthPaidAmountKrw(product) {
  return oneMonthListPriceKrwByTier(tierFromProductKey(product));
}

function recurringPaidAmountKrw(product, fallback) {
  const p = String(product || "");
  if (p === "recurring_super") {
    return Math.max(1000, parseInt(process.env.PORTONE_KRW_REC_SUPER || "15000", 10) || 15000);
  }
  if (p === "recurring_ultra") {
    return Math.max(1000, parseInt(process.env.PORTONE_KRW_REC_ULTRA || "20000", 10) || 20000);
  }
  if (p === "recurring_basic") {
    return Math.max(1000, parseInt(process.env.PORTONE_KRW_REC_BASIC || "10000", 10) || 10000);
  }
  const fb = parseInt(String(fallback || "0"), 10) || 0;
  return fb > 0 ? fb : oneMonthListPriceKrwByTier("basic");
}

function computeRefundLine(input) {
  const paymentAmount = Math.max(0, parseInt(String(input.paymentAmountKrw || "0"), 10) || 0);
  const listPrice = Math.max(0, parseInt(String(input.oneMonthListPriceKrw || "0"), 10) || 0);
  const periodStartMs = Number(input.periodStartMs || 0);
  const periodEndMs = Number(input.periodEndMs || 0);
  const asOfMs = Number(input.asOfMs || Date.now());
  if (!paymentAmount || !listPrice || !periodStartMs || !periodEndMs || periodEndMs <= periodStartMs) {
    return null;
  }

  const totalDays = daysInclusiveKst(periodStartMs, periodEndMs);
  const usedEndMs = Math.min(asOfMs, periodEndMs);
  const usedDays = daysInclusiveKst(periodStartMs, usedEndMs);
  const dailyRateKrw = Math.floor(listPrice / totalDays);
  const usageChargeKrw = usedDays * dailyRateKrw;
  const penaltyKrw = Math.floor(paymentAmount * 0.1);
  const refundKrw = Math.max(0, paymentAmount - usageChargeKrw - penaltyKrw);

  return {
    label: String(input.label || "구독권"),
    paymentAmountKrw: paymentAmount,
    oneMonthListPriceKrw: listPrice,
    periodStartMs,
    periodEndMs,
    periodStartLabel: formatDateKstShort(periodStartMs),
    periodEndLabel: formatDateKstShort(periodEndMs),
    totalDays,
    usedDays,
    dailyRateKrw,
    usageChargeKrw,
    penaltyKrw,
    refundKrw,
    formulaSummary:
      "환불 ≈ 결제 " +
      paymentAmount.toLocaleString("ko-KR") +
      "원 − (이용 " +
      usedDays +
      "일 × 일 " +
      dailyRateKrw.toLocaleString("ko-KR") +
      "원) − 위약금 " +
      penaltyKrw.toLocaleString("ko-KR") +
      "원 = " +
      refundKrw.toLocaleString("ko-KR") +
      "원",
    policyNote:
      "일일 이용료 = 1개월 구독권 정가(" +
      listPrice.toLocaleString("ko-KR") +
      "원) ÷ 이용기간 " +
      totalDays +
      "일. 위약금 = 결제금액의 10%."
  };
}

function looksLikeRefundIntent(text) {
  const s = String(text || "").toLowerCase();
  return /환불|환급|청약\s*철회|결제\s*취소|취소\s*요청|돈\s*돌려|refund/.test(s);
}

/**
 * @param {object} m hanlaw_members 문서
 * @param {number} [asOfMs]
 */
function buildRefundEstimatesFromMember(m, asOfMs) {
  const asOf = Number(asOfMs || Date.now());
  const estimates = [];
  if (!m || typeof m !== "object") {
    return { estimates, membershipSummary: null };
  }

  const paidUntilMs =
    m.paidUntil && typeof m.paidUntil.toMillis === "function" ? m.paidUntil.toMillis() : 0;
  const recPaidAtMs =
    m.portoneRecurringLastPaidAt && typeof m.portoneRecurringLastPaidAt.toMillis === "function"
      ? m.portoneRecurringLastPaidAt.toMillis()
      : 0;
  const recProduct = String(m.portoneRecurringProduct || "").trim();
  const recAmount = parseInt(String(m.portoneRecurringAmount || "0"), 10) || 0;
  const lastProduct = String(m.lastPortoneProduct || "").trim();
  const nextBillingMs =
    m.portoneNextBillingAt && typeof m.portoneNextBillingAt.toMillis === "function"
      ? m.portoneNextBillingAt.toMillis()
      : 0;

  if (recPaidAtMs > 0 && recAmount > 0 && (recProduct || recAmount)) {
    const tier = tierFromProductKey(recProduct || lastProduct);
    const listPrice = oneMonthListPriceKrwByTier(tier);
    const periodEndMs = paidUntilMs > recPaidAtMs ? paidUntilMs : addCalendarMonthsKst(recPaidAtMs, 1);
    const line = computeRefundLine({
      label: "정기 구독 최근 회차(" + (recProduct || "정기") + ")",
      paymentAmountKrw: recAmount,
      oneMonthListPriceKrw: listPrice,
      periodStartMs: recPaidAtMs,
      periodEndMs,
      asOfMs: asOf
    });
    if (line) estimates.push(line);
  }

  if (m.portoneOneMonthPurchase === true && /^one_month_/.test(lastProduct)) {
    const tier = tierFromProductKey(lastProduct);
    const listPrice = oneMonthListPriceKrwByTier(tier);
    const paymentAmount = oneMonthPaidAmountKrw(lastProduct);
    let periodEndMs = paidUntilMs;
    if (recPaidAtMs > 0 && paidUntilMs > recPaidAtMs) {
      periodEndMs = subtractCalendarMonthsKst(paidUntilMs, 1);
      if (periodEndMs < recPaidAtMs) periodEndMs = recPaidAtMs;
    }
    const periodStartMs = subtractCalendarMonthsKst(periodEndMs, 1);
    const line = computeRefundLine({
      label: "1개월 구독권(" + lastProduct + ")",
      paymentAmountKrw: paymentAmount,
      oneMonthListPriceKrw: listPrice,
      periodStartMs,
      periodEndMs,
      asOfMs: asOf
    });
    if (line) estimates.push(line);
  }

  const membershipSummary = {
    membershipTier: String(m.membershipTier || ""),
    paidUntilLabel: paidUntilMs ? formatDateKstShort(paidUntilMs) : null,
    portoneOneMonthPurchase: m.portoneOneMonthPurchase === true,
    portoneAutoRenewEnabled: m.portoneAutoRenewEnabled === true,
    lastPortoneProduct: lastProduct || null,
    portoneRecurringProduct: recProduct || null,
    nextBillingLabel: nextBillingMs ? formatDateKstShort(nextBillingMs) : null,
    recurringLastPaidLabel: recPaidAtMs ? formatDateKstShort(recPaidAtMs) : null
  };

  return { estimates, membershipSummary };
}

function formatEstimatesForAi(estimates, membershipSummary, opts) {
  const o = opts || {};
  const lines = [];
  lines.push("=== 행정법Q 환불 산정(시스템 추정, 최종은 운영 검토·환불정책 적용) ===");
  lines.push("기준: 환불정책 — 일일이용료=1개월 구독권 정가÷이용기간일수, 위약금=결제금액 10%, 0원 미만은 0원.");
  if (membershipSummary) {
    lines.push(
      "회원 상태: tier=" +
        (membershipSummary.membershipTier || "-") +
        ", 이용만료=" +
        (membershipSummary.paidUntilLabel || "-") +
        ", 단건구매=" +
        (membershipSummary.portoneOneMonthPurchase ? "Y" : "N") +
        ", 정기자동=" +
        (membershipSummary.portoneAutoRenewEnabled ? "Y" : "N") +
        ", 다음자동결제=" +
        (membershipSummary.nextBillingLabel || "-")
    );
  }
  if (!estimates || !estimates.length) {
    lines.push("자동 산정 가능한 결제 건이 없습니다. 결제일·금액·상품명을 알려 달라고 안내하세요.");
    return lines.join("\n");
  }
  estimates.forEach(function (e, i) {
    lines.push("");
    lines.push("[" + (i + 1) + "] " + e.label);
    lines.push("  이용기간: " + e.periodStartLabel + " ~ " + e.periodEndLabel + " (총 " + e.totalDays + "일)");
    lines.push("  결제금액: " + e.paymentAmountKrw.toLocaleString("ko-KR") + "원");
    lines.push("  1개월권 정가(일할 기준): " + e.oneMonthListPriceKrw.toLocaleString("ko-KR") + "원");
    lines.push("  이용일수(신청일 포함): " + e.usedDays + "일 / 일일 " + e.dailyRateKrw.toLocaleString("ko-KR") + "원");
    lines.push("  " + e.formulaSummary);
  });
  if (o.disclaimer !== false) {
    lines.push("");
    lines.push(
      "※ 추정치입니다. 실제 환불액·7일 이내 전액 여부·이용 여부(해설 열람 등)는 운영팀 확인 후 확정됩니다."
    );
  }
  return lines.join("\n");
}

async function loadRefundEstimatesForUid(uid, asOfMs) {
  const id = String(uid || "").trim();
  if (!id) return { ok: false, reason: "no_uid", estimates: [], membershipSummary: null };
  const snap = await getFirestore().collection("hanlaw_members").doc(id).get();
  if (!snap.exists) {
    return { ok: false, reason: "no_member", estimates: [], membershipSummary: null };
  }
  const built = buildRefundEstimatesFromMember(snap.data() || {}, asOfMs);
  return {
    ok: true,
    estimates: built.estimates,
    membershipSummary: built.membershipSummary,
    aiContext: formatEstimatesForAi(built.estimates, built.membershipSummary)
  };
}

module.exports = {
  looksLikeRefundIntent,
  buildRefundEstimatesFromMember,
  computeRefundLine,
  formatEstimatesForAi,
  loadRefundEstimatesForUid,
  tierFromProductKey,
  oneMonthListPriceKrwByTier
};
