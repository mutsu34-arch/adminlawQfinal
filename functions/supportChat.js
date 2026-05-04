"use strict";

const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { uniqueGeminiModelCandidates } = require("./geminiModel");

const MAX_MSG = 2000;
const ANON_PREFIX = "anon_";

function isUuidV4Lower(s) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(String(s || ""));
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

function resolveThreadId(request, data) {
  if (request.auth && request.auth.uid) {
    return "user_" + request.auth.uid;
  }
  const tid = String((data && data.threadId) || "").trim().toLowerCase();
  if (!tid.startsWith(ANON_PREFIX)) {
    throw new HttpsError("invalid-argument", "채팅을 시작하려면 threadId가 필요합니다.");
  }
  const rest = tid.slice(ANON_PREFIX.length);
  if (!isUuidV4Lower(rest)) {
    throw new HttpsError("invalid-argument", "threadId 형식이 올바르지 않습니다.");
  }
  return ANON_PREFIX + rest;
}

/** 관리자 Callable용: user_{uid} 또는 anon_{uuidv4} */
function resolveThreadIdForAdmin(data) {
  const tid = String((data && data.threadId) || "").trim();
  if (!tid) {
    throw new HttpsError("invalid-argument", "threadId가 필요합니다.");
  }
  if (tid.startsWith("user_")) {
    const uid = tid.slice(5);
    if (!/^[a-zA-Z0-9]{6,128}$/.test(uid)) {
      throw new HttpsError("invalid-argument", "threadId가 올바르지 않습니다.");
    }
    return tid;
  }
  const low = tid.toLowerCase();
  if (!low.startsWith(ANON_PREFIX)) {
    throw new HttpsError("invalid-argument", "threadId가 올바르지 않습니다.");
  }
  const rest = low.slice(ANON_PREFIX.length);
  if (!isUuidV4Lower(rest)) {
    throw new HttpsError("invalid-argument", "threadId가 올바르지 않습니다.");
  }
  return ANON_PREFIX + rest;
}

function toMillis(ts) {
  if (!ts) return null;
  if (typeof ts.toMillis === "function") return ts.toMillis();
  return null;
}

async function generateSupportChatAssistantText(latestUserText, recentLines) {
  const apiKey = String(process.env.GEMINI_API_KEY || "").trim();
  if (!apiKey) return "";

  const systemInstruction = [
    "당신은 한국어로 고객 응대를 돕는 '행정법Q' 학습 앱의 안내 도우미입니다.",
    "사용자 질문에 2~5문장으로 짧고 정중하게 답합니다.",
    "개별 사건의 법률 자문·시험 정답·판례 적부를 단정하지 마세요. 필요하면 전문가 상담·공식 자료를 이용하라고 안내하세요.",
    "결제·환불·계정·앱 오류는 운영팀이 확인할 수 있다고 말하고, 급하면 ellutionsoft@gmail.com 또는 앱에 표시된 전화(070-7954-2912)를 안내해도 됩니다.",
    "마크다운·목록 기호 없이 평문만 사용하세요."
  ].join("\n");

  const userPart =
    "최근 대화:\n" +
    String(recentLines || "").slice(0, 3500) +
    "\n\n방금 고객 메시지:\n" +
    String(latestUserText || "").slice(0, MAX_MSG);

  const genAI = new GoogleGenerativeAI(apiKey);
  const candidates = uniqueGeminiModelCandidates();
  let lastErr = null;
  for (let i = 0; i < candidates.length; i++) {
    const modelId = candidates[i];
    try {
      const model = genAI.getGenerativeModel({
        model: modelId,
        systemInstruction
      });
      const result = await model.generateContent({
        contents: [{ role: "user", parts: [{ text: userPart }] }],
        generationConfig: { maxOutputTokens: 1024, temperature: 0.4 }
      });
      const text = (result && result.response && result.response.text && result.response.text()) || "";
      const out = String(text || "").trim();
      if (out) return out.length > MAX_MSG ? out.slice(0, MAX_MSG) : out;
    } catch (e) {
      lastErr = e;
    }
  }
  if (lastErr) {
    console.warn("supportChat Gemini:", lastErr && lastErr.message ? lastErr.message : lastErr);
  }
  return "";
}

/**
 * 고객 user 메시지 저장 직후 호출. 실패해도 예외를 밖으로 던지지 않음.
 */
async function appendAssistantReplyIfPossible(threadId, latestUserText) {
  const db = getFirestore();
  const threadRef = db.collection("hanlaw_support_chat").doc(threadId);
  let recentLines = "";
  try {
    const hist = await threadRef.collection("messages").orderBy("createdAt", "desc").limit(12).get();
    const ordered = hist.docs.slice().reverse();
    recentLines = ordered
      .map((doc) => {
        const x = doc.data() || {};
        const role = x.sender === "staff" ? "운영" : x.sender === "assistant" ? "AI" : "고객";
        return role + ": " + String(x.text || "").replace(/\s+/g, " ").trim();
      })
      .filter(Boolean)
      .join("\n");
  } catch (e) {
    recentLines = "";
  }

  const aiText = await generateSupportChatAssistantText(latestUserText, recentLines);
  if (!aiText) return;

  const preview = aiText.length > 160 ? aiText.slice(0, 157) + "…" : aiText;
  const batch = db.batch();
  const msgRef = threadRef.collection("messages").doc();
  batch.set(msgRef, {
    text: aiText,
    createdAt: FieldValue.serverTimestamp(),
    sender: "assistant",
    source: "gemini"
  });
  batch.set(
    threadRef,
    {
      updatedAt: FieldValue.serverTimestamp(),
      lastMessageAt: FieldValue.serverTimestamp(),
      lastMessagePreview: preview
    },
    { merge: true }
  );
  await batch.commit();
}

