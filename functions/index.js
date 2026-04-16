"use strict";

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
let _envProjectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || "";
if (!_envProjectId && process.env.FIREBASE_CONFIG) {
  try {
    _envProjectId = JSON.parse(process.env.FIREBASE_CONFIG).projectId || "";
  } catch (_) {
    _envProjectId = "";
  }
}
if (_envProjectId) {
  require("dotenv").config({ path: path.join(__dirname, `.env.${_envProjectId}`), override: true });
}

/**
 * 환경 구성 (Firebase Functions 환경변수 / Secret)
 *
 * 페이앱(PayApp): PAYAPP_USERID, PAYAPP_LINK_KEY, PAYAPP_LINK_VALUE · 선택 PAYAPP_REBILL_CYCLE_DAY(기본 15), PAYAPP_REBILL_EXPIRE_YEARS(기본 10)
 * 질문권 PAYAPP_KRW_Q1, PAYAPP_KRW_Q10 · 구독 PAYAPP_KRW_SUB_MONTHLY/YEARLY/TWO_YEAR · 비갱신 PAYAPP_KRW_NONRENEW_1M/3M/6M
 * getPayAppQuestionPackCheckout, getPayAppSubscriptionCheckout, cancelPayAppRebill, payappQuestionFeedback
 *
 * 출석 포인트→변호사 질문권: convertAttendancePointsToQuestionCredit · 엘리 질문권: convertAttendancePointsToEllyCredit (대시보드)
 * 개선의견 채택: adminApproveSuggestionTicket (관리자, 출석 포인트 지급)
 * 공개 Q&A: publishLawyerQaPublic(관리자, 비공개 스텁), publishLawyerQaCommunity(질문자 옵트인), searchLawyerQa, revealLawyerQaAnswer, adminBackfillLawyerQaCommunityVisible(관리자 1회)
 * 배포: 프로젝트 루트에서 firebase deploy --only functions,firestore:rules
 *
 * 사전·퀴즈 AI: GEMINI_API_KEY, 선택 GEMINI_MODEL (기본 gemini-2.0-flash, 구형 gemini-1.5-flash-latest 는 1.5-flash 로 치환)
 * 퀴즈 AI: quizAskGemini — 무료 1일 4회(hanlaw_quiz_ai_usage) + 엘리 질문권(hanlaw_quiz_ai_wallet); 기존 구매분 ellyUnlimitedUntil은 서버에서 계속 인정
 * 페이앱 엘리: PAYAPP_KRW_EQ10/EQ50/EQ100 — getPayAppEllyQuestionPackCheckout (무제한 1개월 결제는 UI 제거, 웹훅·Callable은 유지 가능)
 * 관리자 문의함 AI 초안: adminDraftTicketAi — GEMINI_API_KEY, 관리자만, 선택 자료실 RAG(PINECONE·quizAskGemini와 동일 retrieveLibraryContextForQuiz)
 * 자료실 RAG: GEMINI_API_KEY, PINECONE_API_KEY, PINECONE_INDEX_NAME, 선택 PINECONE_HOST, PINECONE_NAMESPACE, GEMINI_EMBED_MODEL, GEMINI_EMBED_DIM
 * Storage 자료실 트리거 버킷: HANLAW_STORAGE_BUCKET — PDF·xlsx 업로드 시 청크·임베딩 (libraryPipeline)
 * 관리자 이메일: ADMIN_EMAILS (쉼표 구분, createLibraryDocument 등)
 * 닉네임: setUserNickname — Firestore hanlaw_user_profiles (클라이언트 직접 쓰기 불가, AI·티켓 호칭용)
 */

const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { consumeOneFromBatches } = require("./walletBatches");
const { appendPointLog, REASON } = require("./attendancePointLedger");

initializeApp();
const db = getFirestore();

const { generateOrGetDictionaryEntry } = require("./dictionaryGemini");
exports.generateOrGetDictionaryEntry = generateOrGetDictionaryEntry;

const { quizAskGemini } = require("./quizAiGemini");
exports.quizAskGemini = quizAskGemini;

const { adminDraftTicketAi } = require("./ticketDraftGemini");
exports.adminDraftTicketAi = adminDraftTicketAi;

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
  getPayAppEllyQuestionPackCheckout,
  getPayAppEllyUnlimitedPassCheckout,
  getPayAppSubscriptionCheckout,
  cancelPayAppRebill,
  payappQuestionFeedback
} = require("./payappPayments");
exports.getPayAppQuestionPackCheckout = getPayAppQuestionPackCheckout;
exports.getPayAppEllyQuestionPackCheckout = getPayAppEllyQuestionPackCheckout;
exports.getPayAppEllyUnlimitedPassCheckout = getPayAppEllyUnlimitedPassCheckout;
exports.getPayAppSubscriptionCheckout = getPayAppSubscriptionCheckout;
exports.cancelPayAppRebill = cancelPayAppRebill;
exports.payappQuestionFeedback = payappQuestionFeedback;

