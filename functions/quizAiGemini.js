"use strict";

const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
const { consumeOneFromBatches, pushCompensatingBatch } = require("./walletBatches");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { retrieveLibraryContextForQuiz } = require("./libraryRag");
const { appendLibraryRagBlockToSystemPrompt } = require("./libraryRagPromptAppend");
const { effectiveGeminiModelId } = require("./geminiModel");
const { getStoredNickname } = require("./userProfileServer");

function db() {
  return getFirestore();
}

const QUIZ_AI_DAILY_LIMIT = 4;
const ELLY_WALLET_BATCH_VALID_MS = 365 * 24 * 60 * 60 * 1000;
const MAX_USER_Q = 800;
const MAX_STATEMENT = 4000;
const MAX_EXPLAIN = 6000;
/** Gemini 출력 상한 — 너무 낮으면 MAX_TOKENS로 중간에 끊긴 답이 성공 처리될 수 있음 */
const GEMINI_MAX_OUTPUT_TOKENS = 4096;
/** 1.5 실패 시 2.5 등으로 폴백 (단종·지역 제한 대비) */
const FALLBACK_MODELS = ["gemini-2.0-flash", "gemini-1.5-flash", "gemini-2.5-flash", "gemini-2.5-flash-lite"];

/**
 * generateContent 결과의 finishReason 검사. 비정상 종료면 throw → 상위에서 releaseEllyReservation.
 * @param {*} genResult
 */
function assertGeminiGenerationComplete(genResult) {
  const resp = genResult && genResult.response;
  if (!resp) {
    throw new Error("AI 응답이 없습니다. 질문권은 복구되었습니다.");
  }
  const cands = resp.candidates;
  if (!cands || !cands.length) {
    try {
      resp.text();
    } catch (e) {
      throw new Error(
        (e && e.message) || "AI 응답을 받지 못했습니다. 질문권은 복구되었습니다."
      );
    }
    throw new Error("AI 응답 후보가 없습니다. 질문권은 복구되었습니다.");
  }
  const fr = cands[0].finishReason;
  if (fr === undefined || fr === null) return;

  const s = String(fr).toUpperCase();
  if (s === "STOP" || s === "FINISH_REASON_STOP" || fr === 1) return;

  if (s === "MAX_TOKENS" || s === "FINISH_REASON_MAX_TOKENS" || fr === 2) {
    throw new Error(
      "답변이 출력 한도에서 잘려 완료되지 않았습니다. 질문권은 복구되었습니다. 질문을 조금 짧게 나누어 다시 시도해 주세요."
    );
  }
  if (s === "SAFETY" || s === "FINISH_REASON_SAFETY" || fr === 3) {
    throw new Error("안전 정책으로 답변이 제한되었습니다. 질문권은 복구되었습니다.");
  }
  if (s === "RECITATION" || s === "FINISH_REASON_RECITATION" || fr === 4) {
    throw new Error("인용·저작권 정책으로 답변이 제한되었습니다. 질문권은 복구되었습니다.");
  }
  throw new Error("AI가 답변을 끝까지 생성하지 못했습니다. 질문권은 복구되었습니다. 잠시 후 다시 시도해 주세요.");
}

function kstYmd(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);
}

function clampStr(v, max) {
  const s = v == null ? "" : String(v);
  return s.length > max ? s.slice(0, max) : s;
}

function oxLabel(b) {
  return b === true ? "O(참)" : b === false ? "X(거짓)" : "—";
}

function sumEllyCredits(batches, nowMs) {
  let n = 0;
  if (!Array.isArray(batches)) return 0;
  for (const b of batches) {
    const exp = b.expiresAt;
    const expMs = exp && typeof exp.toMillis === "function" ? exp.toMillis() : 0;
    if (expMs < nowMs) continue;
    n += Math.max(0, parseInt(b.amount, 10) || 0);
  }
  return n;
}

