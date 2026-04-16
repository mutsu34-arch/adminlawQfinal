"use strict";

/**
 * 질문권·엘리 질문권 등 배치(유효기간 있는 건수) 소비/복구
 */
function consumeOneFromBatches(batches, nowMs) {
  const sorted = batches
    .map((b, i) => ({ b, i }))
    .filter((x) => {
      const exp = x.b.expiresAt;
      const expMs = exp && typeof exp.toMillis === "function" ? exp.toMillis() : 0;
      return expMs >= nowMs && (parseInt(x.b.amount, 10) || 0) > 0;
    })
    .sort((a, b) => {
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

/** AI 오류 등으로 차감분을 복구할 때 — 1건을 새 배치로 되돌려 넣음(구매분과 동일 1년 유효) */
function pushCompensatingBatch(batches, expiresAtTs) {
  const next = Array.isArray(batches) ? batches.slice() : [];
  next.push({
    amount: 1,
    expiresAt: expiresAtTs
  });
  return next;
}

module.exports = { consumeOneFromBatches, pushCompensatingBatch };
