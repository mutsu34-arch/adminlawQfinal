"use strict";

const crypto = require("crypto");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");
const { onCall, HttpsError } = require("firebase-functions/v2/https");

const COL = "hanlaw_identity_challenges";
const CHALLENGE_TTL_MS = 15 * 60 * 1000;

function isMockEnabled() {
  const v = String(process.env.HANLAW_IDENTITY_MOCK || "").toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

function randomChallengeId() {
  return crypto.randomBytes(24).toString("hex");
}

function normEmail(s) {
  if (s == null) return "";
  return String(s).trim().toLowerCase();
}

const ALLOWED_PURPOSES = new Set(["onboarding", "contact_change", "password_reset"]);

/** 모의 인증 시 저장되는 표시용 값(실제 다날 연동 후 게이트웨이 응답으로 대체) */
function mockVerifiedPayload() {
  return {
    verifiedLegalName: "본인인증(모의)",
    verifiedPhoneMasked: "010-****-5678"
  };
}

async function consumeChallengeTx(db, challengeId) {
  const ref = db.collection(COL).doc(challengeId);
  const out = await db.runTransaction(async (t) => {
    const snap = await t.get(ref);
    if (!snap.exists) {
      throw new HttpsError("not-found", "인증 요청을 찾을 수 없습니다. 다시 시도해 주세요.");
    }
    const d = snap.data() || {};
    if (d.status !== "pending") {
      throw new HttpsError("failed-precondition", "이미 처리되었거나 만료된 인증 요청입니다.");
    }
    const exp = d.expiresAt;
    if (exp && exp.toMillis && exp.toMillis() < Date.now()) {
      throw new HttpsError("deadline-exceeded", "인증 시간이 만료되었습니다. 처음부터 다시 시도해 주세요.");
    }
    t.update(ref, {
      status: "consumed",
      consumedAt: FieldValue.serverTimestamp()
    });
    return d;
  });
  return out;
}

/**
 * 본인인증 절차 시작(챌린지 ID 발급).
 * 실제 다날/포트원 표준창 연동 시 여기서 리다이렉트 URL 등을 함께 반환하면 됩니다.
 */
const startIdentityChallenge = onCall({ region: "asia-northeast3" }, async (request) => {
  const data = request.data || {};
  const purpose = String(data.purpose || "").trim();
  if (!ALLOWED_PURPOSES.has(purpose)) {
    throw new HttpsError("invalid-argument", "purpose 값이 올바르지 않습니다.");
  }

  const db = getFirestore();
  const challengeId = randomChallengeId();
  const now = Date.now();
  const expiresAt = Timestamp.fromMillis(now + CHALLENGE_TTL_MS);

  if (purpose === "password_reset") {
    const email = normEmail(data.email);
    if (!email) {
      throw new HttpsError("invalid-argument", "이메일을 입력하세요.");
    }
    let userExists = true;
    try {
      await getAuth().getUserByEmail(email);
    } catch (e) {
      if (e && e.code === "auth/user-not-found") userExists = false;
      else throw e;
    }
    await db.collection(COL).doc(challengeId).set({
      purpose: "password_reset",
      email,
      userExists,
      status: "pending",
      createdAt: FieldValue.serverTimestamp(),
      expiresAt
    });
    return {
      challengeId,
      mockClientFinish: isMockEnabled()
    };
  }

  if (!request.auth || !request.auth.uid) {
    throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
  }
  const uid = request.auth.uid;

  if (purpose === "onboarding" || purpose === "contact_change") {
    await db.collection(COL).doc(challengeId).set({
      purpose,
      uid,
      status: "pending",
      createdAt: FieldValue.serverTimestamp(),
      expiresAt
    });
    return { challengeId, mockClientFinish: isMockEnabled() };
  }

  throw new HttpsError("invalid-argument", "지원하지 않는 요청입니다.");
});

/**
 * 본인인증 완료(모의: HANLAW_IDENTITY_MOCK=1 일 때만 서버에서 완료 처리).
 * 실연동 시 포트원/다날 서버 응답 검증 후 동일 필드를 프로필에 기록합니다.
 */
const finishIdentityChallenge = onCall({ region: "asia-northeast3" }, async (request) => {
  const data = request.data || {};
  const challengeId = String(data.challengeId || "").trim();
  if (!/^[0-9a-f]{48}$/.test(challengeId)) {
    throw new HttpsError("invalid-argument", "challengeId 형식이 올바르지 않습니다.");
  }

  if (!isMockEnabled()) {
    throw new HttpsError(
      "failed-precondition",
      "본인인증 게이트웨이가 아직 연결되지 않았거나 모의 모드가 꺼져 있습니다. 관리자에게 문의하세요."
    );
  }

  const db = getFirestore();
  const ch = await consumeChallengeTx(db, challengeId);
  const purpose = ch.purpose;

  if (purpose === "password_reset") {
    if (!ch.userExists || !ch.email) {
      throw new HttpsError("permission-denied", "요청을 완료할 수 없습니다. 이메일을 확인한 뒤 다시 시도해 주세요.");
    }
    const link = await getAuth().generatePasswordResetLink(String(ch.email));
    return { ok: true, purpose, resetLink: link };
  }

  if (purpose === "onboarding" || purpose === "contact_change") {
    if (!request.auth || !request.auth.uid) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }
    if (String(ch.uid) !== request.auth.uid) {
      throw new HttpsError("permission-denied", "인증 요청과 로그인 계정이 일치하지 않습니다.");
    }
    const mock = mockVerifiedPayload();
    const ref = db.collection("hanlaw_user_profiles").doc(request.auth.uid);
    await ref.set(
      {
        identityVerified: true,
        verifiedLegalName: mock.verifiedLegalName,
        verifiedPhoneMasked: mock.verifiedPhoneMasked,
        identityVerifiedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      },
      { merge: true }
    );
    return { ok: true, purpose, verifiedLegalName: mock.verifiedLegalName, verifiedPhoneMasked: mock.verifiedPhoneMasked };
  }

  throw new HttpsError("failed-precondition", "처리할 수 없는 인증 유형입니다.");
});

module.exports = { startIdentityChallenge, finishIdentityChallenge, isMockEnabled };
