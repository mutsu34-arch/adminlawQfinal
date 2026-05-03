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
 * PortOne V2 + KPN 등: PORTONE_API_SECRET, PORTONE_STORE_ID, PORTONE_CHANNEL_KEY_KPN
 * preparePortOnePayment, completePortOnePayment — 엘리 팩·구독권(한국시간 달력 1개월 연장)
 *
 * 포인트→엘리 질문권: convertAttendancePointsToEllyCredit (대시보드). 변호사 질문권 전환·차감은 종료됨.
 * 개선의견 채택: adminApproveSuggestionTicket (관리자, 포인트 지급)
 * 공개 Q&A: publishLawyerQaPublic(관리자, 비공개 스텁), publishLawyerQaCommunity(질문자 옵트인), publishEllyQaCommunity·unpublishEllyQaCommunity(엘리 질문자 옵트인), searchLawyerQa, revealLawyerQaAnswer, adminBackfillLawyerQaCommunityVisible(관리자 1회)
 * 배포: 프로젝트 루트에서 firebase deploy --only functions,firestore:rules
 *
 * 사전·퀴즈 AI: GEMINI_API_KEY, 선택 GEMINI_MODEL (기본 gemini-2.0-flash, 구형 gemini-1.5-flash-latest 는 1.5-flash 로 치환)
 * 퀴즈 AI: quizAskGemini — 유료 구독 플랜별 일일 한도(hanlaw_quiz_ai_usage) + 엘리 질문권(hanlaw_quiz_ai_wallet); ellyUnlimitedUntil·구매 배치 유지
 * 엘리 팩 금액 env: PORTONE_KRW_EQ10/20/30 (선택, 미설정 시 PAYAPP_KRW_EQ* 레거시명 호환)
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
const { addCalendarMonthsKst } = require("./kstCalendar");

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
  preparePortOnePayment,
  completePortOnePayment,
  cancelPortOneRecurring,
  runPortOneRecurringBilling
} = require("./portonePayments");
exports.preparePortOnePayment = preparePortOnePayment;
exports.completePortOnePayment = completePortOnePayment;
exports.cancelPortOneRecurring = cancelPortOneRecurring;
exports.runPortOneRecurringBilling = runPortOneRecurringBilling;

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

/** 질문권 부족 시 안내(원화, 요금제 표시와 맞출 것) */
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
 * 포인트를 차감하고 엘리(AI) 질문권 1건(지갑 배치, 한국시간 달력 1개월 유효)을 지급합니다.
 */
exports.convertAttendancePointsToEllyCredit = onCall({ region: "asia-northeast3" }, async (request) => {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
  }
  const uid = request.auth.uid;
  const attRef = db.collection("hanlaw_attendance_rewards").doc(uid);
  const walletRef = db.collection("hanlaw_quiz_ai_wallet").doc(uid);
  const purchaseMs = Date.now();
  const exp = Timestamp.fromMillis(addCalendarMonthsKst(purchaseMs, 1));

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

const ADMIN_QUIZ_TEMPLATE_COLLECTION = "hanlaw_admin_settings";
const ADMIN_QUIZ_TEMPLATE_DOC_PREFIX = "quiz_prompt_templates_";

function normalizePromptTemplateRow(row) {
  const src = row || {};
  const id = String(src.id || "").trim().slice(0, 80);
  const name = String(src.name || "").trim().slice(0, 80);
  const text = String(src.text || "").trim().slice(0, 12000);
  const updatedAtRaw = parseInt(src.updatedAt, 10);
  const updatedAt = Number.isFinite(updatedAtRaw) ? updatedAtRaw : Date.now();
  if (!id || !name || !text) return null;
  return { id, name, text, updatedAt };
}

function normalizePromptTemplateStore(raw) {
  const out = { past: [], expected: [] };
  ["past", "expected"].forEach((k) => {
    const list = raw && Array.isArray(raw[k]) ? raw[k] : [];
    const acc = [];
    for (let i = 0; i < list.length; i++) {
      const item = normalizePromptTemplateRow(list[i]);
      if (!item) continue;
      acc.push(item);
      if (acc.length >= 50) break;
    }
    out[k] = acc;
  });
  return out;
}

exports.adminGetQuizPromptTemplates = onCall({ region: "asia-northeast3" }, async (request) => {
  assertAdminCallable(request);
  const uid = String(request.auth.uid || "").trim();
  const ref = db.collection(ADMIN_QUIZ_TEMPLATE_COLLECTION).doc(ADMIN_QUIZ_TEMPLATE_DOC_PREFIX + uid);
  const snap = await ref.get();
  const data = snap.exists ? snap.data() : {};
  return { ok: true, templates: normalizePromptTemplateStore(data && data.templates) };
});

exports.adminSaveQuizPromptTemplates = onCall({ region: "asia-northeast3" }, async (request) => {
  assertAdminCallable(request);
  const uid = String(request.auth.uid || "").trim();
  const templates = normalizePromptTemplateStore(request.data && request.data.templates);
  const ref = db.collection(ADMIN_QUIZ_TEMPLATE_COLLECTION).doc(ADMIN_QUIZ_TEMPLATE_DOC_PREFIX + uid);
  await ref.set(
    {
      templates,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: String(request.auth.token.email || "").toLowerCase()
    },
    { merge: true }
  );
  return { ok: true };
});

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
  if (src.sourceChoiceLabel != null && String(src.sourceChoiceLabel).trim()) {
    const label = String(src.sourceChoiceLabel).trim().slice(0, 20);
    out.sourceChoiceLabel = label;
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
  const blob = [String(row.id || ""), String(row.topic || ""), statement].join("\n");
  const mDigit = blob.match(/(?:보기|선지|지문|선택지)?\s*([1-5])\s*[.)]/);
  if (mDigit && mDigit[1]) return parseIntInRange(mDigit[1], 1, 5);
  if (blob.includes("①")) return 1;
  if (blob.includes("②")) return 2;
  if (blob.includes("③")) return 3;
  if (blob.includes("④")) return 4;
  if (blob.includes("⑤")) return 5;
  const KOR_CHO = ["ㄱ", "ㄴ", "ㄷ", "ㄹ", "ㅁ"];
  for (let i = 0; i < KOR_CHO.length; i++) {
    const ch = KOR_CHO[i];
    const re = new RegExp("(?:^|\\n|\\s|[[(])" + ch + "\\s*[.)\\],:：]", "m");
    if (re.test(blob)) return i + 1;
    if (blob.includes(ch + ",")) return i + 1;
  }
  const KOR_GA = ["가", "나", "다", "라", "마"];
  for (let i = 0; i < KOR_GA.length; i++) {
    const ch = KOR_GA[i];
    const re = new RegExp("(?:^|\\n|\\s|[[(])" + ch + "\\s*[.)\\],:：]", "m");
    if (re.test(blob)) return i + 1;
    if (blob.includes(ch + ",")) return i + 1;
  }
  return null;
}

function inferChoiceLabelFromRow(row) {
  if (!row) return "";
  const direct = String(row.sourceChoiceLabel || "").trim();
  if (direct) return direct.slice(0, 20);
  const statement = String(row.statement || "");
  const blob = [String(row.id || ""), String(row.topic || ""), statement].join("\n");
  const mDigit = blob.match(/(?:보기|선지|지문|선택지)?\s*([1-5])\s*[.)]/);
  if (mDigit && mDigit[1]) return mDigit[1];
  const circled = ["①", "②", "③", "④", "⑤"];
  for (let i = 0; i < circled.length; i++) {
    if (blob.includes(circled[i])) return circled[i];
  }
  const KOR_CHO = ["ㄱ", "ㄴ", "ㄷ", "ㄹ", "ㅁ"];
  for (let i = 0; i < KOR_CHO.length; i++) {
    const ch = KOR_CHO[i];
    const re = new RegExp("(?:^|\\n|\\s|[[(])" + ch + "\\s*[.)\\],:：]", "m");
    if (re.test(blob) || blob.includes(ch + ",")) return ch;
  }
  const KOR_GA = ["가", "나", "다", "라", "마"];
  for (let i = 0; i < KOR_GA.length; i++) {
    const ch = KOR_GA[i];
    const re = new RegExp("(?:^|\\n|\\s|[[(])" + ch + "\\s*[.)\\],:：]", "m");
    if (re.test(blob) || blob.includes(ch + ",")) return ch;
  }
  return "";
}

