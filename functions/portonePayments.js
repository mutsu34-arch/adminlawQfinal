"use strict";

/**
 * PortOne V2 + PG(한국결제네트웍스 등) 일반 결제
 *
 * 환경변수 (Firebase Functions / .env):
 * - PORTONE_API_SECRET: 콘솔 결제연동에서 발급한 V2 API Secret
 * - PORTONE_STORE_ID: 스토어 ID
 * - PORTONE_CHANNEL_KEY_KPN_ONETIME: KPN 단건 결제 채널 키 (권장)
 * - PORTONE_CHANNEL_KEY_KPN_RECURRING: KPN 정기 결제 채널 키 (권장)
 * - PORTONE_CHANNEL_KEY_KPN: 레거시 단일 KPN 채널 키 (하위호환 fallback)
 * - PORTONE_CHANNEL_KEY_GALAXIA_ONETIME: 갤럭시아 단건 결제 채널 키 (권장)
 * - PORTONE_CHANNEL_KEY_GALAXIA_RECURRING: 갤럭시아 정기(빌링) 결제 채널 키 (권장)
 *   ※ 갤럭시아는 단건용 MID와 빌링용 MID가 다릅니다. 정기결제는 콘솔에서 빌링 MID로 연동한 채널의 키를 넣어야 합니다.
 * - PORTONE_CHANNEL_KEY_GALAXIA: 레거시 단일 갤럭시아 채널 키 (하위호환 fallback)
 * - PORTONE_CHANNEL_KEY_KAKAOPAY_ONETIME: 카카오페이 일반 결제 채널 키 (선택)
 * - PORTONE_CHANNEL_KEY_KAKAOPAY_RECURRING: 카카오페이 정기 결제 채널 키 (선택)
 * - PORTONE_CHANNEL_KEY_KAKAOPAY: 레거시 단일 카카오페이 채널 키 (하위호환 fallback)
 * - PORTONE_CHANNEL_KEY_DANAL_CARD: 다날 일반결제(신용카드) 채널 키 (선택)
 * - PORTONE_CHANNEL_KEY_DANAL_MOBILE: 다날 일반결제(휴대폰 소액결제) 채널 키 (선택)
 * - PORTONE_CHANNEL_KEY_DANAL: 레거시 단일 다날 채널 키 (하위호환 fallback)
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

const SERVICE_PERIOD_NOTE = "온라인상품·결제 완료 후 즉시 사용 가능";

function formatDateKst(ms) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(ms));
}

function formatIsoKst(ms) {
  var shifted = new Date(ms + 9 * 60 * 60 * 1000);
  var y = shifted.getUTCFullYear();
  var m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  var d = String(shifted.getUTCDate()).padStart(2, "0");
  var hh = String(shifted.getUTCHours()).padStart(2, "0");
  var mm = String(shifted.getUTCMinutes()).padStart(2, "0");
  var ss = String(shifted.getUTCSeconds()).padStart(2, "0");
  return y + "-" + m + "-" + d + "T" + hh + ":" + mm + ":" + ss + "+09:00";
}

function buildOfferPeriodRangeForProduct(spec, nowMs) {
  const fromMs = Number(nowMs || Date.now());
  let toMs = fromMs;
  if (!spec || !spec.kind) return null;
  if (spec.kind === "sub_one_month" || spec.kind === "sub_recurring_month" || spec.kind === "elly_pack") {
    toMs = addCalendarMonthsKst(fromMs, 1);
  }
  return {
    range: {
      from: formatIsoKst(fromMs),
      to: formatIsoKst(toMs)
    }
  };
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
      orderName: "행정법Q 엘리(AI) 질문권 10건 (" + SERVICE_PERIOD_NOTE + ")",
      amount: expectedKrwForEllyPack(10),
      payMethod: "CARD"
    };
  }
  if (p === "elly_20") {
    return {
      kind: "elly_pack",
      pack: 20,
      orderName: "행정법Q 엘리(AI) 질문권 20건 (" + SERVICE_PERIOD_NOTE + ")",
      amount: expectedKrwForEllyPack(20),
      payMethod: "CARD"
    };
  }
  if (p === "elly_30") {
    return {
      kind: "elly_pack",
      pack: 30,
      orderName: "행정법Q 엘리(AI) 질문권 30건 (" + SERVICE_PERIOD_NOTE + ")",
      amount: expectedKrwForEllyPack(30),
      payMethod: "CARD"
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
      orderName: "행정법Q 베이직 1개월 구독권 (" + SERVICE_PERIOD_NOTE + ")",
      amount: oneMonth.one_month_basic,
      payMethod: "CARD"
    };
  }
  if (p === "one_month_super") {
    return {
      kind: "sub_one_month",
      tier: "super",
      orderName: "행정법Q 슈퍼 1개월 구독권 (" + SERVICE_PERIOD_NOTE + ")",
      amount: oneMonth.one_month_super,
      payMethod: "CARD"
    };
  }
  if (p === "one_month_ultra") {
    return {
      kind: "sub_one_month",
      tier: "ultra",
      orderName: "행정법Q 울트라 1개월 구독권 (" + SERVICE_PERIOD_NOTE + ")",
      amount: oneMonth.one_month_ultra,
      payMethod: "CARD"
    };
  }
  if (p === "recurring_basic") {
    return {
      kind: "sub_recurring_month",
      tier: "basic",
      orderName: "행정법Q 베이직 월 구독(첫 결제, " + SERVICE_PERIOD_NOTE + ")",
      amount: recurring.recurring_basic,
      payMethod: "CARD"
    };
  }
  if (p === "recurring_super") {
    return {
      kind: "sub_recurring_month",
      tier: "super",
      orderName: "행정법Q 슈퍼 월 구독(첫 결제, " + SERVICE_PERIOD_NOTE + ")",
      amount: recurring.recurring_super,
      payMethod: "CARD"
    };
  }
  if (p === "recurring_ultra") {
    return {
      kind: "sub_recurring_month",
      tier: "ultra",
      orderName: "행정법Q 울트라 월 구독(첫 결제, " + SERVICE_PERIOD_NOTE + ")",
      amount: recurring.recurring_ultra,
      payMethod: "CARD"
    };
  }
  return null;
}

function assertPortoneEnv() {
  const secret = String(process.env.PORTONE_API_SECRET || "").trim();
  const storeId = String(process.env.PORTONE_STORE_ID || "").trim();
  const channelKeyKpn = String(process.env.PORTONE_CHANNEL_KEY_KPN || "").trim();
  const channelKeyKpnOnetime = String(process.env.PORTONE_CHANNEL_KEY_KPN_ONETIME || "").trim();
  const channelKeyKpnRecurring = String(process.env.PORTONE_CHANNEL_KEY_KPN_RECURRING || "").trim();
  const channelKeyGalaxia = String(process.env.PORTONE_CHANNEL_KEY_GALAXIA || "").trim();
  const channelKeyGalaxiaOnetime = String(process.env.PORTONE_CHANNEL_KEY_GALAXIA_ONETIME || "").trim();
  const channelKeyGalaxiaRecurring = String(process.env.PORTONE_CHANNEL_KEY_GALAXIA_RECURRING || "").trim();
  const channelKeyKakaopay = String(process.env.PORTONE_CHANNEL_KEY_KAKAOPAY || "").trim();
  const channelKeyKakaopayOnetime = String(process.env.PORTONE_CHANNEL_KEY_KAKAOPAY_ONETIME || "").trim();
  const channelKeyKakaopayRecurring = String(process.env.PORTONE_CHANNEL_KEY_KAKAOPAY_RECURRING || "").trim();
  const channelKeyDanal = String(process.env.PORTONE_CHANNEL_KEY_DANAL || "").trim();
  const channelKeyDanalCard = String(process.env.PORTONE_CHANNEL_KEY_DANAL_CARD || "").trim();
  const channelKeyDanalMobile = String(process.env.PORTONE_CHANNEL_KEY_DANAL_MOBILE || "").trim();
  const effectiveKpnOnetime = channelKeyKpnOnetime || channelKeyKpn;
  const effectiveKpnRecurring = channelKeyKpnRecurring || channelKeyKpn;
  const effectiveGalaxiaOnetime = channelKeyGalaxiaOnetime || channelKeyGalaxia;
  const effectiveGalaxiaRecurring = channelKeyGalaxiaRecurring || channelKeyGalaxia;
  const effectiveKakaopayOnetime = channelKeyKakaopayOnetime || channelKeyKakaopay;
  const effectiveKakaopayRecurring = channelKeyKakaopayRecurring || channelKeyKakaopay;
  const effectiveDanalCard = channelKeyDanalCard || channelKeyDanal;
  const effectiveDanalMobile = channelKeyDanalMobile || channelKeyDanal;
  if (!secret || !storeId || !effectiveKpnOnetime) {
    throw new HttpsError(
      "failed-precondition",
      "PortOne 환경변수(PORTONE_API_SECRET, PORTONE_STORE_ID, PORTONE_CHANNEL_KEY_KPN 또는 PORTONE_CHANNEL_KEY_KPN_ONETIME)가 설정되지 않았습니다."
    );
  }
  return {
    secret,
    storeId,
    channelKeyKpn: effectiveKpnOnetime,
    channelKeyKpnOnetime: effectiveKpnOnetime,
    channelKeyKpnRecurring: effectiveKpnRecurring,
    channelKeyGalaxia: effectiveGalaxiaOnetime,
    channelKeyGalaxiaOnetime: effectiveGalaxiaOnetime,
    channelKeyGalaxiaRecurring: effectiveGalaxiaRecurring,
    channelKeyKakaopay: effectiveKakaopayOnetime,
    channelKeyKakaopayOnetime: effectiveKakaopayOnetime,
    channelKeyKakaopayRecurring: effectiveKakaopayRecurring,
    channelKeyDanal: effectiveDanalCard,
    channelKeyDanalCard: effectiveDanalCard,
    channelKeyDanalMobile: effectiveDanalMobile
  };
}

function resolveChannelKeyByPg(pgProvider, env, options) {
  const opts = options || {};
  const isRecurring = !!opts.isRecurring;
  const picked = String(pgProvider || "kpn").trim().toLowerCase();
  if (picked === "galaxia") {
    const channelKeyGalaxia = isRecurring
      ? env.channelKeyGalaxiaRecurring || env.channelKeyGalaxiaOnetime
      : env.channelKeyGalaxiaOnetime;
    if (!channelKeyGalaxia) {
      throw new HttpsError(
        "failed-precondition",
        "갤럭시아머니트리 채널 키(PORTONE_CHANNEL_KEY_GALAXIA 또는 _ONETIME/_RECURRING)가 설정되지 않았습니다."
      );
    }
    return { channelKey: channelKeyGalaxia, pgProvider: "galaxia" };
  }
  if (picked === "kakaopay") {
    const channelKeyKakaopay = isRecurring
      ? env.channelKeyKakaopayRecurring || env.channelKeyKakaopayOnetime
      : env.channelKeyKakaopayOnetime;
    if (!channelKeyKakaopay) {
      throw new HttpsError(
        "failed-precondition",
        "카카오페이 채널 키(PORTONE_CHANNEL_KEY_KAKAOPAY 또는 _ONETIME/_RECURRING)가 설정되지 않았습니다."
      );
    }
    return { channelKey: channelKeyKakaopay, pgProvider: "kakaopay" };
  }
  if (picked === "danal") {
    const payMethod = String((opts && opts.payMethod) || "CARD").trim().toUpperCase();
    const channelKeyDanal =
      payMethod === "MOBILE"
        ? env.channelKeyDanalMobile || env.channelKeyDanalCard
        : env.channelKeyDanalCard;
    if (!channelKeyDanal) {
      throw new HttpsError(
        "failed-precondition",
        "다날 채널 키(PORTONE_CHANNEL_KEY_DANAL_CARD/_MOBILE 또는 PORTONE_CHANNEL_KEY_DANAL)가 설정되지 않았습니다."
      );
    }
    return { channelKey: channelKeyDanal, pgProvider: "danal" };
  }
  const channelKey = isRecurring ? env.channelKeyKpnRecurring || env.channelKeyKpnOnetime : env.channelKeyKpnOnetime;
  return { channelKey, pgProvider: "kpn" };
}

async function fetchPortOnePayment(secret, paymentId) {
  const url = `https://api.portone.io/payments/${encodeURIComponent(paymentId)}`;
  const maxAttempts = 5;
  const retryableStatus = { 404: true, 408: true, 409: true, 425: true, 429: true, 500: true, 502: true, 503: true, 504: true };
  let lastStatus = 0;
  let lastMsg = "";
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `PortOne ${secret}` }
    });
    lastStatus = Number(res.status || 0);
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch (_) {
      json = null;
    }
    if (res.ok) return json;
    const msg = json && (json.message || json.error) ? String(json.message || json.error) : text.slice(0, 200);
    lastMsg = msg;
    const canRetry = !!retryableStatus[lastStatus] && attempt < maxAttempts;
    if (!canRetry) {
      throw new HttpsError("internal", `결제 조회에 실패했습니다(${lastStatus || "unknown"}): ${msg}`);
    }
    const waitMs = attempt * 450;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
  throw new HttpsError(
    "internal",
    `결제 조회에 실패했습니다(${lastStatus || "unknown"}): ${lastMsg || "알 수 없는 오류"}`
  );
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
  var rawTotal =
    payment && payment.amount && payment.amount.total != null
      ? payment.amount.total
      : payment && payment.totalAmount != null
        ? payment.totalAmount
        : NaN;
  var parsed = Number(rawTotal);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function buildRecurringPaymentId(uid) {
  const ts = Date.now().toString(36);
  const suffix = Math.random()
    .toString(36)
    .replace(/[^A-Za-z0-9]/g, "")
    .slice(2, 8);
  return `hlr${String(uid || "").replace(/[^A-Za-z0-9]/g, "").slice(0, 6)}${ts}${suffix}`;
}

function galaxiaItemCodeForProduct(product, options) {
  const p = String(product || "").trim();
  const opts = options && typeof options === "object" ? options : {};
  const isRecurring = !!opts.isRecurring;
  const recurringOverride = String(process.env.PORTONE_GALAXIA_ITEM_CODE_RECURRING || "").trim();
  const onetimeOverride = String(process.env.PORTONE_GALAXIA_ITEM_CODE || "").trim();
  if (isRecurring && recurringOverride) return recurringOverride.slice(0, 10);
  if (!isRecurring && onetimeOverride) return onetimeOverride.slice(0, 10);
  const map = {
    one_month_basic: "OMBASIC01",
    one_month_super: "OMSUPER01",
    one_month_ultra: "OMULTRA01",
    recurring_basic: "OMBASIC01",
    recurring_super: "OMSUPER01",
    recurring_ultra: "OMULTRA01",
    elly_10: "ELLY010",
    elly_20: "ELLY020",
    elly_30: "ELLY030"
  };
  return (map[p] || "HANLAWQ01").slice(0, 10);
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

function safeCustomerNameFromAuth(auth) {
  const token = auth && auth.token ? auth.token : {};
  const name =
    (token && (token.name || token.displayName)) ||
    "";
  if (name && String(name).trim()) return String(name).trim().slice(0, 40);
  const email = token && token.email ? String(token.email) : "";
  if (email && email.includes("@")) return email.split("@")[0].slice(0, 40);
  return "행정법Q 회원";
}

function safeCustomerForKpnBillingKeyPay(auth, uid) {
  // KPN billing-key 결제 요청은 customer: { id, phoneNumber, email } 형태 예시가 존재합니다.
  // 여기서는 auth 토큰에 이메일/이름이 있으면 넣고, 없으면 최소 필드(id)만 보냅니다.
  const token = auth && auth.token ? auth.token : {};
  const email = token && token.email ? String(token.email).trim() : "";
  const fullName = safeCustomerNameFromAuth(auth);

  const customer = { id: String(uid || "").trim() };
  if (email) customer.email = email;
  if (fullName) customer.name = { full: fullName };
  return customer;
}

async function finalizePortOnePaymentById(paymentId, options) {
  const opts = options || {};
  const uidGuard = String(opts.uidGuard || "").trim();
  const dedupSource = String(opts.dedupSource || "portone").trim() || "portone";
  const { secret } = assertPortoneEnv();
  const prepRef = db().collection("hanlaw_portone_prepare").doc(paymentId);
  const prepSnap = await prepRef.get();
  if (!prepSnap.exists) {
    throw new HttpsError("not-found", "결제 준비 정보를 찾을 수 없습니다. 다시 시도해 주세요.");
  }
  const prep = prepSnap.data() || {};
  if (uidGuard && prep.uid !== uidGuard) {
    throw new HttpsError("permission-denied", "본인이 요청한 결제만 완료 처리할 수 있습니다.");
  }
  if (prep.consumed) {
    return { ok: true, already: true, paymentId };
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

  const dedupId = `${dedupSource}_${paymentId}`;
  const dedupRef = db().collection("hanlaw_webhook_events").doc(dedupId);

  if (prep.kind === "elly_pack") {
    const amount = prep.pack;
    const walletRef = db().collection("hanlaw_quiz_ai_wallet").doc(prep.uid);
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
        purchasedAt: Timestamp.now(),
        batchSource: "purchase"
      });

      t.set(dedupRef, {
        processedAt: FieldValue.serverTimestamp(),
        source: dedupSource,
        kind: "elly_question_pack",
        uid: prep.uid,
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
    const memRef = db().collection("hanlaw_members").doc(prep.uid);
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
        source: dedupSource,
        kind: prep.kind,
        uid: prep.uid,
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

  return { ok: true, paymentId };
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
  const env = assertPortoneEnv();
  const pgProvider = String((request.data && request.data.pgProvider) || "kpn")
    .trim()
    .toLowerCase();
  const resolved = resolveChannelKeyByPg(pgProvider, env, {
    isRecurring: spec.kind === "sub_recurring_month",
    payMethod: (request.data && request.data.payMethod) || spec.payMethod || "CARD"
  });
  const storeId = env.storeId;
  const channelKey = resolved.channelKey;

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
    pgProvider: resolved.pgProvider,
    createdAt: FieldValue.serverTimestamp(),
    consumed: false
  });

  const offerPeriod = buildOfferPeriodRangeForProduct(spec, Date.now());
  const customerId = uid.slice(0, 20);
  const customer =
    resolved.pgProvider === "galaxia"
      ? {
          customerId: customerId
        }
      : {
          customerId: customerId,
          fullName: safeCustomerNameFromAuth(request.auth)
        };
  const bypass =
    resolved.pgProvider === "galaxia"
      ? {
          galaxia: {
            ITEM_CODE: galaxiaItemCodeForProduct(product)
          }
        }
      : null;
  const resolvedPayMethod =
    resolved.pgProvider === "kakaopay"
      ? "EASY_PAY"
      : resolved.pgProvider === "danal"
        ? String((request.data && request.data.payMethod) || spec.payMethod || "CARD")
            .trim()
            .toUpperCase() === "MOBILE"
          ? "MOBILE"
          : "CARD"
        : spec.payMethod || "CARD";
  const resolvedEasyPayProvider = resolved.pgProvider === "kakaopay" ? "KAKAOPAY" : "";

  return {
    storeId,
    channelKey,
    pgProvider: resolved.pgProvider,
    paymentId,
    orderName: spec.orderName,
    totalAmount: spec.amount,
    currency: "CURRENCY_KRW",
    payMethod: resolvedPayMethod,
    easyPayProvider: resolvedEasyPayProvider,
    offerPeriod: offerPeriod,
    customer: customer,
    bypass: bypass
  };
});

const preparePortOneRecurringBillingKey = onCall({ region: REGION }, async (request) => {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
  }
  const uid = request.auth.uid;
  const product = String((request.data && request.data.product) || "").trim();
  const pgProvider = String((request.data && request.data.pgProvider) || "kpn")
    .trim()
    .toLowerCase();
  const spec = productSpec(product);
  if (!spec || !spec.amount || spec.kind !== "sub_recurring_month") {
    throw new HttpsError("invalid-argument", "정기 구독 상품 코드가 아닙니다.");
  }

  const env = assertPortoneEnv();
  if (pgProvider === "danal") {
    throw new HttpsError(
      "failed-precondition",
      "다날은 현재 정기결제(빌링키 발급)를 지원하지 않습니다. 단건 결제를 이용해 주세요."
    );
  }
  const resolved = resolveChannelKeyByPg(pgProvider, env, { isRecurring: true });
  const storeId = env.storeId;
  const channelKey = resolved.channelKey;

  const intentId = `rci${Date.now().toString(36)}${Math.random().toString(36).replace(/[^A-Za-z0-9]/g, "").slice(2, 8)}`;
  const intentRef = db().collection("hanlaw_portone_recurring_intents").doc(intentId);
  await intentRef.set({
    uid,
    product,
    kind: spec.kind,
    tier: spec.tier || null,
    amount: spec.amount,
    createdAt: FieldValue.serverTimestamp(),
    consumed: false
  });

  const offerPeriod = buildOfferPeriodRangeForProduct(spec, Date.now());
  const customerId = uid.slice(0, 20);
  const fullName = safeCustomerNameFromAuth(request.auth);
  const bypass =
    resolved.pgProvider === "galaxia"
      ? {
          galaxia: {
            ITEM_CODE: galaxiaItemCodeForProduct(product, { isRecurring: true })
          }
        }
      : null;
  const billingKeyMethod =
    resolved.pgProvider === "kakaopay"
      ? "EASY_PAY"
      : String((request.data && request.data.payMethod) || "CARD").trim().toUpperCase() === "MOBILE"
        ? "MOBILE"
        : "CARD";
  const easyPayProvider = resolved.pgProvider === "kakaopay" ? "KAKAOPAY" : "";
  const issueName = String(spec.orderName || "정기결제 카드 등록")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40);

  return {
    intentId,
    storeId,
    channelKey,
    pgProvider: resolved.pgProvider,
    billingKeyMethod: billingKeyMethod,
    easyPayProvider: easyPayProvider,
    issueId: intentId,
    issueName: issueName,
    displayAmount: spec.amount,
    currency: "KRW",
    customer:
      resolved.pgProvider === "galaxia"
        ? {
            customerId: customerId
          }
        : {
            customerId: customerId,
            fullName: fullName
          },
    offerPeriod: offerPeriod,
    bypass: bypass
  };
});

const completePortOneRecurringFirstPayment = onCall({ region: REGION }, async (request) => {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
  }
  const uid = request.auth.uid;
  const intentId = String((request.data && request.data.intentId) || "").trim();
  const billingKey = String((request.data && request.data.billingKey) || "").trim();
  if (!intentId || !billingKey) {
    throw new HttpsError("invalid-argument", "intentId와 billingKey가 필요합니다.");
  }

  const intentRef = db().collection("hanlaw_portone_recurring_intents").doc(intentId);
  const intentSnap = await intentRef.get();
  if (!intentSnap.exists) {
    throw new HttpsError("not-found", "정기결제 준비 정보를 찾을 수 없습니다. 다시 시도해 주세요.");
  }
  const intent = intentSnap.data() || {};
  if (intent.uid !== uid) {
    throw new HttpsError("permission-denied", "본인이 요청한 정기결제만 처리할 수 있습니다.");
  }
  if (intent.consumed) return { ok: true, already: true };

  const env = assertPortoneEnv();
  const { secret } = env;

  const paymentId = buildRecurringPaymentId(uid);
  const orderName = "행정법Q 월 구독(정기, 첫 결제) (" + SERVICE_PERIOD_NOTE + ")";
  const body = {
    billingKey,
    orderName,
    customer: safeCustomerForKpnBillingKeyPay(request.auth, uid),
    amount: { total: intent.amount },
    currency: "KRW",
  };

  let paidJson;
  try {
    paidJson = await requestPortOneRecurringPayment(secret, body, paymentId);
  } catch (e) {
    throw new HttpsError("internal", String((e && e.message) || "첫 결제 승인에 실패했습니다."));
  }
  // billing-key 결제 응답 본문 스키마는 PG/시점에 따라 변동될 수 있어,
  // 반드시 결제 단건조회로 상태/금액을 재검증합니다.
  const fetched = await fetchPortOnePayment(secret, paymentId);
  const payment = fetched && fetched.payment ? fetched.payment : fetched;
  const status = String((payment && payment.status) || "");
  const total = paymentTotalAmount(payment);
  console.log("[PortOne recurring first pay] result", {
    paymentId,
    status,
    total,
    expectedAmount: intent.amount,
    hasPaymentObject: !!(paidJson && paidJson.payment)
  });
  if (status !== "PAID" || !Number.isFinite(total) || total !== intent.amount) {
    console.warn("[PortOne recurring first pay] verification failed", {
      paymentId,
      status,
      total,
      expectedAmount: intent.amount,
      responseKeys: paidJson && typeof paidJson === "object" ? Object.keys(paidJson).slice(0, 20) : [],
      fetchedKeys: fetched && typeof fetched === "object" ? Object.keys(fetched).slice(0, 20) : []
    });
    throw new HttpsError("failed-precondition", "결제 승인/금액 검증에 실패했습니다.");
  }

  const tier = String(intent.tier || tierFromProduct(intent.product) || "basic").toLowerCase();
  const ellyDailyTier = tier === "super" || tier === "ultra" ? tier : "basic";
  const memRef = db().collection("hanlaw_members").doc(uid);
  const now = Date.now();
  const newUntil = Timestamp.fromMillis(addCalendarMonthsKst(now, 1));

  await db().runTransaction(async (t) => {
    const isnap = await t.get(intentRef);
    const idata = isnap.exists ? isnap.data() : null;
    if (!idata || idata.consumed) return;

    t.set(
      memRef,
      {
        membershipTier: "paid",
        paidUntil: newUntil,
        ellyDailyTier,
        updatedAt: FieldValue.serverTimestamp(),
        lastPortonePlanKey: "portone_recurring_1m",
        portoneAutoRenewEnabled: true,
        portoneRecurringTier: ellyDailyTier,
        portoneRecurringProduct: String(intent.product || ""),
        portoneRecurringAmount: intent.amount,
        portoneNextBillingAt: newUntil,
        portoneRecurringStatus: "active",
        portoneRecurringLastPaidAt: FieldValue.serverTimestamp(),
        portoneRecurringLastPaymentId: paymentId,
        portoneRecurringFailCount: 0,
        portoneBillingKey: billingKey
      },
      { merge: true }
    );
    t.set(intentRef, { consumed: true, consumedAt: FieldValue.serverTimestamp(), paymentId }, { merge: true });
  });

  return { ok: true };
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

  return await finalizePortOnePaymentById(paymentId, { uidGuard: uid, dedupSource: "portone" });
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
    const { secret } = assertPortoneEnv();
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
        billingKey: billingKey,
        orderName: "행정법Q 월 정기구독 자동결제 (" + SERVICE_PERIOD_NOTE + ")",
        customer: {
          id: uid
        },
        amount: { total: amount },
        currency: "KRW",
      };

      const memRef = db().collection("hanlaw_members").doc(uid);
      try {
        await requestPortOneRecurringPayment(secret, body, paymentId);
        const fetched = await fetchPortOnePayment(secret, paymentId);
        const payment = fetched && fetched.payment ? fetched.payment : fetched;
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
  preparePortOneRecurringBillingKey,
  completePortOneRecurringFirstPayment,
  completePortOnePayment,
  cancelPortOneRecurring,
  runPortOneRecurringBilling,
  finalizePortOnePaymentById
};