const {
  revealLawyerQaAnswer,
  publishLawyerQaPublic,
  searchLawyerQa,
  publishLawyerQaCommunity,
  unpublishLawyerQaCommunity,
  adminBackfillLawyerQaCommunityVisible
} = require("./publicQa");
exports.revealLawyerQaAnswer = revealLawyerQaAnswer;
exports.publishLawyerQaPublic = publishLawyerQaPublic;
exports.searchLawyerQa = searchLawyerQa;
exports.publishLawyerQaCommunity = publishLawyerQaCommunity;
exports.unpublishLawyerQaCommunity = unpublishLawyerQaCommunity;
exports.adminBackfillLawyerQaCommunityVisible = adminBackfillLawyerQaCommunityVisible;

const MONTHLY_FREE_FOR_PAID = 4;
const BATCH_VALID_MS = 365 * 24 * 60 * 60 * 1000;

/** 질문권 부족 시 안내(원화, 페이앱 기본과 맞출 것) */
const QUESTION_PACK_PRICE_HINT_KO =
  process.env.QUESTION_PACK_PRICE_HINT_KO ||
  "요금제에서 추가 구매: 1건 ₩5,000 · 10건 ₩30,000(구매일로부터 1년 유효).";

/** 한국시간 기준 하루 1회, 퀴즈 1문제 이상 풀이 시 지급되는 출석 포인트 */
const ATTENDANCE_POINTS_PER_DAY = 100;
/** 출석 포인트를 변호사 질문권 1건으로 바꿀 때 차감(수동 전환, convertAttendancePointsToQuestionCredit) — 질문권 단가(₩5,000)에 맞춤 */
const ATTENDANCE_POINTS_PER_CREDIT = 5000;
/** 출석 포인트를 엘리(AI) 질문권 1건으로 바꿀 때 차감(convertAttendancePointsToEllyCredit) — 엘리 10건 팩 건당 약 ₩500 수준 */
const ATTENDANCE_POINTS_PER_ELLY_CREDIT = 500;
/** 앱 홍보 인증(관리자 승인 시) 지급 포인트 */
const PROMOTION_REWARD_POINTS = 9000;
/** 개선의견 채택 시 기본 지급 출석 포인트(관리자가 Callable에서 가감 가능) */
const IMPROVEMENT_DEFAULT_POINTS = 3000;

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

exports.consumeQuestionCredit = onCall(
  { region: "asia-northeast3" },
  async (request) => {
    if (!request.auth || !request.auth.uid) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }
    if (isAdminEmailFromAuth(request.auth)) {
      return { ok: true, adminGratis: true };
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
          "질문권이 부족합니다. 유료 구독 월간 혜택을 모두 쓰셨거나, 구매한 질문권이 없습니다. " +
            QUESTION_PACK_PRICE_HINT_KO
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
    appendPointLog(t, attRef, {
      delta: ATTENDANCE_POINTS_PER_DAY,
      reason: REASON.QUIZ_DAILY,
      balanceAfter: points,
      meta: { ymd: todayYmd }
    });

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
 * 출석 포인트를 차감하고 변호사 질문권 1건(구매 배치와 동일, 1년 유효)을 지급합니다.
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
        `변호사 질문권으로 바꾸려면 출석 포인트가 ${ATTENDANCE_POINTS_PER_CREDIT.toLocaleString("ko-KR")}점 이상이어야 합니다.`
      );
    }
    points -= ATTENDANCE_POINTS_PER_CREDIT;

    const walletData = walletSnap.exists ? walletSnap.data() : {};
    const norm = normalizeWallet(walletData, periodKey);
    const batches = norm.batches.slice();
    batches.push({
      amount: 1,
      expiresAt: exp,
      // 배열 원소 내부에는 serverTimestamp sentinel 대신 즉시 Timestamp를 기록
      purchasedAt: Timestamp.now()
    });

    t.set(
      attRef,
      {
        attendancePoints: points,
        updatedAt: FieldValue.serverTimestamp()
      },
      { merge: true }
    );
    appendPointLog(t, attRef, {
      delta: -ATTENDANCE_POINTS_PER_CREDIT,
      reason: REASON.CONVERT_LAWYER,
      balanceAfter: points
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

    return {
      ok: true,
      attendancePoints: points,
      creditsAdded: 1
    };
  });
});

/**
 * 출석 포인트를 차감하고 엘리(AI) 질문권 1건(PayApp 엘리 팩과 동일한 배치, 1년 유효)을 지급합니다.
 */