const submitSupportChatMessage = onCall({ region: "asia-northeast3", timeoutSeconds: 120 }, async (request) => {
  const data = request.data || {};
  let text = String(data.message == null ? "" : data.message).trim();
  if (!text) {
    throw new HttpsError("invalid-argument", "메시지를 입력해 주세요.");
  }
  if (text.length > MAX_MSG) {
    text = text.slice(0, MAX_MSG);
  }
  const threadId = resolveThreadId(request, data);
  const threadRef = getFirestore().collection("hanlaw_support_chat").doc(threadId);
  const msgRef = threadRef.collection("messages").doc();
  const email =
    request.auth && request.auth.token && request.auth.token.email
      ? String(request.auth.token.email).trim().slice(0, 200)
      : null;
  const uid = request.auth && request.auth.uid ? request.auth.uid : null;
  const preview = text.length > 160 ? text.slice(0, 157) + "…" : text;

  const batch = getFirestore().batch();
  batch.set(
    threadRef,
    {
      updatedAt: FieldValue.serverTimestamp(),
      lastMessageAt: FieldValue.serverTimestamp(),
      lastMessagePreview: preview,
      uid: uid || null,
      userEmail: email || null,
      channel: uid ? "member" : "anon"
    },
    { merge: true }
  );
  batch.set(msgRef, {
    text,
    createdAt: FieldValue.serverTimestamp(),
    sender: "user",
    uid: uid || null,
    userEmail: email || null
  });
  await batch.commit();

  try {
    await appendAssistantReplyIfPossible(threadId, text);
  } catch (e) {
    console.warn("appendAssistantReplyIfPossible:", e && e.message ? e.message : e);
  }

  return { ok: true, messageId: msgRef.id };
});

const adminListSupportChatThreads = onCall({ region: "asia-northeast3" }, async (request) => {
  if (!isAdminEmailFromAuth(request.auth)) {
    throw new HttpsError("permission-denied", "관리자만 조회할 수 있습니다.");
  }
  const snap = await getFirestore()
    .collection("hanlaw_support_chat")
    .orderBy("lastMessageAt", "desc")
    .limit(100)
    .get();

  const threads = snap.docs.map((d) => {
    const x = d.data() || {};
    return {
      threadId: d.id,
      preview: String(x.lastMessagePreview || ""),
      channel: x.channel || null,
      userEmail: x.userEmail || null,
      uid: x.uid || null,
      lastMessageAtMs: toMillis(x.lastMessageAt) || toMillis(x.updatedAt)
    };
  });
  return { threads };
});

const adminGetSupportChatMessages = onCall({ region: "asia-northeast3" }, async (request) => {
  if (!isAdminEmailFromAuth(request.auth)) {
    throw new HttpsError("permission-denied", "관리자만 조회할 수 있습니다.");
  }
  const threadId = resolveThreadIdForAdmin(request.data || {});
  const snap = await getFirestore()
    .collection("hanlaw_support_chat")
    .doc(threadId)
    .collection("messages")
    .orderBy("createdAt", "asc")
    .limit(300)
    .get();

  const messages = snap.docs.map((d) => {
    const x = d.data() || {};
    return {
      id: d.id,
      text: String(x.text || ""),
      sender: String(x.sender || "user"),
      createdAtMs: toMillis(x.createdAt)
    };
  });
  return { threadId, messages };
});

const adminReplySupportChat = onCall({ region: "asia-northeast3" }, async (request) => {
  if (!isAdminEmailFromAuth(request.auth)) {
    throw new HttpsError("permission-denied", "관리자만 답장할 수 있습니다.");
  }
  const data = request.data || {};
  const threadId = resolveThreadIdForAdmin(data);
  let text = String(data.message == null ? "" : data.message).trim();
  if (!text) {
    throw new HttpsError("invalid-argument", "답장 내용을 입력해 주세요.");
  }
  if (text.length > MAX_MSG) {
    text = text.slice(0, MAX_MSG);
  }
  const staffEmail =
    request.auth && request.auth.token && request.auth.token.email
      ? String(request.auth.token.email).trim().slice(0, 200)
      : null;

  const threadRef = getFirestore().collection("hanlaw_support_chat").doc(threadId);
  const msgRef = threadRef.collection("messages").doc();
  const preview = text.length > 160 ? text.slice(0, 157) + "…" : text;

  const batch = getFirestore().batch();
  batch.set(
    threadRef,
    {
      updatedAt: FieldValue.serverTimestamp(),
      lastMessageAt: FieldValue.serverTimestamp(),
      lastMessagePreview: preview
    },
    { merge: true }
  );
  batch.set(msgRef, {
    text,
    createdAt: FieldValue.serverTimestamp(),
    sender: "staff",
    staffEmail: staffEmail || null
  });
  await batch.commit();
  return { ok: true, messageId: msgRef.id };
});

module.exports = {
  submitSupportChatMessage,
  adminListSupportChatThreads,
  adminGetSupportChatMessages,
  adminReplySupportChat
};