/**
 * @returns {Promise<{ remainingAfter: number|null, reservationKind: 'unlimited'|'free'|'credit', ellyCreditsAfter?: number }>}
 */
async function reserveEllySlot(uid) {
  const usageRef = db().collection("hanlaw_quiz_ai_usage").doc(uid);
  const walletRef = db().collection("hanlaw_quiz_ai_wallet").doc(uid);
  const memRef = db().collection("hanlaw_members").doc(uid);
  const today = kstYmd();

  return db().runTransaction(async (t) => {
    const [memSnap, usageSnap, walletSnap] = await t.getAll(memRef, usageRef, walletRef);
    const nowMs = Date.now();

    const m = memSnap.exists ? memSnap.data() : {};
    const ellyUntil = m.ellyUnlimitedUntil;
    if (
      ellyUntil &&
      typeof ellyUntil.toMillis === "function" &&
      ellyUntil.toMillis() > nowMs
    ) {
      return {
        remainingAfter: null,
        reservationKind: "unlimited",
        ellyCreditsAfter: undefined
      };
    }

    let count = 0;
    if (usageSnap.exists) {
      const d = usageSnap.data();
      if (d.ymd === today) count = Math.max(0, parseInt(d.count, 10) || 0);
    }

    if (count < QUIZ_AI_DAILY_LIMIT) {
      const next = count + 1;
      t.set(
        usageRef,
        { ymd: today, count: next, updatedAt: FieldValue.serverTimestamp() },
        { merge: true }
      );
      return {
        remainingAfter: QUIZ_AI_DAILY_LIMIT - next,
        reservationKind: "free",
        ellyCreditsAfter: sumEllyCredits(
          walletSnap.exists ? walletSnap.data().batches : [],
          nowMs
        )
      };
    }

    const batches = walletSnap.exists && Array.isArray(walletSnap.data().batches)
      ? walletSnap.data().batches
      : [];
    const newBatches = consumeOneFromBatches(batches, nowMs);
    if (!newBatches) {
      throw new HttpsError(
        "resource-exhausted",
        "무료 " +
          QUIZ_AI_DAILY_LIMIT +
          "회를 모두 사용했습니다. 엘리(AI) 질문권을 구매해 주세요. (요금제 탭)"
      );
    }
    t.set(
      walletRef,
      {
        batches: newBatches,
        updatedAt: FieldValue.serverTimestamp()
      },
      { merge: true }
    );
    return {
      remainingAfter: 0,
      reservationKind: "credit",
      ellyCreditsAfter: sumEllyCredits(newBatches, nowMs)
    };
  });
}

/**
 * @param {string} uid
 * @param {{ reservationKind: string }} reservation
 */
async function releaseEllyReservation(uid, reservation) {
  if (!reservation || reservation.reservationKind === "unlimited") return;
  if (reservation.reservationKind === "free") {
    const usageRef = db().collection("hanlaw_quiz_ai_usage").doc(uid);
    const today = kstYmd();
    try {
      await db().runTransaction(async (t) => {
        const snap = await t.get(usageRef);
        if (!snap.exists) return;
        const d = snap.data();
        if (d.ymd !== today) return;
        let count = Math.max(0, parseInt(d.count, 10) || 0);
        if (count <= 0) return;
        t.set(
          usageRef,
          { ymd: today, count: count - 1, updatedAt: FieldValue.serverTimestamp() },
          { merge: true }
        );
      });
    } catch (e) {
      console.error("quizAiGemini releaseEllyReservation free", e);
    }
    return;
  }
  if (reservation.reservationKind === "credit") {
    const walletRef = db().collection("hanlaw_quiz_ai_wallet").doc(uid);
    const exp = Timestamp.fromMillis(Date.now() + ELLY_WALLET_BATCH_VALID_MS);
    try {
      await db().runTransaction(async (t) => {
        const ws = await t.get(walletRef);
        const prev = ws.exists && Array.isArray(ws.data().batches) ? ws.data().batches : [];
        const next = pushCompensatingBatch(prev, exp);
        t.set(
          walletRef,
          {
            batches: next,
            updatedAt: FieldValue.serverTimestamp()
          },
          { merge: true }
        );
      });
    } catch (e) {
      console.error("quizAiGemini releaseEllyReservation credit", e);
    }
  }
}