function detectChoiceCountFromContext(text) {
  const s = String(text || "");
  function count(re) {
    const m = s.match(re);
    return m ? m.length : 0;
  }

  // 1) 기본은 4지선다로 시작한다.
  let detected = 4;

  // 2) 원문 선지 표기 패턴(줄 시작 기준) 개수를 본다.
  const c1 = count(/(?:^|\n)\s*①\s+/g);
  const c2 = count(/(?:^|\n)\s*②\s+/g);
  const c3 = count(/(?:^|\n)\s*③\s+/g);
  const c4 = count(/(?:^|\n)\s*④\s+/g);
  const c5 = count(/(?:^|\n)\s*⑤\s+/g);

  // 숫자 선지(1. 2. 3. 4. 5.)는 해설 숫자와 충돌하므로 줄 시작 + 뒤 공백을 강제한다.
  const d1 = count(/(?:^|\n)\s*(?:보기|선지|지문|선택지)?\s*1[.)]\s+/g);
  const d2 = count(/(?:^|\n)\s*(?:보기|선지|지문|선택지)?\s*2[.)]\s+/g);
  const d3 = count(/(?:^|\n)\s*(?:보기|선지|지문|선택지)?\s*3[.)]\s+/g);
  const d4 = count(/(?:^|\n)\s*(?:보기|선지|지문|선택지)?\s*4[.)]\s+/g);
  const d5 = count(/(?:^|\n)\s*(?:보기|선지|지문|선택지)?\s*5[.)]\s+/g);

  // 3) 5지선다는 강한 근거가 있을 때만 허용한다.
  const hasStrong5Circled = c5 > 0 && c4 > 0 && c3 > 0 && c2 > 0 && c1 > 0;
  const hasStrong5Digit = d5 > 0 && d4 > 0 && d3 > 0 && d2 > 0 && d1 > 0;
  if (hasStrong5Circled || hasStrong5Digit) detected = 5;

  // 4) ㄱ~ㄹ / 가~라 체계가 주로 보이면 최소 4지선다로 본다.
  //    (ㅁ/마가 확실히 있을 때만 5로 올린다.)
  const cho1 = count(/(?:^|\n)\s*ㄱ\s*[.)\],:：]\s*/g);
  const cho2 = count(/(?:^|\n)\s*ㄴ\s*[.)\],:：]\s*/g);
  const cho3 = count(/(?:^|\n)\s*ㄷ\s*[.)\],:：]\s*/g);
  const cho4 = count(/(?:^|\n)\s*ㄹ\s*[.)\],:：]\s*/g);
  const cho5 = count(/(?:^|\n)\s*ㅁ\s*[.)\],:：]\s*/g);
  const ga1 = count(/(?:^|\n)\s*가\s*[.)\],:：]\s*/g);
  const ga2 = count(/(?:^|\n)\s*나\s*[.)\],:：]\s*/g);
  const ga3 = count(/(?:^|\n)\s*다\s*[.)\],:：]\s*/g);
  const ga4 = count(/(?:^|\n)\s*라\s*[.)\],:：]\s*/g);
  const ga5 = count(/(?:^|\n)\s*마\s*[.)\],:：]\s*/g);
  const hasStrong5Cho = cho5 > 0 && cho4 > 0 && cho3 > 0 && cho2 > 0 && cho1 > 0;
  const hasStrong5Ga = ga5 > 0 && ga4 > 0 && ga3 > 0 && ga2 > 0 && ga1 > 0;
  if (hasStrong5Cho || hasStrong5Ga) detected = 5;

  return Math.max(2, Math.min(5, detected));
}

function extractJsonArrayFromText(raw) {
  const s = String(raw || "").trim();
  if (!s) return [];
  try {
    const parsed = JSON.parse(s);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === "object") {
      const keys = ["items", "rows", "quizzes", "questions", "data", "result"];
      for (let i = 0; i < keys.length; i++) {
        const v = parsed[keys[i]];
        if (Array.isArray(v)) return v;
      }
    }
    return [];
  } catch (_) {}
  const m = s.match(/```json\s*([\s\S]*?)```/i) || s.match(/```\s*([\s\S]*?)```/i);
  if (m && m[1]) {
    try {
      const parsed = JSON.parse(String(m[1]).trim());
      if (Array.isArray(parsed)) return parsed;
      if (parsed && typeof parsed === "object") {
        const keys = ["items", "rows", "quizzes", "questions", "data", "result"];
        for (let i = 0; i < keys.length; i++) {
          const v = parsed[keys[i]];
          if (Array.isArray(v)) return v;
        }
      }
      return [];
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

function stripTrailingCommasInJson(raw) {
  return String(raw || "").replace(/,\s*([}\]])/g, "$1");
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

function normalizeStatementForDedupe(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\w가-힣\s]/g, "")
    .trim();
}

function makeBiGramSet(text) {
  const s = String(text || "").replace(/\s+/g, "");
  const set = new Set();
  if (!s) return set;
  if (s.length < 2) {
    set.add(s);
    return set;
  }
  for (let i = 0; i < s.length - 1; i++) {
    set.add(s.slice(i, i + 2));
  }
  return set;
}

function jaccardSimilarity(setA, setB) {
  if (!setA.size || !setB.size) return 0;
  let inter = 0;
  setA.forEach((v) => {
    if (setB.has(v)) inter += 1;
  });
  const union = setA.size + setB.size - inter;
  return union > 0 ? inter / union : 0;
}

function isNearDuplicateStatement(a, b) {
  const aa = normalizeStatementForDedupe(a);
  const bb = normalizeStatementForDedupe(b);
  if (!aa || !bb) return false;
  if (aa === bb) return true;
  const la = aa.length;
  const lb = bb.length;
  const shorter = Math.min(la, lb);
  const longer = Math.max(la, lb);
  if (shorter >= 16 && longer > 0 && shorter / longer >= 0.88) {
    if (aa.includes(bb) || bb.includes(aa)) return true;
  }
  const ja = makeBiGramSet(aa);
  const jb = makeBiGramSet(bb);
  return jaccardSimilarity(ja, jb) >= 0.86;
}

async function collectExistingExpectedStatements() {
  const normalized = [];
  let cursor = null;
  for (let round = 0; round < 6; round++) {
    let q = db.collection(QUIZ_COLLECTION).where("examId", "==", "expected").orderBy("__name__").limit(500);
    if (cursor) q = q.startAfter(cursor);
    const snap = await q.get();
    if (snap.empty) break;
    snap.docs.forEach((d) => {
      const s = normalizeStatementForDedupe((d.data() || {}).statement);
      if (s) normalized.push(s);
    });
    cursor = snap.docs[snap.docs.length - 1];
    if (snap.size < 500) break;
  }
  const stSnap = await db
    .collection(STAGING_QUIZ_COLLECTION)
    .where("source", "==", "ai-library-expected")
    .limit(1200)
    .get();
  stSnap.docs.forEach((d) => {
    const p = (d.data() || {}).payload || {};
    const s = normalizeStatementForDedupe(p.statement);
    if (s) normalized.push(s);
  });
  return normalized;
}

