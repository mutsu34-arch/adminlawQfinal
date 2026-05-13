"use strict";

/**
 * 질문권·엘리 질문권 등 배치(유효기간 있는 건수) 소비/복구
 *
 * 소진 순서: 구독 일일 한도는 호출부(reserveEllySlot)에서 먼저 소모.
 * 지갑 배치끼리는 유료 구매(purchase)를 가장 나중에 두고, 같은 티어 안에서는 만료가 빠른 배치부터 차감.
 * (포인트 전환·보정·레거시 등 비구매분이 구매분보다 먼저 소진)
 */
function batchPurchaseTier(b) {
  const src = String((b && (b.batchSource || b.ellyBatchSource)) || "").toLowerCase();
  if (src === "purchase") return 1;
  return 0;
}

function consumeOneFromBatches(batches, nowMs) {
  const sorted = batches
    .map((b, i) => ({ b, i }))
    .filter((x) => {
      const exp = x.b.expiresAt;
      const expMs = exp && typeof exp.toMillis === "function" ? exp.toMillis() : 0;
      return expMs >= nowMs && (parseInt(x.b.amount, 10) || 0) > 0;
    })
    .sort((a, b) => {
      const ta = batchPurchaseTier(a.b);
      const tb = batchPurchaseTier(b.b);
      if (ta !== tb) return ta - tb;
      const am = a.b.expiresAt.toMillis();
      const bm = b.b.expiresAt.toMillis();
      return am - bm;
    });

  if (!sorted.length) return null;

  const first = sorted[0].b;
  const idx = batches.indexOf(first);
  if (idx < 0) return null;

  const amt = parseInt(first.amount, 10) || 0;
  const next = batches.slice();
  if (amt <= 1) {
    next.splice(idx, 1);
  } else {
    next[idx] = Object.assign({}, first, { amount: amt - 1 });
  }
  return next;
}

/** AI 오류 등으로 차감분을 복구할 때 — 1건을 새 배치로 되돌려 넣음(구매분과 동일 1개월 유효) */
function pushCompensatingBatch(batches, expiresAtTs) {
  const next = Array.isArray(batches) ? batches.slice() : [];
  next.push({
    amount: 1,
    expiresAt: expiresAtTs,
    batchSource: "compensation"
  });
  return next;
}

module.exports = { consumeOneFromBatches, pushCompensatingBatch };