exports.convertAttendancePointsToEllyCredit = onCall({ region: "asia-northeast3" }, async (request) => {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
  }
  const uid = request.auth.uid;
  const attRef = db.collection("hanlaw_attendance_rewards").doc(uid);
  const walletRef = db.collection("hanlaw_quiz_ai_wallet").doc(uid);
  const exp = Timestamp.fromMillis(Date.now() + BATCH_VALID_MS);

  return db.runTransaction(async (t) => {
    const attSnap = await t.get(attRef);
    let points = Math.max(
      0,
      parseInt(attSnap.exists ? attSnap.data().attendancePoints : 0, 10) || 0
    );
    if (points < ATTENDANCE_POINTS_PER_ELLY_CREDIT) {
      throw new HttpsError(
        "failed-precondition",
        `엘리(AI) 질문권으로 바꾸려면 출석 포인트가 ${ATTENDANCE_POINTS_PER_ELLY_CREDIT.toLocaleString("ko-KR")}점 이상이어야 합니다.`
      );
    }
    points -= ATTENDANCE_POINTS_PER_ELLY_CREDIT;

    const walletSnap = await t.get(walletRef);
    const data = walletSnap.exists ? walletSnap.data() : {};
    const batches = Array.isArray(data.batches) ? data.batches.slice() : [];
    batches.push({
      amount: 1,
      expiresAt: exp,
      purchasedAt: Timestamp.now()
    });

    t.set(
      attRef,
      {
        attendancePoints: points,
        updatedAt: FieldValue.serverTimestamp()
      },
      { merge: true }
    );
    appendPointLog(t, attRef, {
      delta: -ATTENDANCE_POINTS_PER_ELLY_CREDIT,
      reason: REASON.CONVERT_ELLY,
      balanceAfter: points
    });
    t.set(
      walletRef,
      {
        batches,
        updatedAt: FieldValue.serverTimestamp()
      },
      { merge: true }
    );

    return {
      ok: true,
      attendancePoints: points,
      ellyCreditsAdded: 1
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
    appendPointLog(t, attRef, {
      delta: PROMOTION_REWARD_POINTS,
      reason: REASON.PROMOTION,
      balanceAfter: points,
      meta: { ticketId }
    });

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

/**
 * 개선의견(suggestion) 티켓 승인: 답변 알림 + 선택적 채택 시 출석 포인트(기본 IMPROVEMENT_DEFAULT_POINTS).
 */
exports.adminApproveSuggestionTicket = onCall({ region: "asia-northeast3" }, async (request) => {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
  }
  if (!isAdminEmailFromAuth(request.auth)) {
    throw new HttpsError("permission-denied", "관리자만 승인할 수 있습니다.");
  }

  const data = request.data || {};
  const ticketId = String(data.ticketId || "").trim();
  const adminReply = String(data.adminReply || "").trim();
  const adopted = data.adopted === true;
  let awardPts = parseInt(data.points, 10);
  if (adopted) {
    if (!Number.isFinite(awardPts)) awardPts = IMPROVEMENT_DEFAULT_POINTS;
    awardPts = Math.max(0, Math.min(100000, awardPts));
  } else {
    awardPts = 0;
  }
  const adminEmail = String(data.adminEmail || request.auth.token.email || "").trim();
  if (!ticketId) throw new HttpsError("invalid-argument", "ticketId가 필요합니다.");
  if (!adminReply) throw new HttpsError("invalid-argument", "사용자에게 보낼 답변을 입력하세요.");

  const ticketRef = db.collection("hanlaw_tickets").doc(ticketId);

  const result = await db.runTransaction(async (t) => {
    const ts = await t.get(ticketRef);
    if (!ts.exists) throw new HttpsError("not-found", "티켓을 찾을 수 없습니다.");
    const ticket = ts.data() || {};
    if (ticket.type !== "suggestion") {
      throw new HttpsError("failed-precondition", "개선의견 티켓이 아닙니다.");
    }
    if (ticket.status === "approved") {
      return { ok: true, alreadyApproved: true, pointsAwarded: 0 };
    }

    const uid = ticket.userId;
    if (!uid) throw new HttpsError("failed-precondition", "티켓 사용자 정보가 없습니다.");

    const notifRef = db.collection("hanlaw_notifications").doc();

    let newAttPts = null;
    if (adopted && awardPts > 0) {
      const attRef = db.collection("hanlaw_attendance_rewards").doc(uid);
      const attSnap = await t.get(attRef);
      let pts = Math.max(0, parseInt((attSnap.exists && attSnap.data().attendancePoints) || 0, 10) || 0);
      pts += awardPts;
      newAttPts = pts;
      t.set(
        attRef,
        {
          attendancePoints: pts,
          updatedAt: FieldValue.serverTimestamp()
        },
        { merge: true }
      );
      appendPointLog(t, attRef, {
        delta: awardPts,
        reason: REASON.SUGGESTION,
        balanceAfter: pts,
        meta: { ticketId }
      });
    }

    t.update(ticketRef, {
      adminReply,
      status: "approved",
      reviewedBy: adminEmail,
      suggestionAdopted: adopted,
      suggestionPointsAwarded: adopted ? awardPts : 0,
      updatedAt: FieldValue.serverTimestamp()
    });

    const title =
      adopted && awardPts > 0
        ? `개선 아이디어가 채택되어 ${awardPts.toLocaleString("ko-KR")}점이 지급되었습니다`
        : adopted
          ? "개선 아이디어가 채택되었습니다"
          : "개선 의견에 대한 답변이 등록되었습니다";
    const bodySuffix =
      adopted && awardPts > 0
        ? `\n\n(채택 보상 ${awardPts.toLocaleString("ko-KR")}점이 출석 포인트로 지급되었습니다.)`
        : "";

    t.set(notifRef, {
      userId: uid,
      ticketId,
      type: adopted ? "개선 의견 채택" : "개선 의견 답변",
      title,
      body: adminReply + bodySuffix,
      read: false,
      createdAt: FieldValue.serverTimestamp()
    });

    return {
      ok: true,
      alreadyApproved: false,
      pointsAwarded: adopted ? awardPts : 0,
      attendancePoints: newAttPts
    };
  });

  return result;
});

const STAGING_QUIZ_COLLECTION = "hanlaw_questions_staging";
const QUIZ_COLLECTION = "hanlaw_questions";

function assertAdminCallable(request) {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
  }
  if (!isAdminEmailFromAuth(request.auth)) {
    throw new HttpsError("permission-denied", "관리자만 사용할 수 있습니다.");
  }
}

function sanitizeQuizPayload(raw) {
  const src = raw || {};
  const out = {
    id: String(src.id || "").trim(),
    examId: String(src.examId || "").trim(),
    year: parseInt(src.year, 10),
    exam: String(src.exam || "").trim(),
    topic: String(src.topic || "").trim(),
    statement: String(src.statement || "").trim(),
    answer: typeof src.answer === "boolean" ? src.answer : String(src.answer).trim().toLowerCase() === "true",
    explanation: String(src.explanation || "").trim()
  };
  if (!out.id) throw new HttpsError("invalid-argument", "문항 ID가 필요합니다.");
  if (!out.examId) throw new HttpsError("invalid-argument", "시험 종류(examId)가 필요합니다.");
  if (!Number.isFinite(out.year)) throw new HttpsError("invalid-argument", "연도(year)가 필요합니다.");
  if (!out.topic) throw new HttpsError("invalid-argument", "주제(topic)가 필요합니다.");
  if (!out.statement) throw new HttpsError("invalid-argument", "문제 본문(statement)이 필요합니다.");
  if (!out.explanation) throw new HttpsError("invalid-argument", "해설(explanation)이 필요합니다.");
  if (src.explanationBasic != null && String(src.explanationBasic).trim()) {
    out.explanationBasic = String(src.explanationBasic).trim();
  }
  if (src.detail && typeof src.detail === "object") {
    const detail = {};
    if (src.detail.body != null && String(src.detail.body).trim()) {
      detail.body = String(src.detail.body).replace(/\r\n/g, "\n");
    }
    if (src.detail.legal != null && String(src.detail.legal).trim()) detail.legal = String(src.detail.legal).trim();
    if (src.detail.trap != null && String(src.detail.trap).trim()) detail.trap = String(src.detail.trap).trim();
    if (src.detail.precedent != null && String(src.detail.precedent).trim()) {
      detail.precedent = String(src.detail.precedent).trim();
    }
    if (Object.keys(detail).length) out.detail = detail;
  }
  if (Array.isArray(src.tags)) {
    const tags = src.tags.map((x) => String(x || "").trim()).filter(Boolean);
    if (tags.length) out.tags = tags;
  }
  if (src.importance != null && src.importance !== "") {
    const n = parseInt(src.importance, 10);
    if (Number.isFinite(n)) out.importance = Math.max(1, Math.min(5, n));
  }
  if (src.difficulty != null && src.difficulty !== "") {
    const n = parseInt(src.difficulty, 10);
    if (Number.isFinite(n)) out.difficulty = Math.max(1, Math.min(5, n));
  }
  return out;
}

exports.adminStageQuizBatch = onCall({ region: "asia-northeast3" }, async (request) => {
  assertAdminCallable(request);
  const rows = Array.isArray(request.data && request.data.rows) ? request.data.rows : [];
  if (!rows.length) throw new HttpsError("invalid-argument", "rows 배열이 필요합니다.");
  if (rows.length > 500) throw new HttpsError("invalid-argument", "한 번에 최대 500건까지 가능합니다.");
  const email = String(request.auth.token.email || "").toLowerCase();
  const batch = db.batch();
  let okCount = 0;
  const failRows = [];
  rows.forEach((row, idx) => {
    try {
      const payload = sanitizeQuizPayload(row);
      const ref = db.collection(STAGING_QUIZ_COLLECTION).doc();
      batch.set(ref, {
        entityType: "quiz",
        questionId: payload.id,
        payload,
        status: "reviewing",
        source: "excel",
        changeType: "upsert",
        createdBy: email,
        updatedBy: email,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        approvedBy: null,
        approvedAt: null,
        rejectReason: "",
        version: 1
      });
      okCount += 1;
    } catch (err) {
      failRows.push({ index: idx + 1, reason: err && err.message ? err.message : "형식 오류" });
    }
  });
  if (okCount > 0) await batch.commit();
  return { ok: true, okCount, failRows };
});

exports.adminListQuizStaging = onCall({ region: "asia-northeast3" }, async (request) => {
  assertAdminCallable(request);
  const status = String((request.data && request.data.status) || "reviewing").trim();
  const limitRaw = parseInt(request.data && request.data.limit, 10);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(100, limitRaw)) : 50;
  const snap = await db.collection(STAGING_QUIZ_COLLECTION).limit(300).get();
  let items = snap.docs.map((d) => {
    const x = d.data() || {};
    return {
      id: d.id,
      entityType: "quiz",
      questionId: x.questionId || "",
      topic: x.payload && x.payload.topic ? x.payload.topic : "",
      statement: x.payload && x.payload.statement ? x.payload.statement : "",
      status: x.status || "reviewing",
      source: x.source || "",
      version: parseInt(x.version, 10) || 1,
      updatedAtMs: x.updatedAt && typeof x.updatedAt.toMillis === "function" ? x.updatedAt.toMillis() : 0
    };
  });
  if (status && status !== "all") {
    items = items.filter((it) => String(it.status || "") === status);
  }
  items.sort((a, b) => (b.updatedAtMs || 0) - (a.updatedAtMs || 0));
  if (items.length > limit) items = items.slice(0, limit);
  return { ok: true, items };
});

exports.adminGetQuizStaging = onCall({ region: "asia-northeast3" }, async (request) => {
  assertAdminCallable(request);
  const id = String((request.data && request.data.id) || "").trim();
  if (!id) throw new HttpsError("invalid-argument", "id가 필요합니다.");
  const ref = db.collection(STAGING_QUIZ_COLLECTION).doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "검수 항목을 찾을 수 없습니다.");
  const data = snap.data() || {};
  const qid = String(data.questionId || "").trim();
  let published = null;
  if (qid) {
    const ps = await db.collection(QUIZ_COLLECTION).doc(qid).get();
    if (ps.exists) published = ps.data() || null;
  }
  return {
    ok: true,
    item: {
      id: snap.id,
      questionId: qid,
      payload: data.payload || {},
      status: data.status || "reviewing",
      version: parseInt(data.version, 10) || 1,
      rejectReason: data.rejectReason || ""
    },
    published
  };
});

