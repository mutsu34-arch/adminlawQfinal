"use strict";

const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");

const MAX_MSG = 2000;
const ANON_PREFIX = "anon_";

function isUuidV4Lower(s) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(String(s || ""));
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

const submitSupportChatMessage = onCall({ region: "asia-northeast3" }, async (request) => {
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
  return { ok: true, messageId: msgRef.id };
});

module.exports = { submitSupportChatMessage };