async function generateQuizReply(apiKey, modelId, quiz, userQuestion, ragContext, learnerNickname) {
  const gen = new GoogleGenerativeAI(apiKey);
  const candidates = [];
  [modelId].concat(FALLBACK_MODELS).forEach(function (m) {
    var s = String(m || "").trim();
    if (!s || candidates.indexOf(s) >= 0) return;
    candidates.push(s);
  });

  let system = [
    "당신은 한국 행정법 학습을 돕는 조교입니다.",
    "아래에 주어진 퀴즈 문항·정답·해설은 앱에서 제공된 내용입니다.",
    "학습자의 추가 질문에 한국어로 명확하고 간결하게 답하세요.",
    "판례·조문 번호를 단정하지 말고, 불확실하면 불확실하다고 말하세요.",
    "시험 정답은 반드시 제공된 정답(O/X)과 일치하게 설명하세요.",
    "여러 요점이 있으면 줄마다 '* **짧은 제목:** 설명' 형태로 적어 주세요. (앱에서 별표 불릿은 숨기고 제목만 강조됩니다.)",
    "자료실에서 가져온 참고가 있더라도, 사용자에게는 파일명·출처·원문 직접 인용 없이 재서술된 설명만 제공합니다."
  ].join("\n");

  const nick = learnerNickname && String(learnerNickname).trim();
  if (nick) {
    system +=
      "\n\n학습자 닉네임: 「" +
      nick +
      "」 — 답변 시작이나 마무리에 한 번 정도 자연스럽게 ‘" +
      nick +
      "님’처럼 호칭해도 좋습니다. (과하게 반복하지 마세요.)";
  }

  system = appendLibraryRagBlockToSystemPrompt(system, ragContext);
  if (ragContext && String(ragContext).trim()) {
    system += "\n\n(참고 발췌와 퀴즈 정답·해설이 모순되면 해설·문항을 우선하세요.)";
  }

  const ctx = [
    "[문항 주제]",
    quiz.topic || "—",
    "",
    "[문항 본문]",
    quiz.statement,
    "",
    "[정답]",
    oxLabel(quiz.correctAnswer),
    "",
    "[학습자가 고른 답]",
    oxLabel(quiz.userAnsweredTrue),
    "",
    "[기본 해설]",
    quiz.explanationBasic || "(없음)",
    "",
    "[추가 해설]",
    quiz.explanationExtra || "(없음)",
    "",
    "[학습자 질문]",
    userQuestion
  ].join("\n");

  var lastErr = null;
  for (let i = 0; i < candidates.length; i++) {
    const model = gen.getGenerativeModel({
      model: candidates[i],
      generationConfig: {
        temperature: 0.35,
        maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS
      }
    });
    try {
      const res = await model.generateContent(system + "\n\n---\n\n" + ctx);
      assertGeminiGenerationComplete(res);
      const text = res.response.text();
      if (text && String(text).trim()) return String(text).trim();
      lastErr = new Error("모델이 빈 응답을 반환했습니다.");
    } catch (e) {
      lastErr = e;
      const msg = String((e && e.message) || e || "");
      const low = msg.toLowerCase();
      // 모델 미존재·단종(404)만 다음 후보로 폴백
      if (
        (low.includes("models/") && low.includes("not found")) ||
        (low.includes("404") && low.includes("no longer available"))
      ) {
        continue;
      }
      throw e;
    }
  }
  throw lastErr || new Error("AI 모델 호출에 실패했습니다.");
}

