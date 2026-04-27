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
 * 포인트→엘리 질문권: convertAttendancePointsToEllyCredit (대시보드). 변호사 질문권 전환·차감은 종료됨.
 * 개선의견 채택: adminApproveSuggestionTicket (관리자, 포인트 지급)
 * 공개 Q&A: publishLawyerQaPublic(관리자, 비공개 스텁), publishLawyerQaCommunity(질문자 옵트인), publishEllyQaCommunity·unpublishEllyQaCommunity(엘리 질문자 옵트인), searchLawyerQa, revealLawyerQaAnswer, adminBackfillLawyerQaCommunityVisible(관리자 1회)
 * 배포: 프로젝트 루트에서 firebase deploy --only functions,firestore:rules
 *
 * 사전·퀴즈 AI: GEMINI_API_KEY, 선택 GEMINI_MODEL (기본 gemini-2.0-flash, 구형 gemini-1.5-flash-latest 는 1.5-flash 로 치환)
 * 퀴즈 AI: quizAskGemini — 유료 구독 플랜별 일일 한도(hanlaw_quiz_ai_usage) + 엘리 질문권(hanlaw_quiz_ai_wallet); ellyUnlimitedUntil·구매 배치 유지
 * 페이앱 엘리: PAYAPP_KRW_EQ10/EQ20/EQ30 — getPayAppEllyQuestionPackCheckout (무제한 1개월 결제는 UI 제거, 웹훅·Callable은 유지 가능)
 * 관리자 문의함 AI 초안: adminDraftTicketAi — GEMINI_API_KEY, 관리자만, 선택 자료실 RAG(PINECONE·quizAskGemini와 동일 retrieveLibraryContextForQuiz)
 * 자료실 RAG: GEMINI_API_KEY, PINECONE_API_KEY, PINECONE_INDEX_NAME, 선택 PINECONE_HOST, PINECONE_NAMESPACE, GEMINI_EMBED_MODEL, GEMINI_EMBED_DIM
 * Storage 자료실 트리거 버킷: HANLAW_STORAGE_BUCKET — PDF·xlsx 업로드 시 청크·임베딩 (libraryPipeline)
 * 관리자 이메일: ADMIN_EMAILS (쉼표 구분, createLibraryDocument 등)
 * 닉네임: setUserNickname — Firestore hanlaw_user_profiles (클라이언트 직접 쓰기 불가, AI·티켓 호칭용)
 */

const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { consumeOneFromBatches } = require("./walletBatches");
const { appendPointLog, REASON } = require("./attendancePointLedger");

initializeApp();
const db = getFirestore();

const {
  generateOrGetDictionaryEntry,
  generateStatuteOxQuizzesGemini,
  generateStatuteEntryFromWebGemini
} = require("./dictionaryGemini");
const { effectiveGeminiModelId, uniqueGeminiModelCandidates } = require("./geminiModel");
const { retrieveLibraryContextForQuiz } = require("./libraryRag");
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
  publishEllyQaCommunity,
  unpublishEllyQaCommunity,
  adminBackfillLawyerQaCommunityVisible
} = require("./publicQa");
exports.revealLawyerQaAnswer = revealLawyerQaAnswer;
exports.publishLawyerQaPublic = publishLawyerQaPublic;
exports.searchLawyerQa = searchLawyerQa;
exports.publishLawyerQaCommunity = publishLawyerQaCommunity;
exports.unpublishLawyerQaCommunity = unpublishLawyerQaCommunity;
exports.publishEllyQaCommunity = publishEllyQaCommunity;
exports.unpublishEllyQaCommunity = unpublishEllyQaCommunity;
exports.adminBackfillLawyerQaCommunityVisible = adminBackfillLawyerQaCommunityVisible;

const MONTHLY_FREE_FOR_PAID = 4;
const BATCH_VALID_MS = 365 * 24 * 60 * 60 * 1000;
const ELLY_BATCH_VALID_MS = 30 * 24 * 60 * 60 * 1000;

/** 질문권 부족 시 안내(원화, 페이앱 기본과 맞출 것) */
const QUESTION_PACK_PRICE_HINT_KO =
  process.env.QUESTION_PACK_PRICE_HINT_KO ||
  "요금제에서 추가 구매: 10건 ₩5,000 · 20건 ₩10,000 · 30건 ₩15,000(구매일로부터 1개월 유효).";

/** 한국시간 기준 하루 1회, 퀴즈 1문제 이상 풀이 시 지급되는 포인트 */
const ATTENDANCE_POINTS_PER_DAY = 100;
/** 레거시(변호사 질문권 전환 종료). 유지 시 과거 문서·환경변수와 숫자만 맞추면 됨. */
const ATTENDANCE_POINTS_PER_CREDIT = 5000;
/** 포인트를 엘리(AI) 질문권 1건으로 바꿀 때 차감(convertAttendancePointsToEllyCredit) — 엘리 10건 팩 건당 약 ₩500 수준 */
const ATTENDANCE_POINTS_PER_ELLY_CREDIT = 500;
/** 앱 홍보 인증(관리자 승인 시) 지급 포인트 */
const PROMOTION_REWARD_POINTS = 9000;
/** 개선의견 채택 시 기본 지급 포인트(관리자가 Callable에서 가감 가능) */
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