exports.adminUpdateQuizStaging = onCall({ region: "asia-northeast3" }, async (request) => {
  assertAdminCallable(request);
  const id = String((request.data && request.data.id) || "").trim();
  const version = parseInt(request.data && request.data.version, 10);
  const payloadRaw = request.data && request.data.payload;
  if (!id) throw new HttpsError("invalid-argument", "id가 필요합니다.");
  if (!Number.isFinite(version)) throw new HttpsError("invalid-argument", "version이 필요합니다.");
  const payload = sanitizeQuizPayload(payloadRaw || {});
  const email = String(request.auth.token.email || "").toLowerCase();
  const ref = db.collection(STAGING_QUIZ_COLLECTION).doc(id);
  await db.runTransaction(async (t) => {
    const snap = await t.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "검수 항목을 찾을 수 없습니다.");
    const cur = snap.data() || {};
    const curVer = parseInt(cur.version, 10) || 1;
    if (curVer !== version) throw new HttpsError("aborted", "다른 관리자가 먼저 수정했습니다. 새로고침 후 다시 시도하세요.");
    t.update(ref, {
      questionId: payload.id,
      payload,
      status: "reviewing",
      updatedBy: email,
      updatedAt: FieldValue.serverTimestamp(),
      version: curVer + 1
    });
  });
  return { ok: true };
});

