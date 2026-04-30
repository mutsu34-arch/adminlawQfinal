"use strict";

/**
 * PortOne V2 + PG(한국결제네트웍스 등) 일반 결제
 *
 * 환경변수 (Firebase Functions / .env):
 * - PORTONE_API_SECRET: 콘솔 결제연동에서 발급한 V2 API Secret
 * - PORTONE_STORE_ID: 스토어 ID
 * - PORTONE_CHANNEL_KEY_KPN: KPN 채널의 채널 키 (관리자 콘솔 채널관리)
 *
 * 엘리 팩 금액: PORTONE_KRW_EQ10/20/30 우선, 없으면 PAYAPP_KRW_EQ*(레거시 env명) 호환.
 * 구독권 만료일: 한국시간 달력 기준 1개월 가산(2월·31일 등 반영).
 * 1개월·정기 요금제: UI 가격과 맞춘 기본값 + PORTONE_KRW_* 오버라이드.
 *
 * @see https://help.portone.io/content/kpn
 */

const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { addCalendarMonthsKst } = require("./kstCalendar");

let _db;
function db() {
  if (!_db) _db = getFirestore();
  return _db;
}

const REGION = "asia-northeast3";

function nowTs() {
  return Date.now();
}

function expectedKrwForEllyPack(pack) {
  if (pack === 10) {
    return Math.max(
      1000,
      parseInt(process.env.PORTONE_KRW_EQ10 || process.env.PAYAPP_KRW_EQ10 || "5000", 10) || 5000
    );
  }
  if (pack === 20) {
    return Math.max(
      1000,
      parseInt(process.env.PORTONE_KRW_EQ20 || process.env.PAYAPP_KRW_EQ20 || "10000", 10) || 10000
    );
  }
  if (pack === 30) {
    return Math.max(
      1000,
      parseInt(process.env.PORTONE_KRW_EQ30 || process.env.PAYAPP_KRW_EQ30 || "15000", 10) || 15000
    );
  }
  return 0;
}

function tierFromProduct(product) {
  if (/_basic$/.test(product)) return "basic";
  if (/_super$/.test(product)) return "super";
  if (/_ultra$/.test(product)) return "ultra";
  return "basic";
}