function normalizeTextForGrounding(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .replace(/[“”"'`]/g, "")
    .trim()
    .toLowerCase();
}

function isEvidenceGroundedInRag(ragContext, evidenceText) {
  const ev = normalizeTextForGrounding(evidenceText);
  if (!ev || ev.length < 12) return false;
  const rag = normalizeTextForGrounding(String(ragContext || ""));
  if (!rag) return false;
  const probe = ev.length > 160 ? ev.slice(0, 160) : ev;
  return rag.includes(probe);
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
      let rows = extractJsonArrayFromText(txt);
      if (!rows.length) {
        rows = extractJsonArrayFromText(stripTrailingCommasInJson(txt));
      }
      if (!rows.length && txt) {
        // 2차 복원: 모델이 설명/문장 섞어서 출력한 결과를 JSON 배열만 재정규화
        const repairPrompt = [
          "아래 텍스트를 읽고 JSON 배열만 출력하세요.",
          "설명/마크다운/코드블록 금지. JSON 배열 외 문자 금지.",
          "객체 루트라면 items/rows/questions 배열만 추출해 배열로 출력.",
          "",
          "[입력 텍스트]",
          txt.slice(0, 30000)
        ].join("\n");
        const repaired = await model.generateContent(repairPrompt);
        const repairedTxt = String(
          repaired && repaired.response && repaired.response.text ? repaired.response.text() : ""
        ).trim();
        rows = extractJsonArrayFromText(repairedTxt);
        if (!rows.length) rows = extractJsonArrayFromText(stripTrailingCommasInJson(repairedTxt));
      }
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

async function autoReviewQuizRows(apiKey, modelId, rows, userPrompt, ragContext) {
  if (!Array.isArray(rows) || !rows.length) return {};
  const byId = {};
  const batchSize = 20;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const prompt = [
      "당신은 행정법 퀴즈 품질검수자입니다.",
      "입력 문항 배열을 보고 품질 위험도를 판정해 JSON 배열만 출력하세요.",
      "출력 스키마: [{\"id\":\"문항id\",\"risk\":\"low|medium|high\",\"summary\":\"한 줄 요약\",\"reasons\":[\"사유1\",\"사유2\"]}]",
      "사유는 최대 3개. 근거 없는 추측 금지.",
      "",
      "[생성 지시]",
      String(userPrompt || "").slice(0, 1500),
      "",
      "[자료실 발췌 일부]",
      String(ragContext || "").slice(0, 8000),
      "",
      "[검수 대상 배열]",
      JSON.stringify(
        batch.map((x) => ({
          id: x.id,
          topic: x.topic,
          statement: x.statement,
          answer: x.answer,
          explanation: x.explanation,
          explanationBasic: x.explanationBasic
        }))
      )
    ].join("\n");
    let reviewed = [];
    try {
      reviewed = await generateLibraryQuizRows(apiKey, modelId, prompt);
    } catch (_) {
      reviewed = [];
    }
    for (let j = 0; j < reviewed.length; j++) {
      const r = reviewed[j] || {};
      const rid = String(r.id || "").trim();
      if (!rid) continue;
      const riskRaw = String(r.risk || "").trim().toLowerCase();
      const risk = riskRaw === "high" || riskRaw === "medium" || riskRaw === "low" ? riskRaw : "medium";
      const reasons = Array.isArray(r.reasons)
        ? r.reasons.map((x) => String(x || "").trim()).filter(Boolean).slice(0, 3)
        : [];
      byId[rid] = {
        risk,
        summary: String(r.summary || "").trim().slice(0, 400),
        reasons
      };
    }
  }
  return byId;
}

function defaultAiReviewSummary(entityType) {
  if (entityType === "case") return "AI 1차 검수 결과 없음(판례 기본값)";
  if (entityType === "statute") return "AI 1차 검수 결과 없음(조문 기본값)";
  if (entityType === "term") return "AI 1차 검수 결과 없음(용어 기본값)";
  return "AI 1차 검수 결과 없음(기본값)";
}

function buildDefaultAiReview(entityType) {
  return {
    risk: "medium",
    summary: defaultAiReviewSummary(entityType),
    reasons: []
  };
}

async function autoReviewDictRows(apiKey, modelId, entityType, rows) {
  if (!Array.isArray(rows) || !rows.length || !apiKey) return {};
  const gen = new GoogleGenerativeAI(apiKey);
  const out = {};
  const batchSize = 20;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const prompt = [
      "당신은 행정법 사전 콘텐츠 품질검수자입니다.",
      "입력 배열 각 항목의 품질 위험도를 판정해 JSON 배열만 출력하세요.",
      "출력 스키마: [{\"entryKey\":\"키\",\"risk\":\"low|medium|high\",\"summary\":\"한 줄 요약\",\"reasons\":[\"사유1\",\"사유2\"]}]",
      "사유는 최대 3개. 근거 없는 추측 금지.",
      "평가 관점: 사실오류 가능성, 정의/요건 누락, 과도한 단정, 문장 명확성.",
      "",
      "[엔터티 유형]",
      entityType,
      "",
      "[검수 대상 배열]",
      JSON.stringify(batch)
    ].join("\n");
    let reviewed = [];
    try {
      reviewed = await generateLibraryQuizRows(apiKey, modelId, prompt);
    } catch (_) {
      reviewed = [];
    }
    for (let j = 0; j < reviewed.length; j++) {
      const r = reviewed[j] || {};
      const key = String(r.entryKey || "").trim();
      if (!key) continue;
      const riskRaw = String(r.risk || "").trim().toLowerCase();
      const risk = riskRaw === "high" || riskRaw === "medium" || riskRaw === "low" ? riskRaw : "medium";
      const reasons = Array.isArray(r.reasons)
        ? r.reasons.map((x) => String(x || "").trim()).filter(Boolean).slice(0, 3)
        : [];
      out[key] = {
        risk,
        summary: String(r.summary || "").trim().slice(0, 400),
        reasons
      };
    }
  }
  return out;
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
  const choiceOnly = parseIntInRange(data.choiceOnly, 1, 5);
  const questionStartNo = parseIntInRange(data.questionStartNo, 1, 500);
  const questionEndNo = parseIntInRange(data.questionEndNo, 1, 500);
  const expectedCountInput = parseInt(data.expectedCount, 10);
  const excludeStatements = Array.isArray(data.excludeStatements)
    ? data.excludeStatements.map((x) => String(x || "").trim()).filter(Boolean).slice(-200)
    : [];
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
    choiceOnly: choiceOnly || null,
    fastMode,
    ragChars: String(ragContext || "").length,
    elapsedMs: ragMs
  });

  const inferredFromTextExam = inferExamIdLoose(userPrompt + "\n" + ragContext.slice(0, 4000));
  const inferredFromTextYear = inferYearLoose(userPrompt + "\n" + ragContext.slice(0, 4000));
  const inferredQuestionNos = extractQuestionNumbers(ragContext);
  const filteredQuestionNos = inferredQuestionNos.filter((q) => {
    if (questionStartNo != null && q < questionStartNo) return false;
    if (questionEndNo != null && q > questionEndNo) return false;
    return true;
  });
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
      questionNos: filteredQuestionNos,
      detectedChoiceCount
    };
  }
  const expectedCount = Number.isFinite(expectedCountInput)
    ? Math.max(1, Math.min(500, expectedCountInput))
    : questionOnly && choiceOnly
      ? 1
    : filteredQuestionNos.length
      ? Math.min(500, filteredQuestionNos.length * detectedChoiceCount)
      : 120;

  const modelId = effectiveGeminiModelId();
  const collectedRows = [];
  const collectedPairSet = new Set();
  const blockedStatementSet = new Set(
    excludeStatements.map((x) => normalizeStatementForDedupe(x)).filter(Boolean)
  );
  const failRows = [];

  function buildMissingPairs(maxQuestionNo) {
    const out = [];
    const qStart = questionOnly || 1;
    const qEnd = questionOnly || maxQuestionNo;
    for (let qNo = qStart; qNo <= qEnd; qNo++) {
      const cStart = choiceOnly || 1;
      const cEnd = choiceOnly || (detectedChoiceCount || 4);
      for (let cNo = cStart; cNo <= cEnd; cNo++) {
        const key = pairKey(qNo, cNo);
        if (!collectedPairSet.has(key)) out.push(key);
      }
    }
    return out;
  }

  const maxQuestionNo = filteredQuestionNos.length ? filteredQuestionNos[filteredQuestionNos.length - 1] : null;
  const isPairOnly = !!(questionOnly && choiceOnly);
  const maxRounds = isPairOnly ? (fastMode ? 1 : 2) : questionOnly ? (fastMode ? 1 : 2) : (generateAll ? (fastMode ? 3 : 6) : 2);
  const ragForGeneration = String(ragContext || "").slice(0, fastMode ? (questionOnly ? 5000 : 10000) : (questionOnly ? 8000 : 16000));
  for (let round = 0; round < maxRounds; round++) {
    const missingPairs = maxQuestionNo ? buildMissingPairs(maxQuestionNo) : [];
    if (round > 0 && generateAll && maxQuestionNo && !missingPairs.length) break;
    const missingHint = missingPairs.length ? missingPairs.slice(0, 120).join(", ") : "(미지정)";
    const remaining = Math.max(1, expectedCount - collectedRows.length);
    const roundTarget = Math.min(40, remaining);
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
      "- 박스형 보기(ㄱ/ㄴ/ㄷ/ㄹ/ㅁ 또는 가/나/다/라/마)도 각각 별도 문항으로 분해하고 sourceChoiceNo를 1~5로 매핑하세요.",
      "- sourceQuestionNo/sourceChoiceNo를 반드시 채우세요.",
      "- statement는 해당 선지 문장을 원문에 가깝게 유지하세요. 결론/해설식 재서술을 만들지 마세요.",
      "- statement에는 근거 설명(예: '~이므로', '~때문에', '따라서')을 붙이지 말고 OX 판단문 한 문장으로 작성하세요.",
      questionOnly ? "- 이번 배치는 sourceQuestionNo를 반드시 " + questionOnly + "로만 생성하세요." : "",
      choiceOnly ? "- 이번 배치는 sourceChoiceNo를 반드시 " + choiceOnly + "로만 생성하세요." : "",
      "- 파일 순서 기준으로 1번부터 마지막까지 생성하되, 누락 쌍을 우선 보완하세요.",
      "- 누락 쌍(문항-보기): " + missingHint,
      excludeStatements.length
        ? "- 아래 금지 문장(기생성 문장)과 동일/유사한 statement는 절대 생성하지 마세요: " +
          excludeStatements.slice(-50).join(" | ")
        : "",
      "- 목표 생성 개수(총): " + expectedCount,
      "- 이번 라운드 최대 생성 개수: " + roundTarget,
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
      if (choiceOnly && cNo !== choiceOnly) continue;
      if (cNo > (detectedChoiceCount || 4)) continue;
      const key = pairKey(qNo, cNo);
      if (collectedPairSet.has(key)) continue;
      const normalizedStmt = normalizeStatementForDedupe(r.statement);
      if (!normalizedStmt) {
        failRows.push({ index: i + 1, reason: "statement 비어 있음" });
        continue;
      }
      if (blockedStatementSet.has(normalizedStmt)) {
        failRows.push({ index: i + 1, reason: "중복 statement 감지" });
        continue;
      }
      r.sourceQuestionNo = qNo;
      r.sourceChoiceNo = cNo;
      if (!r.sourceChoiceLabel) {
        const choiceLabel = inferChoiceLabelFromRow(r);
        if (choiceLabel) r.sourceChoiceLabel = choiceLabel;
      }
      collectedRows.push(r);
      collectedPairSet.add(key);
      blockedStatementSet.add(normalizedStmt);
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
    choiceOnly: choiceOnly || null,
    fastMode,
    collected: collectedRows.length,
    failCount: failRows.length,
    elapsedMs: tGenDone - t0
  });

  // 2단계: fastMode가 아니면 해설/태그를 보강한다.
  let enrichedRows = [];
  function hasRequiredQuizFields(x) {
    if (!x || typeof x !== "object") return false;
    if (!String(x.statement || "").trim()) return false;
    if (!String(x.explanation || "").trim()) return false;
    if (!String(x.explanationBasic || "").trim()) return false;
    const imp = parseInt(x.importance, 10);
    const diff = parseInt(x.difficulty, 10);
    if (!Number.isFinite(imp) || imp < 1 || imp > 5) return false;
    if (!Number.isFinite(diff) || diff < 1 || diff > 5) return false;
    return true;
  }

  if (fastMode) {
    enrichedRows = collectedRows.map((r) => {
      const ansRaw = parseBoolLoose(r.answer);
      const ans = ansRaw == null ? false : ansRaw;
      const fallback = defaultExplainFromStatement(r.statement, ans, r.topic);
      return Object.assign({}, r, {
        answer: ans,
        explanation: String(r.explanation || "").trim() || fallback.explanation,
        explanationBasic: String(r.explanationBasic || "").trim() || fallback.explanationBasic,
        importance: parseIntInRange(r.importance, 1, 5) || 3,
        difficulty: parseIntInRange(r.difficulty, 1, 5) || 3
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
    const missingRows = [];
    for (let i = 0; i < enrichedRows.length; i++) {
      if (!hasRequiredQuizFields(enrichedRows[i])) missingRows.push(collectedRows[i] || enrichedRows[i]);
    }
    if (missingRows.length) {
      let retried = [];
      try {
        retried = await enrichLibraryQuizRows(
          apiKey,
          modelId,
          missingRows,
          userPrompt,
          ragContext,
          resolvedExamId,
          resolvedYear
        );
      } catch (_) {
        retried = [];
      }
      const byKeyRetry = {};
      for (let i = 0; i < retried.length; i++) {
        const rr = retried[i] || {};
        const qNo = parseIntInRange(rr.sourceQuestionNo, 1, 500);
        const cNo = parseIntInRange(rr.sourceChoiceNo, 1, 5);
        if (qNo == null || cNo == null) continue;
        byKeyRetry[pairKey(qNo, cNo)] = rr;
      }
      enrichedRows = enrichedRows.map((r) => {
        const qNo = parseIntInRange(r && r.sourceQuestionNo, 1, 500);
        const cNo = parseIntInRange(r && r.sourceChoiceNo, 1, 5);
        const key = qNo != null && cNo != null ? pairKey(qNo, cNo) : "";
        if (key && byKeyRetry[key] && hasRequiredQuizFields(byKeyRetry[key])) return byKeyRetry[key];
        return r;
      });
    }
  }

  let aiReviewById = {};
  try {
    aiReviewById = await autoReviewQuizRows(apiKey, modelId, enrichedRows, userPrompt, ragContext);
  } catch (e) {
    aiReviewById = {};
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
        sourceChoiceNo: parseIntInRange(r.sourceChoiceNo, 1, 5),
        sourceChoiceLabel: String(r.sourceChoiceLabel || "").trim().slice(0, 20)
      };
      const fallback = defaultExplainFromStatement(payload.statement, payload.answer, payload.topic);
      if (!payload.explanation) payload.explanation = fallback.explanation;
      if (!payload.explanationBasic) payload.explanationBasic = fallback.explanationBasic;
      if (!Number.isFinite(payload.importance)) payload.importance = 3;
      if (!Number.isFinite(payload.difficulty)) payload.difficulty = 3;
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
        version: 1,
        aiReview: aiReviewById[clean.id] || buildDefaultAiReview("quiz")
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
    choiceOnly: choiceOnly || null,
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

exports.adminGenerateExpectedQuizFromLibrary = onCall(
  { region: "asia-northeast3", timeoutSeconds: 300, memory: "1GiB" },
  async (request) => {
    assertAdminCallable(request);
    const data = request.data || {};
    const userPrompt = String(data.prompt || "").trim();
    const countInput = parseInt(data.count, 10);
    const count = Number.isFinite(countInput) ? Math.max(1, Math.min(200, countInput)) : 30;
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
        { topic: "행정법 교과서 예상문제", statement: "" },
        fileIds.length ? { fileIds } : undefined
      );
    } catch (e) {
      console.warn("adminGenerateExpectedQuizFromLibrary RAG", e && e.message);
    }
    if (!String(ragContext || "").trim()) {
      throw new HttpsError(
        "failed-precondition",
        "자료실 컨텍스트를 찾지 못했습니다. 파일 업로드 후 '학습 중'이 '완료'가 된 뒤 다시 시도하세요."
      );
    }

    const modelId = effectiveGeminiModelId();
    const existingExpectedNormals = await collectExistingExpectedStatements();
    const generationPrompt = [
      "당신은 행정법 교과서 기반 예상문제 출제 편집자입니다.",
      "아래 자료 발췌를 바탕으로 수험용 OX 예상문제를 JSON 배열만 출력하세요.",
      "마크다운/설명/코드블록 금지, JSON 배열만 출력.",
      "",
      "[출력 스키마]",
      "[",
      "  {",
      '    "id": "ai-고유값",',
      '    "topic": "주제",',
      '    "statement": "OX 판단문 1문장",',
      '    "answer": true 또는 false,',
      '    "explanation": "2~5문장 해설",',
      '    "explanationBasic": "1문장 핵심",',
      '    "evidenceQuote": "자료실 발췌에서 그대로 옮긴 근거 문장 1개(필수, 12자 이상)",',
      '    "evidenceHint": "근거 위치 힌트(예: 파일명/쪽수/청크 번호)",',
      '    "legal": "법령 포인트(선택)",',
      '    "trap": "함정 포인트(선택)",',
      '    "precedent": "반드시 빈 문자열로 출력",',
      '    "tags": ["태그1","태그2"],',
      '    "importance": 1~5,',
      '    "difficulty": 1~5',
      "  }",
      "]",
      "",
      "[규칙]",
      "- 총 " + count + "개를 생성하세요.",
      "- 같은 문장을 반복하지 마세요.",
      "- statement는 근거설명(~이므로, 따라서)을 붙이지 말고 OX 판단문으로만 작성.",
      "- 자료에 없는 내용 추측 금지. 확실하지 않으면 해당 문항을 만들지 마세요.",
      "- evidenceQuote는 반드시 [자료실 발췌(RAG)]의 문장을 거의 그대로 복사해 넣으세요.",
      "- evidenceQuote가 없는 문항은 무효입니다.",
      "- 보수 모드: precedent는 반드시 빈 문자열로 두고, 판례 번호/사건번호를 새로 쓰지 마세요.",
      "- 수험생이 헷갈리는 개념을 고르게 포함.",
      "- 법령/개념 중심으로만 구성하세요.",
      "",
      "[사용자 생성 지시]",
      userPrompt,
      "",
      "[자료실 발췌(RAG)]",
      String(ragContext || "").slice(0, 16000)
    ].join("\n");

    const rows = await generateLibraryQuizRows(apiKey, modelId, generationPrompt);
    if (!rows.length) {
      throw new HttpsError("failed-precondition", "생성 결과가 비어 있습니다. 지시문을 구체화해 주세요.");
    }

    let aiReviewById = {};
    try {
      aiReviewById = await autoReviewQuizRows(apiKey, modelId, rows, userPrompt, ragContext);
    } catch (_) {
      aiReviewById = {};
    }

    const email = String(request.auth.token.email || "").toLowerCase();
    const batch = db.batch();
    const failRows = [];
    const stagedRows = [];
    const normalizedSet = new Set();
    const nearDupPool = existingExpectedNormals.slice(0, 3000);
    const outYear = new Date().getFullYear();
    for (let i = 0; i < rows.length; i++) {
      try {
        const r = rows[i] || {};
        const ansRaw = parseBoolLoose(r.answer);
        const ans = ansRaw == null ? false : ansRaw;
        const statement = String(r.statement || "").trim();
        const norm = normalizeStatementForDedupe(statement);
        if (!norm) {
          failRows.push({ index: i + 1, reason: "statement 비어 있음" });
          continue;
        }
        if (normalizedSet.has(norm)) {
          failRows.push({ index: i + 1, reason: "중복 statement 감지" });
          continue;
        }
        let nearDup = false;
        for (let ni = 0; ni < nearDupPool.length; ni++) {
          if (isNearDuplicateStatement(norm, nearDupPool[ni])) {
            nearDup = true;
            break;
          }
        }
        if (nearDup) {
          failRows.push({ index: i + 1, reason: "기존 문항과 유사도가 높아 제외됨" });
          continue;
        }
        const evidenceQuote = String(
          r.evidenceQuote || r.evidence || r.sourceEvidence || r.sourceQuote || ""
        ).trim();
        const evidenceHint = String(r.evidenceHint || r.source || "").trim();
        if (!evidenceQuote) {
          failRows.push({ index: i + 1, reason: "근거 문장(evidenceQuote) 누락" });
          continue;
        }
        if (!isEvidenceGroundedInRag(ragContext, evidenceQuote)) {
          failRows.push({ index: i + 1, reason: "근거 문장이 자료실 발췌와 불일치" });
          continue;
        }
        const precedentText = String(r.precedent || "").trim();
        if (precedentText) {
          failRows.push({ index: i + 1, reason: "보수 모드에서 판례 포인트는 자동 제외" });
          continue;
        }
        normalizedSet.add(norm);
        nearDupPool.push(norm);
        const fallback = defaultExplainFromStatement(statement, ans, r.topic || "행정법 예상문제");
        const payload = {
          id: String(r.id || "").trim() || `ai-expected-${Date.now().toString(36)}-${i + 1}`,
          examId: "expected",
          year: outYear,
          exam: "expected",
          topic: String(r.topic || "행정법 예상문제").trim(),
          statement,
          answer: ans,
          explanation: String(r.explanation || "").trim() || fallback.explanation,
          explanationBasic: String(r.explanationBasic || "").trim() || fallback.explanationBasic,
          detail: {
            legal: String(r.legal || "").trim(),
            trap: String(r.trap || "").trim(),
            precedent: "",
            body: evidenceHint
              ? "[근거] " + evidenceQuote + "\n\n[근거 위치] " + evidenceHint
              : "[근거] " + evidenceQuote
          },
          tags: Array.isArray(r.tags) ? r.tags.map((x) => String(x || "").trim()).filter(Boolean) : [],
          importance: parseIntInRange(r.importance, 1, 5) || 3,
          difficulty: parseIntInRange(r.difficulty, 1, 5) || (fastMode ? 3 : 4)
        };
        if (!payload.tags.length) delete payload.tags;
        if (!payload.detail.legal && !payload.detail.trap && !payload.detail.precedent) delete payload.detail;
        const clean = sanitizeQuizPayload(payload);
        const ref = db.collection(STAGING_QUIZ_COLLECTION).doc();
        batch.set(ref, {
          entityType: "quiz",
          questionId: clean.id,
          payload: clean,
          status: "reviewing",
          source: "ai-library-expected",
          changeType: "upsert",
          createdBy: email,
          updatedBy: email,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          approvedBy: null,
          approvedAt: null,
          rejectReason: "",
          version: 1,
          aiReview: aiReviewById[clean.id] || buildDefaultAiReview("quiz")
        });
        stagedRows.push(clean);
        if (stagedRows.length >= count) break;
      } catch (e) {
        failRows.push({ index: i + 1, reason: e && e.message ? e.message : "형식 오류" });
      }
    }
    if (!stagedRows.length) {
      throw new HttpsError("failed-precondition", "유효한 예상문제가 생성되지 않았습니다.");
    }
    await batch.commit();
    console.info("adminGenerateExpectedQuizFromLibrary phase:done", {
      staged: stagedRows.length,
      failCount: failRows.length,
      elapsedMs: Date.now() - t0
    });
    return {
      ok: true,
      okCount: stagedRows.length,
      expectedCount: count,
      failRows,
      items: stagedRows.slice(0, 20)
    };
  }
);

const EXPECTED_STATEMENTS_MAX = 80;
const EXPECTED_STATEMENTS_CHUNK = 12;

/**
 * 관리자가 입력한 OX 판단문(여러 개)마다 자료실 RAG를 근거로 정답·해설 등을 생성해 검수대기에 등록한다.
 */
exports.adminGenerateExpectedQuizFromStatements = onCall(
  { region: "asia-northeast3", timeoutSeconds: 540, memory: "1GiB" },
  async (request) => {
    assertAdminCallable(request);
    const data = request.data || {};
    const userPrompt = String(data.prompt || "").trim();
    const fastMode = data.fastMode !== false;
    const fileIds = Array.isArray(data.fileIds)
      ? data.fileIds.map((x) => String(x || "").trim()).filter(Boolean).slice(0, 30)
      : [];
    /** 자료실 RAG 사용: 명시값이 있으면 따르고, 없으면 fileIds가 있을 때만 RAG */
    let useLibraryRag =
      typeof data.useLibraryRag === "boolean" ? data.useLibraryRag : fileIds.length > 0;
    if (useLibraryRag && !fileIds.length) useLibraryRag = false;
    let statements = Array.isArray(data.statements)
      ? data.statements.map((x) => String(x || "").trim()).filter(Boolean)
      : [];
    if (!statements.length) {
      throw new HttpsError("invalid-argument", "문장 목록(statements)이 비어 있습니다.");
    }
    if (statements.length > EXPECTED_STATEMENTS_MAX) {
      throw new HttpsError(
        "invalid-argument",
        "한 번에 처리할 문장은 최대 " + EXPECTED_STATEMENTS_MAX + "개입니다."
      );
    }

    const apiKey = process.env.GEMINI_API_KEY || "";
    if (!apiKey) {
      throw new HttpsError("failed-precondition", "서버에 GEMINI_API_KEY가 설정되지 않았습니다.");
    }

    const deduped = [];
    const seenNorm = new Set();
    for (let si = 0; si < statements.length; si++) {
      const raw = String(statements[si] || "").trim();
      if (!raw) continue;
      const norm = normalizeStatementForDedupe(raw);
      if (!norm) continue;
      if (seenNorm.has(norm)) continue;
      seenNorm.add(norm);
      deduped.push(raw);
    }
    if (!deduped.length) {
      throw new HttpsError("invalid-argument", "유효한 문장이 없습니다.");
    }

    const t0 = Date.now();
    const queryHint =
      (userPrompt || "행정법 OX 문항, 자료 근거로 정답·해설 작성") +
      "\n\n" +
      deduped
        .slice(0, 12)
        .map((s, i) => i + 1 + ". " + s)
        .join("\n");
    let ragContext = "";
    if (useLibraryRag) {
      try {
        ragContext = await retrieveLibraryContextForQuiz(
          queryHint,
          { topic: "행정법 교과서 예상문제", statement: String(deduped[0] || "").slice(0, 800) },
          fileIds.length ? { fileIds } : undefined
        );
      } catch (e) {
        console.warn("adminGenerateExpectedQuizFromStatements RAG", e && e.message);
      }
      if (!String(ragContext || "").trim()) {
        throw new HttpsError(
          "failed-precondition",
          "자료실 컨텍스트를 찾지 못했습니다. 파일을 선택하고 학습이 '완료'된 뒤 다시 시도하거나, 교재 없이 생성하는 경우 자료 선택을 해제해 주세요."
        );
      }
    } else if (!userPrompt) {
      throw new HttpsError(
        "invalid-argument",
        "교재 없이 생성할 때는 생성 지침(prompt)이 필요합니다."
      );
    }

    const modelId = effectiveGeminiModelId();
    const existingExpectedNormals = await collectExistingExpectedStatements();
    const nearDupPool = existingExpectedNormals.slice(0, 3000);
    const normalizedSet = new Set();
    const mergedForReview = [];
    const failRows = [];
    const ragSlice = String(ragContext || "").slice(0, 16000);
    const styleBlock = userPrompt
      ? "[편집 지시]\n" + userPrompt.slice(0, 4000)
      : useLibraryRag
        ? "[편집 지시]\n자료실 발췌를 근거로 각 문장의 참·거짓을 판정하고, 수험용 해설을 작성하세요."
        : "[편집 지시]\n행정법 수험 관점에서 각 문장의 참·거짓을 판정하고, 수험용 해설을 작성하세요.";

    let globalIndex = 0;
    for (let c0 = 0; c0 < deduped.length; c0 += EXPECTED_STATEMENTS_CHUNK) {
      const chunk = deduped.slice(c0, c0 + EXPECTED_STATEMENTS_CHUNK);
      const n = chunk.length;
      const listing = chunk.map((s, i) => "[" + (i + 1) + "] " + s).join("\n");
      const evidenceRules = useLibraryRag
        ? [
            "- evidenceQuote는 반드시 [자료실 발췌(RAG)] 안의 문장을 거의 그대로 복사.",
            "- 근거 없이 추측하지 마세요. 자료로 판단이 어려우면 보수적으로 answer를 정하고 근거를 명확히 하세요.",
            "- evidenceHint는 파일명·쪽수 등 위치 힌트."
          ]
        : [
            "- 교재 미연결: evidenceQuote에는 해당 판단의 핵심 법리·개념을 12자 이상으로 요약(문장 복사가 아닌 근거 설명).",
            "- 불확실하면 보수적으로 판정하고 해설에 판단의 한계를 명시.",
            "- evidenceHint에는 '일반론' 또는 관련 제도명 수준으로 짧게."
          ];
      const contextBlock = useLibraryRag
        ? ["[자료실 발췌(RAG)]", ragSlice]
        : [
            "[교재 미연결]",
            "아래 문장만 주어졌습니다. 행정법 수험에 통용되는 지식으로 판단하세요.",
            "판례 번호·사건번호를 새로 만들지 마세요. precedent는 빈 문자열."
          ];
      const generationPrompt = [
        useLibraryRag
          ? "당신은 행정법 교과서 기반 예상문제 해설 편집자입니다."
          : "당신은 행정법 수험용 OX 문항 해설 편집자입니다.",
        useLibraryRag
          ? "관리자가 지정한 OX 판단문 각각에 대해, 아래 [자료실 발췌]를 근거로 정답과 해설을 작성합니다."
          : "관리자가 지정한 OX 판단문 각각에 대해 정답과 해설을 작성합니다.",
        "JSON 배열만 출력. 마크다운/설명/코드블록 금지.",
        "",
        "[출력 배열 길이]",
        "반드시 " + n + "개입니다. 출력 배열의 k번째 원소는 [입력 문장 목록]의 k번째와 1:1 대응합니다.",
        "",
        "[출력 각 원소 스키마]",
        "[",
        "  {",
        '    "id": "ai-고유값",',
        '    "topic": "주제",',
        '    "statement": "입력과 동일한 판단문(수정 금지)",',
        '    "answer": true 또는 false,',
        '    "explanation": "2~5문장 해설",',
        '    "explanationBasic": "1문장 핵심",',
        useLibraryRag
          ? '    "evidenceQuote": "자료실 발췌에서 그대로 옮긴 근거 문장 1개(필수, 12자 이상)",'
          : '    "evidenceQuote": "핵심 근거 요약(필수, 12자 이상)",',
        '    "evidenceHint": "근거 위치 또는 범위 힌트",',
        '    "legal": "법령 포인트(선택)",',
        '    "trap": "함정 포인트(선택)",',
        '    "precedent": "반드시 빈 문자열",',
        '    "tags": ["태그1"],',
        '    "importance": 1~5,',
        '    "difficulty": 1~5',
        "  }",
        "]",
        "",
        "[규칙]",
        "- 각 문장이 참이면 answer=true, 거짓이면 false.",
        ...evidenceRules,
        "- 보수 모드: precedent는 빈 문자열, 판례 번호를 새로 쓰지 마세요.",
        "",
        styleBlock,
        "",
        "[입력 문장 목록]",
        listing,
        "",
        ...contextBlock
      ].join("\n");

      let rows = [];
      try {
        rows = await generateLibraryQuizRows(apiKey, modelId, generationPrompt);
      } catch (e) {
        const em = String((e && e.message) || "모델 호출 실패");
        for (let j = 0; j < chunk.length; j++) {
          globalIndex += 1;
          failRows.push({ index: globalIndex, reason: "청크 생성 실패: " + em });
        }
        continue;
      }
      if (!Array.isArray(rows) || rows.length !== n) {
        const reason =
          !Array.isArray(rows) || !rows.length
            ? "AI 출력이 비어 있음"
            : "AI 출력 개수 불일치(기대 " + n + "개, 실제 " + rows.length + "개)";
        for (let j = 0; j < chunk.length; j++) {
          globalIndex += 1;
          failRows.push({ index: globalIndex, reason });
        }
        continue;
      }

      for (let i = 0; i < n; i++) {
        globalIndex += 1;
        const userStatement = chunk[i];
        const r = rows[i] || {};
        const statement = String(userStatement || "").trim();
        const norm = normalizeStatementForDedupe(statement);
        if (!norm) {
          failRows.push({ index: globalIndex, reason: "statement 비어 있음" });
          continue;
        }
        if (normalizedSet.has(norm)) {
          failRows.push({ index: globalIndex, reason: "요청 내 중복 문장" });
          continue;
        }
        let nearDup = false;
        for (let ni = 0; ni < nearDupPool.length; ni++) {
          if (isNearDuplicateStatement(norm, nearDupPool[ni])) {
            nearDup = true;
            break;
          }
        }
        if (nearDup) {
          failRows.push({ index: globalIndex, reason: "기존 문항과 유사도가 높아 제외됨" });
          continue;
        }
        const evidenceQuote = String(
          r.evidenceQuote || r.evidence || r.sourceEvidence || r.sourceQuote || ""
        ).trim();
        const evidenceHint = String(r.evidenceHint || r.source || "").trim();
        if (!evidenceQuote) {
          failRows.push({ index: globalIndex, reason: "근거 문장(evidenceQuote) 누락" });
          continue;
        }
        if (!isEvidenceGroundedInRag(ragContext, evidenceQuote)) {
          failRows.push({ index: globalIndex, reason: "근거 문장이 자료실 발췌와 불일치" });
          continue;
        }
        const precedentText = String(r.precedent || "").trim();
        if (precedentText) {
          failRows.push({ index: globalIndex, reason: "보수 모드에서 판례 포인트는 자동 제외" });
          continue;
        }
        normalizedSet.add(norm);
        nearDupPool.push(norm);
        const baseId =
          String(r.id || "").trim() || "ai-expected-" + Date.now().toString(36) + "-" + globalIndex;
        const ansGuess = parseBoolLoose(r.answer);
        mergedForReview.push({
          id: baseId,
          topic: String(r.topic || "행정법 예상문제").trim(),
          statement,
          answer: ansGuess == null ? false : ansGuess,
          explanation: String(r.explanation || "").trim(),
          explanationBasic: String(r.explanationBasic || "").trim(),
          _raw: r,
          _statement: statement,
          _evidenceQuote: evidenceQuote,
          _evidenceHint: evidenceHint,
          _globalIndex: globalIndex
        });
      }
    }

    if (!mergedForReview.length) {
      throw new HttpsError(
        "failed-precondition",
        "유효한 예상문제가 생성되지 않았습니다. 자료를 보강하거나 문장을 조정해 주세요."
      );
    }

    let aiReviewById = {};
    try {
      const reviewPayload = mergedForReview.map((x) => ({
        id: x.id,
        topic: x.topic,
        statement: x.statement,
        answer: x.answer,
        explanation: x.explanation,
        explanationBasic: x.explanationBasic
      }));
      aiReviewById = await autoReviewQuizRows(
        apiKey,
        modelId,
        reviewPayload,
        userPrompt,
        useLibraryRag ? ragContext : ""
      );
    } catch (_) {
      aiReviewById = {};
    }

    const email = String(request.auth.token.email || "").toLowerCase();
    const batch = db.batch();
    const stagedRows = [];
    const outYear = new Date().getFullYear();

    for (let i = 0; i < mergedForReview.length; i++) {
      const item = mergedForReview[i];
      const r = item._raw || {};
      const statement = item._statement;
      const ansRaw = parseBoolLoose(r.answer);
      const ans = ansRaw == null ? false : ansRaw;
      const fallback = defaultExplainFromStatement(statement, ans, item.topic || "행정법 예상문제");
      const evidenceQuote = String(item._evidenceQuote || "").trim();
      const evidenceHint = String(item._evidenceHint || "").trim();
      const payload = {
        id: String(r.id || "").trim() || String(item.id || "").trim(),
        examId: "expected",
        year: outYear,
        exam: "expected",
        topic: String(item.topic || "행정법 예상문제").trim(),
        statement,
        answer: ans,
        explanation: String(item.explanation || r.explanation || "").trim() || fallback.explanation,
        explanationBasic:
          String(item.explanationBasic || r.explanationBasic || "").trim() || fallback.explanationBasic,
        detail: {
          legal: String(r.legal || "").trim(),
          trap: String(r.trap || "").trim(),
          precedent: "",
          body: evidenceHint
            ? "[근거] " + evidenceQuote + "\n\n[근거 위치] " + evidenceHint
            : "[근거] " + evidenceQuote
        },
        tags: Array.isArray(r.tags) ? r.tags.map((x) => String(x || "").trim()).filter(Boolean) : [],
        importance: parseIntInRange(r.importance, 1, 5) || 3,
        difficulty: parseIntInRange(r.difficulty, 1, 5) || (fastMode ? 3 : 4)
      };
      if (!payload.tags.length) delete payload.tags;
      {
        const d = payload.detail || {};
        if (!d.legal && !d.trap && !d.precedent && !String(d.body || "").trim()) delete payload.detail;
      }
      const clean = sanitizeQuizPayload(payload);
      const ref = db.collection(STAGING_QUIZ_COLLECTION).doc();
      batch.set(ref, {
        entityType: "quiz",
        questionId: clean.id,
        payload: clean,
        status: "reviewing",
        source: "ai-library-expected-statements",
        changeType: "upsert",
        createdBy: email,
        updatedBy: email,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        approvedBy: null,
        approvedAt: null,
        rejectReason: "",
        version: 1,
        aiReview: aiReviewById[clean.id] || buildDefaultAiReview("quiz")
      });
      stagedRows.push(clean);
    }

    await batch.commit();
    console.info("adminGenerateExpectedQuizFromStatements phase:done", {
      staged: stagedRows.length,
      failCount: failRows.length,
      elapsedMs: Date.now() - t0
    });
    return {
      ok: true,
      okCount: stagedRows.length,
      expectedCount: deduped.length,
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
  const prepared = [];
  for (let i = 0; i < rows.length; i++) {
    try {
      const payload = sanitizeTermPayload(rows[i] || {});
      const entryKey = String(payload.term || "").trim();
      prepared.push({ entryKey, payload });
      if (prepared.length >= count) break;
    } catch (e) {
      failRows.push({ index: i + 1, reason: e && e.message ? e.message : "형식 오류" });
    }
  }
  let aiReviewByKey = {};
  try {
    aiReviewByKey = await autoReviewDictRows(
      apiKey,
      modelId,
      "term",
      prepared.map((x) => ({
        entryKey: x.entryKey,
        term: x.payload.term,
        aliases: x.payload.aliases || [],
        definition: x.payload.definition || ""
      }))
    );
  } catch (_) {
    aiReviewByKey = {};
  }
  for (let i = 0; i < prepared.length; i++) {
    const row = prepared[i];
    const ref = db.collection(STAGING_TERM_COLLECTION).doc();
    batch.set(ref, {
      entityType: "term",
      entryKey: row.entryKey,
      payload: row.payload,
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
      version: 1,
      aiReview: aiReviewByKey[row.entryKey] || buildDefaultAiReview("term")
    });
    stagedRows.push(row.payload);
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
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(1000, limitRaw)) : 100;
  const snap = await db.collection(STAGING_QUIZ_COLLECTION).limit(1200).get();
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
      aiReview: x.aiReview && typeof x.aiReview === "object" ? x.aiReview : null,
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
      aiReview: data.aiReview && typeof data.aiReview === "object" ? data.aiReview : null,
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
const STAGING_STATUTE_COLLECTION = "hanlaw_dict_statutes_staging";
const TERM_COLLECTION = "hanlaw_dict_terms";
const CASE_COLLECTION = "hanlaw_dict_cases";
const STATUTE_COLLECTION = "hanlaw_dict_statutes";

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

function sanitizeStatutePayload(raw) {
  const src = raw || {};
  const statuteKey = String(src.statuteKey || src.key || "").trim();
  if (!statuteKey) throw new HttpsError("invalid-argument", "조문 키(statuteKey)가 필요합니다.");
  const out = {
    statuteKey,
    heading: String(src.heading || "").trim(),
    body: String(src.body || "").trim(),
    appliedRules: String(src.appliedRules || "").trim(),
    subordinateRules: String(src.subordinateRules || "").trim(),
    examPoint: String(src.examPoint || "").trim(),
    sourceNote: String(src.sourceNote || "").trim(),
    oxQuizzes: sanitizeDictOxQuizzes(src.oxQuizzes, 3)
  };
  if (!out.body) throw new HttpsError("invalid-argument", "조문 본문(body)이 필요합니다.");
  return out;
}

function dictStagingCollectionByType(entityType) {
  if (entityType === "case") return STAGING_CASE_COLLECTION;
  if (entityType === "statute") return STAGING_STATUTE_COLLECTION;
  return STAGING_TERM_COLLECTION;
}

function dictPublishedCollectionByType(entityType) {
  if (entityType === "case") return CASE_COLLECTION;
  if (entityType === "statute") return STATUTE_COLLECTION;
  return TERM_COLLECTION;
}

function normTagKeyForLinking(v) {
  return String(v || "")
    .normalize("NFC")
    .trim()
    .replace(/[\s.\-·]/g, "")
    .toLowerCase();
}

function dictKeyByType(entityType, payload) {
  if (entityType === "case") return String(payload.citation || "").trim();
  if (entityType === "statute") return String(payload.statuteKey || payload.key || "").trim();
  return String(payload.term || "").trim();
}

function sanitizeDictPayload(entityType, raw) {
  if (entityType === "case") return sanitizeCasePayload(raw);
  if (entityType === "statute") return sanitizeStatutePayload(raw);
  return sanitizeTermPayload(raw);
}

exports.adminStageDictBatch = onCall({ region: "asia-northeast3" }, async (request) => {
  assertAdminCallable(request);
  const entityTypeRaw = String((request.data && request.data.entityType) || "term")
    .trim()
    .toLowerCase();
  const entityType =
    entityTypeRaw === "case" ? "case" : entityTypeRaw === "statute" ? "statute" : "term";
  const rows = Array.isArray(request.data && request.data.rows) ? request.data.rows : [];
  if (!rows.length) throw new HttpsError("invalid-argument", "rows 배열이 필요합니다.");
  if (rows.length > 500) throw new HttpsError("invalid-argument", "한 번에 최대 500건까지 가능합니다.");
  const email = String(request.auth.token.email || "").toLowerCase();
  const col = dictStagingCollectionByType(entityType);
  const batch = db.batch();
  let okCount = 0;
  const failRows = [];
  const parsedRows = [];
  rows.forEach((row, idx) => {
    try {
      const payload = sanitizeDictPayload(entityType, row);
      const entryKey = dictKeyByType(entityType, payload);
      parsedRows.push({
        entryKey,
        payload
      });
    } catch (err) {
      failRows.push({ index: idx + 1, reason: err && err.message ? err.message : "형식 오류" });
    }
  });
  const apiKey = process.env.GEMINI_API_KEY || "";
  const modelId = effectiveGeminiModelId();
  let aiReviewByKey = {};
  try {
    const reviewInput = parsedRows.map((x) => {
      if (entityType === "case") {
        return {
          entryKey: x.entryKey,
          citation: x.payload.citation || "",
          title: x.payload.title || "",
          issues: x.payload.issues || "",
          judgment: x.payload.judgment || ""
        };
      }
      if (entityType === "statute") {
        return {
          entryKey: x.entryKey,
          statuteKey: x.payload.statuteKey || "",
          heading: x.payload.heading || "",
          body: String(x.payload.body || "").slice(0, 1200),
          appliedRules: x.payload.appliedRules || "",
          subordinateRules: x.payload.subordinateRules || "",
          examPoint: x.payload.examPoint || ""
        };
      }
      return {
        entryKey: x.entryKey,
        term: x.payload.term || "",
        aliases: x.payload.aliases || [],
        definition: x.payload.definition || ""
      };
    });
    aiReviewByKey = await autoReviewDictRows(apiKey, modelId, entityType, reviewInput);
  } catch (_) {
    aiReviewByKey = {};
  }
  parsedRows.forEach((row) => {
    const ref = db.collection(col).doc();
    batch.set(ref, {
      entityType,
      entryKey: row.entryKey,
      payload: row.payload,
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
      version: 1,
      aiReview: aiReviewByKey[row.entryKey] || buildDefaultAiReview(entityType)
    });
    okCount += 1;
  });
  if (okCount > 0) await batch.commit();
  return { ok: true, okCount, failRows };
});

exports.adminListDictStaging = onCall({ region: "asia-northeast3" }, async (request) => {
  assertAdminCallable(request);
  const entityTypeRaw = String((request.data && request.data.entityType) || "term").trim().toLowerCase();
  const entityType =
    entityTypeRaw === "case" ? "case" : entityTypeRaw === "statute" ? "statute" : "term";
  const status = String((request.data && request.data.status) || "reviewing").trim();
  const limitRaw = parseInt(request.data && request.data.limit, 10);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(1000, limitRaw)) : 100;
  const col = dictStagingCollectionByType(entityType);
  const snap = await db.collection(col).limit(1200).get();
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
          : entityType === "statute"
            ? String(payload.statuteKey || payload.heading || "").trim()
            : String(payload.term || "").trim(),
      status: x.status || "reviewing",
      source: x.source || "",
      aiReview: x.aiReview && typeof x.aiReview === "object" ? x.aiReview : null,
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
  const entityType =
    entityTypeRaw === "case" ? "case" : entityTypeRaw === "statute" ? "statute" : "term";
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
    const pubId = entityType === "statute" ? normalizeStatuteDocId(key, "statute") : key;
    const ps = await db.collection(dictPublishedCollectionByType(entityType)).doc(pubId).get();
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
      aiReview: data.aiReview && typeof data.aiReview === "object" ? data.aiReview : null,
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
  const entityType =
    entityTypeRaw === "case" ? "case" : entityTypeRaw === "statute" ? "statute" : "term";
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
  const entityType =
    entityTypeRaw === "case" ? "case" : entityTypeRaw === "statute" ? "statute" : "term";
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
    const pubId = entityType === "statute" ? normalizeStatuteDocId(key, "statute") : key;
    const pubRef = db.collection(pubCol).doc(pubId);
    const sourceTag = String(cur.tagInput || key || "").trim();
    const normSourceTag = normTagKeyForLinking(cur.normKey || sourceTag);
    const tagAliasesSet = {};
    if (sourceTag) tagAliasesSet[sourceTag] = true;
    if (normSourceTag) tagAliasesSet[normSourceTag] = true;
    if (key) {
      tagAliasesSet[key] = true;
      tagAliasesSet[normTagKeyForLinking(key)] = true;
    }
    const tagAliases = Object.keys(tagAliasesSet).filter(Boolean).slice(0, 20);
    t.set(
      pubRef,
      Object.assign({}, payload, {
        sourceTag,
        normSourceTag,
        tagAliases,
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
    appliedRules: String(entry.appliedRules != null ? entry.appliedRules : "").trim(),
    subordinateRules: String(entry.subordinateRules != null ? entry.subordinateRules : "").trim(),
    examPoint: String(entry.examPoint != null ? entry.examPoint : "").trim(),
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
  const entityType =
    entityTypeRaw === "case" ? "case" : entityTypeRaw === "statute" ? "statute" : "term";
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
exports.adminQuoteApproveAllPending = headerQuotesAdmin.adminQuoteApproveAllPending;
exports.adminQuoteReject = headerQuotesAdmin.adminQuoteReject;
exports.adminQuoteUpdateStaging = headerQuotesAdmin.adminQuoteUpdateStaging;
exports.adminQuoteGetPublished = headerQuotesAdmin.adminQuoteGetPublished;
exports.adminQuoteReplacePublished = headerQuotesAdmin.adminQuoteReplacePublished;