exports.adminApproveQuizStaging = onCall({ region: "asia-northeast3" }, async (request) => {
  assertAdminCallable(request);
  const id = String((request.data && request.data.id) || "").trim();
  const version = parseInt(request.data && request.data.version, 10);
  if (!id) throw new HttpsError("invalid-argument", "id가 필요합니다.");
  if (!Number.isFinite(version)) throw new HttpsError("invalid-argument", "version이 필요합니다.");
  const email = String(request.auth.token.email || "").toLowerCase();
  const ref = db.collection(STAGING_QUIZ_COLLECTION).doc(id);
  await db.runTransaction(async (t) => {
    const snap = await t.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "검수 항목을 찾을 수 없습니다.");
    const cur = snap.data() || {};
    const curVer = parseInt(cur.version, 10) || 1;
    if (curVer !== version) throw new HttpsError("aborted", "다른 관리자가 먼저 수정했습니다. 새로고침 후 다시 시도하세요.");
    const payload = sanitizeQuizPayload(cur.payload || {});
    const pubRef = db.collection(QUIZ_COLLECTION).doc(payload.id);
    t.set(
      pubRef,
      Object.assign({}, payload, {
        updatedAt: FieldValue.serverTimestamp()
      }),
      { merge: true }
    );
    t.update(ref, {
      status: "approved",
      approvedBy: email,
      approvedAt: FieldValue.serverTimestamp(),
      updatedBy: email,
      updatedAt: FieldValue.serverTimestamp(),
      rejectReason: "",
      version: curVer + 1
    });
  });
  return { ok: true };
});