async function generateDictionaryReply(apiKey, modelId, quiz, userQuestion, ragContext, learnerNickname) {
  const gen = new GoogleGenerativeAI(apiKey);
  const candidates = [];
  [modelId].concat(FALLBACK_MODELS).forEach(function (m) {
    var s = String(m || "").trim();
    if (!s || candidates.indexOf(s) >= 0) return;
    candidates.push(s);
  });

  let system = [
    "당신은 한국 행정법 학습을 돕는 조교입니다.",
    "아래는 앱의 용어·조문·판례 사전에 수록된 설명입니다. (시험용 O/X 문항이 아닙니다.)",
    "학습자의 질문에 한국어로 명확하고 간결하게 답하세요.",
    "수록문과 모순되지 않게 설명하고, 판례·조문 번호를 단정하지 말며 불확실하면 불확실하다고 말하세요.",
    "여러 요점이 있으면 줄마다 '* **짧은 제목:** 설명' 형태로 적어 주세요. (앱에서 별표 불릿은 숨기고 제목만 강조됩니다.)",
    "자료실 참고가 있더라도, 사용자에게는 파일명·출처·원문 직접 인용 없이 재서술된 설명만 제공합니다."
  ].join("\n");

  const nick = learnerNickname && String(learnerNickname).trim();
  if (nick) {
    system +=
      "\n\n학습자 닉네임: 「" +
      nick +
      "」 — 답변 시작이나 마무리에 한 번 정도 자연스럽게 ‘" +
      nick +
      "님’처럼 호칭해도 좋습니다. (과하게 반복하지 마세요.)";
  }

  system = appendLibraryRagBlockToSystemPrompt(system, ragContext);
  if (ragContext && String(ragContext).trim()) {
    system += "\n\n(참고 발췌와 사전 수록문이 모순되면 사전 수록문을 우선하세요.)";
  }

  const ctx = [
    "[사전 항목 제목·유형]",
    quiz.topic || "—",
    "",
    "[수록 본문]",
    quiz.statement,
    "",
    "[부가 설명]",
    quiz.explanationBasic || "(없음)",
    "",
    "[학습자 질문]",
    userQuestion
  ].join("\n");

  var lastErr = null;
  for (let i = 0; i < candidates.length; i++) {
    const model = gen.getGenerativeModel({
      model: candidates[i],
      generationConfig: {
        temperature: 0.35,
        maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS
      }
    });
    try {
      const res = await model.generateContent(system + "\n\n---\n\n" + ctx);
      assertGeminiGenerationComplete(res);
      const text = res.response.text();
      if (text && String(text).trim()) return String(text).trim();
      lastErr = new Error("모델이 빈 응답을 반환했습니다.");
    } catch (e) {
      lastErr = e;
      const msg = String((e && e.message) || e || "");
      const low = msg.toLowerCase();
      if (
        (low.includes("models/") && low.includes("not found")) ||
        (low.includes("404") && low.includes("no longer available"))
      ) {
        continue;
      }
      throw e;
    }
  }
  throw lastErr || new Error("AI 모델 호출에 실패했습니다.");
}

