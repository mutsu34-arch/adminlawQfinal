"use strict";

const crypto = require("crypto");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { uniqueGeminiModelCandidates } = require("./geminiModel");
const { looksLikeRefundIntent } = require("./refundEstimate");

const STUDY_REDIRECT_REPLY =
  "고객님, 문의해 주셔서 감사합니다. 이 채팅은 앱 이용·결제·오류 등 운영 문의용이며, 행정법 학습 내용(개념·시험·판례·문항 해설 등)은 여기서 답변드리기 어렵습니다. 학습 질문은 앱의 「엘리(AI)에게 질문하기」를 이용해 주세요. 퀴즈·용어사전·조문·판례 화면 하단에서 질문하실 수 있으며, 엘리 질문권은 요금제·포인트 전환으로 이용하실 수 있습니다.";

const ADMIN_HANDOFF_REPLY =
  "고객님, 환불·해지·결제 관련 문의 내용은 관리자(운영팀)님께 전달해 드리겠습니다. 순서대로 확인 후 답변드리겠습니다. 급하시면 ellutionsoft@gmail.com 또는 070-7954-2912로 연락해 주셔도 됩니다. 결제일·상품명·가입 이메일을 함께 알려 주시면 처리가 빠릅니다.";

const MAX_MSG = 2000;
const ANON_PREFIX = "anon_";
const MAX_SUPPORT_CHAT_IMAGES = 3;
const MAX_SUPPORT_CHAT_IMAGE_BYTES = 1024 * 1024;

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

function sniffImageContentType(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return "image/gif";
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 && buf.length >= 12) {
    const webp = buf.slice(8, 12).toString("ascii");
    if (webp === "WEBP") return "image/webp";
  }
  return null;
}

function extForContentType(ct) {
  if (ct === "image/png") return "png";
  if (ct === "image/webp") return "webp";
  if (ct === "image/gif") return "gif";
  return "jpg";
}

/**
 * @param {string} threadId
 * @param {string} messageId
 * @param {Buffer[]} buffers
 * @param {string[]} contentTypes
 * @returns {Promise<string[]>} download URLs with token
 */
async function uploadSupportChatImages(threadId, messageId, buffers, contentTypes) {
  if (!buffers || !buffers.length) return [];
  const bucket = getStorage().bucket();
  const urls = [];
  for (let i = 0; i < buffers.length; i++) {
    const buf = buffers[i];
    const ct = contentTypes[i];
    const ext = extForContentType(ct);
    const safeThread = String(threadId || "").replace(/[^a-zA-Z0-9_\-]/g, "_").slice(0, 200);
    const path = `support_chat/${safeThread}/${messageId}_${i}.${ext}`;
    const token = crypto.randomBytes(32).toString("hex");
    const file = bucket.file(path);
    await file.save(buf, {
      resumable: false,
      metadata: {
        contentType: ct,
        metadata: { firebaseStorageDownloadTokens: token }
      }
    });
    const enc = encodeURIComponent(path);
    urls.push(`https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${enc}?alt=media&token=${token}`);
  }
  return urls;
}

/**
 * @param {unknown} raw
 * @returns {{ buffers: Buffer[], contentTypes: string[] }}
 */
function parseIncomingChatImages(raw) {
  const buffers = [];
  const contentTypes = [];
  if (!raw) return { buffers, contentTypes };
  const arr = Array.isArray(raw) ? raw : [];
  for (let i = 0; i < arr.length && buffers.length < MAX_SUPPORT_CHAT_IMAGES; i++) {
    const item = arr[i];
    const b64 =
      item && typeof item === "object" && item.base64 != null
        ? String(item.base64).trim()
        : typeof item === "string"
          ? String(item).trim()
          : "";
    if (!b64) continue;
    const cleaned = b64.replace(/^data:image\/\w+;base64,/, "").replace(/\s/g, "");
    let buf;
    try {
      buf = Buffer.from(cleaned, "base64");
    } catch (_) {
      throw new HttpsError("invalid-argument", "이미지 데이터 형식이 올바르지 않습니다.");
    }
    if (!buf.length || buf.length > MAX_SUPPORT_CHAT_IMAGE_BYTES) {
      throw new HttpsError(
        "invalid-argument",
        `이미지는 각각 ${Math.floor(MAX_SUPPORT_CHAT_IMAGE_BYTES / (1024 * 1024))}MB 이하만 첨부할 수 있습니다.`
      );
    }
    const sniffed = sniffImageContentType(buf);
    if (!sniffed) {
      throw new HttpsError("invalid-argument", "JPEG, PNG, GIF, WebP 이미지만 첨부할 수 있습니다.");
    }
    buffers.push(buf);
    contentTypes.push(sniffed);
  }
  return { buffers, contentTypes };
}

/** 행정법·시험 등 학습 질문 — 문의 채팅이 아닌 엘리(AI) 질문으로 유도 */
function looksLikeStudyIntent(text) {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  if (!s) return false;
  if (/학습\s*질문|시험\s*질문|엘리.*질문|AI.*질문/.test(s)) return true;
  if (/너한테\s*.*질문|여기서\s*.*질문\s*해도/.test(s) && /학습|시험|법률|행정|OX|판례|조문/.test(s)) {
    return true;
  }
  const legalTopic =
    /행정법|행정처분|행정소송|행정심판|재량|기속|법률유보|비례|신뢰보호|처분|소송|판례|조문|용어|OX|기출|해설|정답|무효|취소소송/.test(
      s
    );
  const asksConcept =
    /(?:이|가)\s*뭐|무엇|뜻|의미|구분|차이|맞나|틀리|설명|알려|인가요|일까|되나|되나요/.test(s);
  if (legalTopic && asksConcept) return true;
  if (/판례|조문사전|용어사전/.test(s) && asksConcept) return true;
  return false;
}