exports.adminRejectQuizStaging = onCall({ region: "asia-northeast3" }, async (request) => {
  assertAdminCallable(request);
  const id = String((request.data && request.data.id) || "").trim();
  const version = parseInt(request.data && request.data.version, 10);
  const reason = String((request.data && request.data.reason) || "").trim();
  if (!id) throw new HttpsError("invalid-argument", "id가 필요합니다.");
  if (!Number.isFinite(version)) throw new HttpsError("invalid-argument", "version이 필요합니다.");
  const ref = db.collection(STAGING_QUIZ_COLLECTION).doc(id);
  const email = String(request.auth.token.email || "").toLowerCase();
  await db.runTransaction(async (t) => {
    const snap = await t.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "검수 항목을 찾을 수 없습니다.");
    const cur = snap.data() || {};
    const curVer = parseInt(cur.version, 10) || 1;
    if (curVer !== version) throw new HttpsError("aborted", "다른 관리자가 먼저 수정했습니다. 새로고침 후 다시 시도하세요.");
    t.update(ref, {
      status: "rejected",
      rejectReason: reason || "반려",
      updatedBy: email,
      updatedAt: FieldValue.serverTimestamp(),
      version: curVer + 1
    });
  });
  return { ok: true };
});

const STAGING_TERM_COLLECTION = "hanlaw_dict_terms_staging";
const STAGING_CASE_COLLECTION = "hanlaw_dict_cases_staging";
const TERM_COLLECTION = "hanlaw_dict_terms";
const CASE_COLLECTION = "hanlaw_dict_cases";

function sanitizeTermPayload(raw) {
  const src = raw || {};
  const term = String(src.term || "").trim();
  if (!term) throw new HttpsError("invalid-argument", "용어(term)가 필요합니다.");
  const out = {
    term,
    aliases: Array.isArray(src.aliases)
      ? src.aliases.map((x) => String(x || "").trim()).filter(Boolean).slice(0, 30)
      : [],
    definition: String(src.definition || "").trim()
  };
  if (!out.definition) throw new HttpsError("invalid-argument", "정의(definition)가 필요합니다.");
  return out;
}

function sanitizeCasePayload(raw) {
  const src = raw || {};
  const out = {
    citation: String(src.citation || "").trim(),
    title: String(src.title || "").trim(),
    facts: String(src.facts || "").trim(),
    issues: String(src.issues || "").trim(),
    judgment: String(src.judgment || "").trim(),
    searchKeys: Array.isArray(src.searchKeys)
      ? src.searchKeys.map((x) => String(x || "").trim()).filter(Boolean).slice(0, 40)
      : [],
    topicKeywords: Array.isArray(src.topicKeywords)
      ? src.topicKeywords.map((x) => String(x || "").trim()).filter(Boolean).slice(0, 40)
      : [],
    casenoteUrl: String(src.casenoteUrl || "").trim(),
    jisCntntsSrno: String(src.jisCntntsSrno || "").trim(),
    scourtPortalUrl: String(src.scourtPortalUrl || "").trim()
  };
  if (!out.citation) throw new HttpsError("invalid-argument", "사건 표기(citation)가 필요합니다.");
  return out;
}

function dictStagingCollectionByType(entityType) {
  return entityType === "case" ? STAGING_CASE_COLLECTION : STAGING_TERM_COLLECTION;
}

function dictPublishedCollectionByType(entityType) {
  return entityType === "case" ? CASE_COLLECTION : TERM_COLLECTION;
}

function dictKeyByType(entityType, payload) {
  if (entityType === "case") return String(payload.citation || "").trim();
  return String(payload.term || "").trim();
}

function sanitizeDictPayload(entityType, raw) {
  return entityType === "case" ? sanitizeCasePayload(raw) : sanitizeTermPayload(raw);
}

