"use strict";
/**
 * 환경 구성 (Firebase Functions 환경변수 / Secret)
 * - CREEM_WEBHOOK_SECRET : Creem 대시보드 Webhook 시크릿 (서명 검증)
 * - CREEM_Q1_PRODUCT_IDS : 쉼표 구분 Creem 상품 ID (메타데이터 없이 1건 팩 인식, 표시 가격 $2 USD)
 * - CREEM_Q10_PRODUCT_IDS : 10건 팩 상품 ID 목록 (표시 가격 $10 USD)
 *
 * 페이앱(PayApp): PAYAPP_USERID, PAYAPP_LINK_KEY, PAYAPP_LINK_VALUE
 * 질문권 PAYAPP_KRW_Q1, PAYAPP_KRW_Q10 · 구독 PAYAPP_KRW_SUB_MONTHLY/YEARLY/TWO_YEAR
 * getPayAppQuestionPackCheckout, getPayAppSubscriptionCheckout, payappQuestionFeedback
 *
 * 출석 포인트→질문권: convertAttendancePointsToQuestionCredit (대시보드 버튼)
 * 배포: 프로젝트 루트에서 firebase deploy --only functions,firestore:rules
 * 웹훅 URL: creemQuestionWebhook 의 HTTPS URL을 Creem에 등록
 *
 * 사전·퀴즈 AI: GEMINI_API_KEY, 선택 GEMINI_MODEL (기본 gemini-1.5-flash-latest)
 * 퀴즈 AI: quizAskGemini — 한국시간 기준 1일 4회 (hanlaw_quiz_ai_usage)
 * 자료실 RAG: GEMINI_API_KEY, PINECONE_API_KEY, PINECONE_INDEX_NAME, 선택 PINECONE_HOST, PINECONE_NAMESPACE, GEMINI_EMBED_MODEL, GEMINI_EMBED_DIM
 * Storage PDF 트리거 버킷: HANLAW_STORAGE_BUCKET (기본값은 firebase-config storageBucket 과 동일하게 libraryPipeline 에 설정)
 * 관리자 이메일: ADMIN_EMAILS (쉼표 구분, createLibraryDocument 등)
 * 닉네임: setUserNickname — Firestore hanlaw_user_profiles (클라이언트 직접 쓰기 불가, AI·티켓 호칭용)
 */

const crypto = require("crypto");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const functionsV1 = require("firebase-functions/v1");

initializeApp();
const db = getFirestore();

const { generateOrGetDictionaryEntry } = require("./dictionaryGemini");
exports.generateOrGetDictionaryEntry = generateOrGetDictionaryEntry;

const { quizAskGemini } = require("./quizAiGemini");
exports.quizAskGemini = quizAskGemini;

const { setUserNickname } = require("./userProfileServer");
exports.setUserNickname = setUserNickname;

const {
  createLibraryDocument,
  deleteLibraryDocument,
  onLibraryPdfUploaded
} = require("./libraryPipeline");
exports.createLibraryDocument = createLibraryDocument;
exports.deleteLibraryDocument = deleteLibraryDocument;
exports.onLibraryPdfUploaded = onLibraryPdfUploaded;

const {
  getPayAppQuestionPackCheckout,
  getPayAppSubscriptionCheckout,
  payappQuestionFeedback
} = require("./payappPayments");
exports.getPayAppQuestionPackCheckout = getPayAppQuestionPackCheckout;
exports.getPayAppSubscriptionCheckout = getPayAppSubscriptionCheckout;
exports.payappQuestionFeedback = payappQuestionFeedback;

const MONTHLY_FREE_FOR_PAID = 4;
const BATCH_VALID_MS = 365 * 24 * 60 * 60 * 1000;

/** 한국시간 기준 하루 1회, 퀴즈 1문제 이상 풀이 시 지급되는 출석 포인트 */
const ATTENDANCE_POINTS_PER_DAY = 100;
/** 출석 포인트를 질문권 1건으로 바꿀 때 차감하는 점수(수동 전환, convertAttendancePointsToQuestionCredit) */
const ATTENDANCE_POINTS_PER_CREDIT = 3000;
/** 앱 홍보 인증(관리자 승인 시) 지급 포인트 */
const PROMOTION_REWARD_POINTS = 9000;

function kstYmd(now = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  return fmt.format(now);
}

function kstYearMonth(now = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit"
  });
  const parts = fmt.formatToParts(now);
  const y = parts.find((p) => p.type === "year").value;
  const m = parts.find((p) => p.type === "month").value;
  return y + "-" + m;
}

