"use strict";

const { getFirestore } = require("firebase-admin/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { uniqueGeminiModelCandidates } = require("./geminiModel");
const { loadRefundEstimatesForUid, formatEstimatesForAi } = require("./refundEstimate");

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

async function resolveUidFromRequest(data) {
  const uid = String((data && data.uid) || "").trim();
  if (uid) return uid;
  const email = String((data && data.email) || "").trim().toLowerCase();
  if (!email) return "";
  const snap = await getFirestore().collection("hanlaw_members").where("email", "==", email).limit(1).get();
  if (!snap.empty) return snap.docs[0].id;
  return "";
}

function buildAdminRefundPrompt(channel, userMessage, aiContext, nick) {
  const ch = String(channel || "email").toLowerCase();
  const channelLabel =
    ch === "phone" || ch === "call"
      ? "전화 통화"
      : ch === "sms" || ch === "문자"
        ? "문자(SMS)"
        : ch === "chat"
          ? "앱 채팅"
          : "이메일";
  const call = nick ? nick + "님" : "회원님";

  return [
    "당신은 '행정법Q' 운영팀이 환불 문의에 답하는 초안을 작성합니다.",
    "아래 [시스템 환불 산정]은 참고용 추정치이며, 최종 환불액은 운영 검토·환불정책·이용 여부(해설 열람 등)에 따라 달라질 수 있습니다.",
    "",
    "출력 형식(반드시 준수):",
    "===고객용 답변===",
    "(고객에게 보낼/말할 본문만. 정중한 한국어. 산식·금액·근거를 이해하기 쉽게. 마크다운 금지.)",
    "===관리자 메모===",
    "(내부용: 확인할 사항, PG 취소 시 유의, 산정 가정 한 줄 요약)",
    "",
    "요구사항:",
    "- 앱 이름은 '행정법Q'만 사용.",
    "- 채널: " + channelLabel + " — " + (ch === "phone" ? "구두로 읽기 쉬운 문장." : "복사·붙여넣기 가능한 문장."),
    "- 7일 이내·미이용 시 전액 환불 가능 여부는 고객 제출 내용에 따라 언급(확정 단정 금지).",
    "- 정기 해지(다음 결제 중단)와 환불(이미 낸 회차)은 별도임을 필요 시 안내.",
    "- 환불 절차: ellutionsoft@gmail.com, 3영업일 내 처리 시도, 카드사 환급 지연 가능.",
    "- 호칭: " + call,
    "",
    "[고객 문의]",
    clampStr(userMessage, 6000),
    "",
    "[시스템 환불 산정]",
    clampStr(aiContext, 8000)
  ].join("\n");
}

function parseDualDraft(text) {
  const raw = String(text || "").trim();
  const customerKey = "===고객용 답변===";
  const adminKey = "===관리자 메모===";
  let customerReply = raw;
  let adminNotes = "";
  const i0 = raw.indexOf(customerKey);
  const i1 = raw.indexOf(adminKey);
  if (i0 >= 0 && i1 > i0) {
    customerReply = raw.slice(i0 + customerKey.length, i1).trim();
    adminNotes = raw.slice(i1 + adminKey.length).trim();
  } else if (i0 >= 0) {
    customerReply = raw.slice(i0 + customerKey.length).trim();
  }
  return { customerReply, adminNotes };
}

async function generateRefundDraftPlain(apiKey, userPrompt) {
  const genAI = new GoogleGenerativeAI(apiKey);
  const candidates = uniqueGeminiModelCandidates();
  let lastErr = null;
  for (let i = 0; i < candidates.length; i++) {
    const modelId = candidates[i];
    try {
      const model = genAI.getGenerativeModel({
        model: modelId,
        generationConfig: { maxOutputTokens: 4096, temperature: 0.35 }
      });
      const res = await model.generateContent(userPrompt);
      const out = String((res && res.response && res.response.text && res.response.text()) || "").trim();
      if (out) return out;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("Gemini 호출 실패");
}

const adminDraftRefundReply = onCall({ region: "asia-northeast3", timeoutSeconds: 120 }, async (request) => {
  if (!isAdminFromAuth(request.auth)) {
    throw new HttpsError("permission-denied", "관리자만 사용할 수 있습니다.");
  }
  const data = request.data || {};
  const channel = String(data.channel || "email").trim();
  const userMessage = String(data.userMessage || data.message || "").trim();
  if (!userMessage) {
    throw new HttpsError("invalid-argument", "고객 문의 내용(userMessage)이 필요합니다.");
  }

  const uid = await resolveUidFromRequest(data);
  let aiContext = "";
  let estimates = [];
  let membershipSummary = null;
  if (uid) {
    const loaded = await loadRefundEstimatesForUid(uid, Date.now());
    if (loaded.ok) {
      estimates = loaded.estimates;
      membershipSummary = loaded.membershipSummary;
      aiContext = loaded.aiContext;
    }
  } else {
    aiContext = formatEstimatesForAi([], null, { disclaimer: true });
    aiContext +=
      "\n회원 UID/이메일이 없어 자동 산정을 생략했습니다. 결제일·금액·플랜을 문의에서 추정해 안내하세요.";
  }

  const nick = String(data.userNickname || "").trim();
  const apiKey = String(process.env.GEMINI_API_KEY || "").trim();
  if (!apiKey) {
    const fallbackCustomer =
      (nick ? nick + "님, " : "") +
      "환불 요청 접수되었습니다. 결제일·금액·이용 여부를 확인한 뒤 환불정책에 따라 산정해 안내드리겠습니다. (GEMINI_API_KEY 미설정으로 AI 초안 생략)";
    return {
      ok: true,
      customerReply: fallbackCustomer,
      adminNotes: aiContext,
      estimates,
      membershipSummary
    };
  }

  try {
    const prompt = buildAdminRefundPrompt(channel, userMessage, aiContext, nick);
    const raw = await generateRefundDraftPlain(apiKey, prompt);
    const parsed = parseDualDraft(raw);
    return {
      ok: true,
      customerReply: parsed.customerReply || raw,
      adminNotes: parsed.adminNotes || aiContext,
      estimates,
      membershipSummary
    };
  } catch (e) {
    console.error("adminDraftRefundReply", e);
    throw new HttpsError("internal", String((e && e.message) || "환불 답변 초안 생성에 실패했습니다."));
  }
});

module.exports = { adminDraftRefundReply, parseDualDraft };