exports.adminListDictStaging = onCall({ region: "asia-northeast3" }, async (request) => {
  assertAdminCallable(request);
  const entityTypeRaw = String((request.data && request.data.entityType) || "term").trim().toLowerCase();
  const entityType = entityTypeRaw === "case" ? "case" : "term";
  const status = String((request.data && request.data.status) || "reviewing").trim();
  const limitRaw = parseInt(request.data && request.data.limit, 10);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(100, limitRaw)) : 50;
  const col = dictStagingCollectionByType(entityType);
  const snap = await db.collection(col).limit(300).get();
  let items = snap.docs.map((d) => {
    const x = d.data() || {};
    const payload = x.payload || {};
    return {
      id: d.id,
      entityType,
      key: x.entryKey || dictKeyByType(entityType, payload),
      title:
        entityType === "case"
          ? String(payload.citation || payload.title || "").trim()
          : String(payload.term || "").trim(),
      status: x.status || "reviewing",
      source: x.source || "",
      version: parseInt(x.version, 10) || 1,
      updatedAtMs: x.updatedAt && typeof x.updatedAt.toMillis === "function" ? x.updatedAt.toMillis() : 0
    };
  });
  if (status && status !== "all") {
    items = items.filter((it) => String(it.status || "") === status);
  }
  items.sort((a, b) => (b.updatedAtMs || 0) - (a.updatedAtMs || 0));
  if (items.length > limit) items = items.slice(0, limit);
  return { ok: true, items };
});

exports.adminGetDictStaging = onCall({ region: "asia-northeast3" }, async (request) => {
  assertAdminCallable(request);
  const id = String((request.data && request.data.id) || "").trim();
  const entityTypeRaw = String((request.data && request.data.entityType) || "term").trim().toLowerCase();
  const entityType = entityTypeRaw === "case" ? "case" : "term";
  if (!id) throw new HttpsError("invalid-argument", "id가 필요합니다.");
  const col = dictStagingCollectionByType(entityType);
  const ref = db.collection(col).doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "검수 항목을 찾을 수 없습니다.");
  const data = snap.data() || {};
  const payload = sanitizeDictPayload(entityType, data.payload || {});
  const key = String(data.entryKey || dictKeyByType(entityType, payload)).trim();
  let published = null;
  if (key) {
    const ps = await db.collection(dictPublishedCollectionByType(entityType)).doc(key).get();
    if (ps.exists) published = ps.data() || null;
  }
  return {
    ok: true,
    item: {
      id: snap.id,
      entityType,
      entryKey: key,
      payload,
      status: data.status || "reviewing",
      version: parseInt(data.version, 10) || 1,
      rejectReason: data.rejectReason || ""
    },
    published
  };
});

exports.adminUpdateDictStaging = onCall({ region: "asia-northeast3" }, async (request) => {
  assertAdminCallable(request);
  const id = String((request.data && request.data.id) || "").trim();
  const entityTypeRaw = String((request.data && request.data.entityType) || "term").trim().toLowerCase();
  const entityType = entityTypeRaw === "case" ? "case" : "term";
  const version = parseInt(request.data && request.data.version, 10);
  if (!id) throw new HttpsError("invalid-argument", "id가 필요합니다.");
  if (!Number.isFinite(version)) throw new HttpsError("invalid-argument", "version이 필요합니다.");
  const payload = sanitizeDictPayload(entityType, request.data && request.data.payload);
  const key = dictKeyByType(entityType, payload);
  const col = dictStagingCollectionByType(entityType);
  const email = String(request.auth.token.email || "").toLowerCase();
  const ref = db.collection(col).doc(id);
  await db.runTransaction(async (t) => {
    const snap = await t.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "검수 항목을 찾을 수 없습니다.");
    const cur = snap.data() || {};
    const curVer = parseInt(cur.version, 10) || 1;
    if (curVer !== version) throw new HttpsError("aborted", "다른 관리자가 먼저 수정했습니다. 새로고침 후 다시 시도하세요.");
    t.update(ref, {
      entryKey: key,
      payload,
      status: "reviewing",
      updatedBy: email,
      updatedAt: FieldValue.serverTimestamp(),
      version: curVer + 1
    });
  });
  return { ok: true };
});

