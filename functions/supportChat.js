"use strict";

const crypto = require("crypto");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { uniqueGeminiModelCandidates } = require("./geminiModel");
const { looksLikeRefundIntent, loadRefundEstimatesForUid, formatEstimatesForAi } = require("./refundEstimate");

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

async function generateSupportChatAssistantText(latestUserText, recentLines, extraContext) {
  const apiKey = String(process.env.GEMINI_API_KEY || "").trim();
  if (!apiKey) return "";

  const isRefund = looksLikeRefundIntent(latestUserText);
  const systemInstruction = [
    "당신은 한국어로 고객 응대를 돕는 '행정법Q' 학습 앱의 안내 도우미입니다.",
    isRefund
      ? "이번 메시지는 환불·환급 문의입니다. 아래 [환불 산정 참고]가 있으면 예상 환불액·산식·근거(1개월권 정가 일할, 위약금 10%)를 고객이 이해하기 쉽게 설명하세요. 최종 금액은 운영팀 확인 후 확정된다고 반드시 밝히세요."
      : "사용자 질문에 2~5문장으로 짧고 정중하게 답합니다.",
    "개별 사건의 법률 자문·시험 정답·판례 적부를 단정하지 마세요. 필요하면 전문가 상담·공식 자료를 이용하라고 안내하세요.",
    "결제·환불·계정·앱 오류는 운영팀이 확인할 수 있다고 말하고, 급하면 ellutionsoft@gmail.com 또는 앱에 표시된 전화(070-7954-2912)를 안내해도 됩니다.",
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

  let extraContext = "";
  if (looksLikeRefundIntent(latestUserText)) {
    try {
      const threadSnap = await threadRef.get();
      const tdata = threadSnap.exists ? threadSnap.data() || {} : {};
      const uid = tdata.uid ? String(tdata.uid).trim() : "";
      if (uid) {
        const loaded = await loadRefundEstimatesForUid(uid, Date.now());
        if (loaded.ok) extraContext = "[환불 산정 참고]\n" + loaded.aiContext;
        else extraContext = "[환불 산정 참고]\n결제·회원 정보를 찾지 못했습니다. 결제일·금액·상품을 알려 주시면 운영팀이 산정합니다.";
      } else {
        extraContext =
          "[환불 산정 참고]\n로그인 후 환불 요청 시 자동 산정이 가능합니다. 결제일·금액·이메일을 알려 주세요.";
      }
    } catch (e) {
      console.warn("refund context for chat:", e && e.message ? e.message : e);
    }
  }

  const aiText = await generateSupportChatAssistantText(latestUserText, recentLines, extraContext);
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
