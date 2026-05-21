"use strict";

const assert = require("assert");
const { computeRefundLine, buildRefundEstimatesFromMember } = require("../refundEstimate");
const { daysInclusiveKst } = require("../kstCalendar");

const start = Date.parse("2026-05-01T10:00:00+09:00");
const end = Date.parse("2026-06-01T10:00:00+09:00");
const mid = Date.parse("2026-05-16T12:00:00+09:00");

const line = computeRefundLine({
  label: "test",
  paymentAmountKrw: 12000,
  oneMonthListPriceKrw: 12000,
  periodStartMs: start,
  periodEndMs: end,
  asOfMs: mid
});

assert.ok(line);
assert.strictEqual(line.totalDays, daysInclusiveKst(start, end));
assert.ok(line.usedDays >= 16);
assert.ok(line.refundKrw >= 0 && line.refundKrw < 12000);

const m = {
  membershipTier: "paid",
  paidUntil: { toMillis: () => Date.parse("2026-07-01T10:00:00+09:00") },
  portoneOneMonthPurchase: true,
  lastPortoneProduct: "one_month_basic",
  portoneRecurringLastPaidAt: { toMillis: () => Date.parse("2026-05-16T10:00:00+09:00") },
  portoneRecurringAmount: 10000,
  portoneRecurringProduct: "recurring_basic",
  portoneAutoRenewEnabled: true
};
const built = buildRefundEstimatesFromMember(m, mid);
assert.ok(built.estimates.length >= 2);

console.log("refundEstimate.test.js: ok");
