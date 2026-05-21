"use strict";

const assert = require("assert");
const {
  membershipStackBaseMs,
  remainingPaidDaysKstCeil,
  hasActiveSinglePeriod,
  computeStackedPaidUntilMs
} = require("../portoneMembershipPeriod");

function fakeTs(ms) {
  return { toMillis: () => ms };
}

const MS_DAY = 86400000;
const now = Date.parse("2026-05-21T12:00:00+09:00");
const future = Date.parse("2026-05-31T23:59:59+09:00");

assert.strictEqual(remainingPaidDaysKstCeil(future, now), 11);
assert.strictEqual(remainingPaidDaysKstCeil(now, now), 0);
assert.strictEqual(remainingPaidDaysKstCeil(now - 1, now), 0);
assert.strictEqual(remainingPaidDaysKstCeil(now + MS_DAY * 0.5, now), 1);

const singleMember = {
  membershipTier: "paid",
  paidUntil: fakeTs(future),
  portoneOneMonthPurchase: true,
  portoneAutoRenewEnabled: false
};
assert.strictEqual(hasActiveSinglePeriod(singleMember, now), true);
assert.strictEqual(membershipStackBaseMs(singleMember, now), future);

const stacked = computeStackedPaidUntilMs(singleMember, now, 1);
assert.ok(stacked > future, "stacked until should be after single expiry");

const recurringAlready = {
  membershipTier: "paid",
  paidUntil: fakeTs(future),
  portoneOneMonthPurchase: true,
  portoneAutoRenewEnabled: true
};
assert.strictEqual(hasActiveSinglePeriod(recurringAlready, now), false);

console.log("portoneMembershipPeriod.test.js: ok");