exports.consumeQuestionCredit = onCall({ region: "asia-northeast3" }, async () => {
  throw new HttpsError("failed-precondition", "변호사 질문 기능은 더 이상 제공되지 않습니다.");
});

/**
 * 로그인 사용자가 퀴즈를 1문제 이상 풀었을 때(클라이언트에서 정답/오답 제출 직후 호출).
 * KST 달력일 기준 하루 1회만 포인트 지급. 엘리 질문권 전환은 대시보드에서 별도 버튼(convertAttendancePointsToEllyCredit).
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

exports.convertAttendancePointsToQuestionCredit = onCall({ region: "asia-northeast3" }, async () => {
  throw new HttpsError("failed-precondition", "변호사 질문권 전환은 더 이상 제공되지 않습니다.");
});

/**
 * 포인트를 차감하고 엘리(AI) 질문권 1건(PayApp 엘리 팩과 동일한 배치, 1개월 유효)을 지급합니다.
 */
exports.convertAttendancePointsToEllyCredit = onCall({ region: "asia-northeast3" }, async (request) => {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
  }
  const uid = request.auth.uid;
  const attRef = db.collection("hanlaw_attendance_rewards").doc(uid);
  const walletRef = db.collection("hanlaw_quiz_ai_wallet").doc(uid);
  const exp = Timestamp.fromMillis(Date.now() + ELLY_BATCH_VALID_MS);

  return db.runTransaction(async (t) => {
    const attSnap = await t.get(attRef);
    let points = Math.max(
      0,
      parseInt(attSnap.exists ? attSnap.data().attendancePoints : 0, 10) || 0
    );
    if (points < ATTENDANCE_POINTS_PER_ELLY_CREDIT) {
      throw new HttpsError(
        "failed-precondition",
        `엘리(AI) 질문권으로 바꾸려면 포인트가 ${ATTENDANCE_POINTS_PER_ELLY_CREDIT.toLocaleString("ko-KR")}점 이상이어야 합니다.`
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
        " (지급 포인트 9,000점. 대시보드에서 포인트를 질문권으로 전환할 수 있습니다.)",
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
 * 개선의견(suggestion) 티켓 승인: 답변 알림 + 선택적 채택 시 포인트(기본 IMPROVEMENT_DEFAULT_POINTS).
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
        ? `\n\n(채택 보상 ${awardPts.toLocaleString("ko-KR")}점이 포인트로 지급되었습니다.)`
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
  if (src.sourceQuestionNo != null && src.sourceQuestionNo !== "") {
    const n = parseInt(src.sourceQuestionNo, 10);
    if (Number.isFinite(n) && n >= 1 && n <= 500) out.sourceQuestionNo = n;
  }
  if (src.sourceChoiceNo != null && src.sourceChoiceNo !== "") {
    const n = parseInt(src.sourceChoiceNo, 10);
    if (Number.isFinite(n) && n >= 1 && n <= 5) out.sourceChoiceNo = n;
  }
  return out;
}

function parseBoolLoose(v) {
  if (v === true || v === false) return v;
  const s = String(v == null ? "" : v).trim().toUpperCase();
  if (s === "O" || s === "TRUE" || s === "1" || s === "Y" || s === "참") return true;
  if (s === "X" || s === "FALSE" || s === "0" || s === "N" || s === "거짓") return false;
  return null;
}

function pairKey(questionNo, choiceNo) {
  return String(questionNo) + "-" + String(choiceNo);
}

function parseIntInRange(v, min, max) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return null;
  if (n < min || n > max) return null;
  return n;
}

function extractQuestionNumbers(text) {
  const src = String(text || "");
  const set = new Set();
  const patterns = [
    /(?:^|\n)\s*(\d{1,3})\s*[.)]/g,
    /(?:^|\n)\s*(\d{1,3})\s*번\s*문(?:제)?/g,
    /문(?:항|제)\s*(\d{1,3})/g
  ];
  for (let i = 0; i < patterns.length; i++) {
    const re = patterns[i];
    let m;
    while ((m = re.exec(src))) {
      const q = parseIntInRange(m[1], 1, 500);
      if (q != null) set.add(q);
    }
  }
  const arr = Array.from(set);
  arr.sort((a, b) => a - b);
  return arr;
}

function inferQuestionNoFromRow(row) {
  if (!row) return null;
  const direct = parseIntInRange(row.sourceQuestionNo, 1, 500);
  if (direct != null) return direct;
  const blob = [String(row.id || ""), String(row.topic || ""), String(row.statement || "")].join("\n");
  let m = blob.match(/(\d{1,3})\s*번\s*문(?:제)?/);
  if (m && m[1]) return parseIntInRange(m[1], 1, 500);
  m = blob.match(/(?:^|\n)\s*(\d{1,3})\s*[.)]/);
  if (m && m[1]) return parseIntInRange(m[1], 1, 500);
  return null;
}

function inferChoiceNoFromRow(row) {
  if (!row) return null;
  const direct = parseIntInRange(row.sourceChoiceNo, 1, 5);
  if (direct != null) return direct;
  const statement = String(row.statement || "");
  const mDigit = statement.match(/(?:보기|선지|지문|선택지)?\s*([1-5])\s*[.)]/);
  if (mDigit && mDigit[1]) return parseIntInRange(mDigit[1], 1, 5);
  if (statement.includes("①")) return 1;
  if (statement.includes("②")) return 2;
  if (statement.includes("③")) return 3;
  if (statement.includes("④")) return 4;
  if (statement.includes("⑤")) return 5;
  return null;
}