/** UI 요금제와 동기. 필요 시 PORTONE_KRW_* 로 덮어쓸 수 있음. */
function productSpec(product) {
  const p = String(product || "").trim();
  if (p === "elly_10") {
    return {
      kind: "elly_pack",
      pack: 10,
      orderName: "행정법Q 엘리(AI) 질문권 10건",
      amount: expectedKrwForEllyPack(10),
      payMethod: "EASY_PAY",
      easyPayProvider: "KAKAOPAY"
    };
  }
  if (p === "elly_20") {
    return {
      kind: "elly_pack",
      pack: 20,
      orderName: "행정법Q 엘리(AI) 질문권 20건",
      amount: expectedKrwForEllyPack(20),
      payMethod: "EASY_PAY",
      easyPayProvider: "KAKAOPAY"
    };
  }
  if (p === "elly_30") {
    return {
      kind: "elly_pack",
      pack: 30,
      orderName: "행정법Q 엘리(AI) 질문권 30건",
      amount: expectedKrwForEllyPack(30),
      payMethod: "EASY_PAY",
      easyPayProvider: "KAKAOPAY"
    };
  }
  const oneMonth = {
    one_month_basic: Math.max(1000, parseInt(process.env.PORTONE_KRW_1M_BASIC || "12000", 10) || 12000),
    one_month_super: Math.max(1000, parseInt(process.env.PORTONE_KRW_1M_SUPER || "18000", 10) || 18000),
    one_month_ultra: Math.max(1000, parseInt(process.env.PORTONE_KRW_1M_ULTRA || "24000", 10) || 24000)
  };
  const recurring = {
    recurring_basic: Math.max(1000, parseInt(process.env.PORTONE_KRW_REC_BASIC || "10000", 10) || 10000),
    recurring_super: Math.max(1000, parseInt(process.env.PORTONE_KRW_REC_SUPER || "15000", 10) || 15000),
    recurring_ultra: Math.max(1000, parseInt(process.env.PORTONE_KRW_REC_ULTRA || "20000", 10) || 20000)
  };
  if (p === "one_month_basic") {
    return {
      kind: "sub_one_month",
      tier: "basic",
      orderName: "행정법Q 베이직 1개월 구독권",
      amount: oneMonth.one_month_basic,
      payMethod: "EASY_PAY",
      easyPayProvider: "KAKAOPAY"
    };
  }
  if (p === "one_month_super") {
    return {
      kind: "sub_one_month",
      tier: "super",
      orderName: "행정법Q 슈퍼 1개월 구독권",
      amount: oneMonth.one_month_super,
      payMethod: "EASY_PAY",
      easyPayProvider: "KAKAOPAY"
    };
  }
  if (p === "one_month_ultra") {
    return {
      kind: "sub_one_month",
      tier: "ultra",
      orderName: "행정법Q 울트라 1개월 구독권",
      amount: oneMonth.one_month_ultra,
      payMethod: "EASY_PAY",
      easyPayProvider: "KAKAOPAY"
    };
  }
  if (p === "recurring_basic") {
    return {
      kind: "sub_recurring_month",
      tier: "basic",
      orderName: "행정법Q 베이직 월 구독(첫 결제)",
      amount: recurring.recurring_basic,
      payMethod: "CARD"
    };
  }
  if (p === "recurring_super") {
    return {
      kind: "sub_recurring_month",
      tier: "super",
      orderName: "행정법Q 슈퍼 월 구독(첫 결제)",
      amount: recurring.recurring_super,
      payMethod: "CARD"
    };
  }
  if (p === "recurring_ultra") {
    return {
      kind: "sub_recurring_month",
      tier: "ultra",
      orderName: "행정법Q 울트라 월 구독(첫 결제)",
      amount: recurring.recurring_ultra,
      payMethod: "CARD"
    };
  }
  return null;
}

function assertPortoneEnv() {
  const secret = String(process.env.PORTONE_API_SECRET || "").trim();
  const storeId = String(process.env.PORTONE_STORE_ID || "").trim();
  const channelKey = String(process.env.PORTONE_CHANNEL_KEY_KPN || "").trim();
  if (!secret || !storeId || !channelKey) {
    throw new HttpsError(
      "failed-precondition",
      "PortOne 환경변수(PORTONE_API_SECRET, PORTONE_STORE_ID, PORTONE_CHANNEL_KEY_KPN)가 설정되지 않았습니다."
    );
  }
  return { secret, storeId, channelKey };
}