/** 환불·해지·결제 취소 등 — 관리자 전달 안내(자동 산정·법률 해설 없음) */
function looksLikeAdminHandoffIntent(text) {
  if (looksLikeRefundIntent(text)) return true;
  const s = String(text || "").toLowerCase();
  return /해지|구독\s*취소|자동\s*결제\s*취소|정기\s*결제\s*취소|탈퇴|결제\s*취소|취소\s*하고|취소\s*해|취소\s*요청|unsubscribe|cancel/.test(
    s
  );
}

function resolveCannedAssistantReply(latestUserText) {
  if (looksLikeAdminHandoffIntent(latestUserText)) return ADMIN_HANDOFF_REPLY;
  if (looksLikeStudyIntent(latestUserText)) return STUDY_REDIRECT_REPLY;
  return "";
}

async function generateSupportChatAssistantText(latestUserText, recentLines, extraContext) {
  const apiKey = String(process.env.GEMINI_API_KEY || "").trim();
  if (!apiKey) return "";

  const systemInstruction = [
    "당신은 한국어로 고객 응대를 돕는 '행정법Q' 학습 앱의 운영 안내 도우미입니다.",
    "사용자 질문에 2~5문장으로 짧고 정중하게 답합니다.",
    "행정법·시험·판례·조문·문항 해설 등 학습·법률 내용 질문에는 답하지 말고, 앱의 「엘리(AI)에게 질문하기」를 이용하라고 안내하세요.",
    "환불·해지·결제 취소·구독 해지 문의에는 내용을 관리자(운영팀)에게 전달해 확인·답변드리겠다고 말하세요. 예상 환불액을 임의로 계산·단정하지 마세요.",
    "개별 사건의 법률 자문·시험 정답·판례 적부를 단정하지 마세요.",
    "앱 오류·로그인·계정 문제는 운영팀이 확인할 수 있다고 말하고, 급하면 ellutionsoft@gmail.com 또는 070-7954-2912를 안내하세요.",
    "마크다운·목록 기호 없이 평문만 사용하세요."
  ].join("\n");

  const userPart =
    "최근 대화:\n" +
    String(recentLines || "").slice(0, 3500) +
    "\n\n방금 고객 메시지:\n" +
    String(latestUserText || "").slice(0, MAX_MSG) +
    (extraContext ? "\n\n" + String(extraContext).slice(0, 5000) : "");

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
        const urls = Array.isArray(x.imageUrls) ? x.imageUrls : [];
        const imgNote = urls.length ? " [첨부 이미지 " + urls.length + "장]" : "";
        return role + ": " + String(x.text || "").replace(/\s+/g, " ").trim() + imgNote;
      })
      .filter(Boolean)
      .join("\n");
  } catch (e) {
    recentLines = "";
  }

  let aiText = resolveCannedAssistantReply(latestUserText);
  if (!aiText) {
    aiText = await generateSupportChatAssistantText(latestUserText, recentLines, "");
  }
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
  const { buffers, contentTypes } = parseIncomingChatImages(data.images);
  if (!text && !buffers.length) {
    throw new HttpsError("invalid-argument", "메시지 또는 이미지를 보내 주세요.");
  }
  if (text.length > MAX_MSG) {
    text = text.slice(0, MAX_MSG);
  }
  const threadId = resolveThreadId(request, data);
  const threadRef = getFirestore().collection("hanlaw_support_chat").doc(threadId);
  const msgRef = threadRef.collection("messages").doc();
  const messageId = msgRef.id;

  let imageUrls = [];
  if (buffers.length) {
    try {
      imageUrls = await uploadSupportChatImages(threadId, messageId, buffers, contentTypes);
    } catch (e) {
      console.error("uploadSupportChatImages", e);
      throw new HttpsError("internal", "이미지 저장에 실패했습니다. 잠시 후 다시 시도해 주세요.");
    }
  }

  const email =
    request.auth && request.auth.token && request.auth.token.email
      ? String(request.auth.token.email).trim().slice(0, 200)
      : null;
  const uid = request.auth && request.auth.uid ? request.auth.uid : null;
  const previewBase = text || (imageUrls.length ? "[이미지 " + imageUrls.length + "장]" : "");
  const preview = previewBase.length > 160 ? previewBase.slice(0, 157) + "…" : previewBase;

  const msgPayload = {
    text: text || "",
    createdAt: FieldValue.serverTimestamp(),
    sender: "user",
    uid: uid || null,
    userEmail: email || null
  };
  if (imageUrls.length) {
    msgPayload.imageUrls = imageUrls;
  }

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
  batch.set(msgRef, msgPayload);
  await batch.commit();

  try {
    const forAi =
      (text || "(텍스트 없음)") +
      (imageUrls.length
        ? "\n[고객이 이미지 " + imageUrls.length + "장을 첨부했습니다. 운영팀이 화면을 확인할 수 있습니다.]"
        : "");
    await appendAssistantReplyIfPossible(threadId, forAi);
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
    const urls = Array.isArray(x.imageUrls) ? x.imageUrls.map((u) => String(u || "").trim()).filter(Boolean) : [];
    return {
      id: d.id,
      text: String(x.text || ""),
      sender: String(x.sender || "user"),
      createdAtMs: toMillis(x.createdAt),
      imageUrls: urls
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