const quizAskGemini = onCall({ region: "asia-northeast3" }, async (request) => {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
  }
  const uid = request.auth.uid;
  const data = request.data || {};

  let rawQ = clampStr(data.userQuestion, MAX_USER_Q).trim();
  if (!rawQ) {
    rawQ = "이 문제와 위 해설을 바탕으로 핵심만 다시 정리해 주세요.";
  }

  const qz = data.quiz || {};
  const isDictionary = qz.mode === "dictionary";
  const quiz = {
    statement: clampStr(qz.statement, MAX_STATEMENT),
    topic: clampStr(qz.topic, 200),
    correctAnswer: qz.correctAnswer === true || qz.correctAnswer === false ? qz.correctAnswer : null,
    userAnsweredTrue:
      qz.userAnsweredTrue === true || qz.userAnsweredTrue === false ? qz.userAnsweredTrue : null,
    explanationBasic: clampStr(qz.explanationBasic, MAX_EXPLAIN),
    explanationExtra: clampStr(qz.explanationExtra, MAX_EXPLAIN)
  };

  if (!quiz.statement || quiz.statement.length < 3) {
    throw new HttpsError(
      "invalid-argument",
      isDictionary
        ? "사전 본문 정보가 없습니다. 항목을 검색한 뒤 다시 시도해 주세요."
        : "문항 정보가 없습니다. 퀴즈 화면에서 다시 시도해 주세요."
    );
  }
  if (!isDictionary) {
    if (quiz.correctAnswer !== true && quiz.correctAnswer !== false) {
      throw new HttpsError("invalid-argument", "문항 정답 정보가 올바르지 않습니다.");
    }
  }

  const apiKey = process.env.GEMINI_API_KEY || "";
  const modelId = effectiveGeminiModelId();
  if (!apiKey) {
    throw new HttpsError(
      "failed-precondition",
      "서버에 GEMINI_API_KEY가 설정되어 있지 않습니다. 관리자에게 문의하세요."
    );
  }

  let rem;
  try {
    rem = await reserveEllySlot(uid);
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    console.error("quizAskGemini reserve", e);
    throw new HttpsError("internal", "사용 한도 확인 중 오류가 발생했습니다.");
  }

  let ragContext = "";
  try {
    ragContext = await retrieveLibraryContextForQuiz(rawQ, quiz);
  } catch (ragErr) {
    console.warn("quizAskGemini RAG skip", ragErr && ragErr.message);
  }

  let learnerNick = "";
  try {
    learnerNick = await getStoredNickname(uid);
  } catch (nickErr) {
    console.warn("quizAskGemini nickname skip", nickErr && nickErr.message);
  }

  try {
    const answer = isDictionary
      ? await generateDictionaryReply(apiKey, modelId, quiz, rawQ, ragContext, learnerNick)
      : await generateQuizReply(apiKey, modelId, quiz, rawQ, ragContext, learnerNick);

    try {
      const qid =
        qz.questionId != null && String(qz.questionId).trim()
          ? clampStr(String(qz.questionId).trim(), 120)
          : null;
      await db().collection("hanlaw_quiz_ai_asks").add({
        userId: uid,
        userQuestion: clampStr(rawQ, MAX_USER_Q),
        /** 대시보드·Q&A에서 퀴즈 지문·사전 본문 표시용 */
        quizStatement: clampStr(quiz.statement, MAX_STATEMENT),
        answerPreview: clampStr(String(answer), 4000),
        /** Q&A 공개·열람용 전문(미리보기보다 길게 보관) */
        answerFull: clampStr(String(answer), 12000),
        userNickname: learnerNick ? clampStr(learnerNick, 80) : "",
        mode: isDictionary ? "dictionary" : "quiz",
        quizTopic: clampStr(quiz.topic, 200) || "",
        questionId: qid,
        createdAt: FieldValue.serverTimestamp()
      });
    } catch (logErr) {
      console.warn("quizAskGemini history log", logErr && logErr.message);
    }

    return {
      ok: true,
      answer,
      remainingToday: rem.remainingAfter,
      ellyUnlimited: rem.reservationKind === "unlimited",
      ellyCreditsRemaining:
        typeof rem.ellyCreditsAfter === "number" ? rem.ellyCreditsAfter : undefined,
      usedLibraryRag: !!ragContext
    };
  } catch (e) {
    await releaseEllyReservation(uid, rem);
    console.error("quizAskGemini generate", e);
    throw new HttpsError(
      "internal",
      (e && e.message) || "AI 응답 생성 중 오류가 발생했습니다."
    );
  }
});

module.exports = { quizAskGemini, QUIZ_AI_DAILY_LIMIT };