function isPaidMember(data) {
  if (!data || data.membershipTier !== "paid") return false;
  const u = data.paidUntil;
  if (u && typeof u.toMillis === "function" && u.toMillis() < Date.now()) return false;
  return true;
}

function isAdminEmailFromAuth(auth) {
  const email = auth && auth.token && auth.token.email ? String(auth.token.email).toLowerCase() : "";
  if (!email) return false;
  const raw = process.env.ADMIN_EMAILS || "mutsu34@gmail.com";
  const admins = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return admins.includes(email);
}

function normalizeWallet(data, periodKey) {
  const w = data || {};
  let monthlyUsed = w.monthlyUsed || 0;
  let batches = Array.isArray(w.batches) ? w.batches.slice() : [];
  if (w.monthlyPeriodKey !== periodKey) {
    monthlyUsed = 0;
  }
  return {
    monthlyPeriodKey: periodKey,
    monthlyUsed,
    batches
  };
}

function sumPurchasedCredits(batches, nowMs) {
  let n = 0;
  for (const b of batches) {
    const exp = b.expiresAt;
    const expMs = exp && typeof exp.toMillis === "function" ? exp.toMillis() : 0;
    if (expMs < nowMs) continue;
    n += Math.max(0, parseInt(b.amount, 10) || 0);
  }
  return n;
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

exports.consumeQuestionCredit = onCall(
  { region: "asia-northeast3" },
  async (request) => {
    if (!request.auth || !request.auth.uid) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }
    const uid = request.auth.uid;
    const periodKey = kstYearMonth();

    await db.runTransaction(async (t) => {
      const memRef = db.collection("hanlaw_members").doc(uid);
      const walletRef = db.collection("hanlaw_question_wallet").doc(uid);
      const [memSnap, walletSnap] = await t.getAll(memRef, walletRef);

      const paid = memSnap.exists && isPaidMember(memSnap.data());
      const base = walletSnap.exists ? walletSnap.data() : {};
      const norm = normalizeWallet(base, periodKey);

      if (paid) {
        const used = norm.monthlyUsed || 0;
        if (used < MONTHLY_FREE_FOR_PAID) {
          t.set(
            walletRef,
            {
              monthlyPeriodKey: periodKey,
              monthlyUsed: used + 1,
              batches: norm.batches,
              updatedAt: FieldValue.serverTimestamp()
            },
            { merge: true }
          );
          return;
        }
      }

      const nowMs = Date.now();
      const newBatches = consumeOneFromBatches(norm.batches, nowMs);
      if (!newBatches) {
        throw new HttpsError(
          "failed-precondition",
          "질문권이 부족합니다. 유료 구독 월간 혜택을 모두 쓰셨거나, 구매한 질문권이 없습니다. 요금제에서 추가 구매: 1건 $2 · 10건 $10 USD."
        );
      }

      t.set(
        walletRef,
        {
          monthlyPeriodKey: periodKey,
          monthlyUsed: norm.monthlyUsed,
          batches: newBatches,
          updatedAt: FieldValue.serverTimestamp()
        },
        { merge: true }
      );
    });

    return { ok: true };
  }
);

/**
 * 로그인 사용자가 퀴즈를 1문제 이상 풀었을 때(클라이언트에서 정답/오답 제출 직후 호출).
 * KST 달력일 기준 하루 1회만 출석 포인트 지급. 질문권 전환은 대시보드에서 별도 버튼(convertAttendancePointsToQuestionCredit).
 */
exports.recordQuizAttendance = onCall({ region: "asia-northeast3" }, async (request) => {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
  }
  const uid = request.auth.uid;
  const todayYmd = kstYmd();
  const attRef = db.collection("hanlaw_attendance_rewards").doc(uid);

  const result = await db.runTransaction(async (t) => {
    const attSnap = await t.get(attRef);
    const prev = attSnap.exists ? attSnap.data() : {};
    const lastYmd = prev.lastAttendanceYmd ? String(prev.lastAttendanceYmd) : "";
    let points = Math.max(0, parseInt(prev.attendancePoints, 10) || 0);

    if (lastYmd === todayYmd) {
      return {
        ok: true,
        alreadyToday: true,
        attendancePoints: points,
        pointsAwarded: 0,
        creditsGranted: 0
      };
    }

    points += ATTENDANCE_POINTS_PER_DAY;

    t.set(
      attRef,
      {
        attendancePoints: points,
        lastAttendanceYmd: todayYmd,
        updatedAt: FieldValue.serverTimestamp()
      },
      { merge: true }
    );

    return {
      ok: true,
      alreadyToday: false,
      attendancePoints: points,
      pointsAwarded: ATTENDANCE_POINTS_PER_DAY,
      creditsGranted: 0
    };
  });

  return result;
});

