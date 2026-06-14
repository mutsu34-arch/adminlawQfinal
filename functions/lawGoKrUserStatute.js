"use strict";

const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const {
  LAW_API_VPC,
  fetchStatuteArticleOpenApi,
  suggestStatuteArticlesOpenApi
} = require("./lawGoKrApi");

const THROTTLE_COLLECTION = "hanlaw_statute_api_throttle";
const RATE_LIMIT = { windowMs: 60 * 60 * 1000, maxCalls: 90 };

async function enforceUidRateLimit(uid) {
  const id = String(uid || "").trim();
  if (!id) return;
  const ref = getFirestore().collection(THROTTLE_COLLECTION).doc(id);
  const now = Date.now();
  await getFirestore().runTransaction(async (t) => {
    const snap = await t.get(ref);
    let windowStart = now;
    let count = 0;
    if (snap.exists) {
      const d = snap.data() || {};
      windowStart = typeof d.windowStart === "number" ? d.windowStart : now;
      count = typeof d.count === "number" ? d.count : 0;
      if (now - windowStart >= RATE_LIMIT.windowMs) {
        windowStart = now;
        count = 0;
      }
    }
    if (count >= RATE_LIMIT.maxCalls) {
      throw new HttpsError(
        "resource-exhausted",
        "조문 조회 요청이 많습니다. 잠시 후 다시 시도해 주세요."
      );
    }
    t.set(
      ref,
      { windowStart, count: count + 1, updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
  });
}

function assertLoggedInMember(request) {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
  }
  const email = String(request.auth.token.email || "").trim();
  if (!email) {
    throw new HttpsError("unauthenticated", "회원 로그인이 필요합니다.");
  }
}

const fetchStatuteArticleForUser = onCall(
  Object.assign({ region: "asia-northeast3", timeoutSeconds: 120 }, LAW_API_VPC),
  async (request) => {
    assertLoggedInMember(request);
    const statuteKey = String((request.data && request.data.statuteKey) || "").trim();
    if (!statuteKey) {
      throw new HttpsError("invalid-argument", "statuteKey가 필요합니다.");
    }
    await enforceUidRateLimit(request.auth.uid);
    try {
      return await fetchStatuteArticleOpenApi(statuteKey);
    } catch (e) {
      throw new HttpsError("failed-precondition", String((e && e.message) || e));
    }
  }
);

const suggestStatuteArticlesForUser = onCall(
  Object.assign({ region: "asia-northeast3", timeoutSeconds: 180, memory: "512MiB" }, LAW_API_VPC),
  async (request) => {
    assertLoggedInMember(request);
    const query = String((request.data && request.data.query) || "").trim();
    if (!query) {
      throw new HttpsError("invalid-argument", "검색어가 필요합니다.");
    }
    const maxResults = parseInt((request.data && request.data.maxResults) || 10, 10);
    await enforceUidRateLimit(request.auth.uid);
    try {
      return await suggestStatuteArticlesOpenApi(query, { maxResults });
    } catch (e) {
      throw new HttpsError("failed-precondition", String((e && e.message) || e));
    }
  }
);

module.exports = { fetchStatuteArticleForUser, suggestStatuteArticlesForUser };
