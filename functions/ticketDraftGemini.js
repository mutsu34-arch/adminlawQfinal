"use strict";

/**
 * 관리자 문의함: 티켓 유형별 회신 초안을 Gemini로 생성합니다.
 * GEMINI_API_KEY 필요. ADMIN_EMAILS 와 동일한 관리자만 호출 가능.
 * 자료실 RAG: PINECONE 등 설정 시 티켓 본문·문항 맥락으로 retrieveLibraryContextForQuiz 후 프롬프트에 발췌를 붙입니다.
 */

const { getFirestore } = require("firebase-admin/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { effectiveGeminiModelId, uniqueGeminiModelCandidates } = require("./geminiModel");
const { retrieveLibraryContextForQuiz } = require("./libraryRag");
const { appendLibraryRagBlockToSystemPrompt } = require("./libraryRagPromptAppend");

function isAdminFromAuth(auth) {
  const email = auth && auth.token && auth.token.email ? String(auth.token.email).toLowerCase() : "";
  if (!email) return false;
  const raw = process.env.ADMIN_EMAILS || "mutsu34@gmail.com";
  const admins = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return admins.includes(email);
}

function clampStr(v, max) {
  const s = v == null ? "" : String(v);
  return s.length > max ? s.slice(0, max) : s;
}

/**
 * 모델이 학습 데이터의 구 앱명을 출력하는 경우 서버에서 강제로 정규화합니다.
 */
function normalizeAppBrandInDraft(text) {
  let out = String(text || "");
  if (!out) return out;
  out = out.replace(/한국\s*행정법\s*퀴즈/g, "행정법Q");
  out = out.replace(/한국행정법퀴즈/g, "행정법Q");
  return out;
}

/**
 * 자료실 Pinecone 검색용: quizAskGemini와 동일 retrieveLibraryContextForQuiz(userQuestion, quiz)
 */
function buildRagQueryForTicket(ticket) {
  const type = String(ticket.type || "report").toLowerCase();
  const msg = clampStr(ticket.message, 1500);
  const ctx = ticket.quizContext || {};
  if (type === "question") {
    return {
      userQuestion: msg,
      quiz: {
        topic: ctx.topic != null ? String(ctx.topic) : "",
        statement: ctx.statement != null ? String(ctx.statement) : ""
      }
    };
  }
  const topicHint =
    type === "suggestion"
      ? "서비스 개선·의견"
      : type === "promotion"
        ? "홍보·인증 신청"
        : "오류 신고·문의";
  return {
    userQuestion: msg,
    quiz: { topic: topicHint, statement: "" }
  };
}

function appendLibraryRagToPrompt(basePrompt, ragBlock) {
  const b = String(basePrompt || "");
  const r = String(ragBlock || "").trim();
  if (!r) return b;
  let out = appendLibraryRagBlockToSystemPrompt(b, r);
  out +=
    "\n\n(위 발췌는 참고용입니다. 회원에게 보낼 문장에도 파일명·원문 직접 인용·특정 교재 표시는 넣지 마세요. 의미만 반영해 재서술하세요.)";
  return out;
}

function buildPrompt(ticket) {
  const type = String(ticket.type || "report").toLowerCase();
  const msg = clampStr(ticket.message, 8000);
  const nick = ticket.userNickname && String(ticket.userNickname).trim() ? String(ticket.userNickname).trim() : "";
  const links = Array.isArray(ticket.linkUrls) ? ticket.linkUrls.filter(Boolean).map((u) => clampStr(u, 2000)).slice(0, 8) : [];
  const linkBlock = links.length ? "\n[참고 링크]\n" + links.join("\n") : "";

  if (type === "suggestion") {
    return [
      "당신은 '행정법Q' 웹앱 운영팀이 사용자에게 보낼 답장 초안을 작성합니다.",
      "아래는 사용자가 제출한 서비스 개선 의견입니다.",
      "",
      "요구사항:",
      "- 앱 이름 표기는 반드시 '행정법Q'로 통일합니다. (다른 앱명 금지)",
      "- 한국어로 정중하고 따뜻한 톤입니다.",
      "- 의견에 감사를 표하고, 내부 검토 후 검토 결과(반영 가능 여부 등)를 안내하는 문장으로 구성합니다. '반드시 반영' 같은 단정적 약속은 피합니다.",
      "- 2~5개의 짧은 문단. 관리자가 약간 수정해 바로 보낼 수 있게 합니다.",
      "- 맨 앞에 [초안] 같은 라벨이나 메타 설명은 넣지 마세요.",
      nick
        ? "- 호칭: 자연스럽게 '" + nick + "님' 등으로 부르세요."
        : "- 닉네임이 없으면 '회원님' 등으로 통칭해도 됩니다.",
      "",
      "[사용자 닉네임] " + (nick || "(없음)"),
      "[제출 내용]",
      msg,
      linkBlock
    ].join("\n");
  }

  if (type === "promotion") {
    return [
      "당신은 '행정법Q' 웹앱 운영팀이 홍보·인증 신청에 답하는 초안을 작성합니다.",
      "아래는 사용자가 제출한 홍보 활동 요약과 링크입니다.",
      "",
      "요구사항:",
      "- 앱 이름 표기는 반드시 '행정법Q'로 통일합니다. (다른 앱명 금지)",
      "- 한국어, 정중한 톤.",
      "- 검토했음을 알리고, 인증 기준에 따라 승인·보완 요청 중 어떤 쪽에 해당할 수 있는지 중립적으로 안내하는 초안(아직 결과를 단정하지 않음).",
      "- 2~4문단. 맨 앞 라벨·메타 문구 없이 본문만.",
      nick ? "- 호칭: '" + nick + "님' 등." : "",
      "",
      "[사용자 닉네임] " + (nick || "(없음)"),
      "[제출 내용]",
      msg,
      linkBlock
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (type === "question") {
    const ctx = ticket.quizContext || {};
    const ctxLines = [
      "문항 ID: " + (ctx.questionId != null ? String(ctx.questionId) : "-"),
      "주제: " + (ctx.topic != null ? String(ctx.topic) : "-"),
      "시험/연도: " + (ctx.exam != null ? String(ctx.exam) : "-") + " / " + (ctx.year != null ? String(ctx.year) : "-"),
      "지문 일부: " + clampStr(ctx.statement || "", 1200)
    ].join("\n");
    return [
      "당신은 '행정법Q' 웹앱에서 학습자 질문 답변을 돕는 조교입니다.",
      "아래는 유료 질문권으로 제출된 학습자 질문과 문항 맥락입니다.",
      "",
      "요구사항:",
      "- 앱·서비스 이름은 반드시 '행정법Q'로만 표기합니다. (예: '한국행정법 퀴즈' 등 다른 이름 금지)",
      "- 한국어로 명확하고 수험에 도움이 되게 답하세요.",
      "- 앱에 제시된 문항·정답·해설과 모순되지 않게 하세요. 불확실하면 불확실하다고 하세요.",
      "- 2~6문단. 맨 앞 [초안] 같은 라벨은 넣지 마세요.",
      nick ? "- 호칭: '" + nick + "님' 등 자연스럽게." : "",
      "",
      "[문항 맥락]\n" + ctxLines,
      "",
      "[학습자 질문]",
      msg,
      linkBlock
    ]
      .filter(Boolean)
      .join("\n");
  }

  // report (오류 신고 등)
  return [
    "당신은 '행정법Q' 웹앱 운영팀이 오류·문의 신고에 답하는 초안을 작성합니다.",
    "",
    "요구사항:",
    "- 앱 이름 표기는 반드시 '행정법Q'로 통일합니다. (다른 앱명 금지)",
    "- 한국어, 정중한 톤.",
    "- 접수·검토 중임을 알리고, 재현이 필요하면 안내하는 수준의 초안. 원인 단정은 피합니다.",
    "- 2~4문단. 라벨 없이 본문만.",
    nick ? "- 호칭: '" + nick + "님' 등." : "",
    "",
    "[제보 내용]",
    msg,
    linkBlock
  ]
    .filter(Boolean)
    .join("\n");
}

async function generateDraftPlain(apiKey, modelId, userPrompt) {
  const gen = new GoogleGenerativeAI(apiKey);
  const candidates = uniqueGeminiModelCandidates();
  const ordered = [];
  [modelId].concat(candidates).forEach(function (m) {
    const s = String(m || "").trim();
    if (!s || ordered.indexOf(s) >= 0) return;
    ordered.push(s);
  });

  let lastErr = null;
  for (let i = 0; i < ordered.length; i++) {
    const mid = ordered[i];
    try {
      const model = gen.getGenerativeModel({
        model: mid,
        generationConfig: {
          temperature: 0.35,
          maxOutputTokens: 4096
        }
      });
      const res = await model.generateContent(userPrompt);
      const text = res.response.text();
      const out = String(text || "").trim();
      if (out) return out;
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
  throw lastErr || new Error("Gemini 모델 호출에 실패했습니다.");
}

const adminDraftTicketAi = onCall({ region: "asia-northeast3" }, async (request) => {
  if (!isAdminFromAuth(request.auth)) {
    throw new HttpsError("permission-denied", "관리자만 사용할 수 있습니다.");
  }
  const ticketId = String((request.data || {}).ticketId || "").trim();
  if (!ticketId) {
    throw new HttpsError("invalid-argument", "ticketId가 필요합니다.");
  }

  const snap = await getFirestore().collection("hanlaw_tickets").doc(ticketId).get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "티켓을 찾을 수 없습니다.");
  }
  const ticket = snap.data() || {};
  const ticketWithId = Object.assign({ id: ticketId }, ticket);

  const apiKey = process.env.GEMINI_API_KEY || "";
  if (!apiKey) {
    throw new HttpsError(
      "failed-precondition",
      "서버에 GEMINI_API_KEY가 설정되어 있지 않습니다. Firebase Functions 환경에 키를 설정하세요."
    );
  }

  let ragContext = "";
  try {
    const rq = buildRagQueryForTicket(ticketWithId);
    ragContext = await retrieveLibraryContextForQuiz(rq.userQuestion, rq.quiz);
  } catch (ragErr) {
    console.warn("adminDraftTicketAi RAG skip", ragErr && ragErr.message);
  }

  const prompt = appendLibraryRagToPrompt(buildPrompt(ticketWithId), ragContext);
  const modelId = effectiveGeminiModelId();

  try {
    const draftRaw = await generateDraftPlain(apiKey, modelId, prompt);
    const draft = normalizeAppBrandInDraft(draftRaw);
    return { ok: true, draft, usedLibraryRag: !!ragContext };
  } catch (e) {
    console.error("adminDraftTicketAi", e);
    throw new HttpsError("internal", (e && e.message) || "AI 초안 생성에 실패했습니다.");
  }
});

module.exports = { adminDraftTicketAi };