function detectChoiceCountFromContext(text) {
  const s = String(text || "");
  if (s.includes("⑤")) return 5;
  return 4;
}

function extractJsonArrayFromText(raw) {
  const s = String(raw || "").trim();
  if (!s) return [];
  try {
    const parsed = JSON.parse(s);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {}
  const m = s.match(/```json\s*([\s\S]*?)```/i) || s.match(/```\s*([\s\S]*?)```/i);
  if (m && m[1]) {
    try {
      const parsed = JSON.parse(String(m[1]).trim());
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {}
  }
  const l = s.indexOf("[");
  const r = s.lastIndexOf("]");
  if (l >= 0 && r > l) {
    try {
      const parsed = JSON.parse(s.slice(l, r + 1));
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {}
  }
  return [];
}

function inferExamIdLoose(text) {
  const s = String(text || "").toLowerCase();
  if (!s) return "";
  if (s.includes("변호사")) return "lawyer";
  if (s.includes("국가직") && s.includes("9급")) return "grade9";
  if (s.includes("국가공무원") && s.includes("9급")) return "grade9";
  if (s.includes("9급")) return "grade9";
  if (s.includes("국가직") && s.includes("7급")) return "grade7";
  if (s.includes("국가공무원") && s.includes("7급")) return "grade7";
  if (s.includes("7급")) return "grade7";
  if (s.includes("국가직") && s.includes("5급")) return "grade5";
  if (s.includes("국가공무원") && s.includes("5급")) return "grade5";
  if (s.includes("5급")) return "grade5";
  if (s.includes("소방")) return "fire";
  if (s.includes("경찰")) return "police";
  if (s.includes("지방")) return "local";
  if (s.includes("관세") || s.includes("세관")) return "customs";
  if (s.includes("교육청")) return "edu";
  return "";
}

function inferYearLoose(text) {
  const m = String(text || "").match(/(19|20)\d{2}/);
  if (!m) return null;
  const y = parseInt(m[0], 10);
  if (!Number.isFinite(y) || y < 1990 || y > 2100) return null;
  return y;
}

async function generateLibraryQuizRows(apiKey, modelId, prompt) {
  const gen = new GoogleGenerativeAI(apiKey);
  const candidates = uniqueGeminiModelCandidates();
  const ordered = [];
  [modelId]
    .concat(candidates)
    .forEach((m) => {
      const mm = String(m || "").trim();
      if (!mm || ordered.includes(mm)) return;
      ordered.push(mm);
    });

  let lastErr = null;
  for (let i = 0; i < ordered.length; i++) {
    const mid = ordered[i];
    try {
      const model = gen.getGenerativeModel({
        model: mid,
        generationConfig: { temperature: 0.35, maxOutputTokens: 8192 }
      });
      const res = await model.generateContent(prompt);
      const txt = String(res && res.response && res.response.text ? res.response.text() : "").trim();
      const rows = extractJsonArrayFromText(txt);
      if (rows.length) return rows;
      throw new Error("모델 출력에서 JSON 배열을 추출하지 못했습니다.");
    } catch (e) {
      lastErr = e;
      const msg = String((e && e.message) || e || "").toLowerCase();
      if ((msg.includes("models/") && msg.includes("not found")) || msg.includes("no longer available")) {
        continue;
      }
    }
  }
  throw lastErr || new Error("Gemini 모델 호출에 실패했습니다.");
}

async function generateLibraryTermRows(apiKey, modelId, prompt) {
  const gen = new GoogleGenerativeAI(apiKey);
  const candidates = uniqueGeminiModelCandidates();
  const ordered = [];
  [modelId]
    .concat(candidates)
    .forEach((m) => {
      const mm = String(m || "").trim();
      if (!mm || ordered.includes(mm)) return;
      ordered.push(mm);
    });

  let lastErr = null;
  for (let i = 0; i < ordered.length; i++) {
    const mid = ordered[i];
    try {
      const model = gen.getGenerativeModel({
        model: mid,
        generationConfig: { temperature: 0.35, maxOutputTokens: 8192 }
      });
      const res = await model.generateContent(prompt);
      const txt = String(res && res.response && res.response.text ? res.response.text() : "").trim();
      const rows = extractJsonArrayFromText(txt);
      if (rows.length) return rows;
      throw new Error("모델 출력에서 JSON 배열을 추출하지 못했습니다.");
    } catch (e) {
      lastErr = e;
      const msg = String((e && e.message) || e || "").toLowerCase();
      if ((msg.includes("models/") && msg.includes("not found")) || msg.includes("no longer available")) {
        continue;
      }
    }
  }
  throw lastErr || new Error("Gemini 모델 호출에 실패했습니다.");
}

function defaultExplainFromStatement(statement, answer, topic) {
  const st = String(statement || "").trim();
  const tp = String(topic || "행정법").trim();
  const ans = answer === true ? "O(참)" : "X(거짓)";
  const brief = st ? st.slice(0, 120) : "해당 지문";
  return {
    explanation:
      "정답은 " +
      ans +
      "입니다. " +
      brief +
      " 지문은 " +
      tp +
      "의 기본 법리와 판례 태도를 기준으로 판단해야 하며, 문언의 절대적 표현 여부와 예외를 함께 확인해야 합니다.",
    explanationBasic: "정답은 " + ans + "이며, 문언의 요건·예외를 함께 검토해야 합니다."
  };
}

async function enrichLibraryQuizRows(apiKey, modelId, rows, userPrompt, ragContext, examId, year) {
  if (!Array.isArray(rows) || !rows.length) return [];
  const out = [];
  const batchSize = 20;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const prompt = [
      "당신은 행정법 기출문제 해설 편집자입니다.",
      "아래 입력 문항 배열을 받아 해설 필드를 채운 JSON 배열만 출력하세요.",
      "마크다운/설명 금지, JSON 배열만 출력.",
      "",
      "[입력 배열의 각 원소에서 유지할 필드]",
      "- sourceQuestionNo, sourceChoiceNo, topic, statement, answer",
      "",
      "[추가/보강할 필드]",
      "- explanation(필수), explanationBasic(필수), legal(선택), trap(선택), precedent(선택), importance(1~5), difficulty(1~5), tags",
      "",
      "[규칙]",
      "- explanation은 2~5문장, 근거 없는 추측 금지.",
      "- explanationBasic은 1문장 핵심.",
      "- 출력 배열 길이는 입력과 같아야 함.",
      "- 시험종류(examId): " + examId + ", 연도(year): " + year,
      "",
      "[생성 지시]",
      userPrompt,
      "",
      "[자료실 발췌(RAG)]",
      String(ragContext || "").slice(0, 12000),
      "",
      "[입력 문항 배열]",
      JSON.stringify(batch)
    ].join("\n");
    let enriched = [];
    try {
      enriched = await generateLibraryQuizRows(apiKey, modelId, prompt);
    } catch (_) {
      enriched = [];
    }
    const byKey = {};
    for (let j = 0; j < enriched.length; j++) {
      const r = enriched[j] || {};
      const qNo = parseIntInRange(r.sourceQuestionNo, 1, 500);
      const cNo = parseIntInRange(r.sourceChoiceNo, 1, 5);
      if (qNo == null || cNo == null) continue;
      byKey[pairKey(qNo, cNo)] = r;
    }
    for (let j = 0; j < batch.length; j++) {
      const base = batch[j] || {};
      const qNo = parseIntInRange(base.sourceQuestionNo, 1, 500);
      const cNo = parseIntInRange(base.sourceChoiceNo, 1, 5);
      const key = qNo != null && cNo != null ? pairKey(qNo, cNo) : "";
      const add = key && byKey[key] ? byKey[key] : {};
      const ans = typeof base.answer === "boolean" ? base.answer : parseBoolLoose(base.answer) === true;
      const fallback = defaultExplainFromStatement(base.statement, ans, base.topic);
      out.push({
        sourceQuestionNo: qNo,
        sourceChoiceNo: cNo,
        topic: String(add.topic || base.topic || "").trim(),
        statement: String(add.statement || base.statement || "").trim(),
        answer: parseBoolLoose(add.answer) == null ? ans : parseBoolLoose(add.answer),
        explanation: String(add.explanation || "").trim() || fallback.explanation,
        explanationBasic: String(add.explanationBasic || "").trim() || fallback.explanationBasic,
        legal: String(add.legal || "").trim(),
        trap: String(add.trap || "").trim(),
        precedent: String(add.precedent || "").trim(),
        tags: Array.isArray(add.tags) ? add.tags : [],
        importance: add.importance,
        difficulty: add.difficulty
      });
    }
  }
  return out;
}

exports.adminGenerateQuizFromLibrary = onCall(
  { region: "asia-northeast3", timeoutSeconds: 300, memory: "1GiB" },
  async (request) => {
  assertAdminCallable(request);
  const data = request.data || {};
  const userPrompt = String(data.prompt || "").trim();
  const examIdInput = String(data.examId || "").trim().toLowerCase();
  const topicInput = String(data.topic || "").trim();
  const yearInput = parseInt(data.year, 10);
  const inferredExamId = String(data.inferredExamId || "").trim().toLowerCase();
  const inferredYearRaw = parseInt(data.inferredYear, 10);
  const inferredYear = Number.isFinite(inferredYearRaw) ? inferredYearRaw : null;
  const generateAll = data.generateAll !== false;
  const questionOnly = parseIntInRange(data.questionOnly, 1, 500);
  const expectedCountInput = parseInt(data.expectedCount, 10);
  const scanOnly = data.scanOnly === true;
  const fastMode = data.fastMode !== false;
  const fileIds = Array.isArray(data.fileIds)
    ? data.fileIds.map((x) => String(x || "").trim()).filter(Boolean).slice(0, 30)
    : [];
  if (!userPrompt) throw new HttpsError("invalid-argument", "생성 지시(prompt)가 필요합니다.");

  const apiKey = process.env.GEMINI_API_KEY || "";
  if (!apiKey) {
    throw new HttpsError("failed-precondition", "서버에 GEMINI_API_KEY가 설정되지 않았습니다.");
  }

  const t0 = Date.now();
  let ragContext = "";
  try {
    ragContext = await retrieveLibraryContextForQuiz(
      userPrompt,
      { topic: topicInput || "행정법 기출문제", statement: "" },
      fileIds.length ? { fileIds } : undefined
    );
  } catch (e) {
    console.warn("adminGenerateQuizFromLibrary RAG", e && e.message);
  }
  if (!String(ragContext || "").trim()) {
    throw new HttpsError(
      "failed-precondition",
      "자료실 컨텍스트를 찾지 못했습니다. 파일 업로드 후 '학습 중'이 '완료'가 된 뒤 다시 시도하세요."
    );
  }
  const ragMs = Date.now() - t0;
  console.info("adminGenerateQuizFromLibrary phase:rag", {
    scanOnly,
    questionOnly: questionOnly || null,
    fastMode,
    ragChars: String(ragContext || "").length,
    elapsedMs: ragMs
  });

  const inferredFromTextExam = inferExamIdLoose(userPrompt + "\n" + ragContext.slice(0, 4000));
  const inferredFromTextYear = inferYearLoose(userPrompt + "\n" + ragContext.slice(0, 4000));
  const inferredQuestionNos = extractQuestionNumbers(ragContext);
  const detectedChoiceCount = detectChoiceCountFromContext(ragContext);
  const resolvedExamId = examIdInput || inferredExamId || inferredFromTextExam;
  const resolvedYear = Number.isFinite(yearInput)
    ? yearInput
    : Number.isFinite(inferredYear)
      ? inferredYear
      : inferredFromTextYear;
  if (!resolvedExamId) {
    throw new HttpsError("invalid-argument", "시험 종류를 자동 인식하지 못했습니다. 파일명에 시험명을 포함해 주세요.");
  }
  if (!Number.isFinite(resolvedYear)) {
    throw new HttpsError("invalid-argument", "연도를 자동 인식하지 못했습니다. 파일명에 연도(예: 2026)를 포함해 주세요.");
  }
  if (scanOnly) {
    return {
      ok: true,
      examId: resolvedExamId,
      year: resolvedYear,
      questionNos: inferredQuestionNos,
      detectedChoiceCount
    };
  }
  const expectedCount = Number.isFinite(expectedCountInput)
    ? Math.max(1, Math.min(500, expectedCountInput))
    : inferredQuestionNos.length
      ? Math.min(500, inferredQuestionNos.length * detectedChoiceCount)
      : 120;

  const modelId = effectiveGeminiModelId();
  const collectedRows = [];
  const collectedPairSet = new Set();
  const failRows = [];

  function buildMissingPairs(maxQuestionNo) {
    const out = [];
    const qStart = questionOnly || 1;
    const qEnd = questionOnly || maxQuestionNo;
    for (let qNo = qStart; qNo <= qEnd; qNo++) {
      const cStart = 1;
      const cEnd = detectedChoiceCount || 4;
      for (let cNo = cStart; cNo <= cEnd; cNo++) {
        const key = pairKey(qNo, cNo);
        if (!collectedPairSet.has(key)) out.push(key);
      }
    }
    return out;
  }

  const maxQuestionNo = inferredQuestionNos.length ? inferredQuestionNos[inferredQuestionNos.length - 1] : null;
  const maxRounds = questionOnly ? (fastMode ? 1 : 2) : (generateAll ? (fastMode ? 3 : 6) : 2);
  const ragForGeneration = String(ragContext || "").slice(0, fastMode ? (questionOnly ? 5000 : 10000) : (questionOnly ? 8000 : 16000));
  for (let round = 0; round < maxRounds; round++) {
    const missingPairs = maxQuestionNo ? buildMissingPairs(maxQuestionNo) : [];
    if (round > 0 && generateAll && maxQuestionNo && !missingPairs.length) break;
    const missingHint = missingPairs.length ? missingPairs.slice(0, 120).join(", ") : "(미지정)";
    const generationPrompt = [
      "당신은 행정법 기출문제 편집자입니다.",
      "아래 자료 발췌를 바탕으로 먼저 문항 구조만 추출하세요.",
      "마크다운/설명/코드블록 금지, JSON 배열만 출력.",
      "",
      "[반드시 지킬 출력 스키마]",
      "[",
      "  {",
      '    "id": "ai-고유값",',
      '    "sourceQuestionNo": 1 이상의 정수,',
      '    "sourceChoiceNo": 1~5 정수,',
      '    "topic": "주제",',
      '    "statement": "문제 지문(OX 판단문)",',
      '    "answer": true 또는 false',
      "  }",
      "]",
      "",
      "[규칙]",
      "- 각 문제는 보기 1~" + (detectedChoiceCount || 4) + "를 각각 1개 OX 문항으로 분해하세요.",
      "- sourceQuestionNo/sourceChoiceNo를 반드시 채우세요.",
      questionOnly ? "- 이번 배치는 sourceQuestionNo를 반드시 " + questionOnly + "로만 생성하세요." : "",
      "- 파일 순서 기준으로 1번부터 마지막까지 생성하되, 누락 쌍을 우선 보완하세요.",
      "- 누락 쌍(문항-보기): " + missingHint,
      "- 목표 생성 개수(총): " + expectedCount,
      "- 이 단계는 해설 생성이 아니라 구조 추출 단계다.",
      "- 자료에 없는 내용 추측 금지.",
      "- 문장은 한국어로 명확하게 작성.",
      "- 시험 종류(examId): " + resolvedExamId,
      "- 연도(year): " + resolvedYear,
      "",
      "[사용자 생성 지시]",
      userPrompt,
      "",
      "[자료실 발췌(RAG)]",
      ragForGeneration
    ].join("\n");

    let rows = [];
    try {
      rows = await generateLibraryQuizRows(apiKey, modelId, generationPrompt);
    } catch (e) {
      const em = String((e && e.message) || "모델 출력 파싱 실패");
      failRows.push({ index: -(round + 1), reason: "라운드 " + (round + 1) + " 생성 실패: " + em });
      continue;
    }
    if (!rows.length) {
      failRows.push({ index: -(round + 1), reason: "라운드 " + (round + 1) + " 생성 결과 비어 있음" });
      continue;
    }
    let acceptedInRound = 0;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i] || {};
      const qNo = inferQuestionNoFromRow(r);
      const cNo = inferChoiceNoFromRow(r);
      if (qNo == null || cNo == null) {
        failRows.push({ index: i + 1, reason: "sourceQuestionNo/sourceChoiceNo 인식 실패" });
        continue;
      }
      if (questionOnly && qNo !== questionOnly) continue;
      if (cNo > (detectedChoiceCount || 4)) continue;
      const key = pairKey(qNo, cNo);
      if (collectedPairSet.has(key)) continue;
      r.sourceQuestionNo = qNo;
      r.sourceChoiceNo = cNo;
      collectedRows.push(r);
      collectedPairSet.add(key);
      acceptedInRound += 1;
      if (collectedRows.length >= expectedCount) break;
    }
    if (collectedRows.length >= expectedCount) break;
    if (acceptedInRound < 1 && round >= 1) break;
  }

  if (!collectedRows.length) {
    throw new HttpsError(
      "failed-precondition",
      "모델이 퀴즈 JSON을 안정적으로 반환하지 못했습니다. 파일을 2~3개로 나눠 업로드하거나 지시문을 짧게 줄여 다시 시도해 주세요."
    );
  }

  const tGenDone = Date.now();
  console.info("adminGenerateQuizFromLibrary phase:generate", {
    questionOnly: questionOnly || null,
    fastMode,
    collected: collectedRows.length,
    failCount: failRows.length,
    elapsedMs: tGenDone - t0
  });

  // 2단계: fastMode가 아니면 해설/태그를 보강한다.
  let enrichedRows = [];
  if (fastMode) {
    enrichedRows = collectedRows.map((r) => {
      const ansRaw = parseBoolLoose(r.answer);
      const ans = ansRaw == null ? false : ansRaw;
      const fallback = defaultExplainFromStatement(r.statement, ans, r.topic);
      return Object.assign({}, r, {
        answer: ans,
        explanation: String(r.explanation || "").trim() || fallback.explanation,
        explanationBasic: String(r.explanationBasic || "").trim() || fallback.explanationBasic
      });
    });
  } else {
    enrichedRows = await enrichLibraryQuizRows(
      apiKey,
      modelId,
      collectedRows,
      userPrompt,
      ragContext,
      resolvedExamId,
      resolvedYear
    );
  }

  const email = String(request.auth.token.email || "").toLowerCase();
  const batch = db.batch();
  const stagedRows = [];
  for (let i = 0; i < enrichedRows.length; i++) {
    try {
      const r = enrichedRows[i] || {};
      const answer = parseBoolLoose(r.answer);
      const baseId = String(r.id || "").trim() || `ai-${Date.now().toString(36)}-${i + 1}`;
      const rowExamId = String(r.examId || "").trim().toLowerCase();
      const rowYear = parseInt(r.year, 10);
      const payload = {
        id: baseId,
        examId: rowExamId || resolvedExamId,
        year: Number.isFinite(rowYear) ? rowYear : resolvedYear,
        exam: rowExamId || resolvedExamId,
        topic: String(r.topic || topicInput || "행정법 기출").trim(),
        statement: String(r.statement || "").trim(),
        answer: answer === null ? false : answer,
        explanation: String(r.explanation || "").trim(),
        explanationBasic: String(r.explanationBasic || "").trim(),
        detail: {
          legal: String(r.legal || "").trim(),
          trap: String(r.trap || "").trim(),
          precedent: String(r.precedent || "").trim()
        },
        tags: Array.isArray(r.tags) ? r.tags.map((x) => String(x || "").trim()).filter(Boolean) : [],
        importance: parseInt(r.importance, 10),
        difficulty: parseInt(r.difficulty, 10),
        sourceQuestionNo: parseIntInRange(r.sourceQuestionNo, 1, 500),
        sourceChoiceNo: parseIntInRange(r.sourceChoiceNo, 1, 5)
      };
      if (!payload.explanationBasic) delete payload.explanationBasic;
      if (!payload.tags.length) delete payload.tags;
      if (!payload.detail.legal && !payload.detail.trap && !payload.detail.precedent) delete payload.detail;
      if (!Number.isFinite(payload.importance)) delete payload.importance;
      if (!Number.isFinite(payload.difficulty)) delete payload.difficulty;

      const clean = sanitizeQuizPayload(payload);
      const ref = db.collection(STAGING_QUIZ_COLLECTION).doc();
      batch.set(ref, {
        entityType: "quiz",
        questionId: clean.id,
        payload: clean,
        status: "reviewing",
        source: "ai-library",
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
      stagedRows.push(clean);
      if (stagedRows.length >= 500) break;
    } catch (e) {
      failRows.push({ index: i + 1, reason: e && e.message ? e.message : "형식 오류" });
    }
  }
  if (!stagedRows.length) {
    throw new HttpsError("failed-precondition", "유효한 퀴즈가 생성되지 않았습니다.");
  }
  await batch.commit();
  console.info("adminGenerateQuizFromLibrary phase:done", {
    questionOnly: questionOnly || null,
    fastMode,
    staged: stagedRows.length,
    elapsedMs: Date.now() - t0
  });
  return {
    ok: true,
    okCount: stagedRows.length,
    examId: resolvedExamId,
    year: resolvedYear,
    expectedCount,
    failRows,
    items: stagedRows.slice(0, 20)
  };
  }
);

exports.adminGenerateTermsFromLibrary = onCall({ region: "asia-northeast3" }, async (request) => {
  assertAdminCallable(request);
  const data = request.data || {};
  const userPrompt = String(data.prompt || "").trim();
  const countInput = parseInt(data.count, 10);
  const count = Number.isFinite(countInput) ? Math.max(1, Math.min(30, countInput)) : 10;
  const fileIds = Array.isArray(data.fileIds)
    ? data.fileIds.map((x) => String(x || "").trim()).filter(Boolean).slice(0, 30)
    : [];
  if (!userPrompt) throw new HttpsError("invalid-argument", "생성 지시(prompt)가 필요합니다.");

  const apiKey = process.env.GEMINI_API_KEY || "";
  if (!apiKey) {
    throw new HttpsError("failed-precondition", "서버에 GEMINI_API_KEY가 설정되지 않았습니다.");
  }

  let ragContext = "";
  try {
    ragContext = await retrieveLibraryContextForQuiz(
      userPrompt,
      { topic: "행정법 용어사전", statement: "" },
      fileIds.length ? { fileIds } : undefined
    );
  } catch (e) {
    console.warn("adminGenerateTermsFromLibrary RAG", e && e.message);
  }
  if (!String(ragContext || "").trim()) {
    throw new HttpsError(
      "failed-precondition",
      "자료실 컨텍스트를 찾지 못했습니다. 파일 업로드 후 '학습 중'이 '완료'가 된 뒤 다시 시도하세요."
    );
  }

  const generationPrompt = [
    "당신은 행정법 용어사전 편집자입니다.",
    "아래 자료 발췌를 기반으로 행정법 관련 용어를 선별해 JSON 배열만 출력하세요.",
    "마크다운/설명/코드블록 금지, JSON 배열만 출력.",
    "",
    "[출력 스키마]",
    "[",
    "  {",
    '    "term": "용어명",',
    '    "aliases": ["동의어1","동의어2"],',
    '    "definition": "수험생 기준으로 명확한 설명",',
    '    "oxQuizzes": [',
    '      {"statement":"OX 문장","answer":true 또는 false,"explanation":"해설","explanationBasic":"한 줄 핵심"}',
    "    ]",
    "  }",
    "]",
    "",
    "[규칙]",
    "- count=" + count + "개 생성",
    "- 자료에 없는 내용 추측 금지",
    "- definition은 너무 짧지 않게(2~5문장 권장), 수험 관점으로 작성",
    "- oxQuizzes는 각 용어당 1~3개",
    "- 중복 용어 금지",
    "",
    "[사용자 생성 지시]",
    userPrompt,
    "",
    "[자료실 발췌(RAG)]",
    ragContext
  ].join("\n");

  const modelId = effectiveGeminiModelId();
  const rows = await generateLibraryTermRows(apiKey, modelId, generationPrompt);
  if (!rows.length) {
    throw new HttpsError("failed-precondition", "생성 결과가 비어 있습니다. 지시문을 구체화해 주세요.");
  }

  const email = String(request.auth.token.email || "").toLowerCase();
  const batch = db.batch();
  const failRows = [];
  const stagedRows = [];
  for (let i = 0; i < rows.length; i++) {
    try {
      const payload = sanitizeTermPayload(rows[i] || {});
      const entryKey = String(payload.term || "").trim();
      const ref = db.collection(STAGING_TERM_COLLECTION).doc();
      batch.set(ref, {
        entityType: "term",
        entryKey,
        payload,
        status: "reviewing",
        source: "ai-library",
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
      stagedRows.push(payload);
      if (stagedRows.length >= count) break;
    } catch (e) {
      failRows.push({ index: i + 1, reason: e && e.message ? e.message : "형식 오류" });
    }
  }
  if (!stagedRows.length) {
    throw new HttpsError("failed-precondition", "유효한 용어가 생성되지 않았습니다.");
  }
  await batch.commit();
  return {
    ok: true,
    okCount: stagedRows.length,
    failRows,
    items: stagedRows.slice(0, 20)
  };
});

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

function sanitizeDictOxQuizzes(input, maxItems) {
  const cap =
    Number.isFinite(maxItems) && maxItems > 0 ? Math.min(10, Math.floor(maxItems)) : 5;
  if (!Array.isArray(input)) return [];
  function normalizeOxAnswer(v) {
    if (v === true || v === false) return v;
    const s = String(v == null ? "" : v).trim().toLowerCase();
    if (s === "o" || s === "true" || s === "참" || s === "1") return true;
    if (s === "x" || s === "false" || s === "거짓" || s === "0") return false;
    return null;
  }
  const out = [];
  for (let i = 0; i < input.length; i++) {
    const row = input[i] || {};
    const statement = String(row.statement || "").trim().slice(0, 600);
    const answer = normalizeOxAnswer(row.answer);
    const explanation = String(row.explanation || "").trim().slice(0, 2000);
    const explanationBasicRaw =
      row.explanationBasic == null ? explanation : String(row.explanationBasic || "").trim();
    const explanationBasic = explanationBasicRaw.slice(0, 2000);
    if (!statement || answer == null || !explanation) continue;
    out.push({
      statement,
      answer,
      explanation,
      explanationBasic: explanationBasic || explanation
    });
    if (out.length >= cap) break;
  }
  return out;
}

function sanitizeTermPayload(raw) {
  const src = raw || {};
  const term = String(src.term || "").trim();
  if (!term) throw new HttpsError("invalid-argument", "용어(term)가 필요합니다.");
  const out = {
    term,
    aliases: Array.isArray(src.aliases)
      ? src.aliases.map((x) => String(x || "").trim()).filter(Boolean).slice(0, 30)
      : [],
    definition: String(src.definition || "").trim(),
    oxQuizzes: sanitizeDictOxQuizzes(src.oxQuizzes, 3)
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
    caseFullText: String(src.caseFullText || "").trim(),
    oxQuizzes: sanitizeDictOxQuizzes(src.oxQuizzes, 5),
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

exports.adminStageDictBatch = onCall({ region: "asia-northeast3" }, async (request) => {
  assertAdminCallable(request);
  const entityTypeRaw = String((request.data && request.data.entityType) || "term")
    .trim()
    .toLowerCase();
  const entityType = entityTypeRaw === "case" ? "case" : "term";
  const rows = Array.isArray(request.data && request.data.rows) ? request.data.rows : [];
  if (!rows.length) throw new HttpsError("invalid-argument", "rows 배열이 필요합니다.");
  if (rows.length > 500) throw new HttpsError("invalid-argument", "한 번에 최대 500건까지 가능합니다.");
  const email = String(request.auth.token.email || "").toLowerCase();
  const col = dictStagingCollectionByType(entityType);
  const batch = db.batch();
  let okCount = 0;
  const failRows = [];
  rows.forEach((row, idx) => {
    try {
      const payload = sanitizeDictPayload(entityType, row);
      const entryKey = dictKeyByType(entityType, payload);
      const ref = db.collection(col).doc();
      batch.set(ref, {
        entityType,
        entryKey,
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
    oxQuizzes: sanitizeDictOxQuizzes(entry.oxQuizzes, 3),
    updatedAt: FieldValue.serverTimestamp()
  };
  await db.collection("hanlaw_dict_statutes").doc(id).set(payload, { merge: true });
  return { ok: true, id };
});

exports.generateDictStatuteOxQuizzes = onCall({ region: "asia-northeast3" }, async (request) => {
  assertAdminCallable(request);
  const statuteKey = String((request.data && request.data.statuteKey) || "").trim();
  const heading = String((request.data && request.data.heading) != null ? request.data.heading : "").trim();
  const body = String((request.data && request.data.body) != null ? request.data.body : "").trim();
  if (!statuteKey) {
    throw new HttpsError("invalid-argument", "statuteKey가 필요합니다.");
  }
  if (!body) {
    throw new HttpsError("invalid-argument", "본문(body)을 입력해 주세요.");
  }
  const apiKey = process.env.GEMINI_API_KEY || "";
  if (!apiKey) {
    throw new HttpsError("failed-precondition", "서버에 GEMINI_API_KEY가 설정되지 않았습니다.");
  }
  const oxQuizzes = await generateStatuteOxQuizzesGemini(
    statuteKey,
    heading,
    body,
    apiKey,
    effectiveGeminiModelId()
  );
  return { ok: true, oxQuizzes };
});

exports.generateDictStatuteFromWeb = onCall({ region: "asia-northeast3" }, async (request) => {
  assertAdminCallable(request);
  const statuteKey = String((request.data && request.data.statuteKey) || "").trim();
  const headingHint = String((request.data && request.data.headingHint) || "").trim();
  const bodyHint = String((request.data && request.data.bodyHint) || "").trim();
  if (!statuteKey) {
    throw new HttpsError("invalid-argument", "statuteKey가 필요합니다.");
  }
  const apiKey = process.env.GEMINI_API_KEY || "";
  if (!apiKey) {
    throw new HttpsError("failed-precondition", "서버에 GEMINI_API_KEY가 설정되지 않았습니다.");
  }
  const payload = await generateStatuteEntryFromWebGemini(
    statuteKey,
    headingHint,
    bodyHint,
    apiKey,
    effectiveGeminiModelId()
  );
  return { ok: true, entry: payload };
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
