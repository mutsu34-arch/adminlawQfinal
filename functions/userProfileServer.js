"use strict";

const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");

const NICK_MAX = 24;

function normNickname(s) {
  if (s == null) return "";
  let t = String(s).trim();
  if (t.length > NICK_MAX) t = t.slice(0, NICK_MAX);
  return t;
}

async function getStoredNickname(uid) {
  if (!uid) return "";
  const snap = await getFirestore().collection("hanlaw_user_profiles").doc(uid).get();
  if (!snap.exists) return "";
  const n = snap.data().nickname;
  return typeof n === "string" ? normNickname(n) : "";
}

const setUserNickname = onCall({ region: "asia-northeast3" }, async (request) => {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
  }
  const uid = request.auth.uid;
  const raw = normNickname((request.data && request.data.nickname) || "");
  if (raw.length > NICK_MAX) {
    throw new HttpsError("invalid-argument", `닉네임은 ${NICK_MAX}자 이하로 입력하세요.`);
  }
  if (raw) {
    if (!/^[\p{L}\p{N}\s._·\-~@]+$/u.test(raw)) {
      throw new HttpsError("invalid-argument", "닉네임에 사용할 수 없는 문자가 포함되어 있습니다.");
    }
    if (/[\u200b-\u200d\ufeff]/.test(raw)) {
      throw new HttpsError("invalid-argument", "닉네임에 사용할 수 없는 문자가 포함되어 있습니다.");
    }
  }
  const ref = getFirestore().collection("hanlaw_user_profiles").doc(uid);
  const payload = { updatedAt: FieldValue.serverTimestamp() };
  if (raw === "") {
    payload.nickname = FieldValue.delete();
  } else {
    payload.nickname = raw;
  }
  await ref.set(payload, { merge: true });
  return { ok: true, nickname: raw };
});

module.exports = { setUserNickname, getStoredNickname, NICK_MAX };