async function fetchPortOnePayment(secret, paymentId) {
  const url = `https://api.portone.io/payments/${encodeURIComponent(paymentId)}`;
  const res = await fetch(url, {
    method: "GET",
    headers: { Authorization: `PortOne ${secret}` }
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch (_) {
    json = null;
  }
  if (!res.ok) {
    const msg = json && (json.message || json.error) ? String(json.message || json.error) : text.slice(0, 200);
    throw new HttpsError("internal", "결제 조회에 실패했습니다: " + msg);
  }
  return json;
}

function pickBillingKey(payment) {
  if (!payment || typeof payment !== "object") return "";
  var candidates = [
    payment.billingKey,
    payment.billingKeyId,
    payment.billing_key,
    payment.method && payment.method.billingKey,
    payment.method && payment.method.billingKeyId,
    payment.method && payment.method.card && payment.method.card.billingKey,
    payment.method && payment.method.card && payment.method.card.billingKeyId,
    payment.card && payment.card.billingKey,
    payment.card && payment.card.billingKeyId
  ];
  for (var i = 0; i < candidates.length; i++) {
    var v = String(candidates[i] || "").trim();
    if (v) return v;
  }
  return "";
}

function paymentTotalAmount(payment) {
  var total =
    payment && payment.amount && typeof payment.amount.total === "number"
      ? payment.amount.total
      : payment && typeof payment.totalAmount === "number"
        ? payment.totalAmount
        : NaN;
  return total;
}

function buildRecurringPaymentId(uid) {
  const ts = Date.now().toString(36);
  const suffix = Math.random()
    .toString(36)
    .replace(/[^A-Za-z0-9]/g, "")
    .slice(2, 8);
  return `hlr${String(uid || "").replace(/[^A-Za-z0-9]/g, "").slice(0, 6)}${ts}${suffix}`;
}

async function requestPortOneRecurringPayment(secret, body, paymentId) {
  const url = `https://api.portone.io/payments/${encodeURIComponent(paymentId)}/billing-key`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `PortOne ${secret}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch (_) {
    json = null;
  }
  if (!res.ok) {
    const msg = json && (json.message || json.error) ? String(json.message || json.error) : text.slice(0, 300);
    throw new Error(msg || "billing-key 결제 요청 실패");
  }
  return json;
}

const preparePortOnePayment = onCall({ region: REGION }, async (request) => {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
  }
  const uid = request.auth.uid;
  const product = String((request.data && request.data.product) || "").trim();
  const spec = productSpec(product);
  if (!spec || !spec.amount) {
    throw new HttpsError("invalid-argument", "지원하지 않는 상품 코드입니다.");
  }
  const { storeId, channelKey } = assertPortoneEnv();

  // KPN 채널에서 주문번호 필드 길이 제한(바이트)에 걸리지 않도록 paymentId를 짧게 유지
  const ts = Date.now().toString(36);
  const suffix = Math.random()
    .toString(36)
    .replace(/[^A-Za-z0-9]/g, "")
    .slice(2, 8);
  const paymentId = `hl${ts}${suffix}`;

  const prepRef = db().collection("hanlaw_portone_prepare").doc(paymentId);
  await prepRef.set({
    uid,
    product,
    kind: spec.kind,
    amount: spec.amount,
    tier: spec.tier != null ? spec.tier : null,
    pack: spec.pack != null ? spec.pack : null,
    createdAt: FieldValue.serverTimestamp(),
    consumed: false
  });

  return {
    storeId,
    channelKey,
    paymentId,
    orderName: spec.orderName,
    totalAmount: spec.amount,
    currency: "CURRENCY_KRW",
    payMethod: spec.payMethod || "CARD",
    easyPayProvider: spec.easyPayProvider || ""
  };
});

const completePortOnePayment = onCall({ region: REGION }, async (request) => {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
  }
  const uid = request.auth.uid;
  const paymentId = String((request.data && request.data.paymentId) || "").trim();
  if (!paymentId) {
    throw new HttpsError("invalid-argument", "paymentId가 필요합니다.");
  }

  const { secret } = assertPortoneEnv();
  const prepRef = db().collection("hanlaw_portone_prepare").doc(paymentId);
  const prepSnap = await prepRef.get();
  if (!prepSnap.exists) {
    throw new HttpsError("not-found", "결제 준비 정보를 찾을 수 없습니다. 다시 시도해 주세요.");
  }
  const prep = prepSnap.data();
  if (prep.uid !== uid) {
    throw new HttpsError("permission-denied", "본인이 요청한 결제만 완료 처리할 수 있습니다.");
  }
  if (prep.consumed) {
    return { ok: true, already: true };
  }

  const paymentJson = await fetchPortOnePayment(secret, paymentId);
  const payment = paymentJson && paymentJson.payment ? paymentJson.payment : paymentJson;
  if (!payment || typeof payment !== "object") {
    throw new HttpsError("internal", "결제 정보 형식이 올바르지 않습니다.");
  }
  const status = String(payment.status || "");
  const total = paymentTotalAmount(payment);
  if (status !== "PAID") {
    throw new HttpsError("failed-precondition", "결제가 완료되지 않았습니다. 상태: " + (status || "(없음)"));
  }
  if (!Number.isFinite(total) || total !== prep.amount) {
    throw new HttpsError("failed-precondition", "결제 금액이 주문과 일치하지 않습니다.");
  }

  const dedupId = `portone_${paymentId}`;
  const dedupRef = db().collection("hanlaw_webhook_events").doc(dedupId);

  if (prep.kind === "elly_pack") {
    const amount = prep.pack;
    const walletRef = db().collection("hanlaw_quiz_ai_wallet").doc(uid);
    const purchaseMs = Date.now();
    const exp = Timestamp.fromMillis(addCalendarMonthsKst(purchaseMs, 1));

    await db().runTransaction(async (t) => {
      const dup = await t.get(dedupRef);
      if (dup.exists) return;

      const wsnap = await t.get(walletRef);
      const data = wsnap.exists ? wsnap.data() : {};
      const batches = Array.isArray(data.batches) ? data.batches.slice() : [];
      batches.push({
        amount,
        expiresAt: exp,
        purchasedAt: Timestamp.now()
      });

      t.set(dedupRef, {
        processedAt: FieldValue.serverTimestamp(),
        source: "portone",
        kind: "elly_question_pack",
        uid,
        amount,
        paymentId,
        payState: "PAID"
      });
      t.set(
        walletRef,
        {
          batches,
          updatedAt: FieldValue.serverTimestamp()
        },
        { merge: true }
      );
      t.set(prepRef, { consumed: true, consumedAt: FieldValue.serverTimestamp() }, { merge: true });
    });
  } else if (prep.kind === "sub_one_month" || prep.kind === "sub_recurring_month") {
    const tier = String(prep.tier || tierFromProduct(prep.product) || "basic").toLowerCase();
    const ellyDailyTier = tier === "super" || tier === "ultra" ? tier : "basic";
    const memRef = db().collection("hanlaw_members").doc(uid);
    const planLabel = prep.kind === "sub_recurring_month" ? "portone_recurring_1m" : "portone_1m";
    const billingKey = prep.kind === "sub_recurring_month" ? pickBillingKey(payment) : "";

    await db().runTransaction(async (t) => {
      const dup = await t.get(dedupRef);
      if (dup.exists) return;

      const msnap = await t.get(memRef);
      const mdata = msnap.exists ? msnap.data() : {};
      const now = Date.now();
      let base = now;
      if (mdata.membershipTier === "paid" && mdata.paidUntil && typeof mdata.paidUntil.toMillis === "function") {
        base = Math.max(now, mdata.paidUntil.toMillis());
      }
      const newUntilMs = addCalendarMonthsKst(base, 1);
      const newUntil = Timestamp.fromMillis(newUntilMs);

      t.set(dedupRef, {
        processedAt: FieldValue.serverTimestamp(),
        source: "portone",
        kind: prep.kind,
        uid,
        tier: ellyDailyTier,
        paymentId,
        payState: "PAID"
      });
      const memPatch = {
        membershipTier: "paid",
        paidUntil: newUntil,
        ellyDailyTier,
        updatedAt: FieldValue.serverTimestamp(),
        lastPortonePlanKey: planLabel
      };
      if (prep.kind === "sub_recurring_month") {
        memPatch.portoneAutoRenewEnabled = !!billingKey;
        memPatch.portoneRecurringTier = ellyDailyTier;
        memPatch.portoneRecurringProduct = String(prep.product || "");
        memPatch.portoneRecurringAmount = prep.amount;
        memPatch.portoneNextBillingAt = newUntil;
        memPatch.portoneRecurringStatus = billingKey ? "active" : "billing_key_missing";
        memPatch.portoneRecurringLastPaidAt = FieldValue.serverTimestamp();
        memPatch.portoneRecurringFailCount = 0;
        if (billingKey) memPatch.portoneBillingKey = billingKey;
      }
      t.set(memRef, memPatch, { merge: true });
      t.set(prepRef, { consumed: true, consumedAt: FieldValue.serverTimestamp() }, { merge: true });
    });
  } else {
    throw new HttpsError("internal", "알 수 없는 상품 유형입니다.");
  }

  return { ok: true };
});

const cancelPortOneRecurring = onCall({ region: REGION }, async (request) => {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
  }
  const uid = request.auth.uid;
  const memRef = db().collection("hanlaw_members").doc(uid);
  await memRef.set(
    {
      portoneAutoRenewEnabled: false,
      portoneRecurringStatus: "cancelled",
      portoneRecurringCancelledAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    },
    { merge: true }
  );
  return { ok: true };
});

const runPortOneRecurringBilling = onSchedule(
  {
    region: REGION,
    schedule: "every 60 minutes",
    timeZone: "Asia/Seoul"
  },
  async () => {
    const { secret, storeId, channelKey } = assertPortoneEnv();
    const now = nowTs();
    const snap = await db()
      .collection("hanlaw_members")
      .where("portoneAutoRenewEnabled", "==", true)
      .limit(200)
      .get();
    if (snap.empty) return;

    for (const doc of snap.docs) {
      const uid = doc.id;
      const m = doc.data() || {};
      const billingKey = String(m.portoneBillingKey || "").trim();
      const amount = parseInt(String(m.portoneRecurringAmount || "0"), 10) || 0;
      const tier = String(m.portoneRecurringTier || "basic").toLowerCase();
      const nextTs =
        m.portoneNextBillingAt && typeof m.portoneNextBillingAt.toMillis === "function"
          ? m.portoneNextBillingAt.toMillis()
          : 0;
      if (!billingKey || !amount || !nextTs || nextTs > now) continue;

      const paymentId = buildRecurringPaymentId(uid);
      const body = {
        storeId: storeId,
        channelKey: channelKey,
        billingKey: billingKey,
        orderName: "행정법Q 월 정기구독 자동결제",
        totalAmount: amount,
        currency: "CURRENCY_KRW",
        customer: {
          customerId: uid
        }
      };

      const memRef = db().collection("hanlaw_members").doc(uid);
      try {
        const paid = await requestPortOneRecurringPayment(secret, body, paymentId);
        const payment = paid && paid.payment ? paid.payment : paid;
        const status = String((payment && payment.status) || "");
        const total = paymentTotalAmount(payment);
        if (status !== "PAID" || !Number.isFinite(total) || total !== amount) {
          throw new Error("자동결제 승인/금액 검증 실패");
        }
        const base = now;
        const newUntil = Timestamp.fromMillis(addCalendarMonthsKst(base, 1));
        await memRef.set(
          {
            membershipTier: "paid",
            paidUntil: newUntil,
            ellyDailyTier: tier === "super" || tier === "ultra" ? tier : "basic",
            portoneNextBillingAt: newUntil,
            portoneRecurringStatus: "active",
            portoneRecurringLastPaidAt: FieldValue.serverTimestamp(),
            portoneRecurringLastPaymentId: paymentId,
            portoneRecurringFailCount: 0,
            updatedAt: FieldValue.serverTimestamp()
          },
          { merge: true }
        );
      } catch (e) {
        const failCount = (parseInt(String(m.portoneRecurringFailCount || "0"), 10) || 0) + 1;
        const patch = {
          portoneRecurringStatus: "failed",
          portoneRecurringLastError: String((e && e.message) || "자동결제 실패").slice(0, 400),
          portoneRecurringFailCount: failCount,
          portoneRecurringLastTriedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp()
        };
        if (failCount >= 3) patch.portoneAutoRenewEnabled = false;
        await memRef.set(patch, { merge: true });
      }
    }
  }
);

module.exports = {
  preparePortOnePayment,
  completePortOnePayment,
  cancelPortOneRecurring,
  runPortOneRecurringBilling
};