exports.adminApproveDictStaging = onCall({ region: "asia-northeast3" }, async (request) => {
  assertAdminCallable(request);
  const id = String((request.data && request.data.id) || "").trim();
  const entityTypeRaw = String((request.data && request.data.entityType) || "term").trim().toLowerCase();
  const entityType = entityTypeRaw === "case" ? "case" : "term";
  const version = parseInt(request.data && request.data.version, 10);
  if (!id) throw new HttpsError("invalid-argument", "id가 필요합니다.");
  if (!Number.isFinite(version)) throw new HttpsError("invalid-argument", "version이 필요합니다.");
  const col = dictStagingCollectionByType(entityType);
  const pubCol = dictPublishedCollectionByType(entityType);
  const email = String(request.auth.token.email || "").toLowerCase();
  const ref = db.collection(col).doc(id);
  await db.runTransaction(async (t) => {
    const snap = await t.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "검수 항목을 찾을 수 없습니다.");
    const cur = snap.data() || {};
    const curVer = parseInt(cur.version, 10) || 1;
    if (curVer !== version) throw new HttpsError("aborted", "다른 관리자가 먼저 수정했습니다. 새로고침 후 다시 시도하세요.");
    const payload = sanitizeDictPayload(entityType, cur.payload || {});
    const key = dictKeyByType(entityType, payload);
    const pubRef = db.collection(pubCol).doc(key);
    t.set(
      pubRef,
      Object.assign({}, payload, {
        updatedAt: FieldValue.serverTimestamp()
      }),
      { merge: true }
    );
    t.update(ref, {
      entryKey: key,
      status: "approved",
      approvedBy: email,
      approvedAt: FieldValue.serverTimestamp(),
      updatedBy: email,
      updatedAt: FieldValue.serverTimestamp(),
      rejectReason: "",
      version: curVer + 1
    });
  });
  return { ok: true };
});

/**
 * 조문(hanlaw_dict_statutes) 저장. Admin SDK 사용 → Firestore 규칙 미배포·클라이언트 permission 오류 방지.
 */
function normalizeStatuteDocId(raw, fallbackPrefix) {
  let s = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_ㄱ-ㅎ가-힣-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!s) s = `${fallbackPrefix || "entry"}_${Date.now().toString(36)}`;
  if (s.length > 180) s = s.slice(0, 180);
  return s;
}

exports.adminSaveDictStatute = onCall({ region: "asia-northeast3" }, async (request) => {
  assertAdminCallable(request);
  const entry = request.data && request.data.entry ? request.data.entry : {};
  const statuteKey = String(entry.statuteKey || "").trim();
  if (!statuteKey) {
    throw new HttpsError("invalid-argument", "statuteKey가 필요합니다.");
  }
  const docIdRaw = String((request.data && request.data.docId) || "").trim();
  const id = docIdRaw || normalizeStatuteDocId(statuteKey, "statute");
  const payload = {
    statuteKey,
    heading: String(entry.heading != null ? entry.heading : "").trim(),
    body: String(entry.body != null ? entry.body : "").trim(),
    sourceNote: String(entry.sourceNote != null ? entry.sourceNote : "").trim(),
    updatedAt: FieldValue.serverTimestamp()
  };
  await db.collection("hanlaw_dict_statutes").doc(id).set(payload, { merge: true });
  return { ok: true, id };
});

exports.adminRejectDictStaging = onCall({ region: "asia-northeast3" }, async (request) => {
  assertAdminCallable(request);
  const id = String((request.data && request.data.id) || "").trim();
  const entityTypeRaw = String((request.data && request.data.entityType) || "term").trim().toLowerCase();
  const entityType = entityTypeRaw === "case" ? "case" : "term";
  const version = parseInt(request.data && request.data.version, 10);
  const reason = String((request.data && request.data.reason) || "").trim();
  if (!id) throw new HttpsError("invalid-argument", "id가 필요합니다.");
  if (!Number.isFinite(version)) throw new HttpsError("invalid-argument", "version이 필요합니다.");
  const email = String(request.auth.token.email || "").toLowerCase();
  const ref = db.collection(dictStagingCollectionByType(entityType)).doc(id);
  await db.runTransaction(async (t) => {
    const snap = await t.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "검수 항목을 찾을 수 없습니다.");
    const cur = snap.data() || {};
    const curVer = parseInt(cur.version, 10) || 1;
    if (curVer !== version) throw new HttpsError("aborted", "다른 관리자가 먼저 수정했습니다. 새로고침 후 다시 시도하세요.");
    t.update(ref, {
      status: "rejected",
      rejectReason: reason || "반려",
      updatedBy: email,
      updatedAt: FieldValue.serverTimestamp(),
      version: curVer + 1
    });
  });
  return { ok: true };
});

const headerQuotesAdmin = require("./headerQuotesAdmin");
exports.adminQuoteAddStaging = headerQuotesAdmin.adminQuoteAddStaging;
exports.adminQuoteGenerateAi = headerQuotesAdmin.adminQuoteGenerateAi;
exports.adminQuoteListStaging = headerQuotesAdmin.adminQuoteListStaging;
exports.adminQuoteApprove = headerQuotesAdmin.adminQuoteApprove;
exports.adminQuoteReject = headerQuotesAdmin.adminQuoteReject;
exports.adminQuoteGetPublished = headerQuotesAdmin.adminQuoteGetPublished;
exports.adminQuoteReplacePublished = headerQuotesAdmin.adminQuoteReplacePublished;