/**
 * 출석 포인트 3,000점을 차감하고 질문권 1건(구매 배치와 동일, 1년 유효)을 지급합니다.
 */
exports.convertAttendancePointsToQuestionCredit = onCall({ region: "asia-northeast3" }, async (request) => {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
  }
  const uid = request.auth.uid;
  const periodKey = kstYearMonth();
  const attRef = db.collection("hanlaw_attendance_rewards").doc(uid);
  const walletRef = db.collection("hanlaw_question_wallet").doc(uid);
  const exp = Timestamp.fromMillis(Date.now() + BATCH_VALID_MS);

  return db.runTransaction(async (t) => {
    const [attSnap, walletSnap] = await t.getAll(attRef, walletRef);
    let points = Math.max(
      0,
      parseInt(attSnap.exists ? attSnap.data().attendancePoints : 0, 10) || 0
    );
    if (points < ATTENDANCE_POINTS_PER_CREDIT) {
      throw new HttpsError(
        "failed-precondition",
        `질문권으로 바꾸려면 출석 포인트가 ${ATTENDANCE_POINTS_PER_CREDIT.toLocaleString("ko-KR")}점 이상이어야 합니다.`
      );
    }
    points -= ATTENDANCE_POINTS_PER_CREDIT;

    const walletData = walletSnap.exists ? walletSnap.data() : {};
    const norm = normalizeWallet(walletData, periodKey);
    const batches = norm.batches.slice();
    batches.push({
      amount: 1,
      expiresAt: exp,
      purchasedAt: FieldValue.serverTimestamp()
    });

    t.set(
      attRef,
      {
        attendancePoints: points,
        updatedAt: FieldValue.serverTimestamp()
      },
      { merge: true }
    );
    t.set(
      walletRef,
      {
        monthlyPeriodKey: periodKey,
        monthlyUsed: norm.monthlyUsed,
        batches,
        updatedAt: FieldValue.serverTimestamp()
      },
      { merge: true }
    );

    return {
      ok: true,
      attendancePoints: points,
      creditsAdded: 1
    };
  });
});

/**
 * 관리자 승인 시 홍보 인증 티켓(promotion)에 9000 포인트 지급.
 * 질문권 전환은 사용자가 대시보드에서 직접 수행.
 */
exports.adminApprovePromotionTicket = onCall({ region: "asia-northeast3" }, async (request) => {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
  }
  if (!isAdminEmailFromAuth(request.auth)) {
    throw new HttpsError("permission-denied", "관리자만 승인할 수 있습니다.");
  }

  const data = request.data || {};
  const ticketId = String(data.ticketId || "").trim();
  const adminReply = String(data.adminReply || "").trim();
  const adminEmail = String(data.adminEmail || request.auth.token.email || "").trim();
  if (!ticketId) throw new HttpsError("invalid-argument", "ticketId가 필요합니다.");
  if (!adminReply) throw new HttpsError("invalid-argument", "사용자에게 보낼 답변을 입력하세요.");

  const ticketRef = db.collection("hanlaw_tickets").doc(ticketId);
  const notifRef = db.collection("hanlaw_notifications").doc();

  const result = await db.runTransaction(async (t) => {
    const ts = await t.get(ticketRef);
    if (!ts.exists) throw new HttpsError("not-found", "티켓을 찾을 수 없습니다.");
    const ticket = ts.data() || {};
    if (ticket.type !== "promotion") {
      throw new HttpsError("failed-precondition", "홍보 인증 티켓이 아닙니다.");
    }
    if (ticket.promotionGranted === true || ticket.status === "approved") {
      return { ok: true, alreadyApproved: true, pointsAwarded: 0, creditsGranted: 0 };
    }

    const uid = ticket.userId;
    if (!uid) throw new HttpsError("failed-precondition", "티켓 사용자 정보가 없습니다.");

    const attRef = db.collection("hanlaw_attendance_rewards").doc(uid);
    const attSnap = await t.get(attRef);

    let points = Math.max(0, parseInt((attSnap.exists && attSnap.data().attendancePoints) || 0, 10) || 0);
    points += PROMOTION_REWARD_POINTS;

    t.set(
      attRef,
      {
        attendancePoints: points,
        updatedAt: FieldValue.serverTimestamp()
      },
      { merge: true }
    );

    t.update(ticketRef, {
      adminReply,
      status: "approved",
      reviewedBy: adminEmail,
      promotionGranted: true,
      promotionPointsAwarded: PROMOTION_REWARD_POINTS,
      updatedAt: FieldValue.serverTimestamp()
    });

    t.set(notifRef, {
      userId: uid,
      ticketId: ticketId,
      type: "홍보 인증 보상",
      title: "홍보 인증이 승인되어 9,000 포인트가 지급되었습니다",
      body:
        adminReply +
        " (지급 포인트 9,000점. 대시보드에서 출석 포인트를 질문권으로 전환할 수 있습니다.)",
      read: false,
      createdAt: FieldValue.serverTimestamp()
    });

    return {
      ok: true,
      alreadyApproved: false,
      pointsAwarded: PROMOTION_REWARD_POINTS,
      attendancePoints: points,
      creditsGranted: 0
    };
  });

  return result;
});

function verifyCreemSignature(rawBody, signature, secret) {
  if (!secret || !signature || !rawBody) return false;
  const computed = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(computed, "hex"), Buffer.from(signature, "hex"));
  } catch (e) {
    return false;
  }
}

function resolvePackAmount(obj) {
  const metadata = obj.metadata || {};
  const pack = metadata.hanlaw_question_pack;
  if (pack === "1" || pack === 1) return 1;
  if (pack === "10" || pack === 10) return 10;

  const prodId = (obj.product && obj.product.id) || (obj.order && obj.order.product) || "";
  const q1 = (process.env.CREEM_Q1_PRODUCT_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const q10 = (process.env.CREEM_Q10_PRODUCT_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (prodId && q1.includes(prodId)) return 1;
  if (prodId && q10.includes(prodId)) return 10;
  return 0;
}

exports.creemQuestionWebhook = functionsV1.region("asia-northeast3").https.onRequest(async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).send("Method Not Allowed");
    return;
  }

  const secret = process.env.CREEM_WEBHOOK_SECRET || "";
  const sig = req.get("creem-signature") || req.get("Creem-Signature") || "";
  const rawBody = req.rawBody ? req.rawBody.toString("utf8") : JSON.stringify(req.body || {});

  if (!verifyCreemSignature(rawBody, sig, secret)) {
    res.status(401).send("Invalid signature");
    return;
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch (e) {
    res.status(400).send("Bad JSON");
    return;
  }

  if (!event || event.eventType !== "checkout.completed") {
    res.status(200).send("ignored");
    return;
  }

  const obj = event.object || {};
  const eventId = event.id || obj.id;
  if (!eventId) {
    res.status(200).send("no event id");
    return;
  }

  const dedupRef = db.collection("hanlaw_webhook_events").doc(String(eventId));

  const amount = resolvePackAmount(obj);
  const metadata = obj.metadata || {};
  const customer = obj.customer || {};
  let uid = metadata.firebase_uid || metadata.firebaseUid || metadata.referenceId || metadata.user_id;

  if (!uid && customer.email) {
    try {
      const u = await getAuth().getUserByEmail(String(customer.email).trim());
      uid = u.uid;
    } catch (e) {
      console.warn("creemQuestionWebhook: no Firebase user for email", customer.email);
    }
  }

  if (!uid || !amount) {
    try {
      await dedupRef.set({
        processedAt: FieldValue.serverTimestamp(),
        skipped: true,
        reason: "no uid or unknown product",
        eventType: event.eventType
      });
    } catch (e) {}
    res.status(200).send("skip");
    return;
  }

  const walletRef = db.collection("hanlaw_question_wallet").doc(uid);
  const exp = Timestamp.fromMillis(Date.now() + BATCH_VALID_MS);

  var outcome = "ok";
  try {
    await db.runTransaction(async (t) => {
      const dup = await t.get(dedupRef);
      if (dup.exists) {
        outcome = "duplicate";
        return;
      }
      const wsnap = await t.get(walletRef);
      const data = wsnap.exists ? wsnap.data() : {};
      const periodKey = kstYearMonth();
      const norm = normalizeWallet(data, periodKey);
      const batches = norm.batches.slice();
      batches.push({
        amount,
        expiresAt: exp,
        purchasedAt: FieldValue.serverTimestamp()
      });
      t.set(dedupRef, {
        processedAt: FieldValue.serverTimestamp(),
        uid,
        amount,
        eventType: event.eventType
      });
      t.set(
        walletRef,
        {
          monthlyPeriodKey: periodKey,
          monthlyUsed: norm.monthlyUsed,
          batches,
          updatedAt: FieldValue.serverTimestamp()
        },
        { merge: true }
      );
    });
    res.status(200).send(outcome);
  } catch (e) {
    console.error("creemQuestionWebhook grant error", e);
    res.status(500).send("grant failed");
  }
});
