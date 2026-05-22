"use strict";

const crypto = require("crypto");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");
const { onCall, HttpsError } = require("firebase-functions/v2/https");

const COL = "hanlaw_identity_challenges";
const CHALLENGE_TTL_MS = 15 * 60 * 1000;
const REGION = "asia-northeast3";

function isMockEnabled() {
  const v = String(process.env.HANLAW_IDENTITY_MOCK || "").toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

function portoneSecret() {
  return String(process.env.PORTONE_API_SECRET || "").trim();
}

function portoneStoreId() {
  return String(process.env.PORTONE_STORE_ID || "").trim();
}

function portoneIdentityChannelKey() {
  return (
    String(process.env.PORTONE_CHANNEL_KEY_DANAL_IDENTITY || "").trim() ||
    String(process.env.PORTONE_CHANNEL_KEY_DANAL_IDENTITY_VERIFICATION || "").trim() ||
    String(process.env.PORTONE_CHANNEL_KEY_DANAL || "").trim()
  );
}

function isPortoneIdentityConfigured() {
  return !!(portoneSecret() && portoneStoreId() && portoneIdentityChannelKey());
}

function identityCptitle() {
  const v = String(process.env.PORTONE_IDENTITY_CPTITLE || "").trim();
  return v || "https://adminlawq.ellution.co.kr";
}

function randomChallengeId() {
  return crypto.randomBytes(24).toString("hex");
}

function randomIdentityVerificationId() {
  const ts = Date.now().toString(36);
  const suffix = Math.random()
    .toString(36)
    .replace(/[^a-z0-9]/gi, "")
    .slice(2, 10);
  return `iv${ts}${suffix}`;
}

function normEmail(s) {
  if (s == null) return "";
  return String(s).trim().toLowerCase();
}

function maskPhone(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (digits.length >= 11) {
    return `${digits.slice(0, 3)}-****-${digits.slice(-4)}`;
  }
  if (digits.length >= 10) {
    return `${digits.slice(0, 3)}-***-${digits.slice(-4)}`;
  }
  return "—";
}

const ALLOWED_PURPOSES = new Set(["onboarding", "contact_change", "password_reset"]);

/** 모의 인증 시 저장되는 표시용 값(개발·테스트 전용) */
function mockVerifiedPayload() {
  return {
    verifiedLegalName: "본인인증(모의)",
    verifiedPhoneMasked: "010-****-5678"
  };
}

async function fetchPortOneIdentityVerification(secret, identityVerificationId) {
  const url = `https://api.portone.io/identity-verifications/${encodeURIComponent(identityVerificationId)}`;
  const maxAttempts = 5;
  const retryableStatus = { 404: true, 408: true, 409: true, 425: true, 429: true, 500: true, 502: true, 503: true, 504: true };
  let lastStatus = 0;
  let lastMsg = "";
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `PortOne ${secret}` }
    });
    lastStatus = Number(res.status || 0);
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch (_) {
      json = null;
    }
    if (res.ok) return json;
    const msg = json && (json.message || json.error) ? String(json.message || json.error) : text.slice(0, 200);
    lastMsg = msg;
    const canRetry = !!retryableStatus[lastStatus] && attempt < maxAttempts;
    if (!canRetry) {
      throw new HttpsError("internal", `본인인증 조회에 실패했습니다(${lastStatus || "unknown"}): ${msg}`);
    }
    await new Promise((resolve) => setTimeout(resolve, attempt * 450));
  }
  throw new HttpsError(
    "internal",
    `본인인증 조회에 실패했습니다(${lastStatus || "unknown"}): ${lastMsg || "알 수 없는 오류"}`
  );
}

function verifiedPayloadFromPortone(iv) {
  if (!iv || typeof iv !== "object") {
    throw new HttpsError("failed-precondition", "본인인증 결과를 확인할 수 없습니다.");
  }
  const status = String(iv.status || "").toUpperCase();
  if (status !== "VERIFIED") {
    throw new HttpsError("failed-precondition", "본인인증이 완료되지 않았습니다. 다시 시도해 주세요.");
  }
  const vc = iv.verifiedCustomer || iv.customer || {};
  let name = String(vc.name || vc.fullName || "").trim();
  if (!name && (vc.firstName || vc.lastName)) {
    name = String(vc.lastName || "") + String(vc.firstName || "");
  }
  const phone = String(vc.phoneNumber || vc.phone || "").trim();
  if (!name) {
    throw new HttpsError("failed-precondition", "본인인증 결과에서 이름을 확인할 수 없습니다.");
  }
  return {
    verifiedLegalName: name,
    verifiedPhoneMasked: maskPhone(phone)
  };
}

async function loadPendingChallenge(db, challengeId) {
  const ref = db.collection(COL).doc(challengeId);
  const snap = await ref.get();
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
  return { ref, data: d };
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

function buildPortoneStartPayload(identityVerificationId) {
  return {
    storeId: portoneStoreId(),
    channelKey: portoneIdentityChannelKey(),
    identityVerificationId,
    bypass: {
      danal: {
        CPTITLE: identityCptitle()
      }
    }
  };
}

function buildStartResponse(challengeId, identityVerificationId) {
  const out = { challengeId };
  if (isMockEnabled()) {
    out.mockClientFinish = true;
  }
  if (identityVerificationId && isPortoneIdentityConfigured()) {
    out.portone = buildPortoneStartPayload(identityVerificationId);
  }
  if (!out.mockClientFinish && !out.portone) {
    throw new HttpsError(
      "failed-precondition",
      "본인인증 서비스가 준비 중입니다. 잠시 후 다시 시도해 주세요."
    );
  }
  return out;
}

/**
 * 본인인증 절차 시작(챌린지 ID 발급 + PortOne 본인확인 ID).
 */
const startIdentityChallenge = onCall({ region: REGION }, async (request) => {
  const data = request.data || {};
  const purpose = String(data.purpose || "").trim();
  if (!ALLOWED_PURPOSES.has(purpose)) {
    throw new HttpsError("invalid-argument", "purpose 값이 올바르지 않습니다.");
  }

  const db = getFirestore();
  const challengeId = randomChallengeId();
  const now = Date.now();
  const expiresAt = Timestamp.fromMillis(now + CHALLENGE_TTL_MS);
  const identityVerificationId = isPortoneIdentityConfigured() ? randomIdentityVerificationId() : null;
  const challengeBase = {
    status: "pending",
    createdAt: FieldValue.serverTimestamp(),
    expiresAt,
    identityVerificationId: identityVerificationId || null
  };

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
      ...challengeBase,
      purpose: "password_reset",
      email,
      userExists
    });
    return buildStartResponse(challengeId, identityVerificationId);
  }

  if (!request.auth || !request.auth.uid) {
    throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
  }
  const uid = request.auth.uid;

  if (purpose === "onboarding" || purpose === "contact_change") {
    await db.collection(COL).doc(challengeId).set({
      ...challengeBase,
      purpose,
      uid
    });
    return buildStartResponse(challengeId, identityVerificationId);
  }

  throw new HttpsError("invalid-argument", "지원하지 않는 요청입니다.");
});

async function finishWithPortone(db, challengeId, identityVerificationId, request) {
  const { data: ch } = await loadPendingChallenge(db, challengeId);
  const storedIv = String(ch.identityVerificationId || "").trim();
  if (!storedIv || storedIv !== identityVerificationId) {
    throw new HttpsError("permission-denied", "본인인증 요청이 일치하지 않습니다. 처음부터 다시 시도해 주세요.");
  }

  const iv = await fetchPortOneIdentityVerification(portoneSecret(), identityVerificationId);
  const verified = verifiedPayloadFromPortone(iv);
  const consumed = await consumeChallengeTx(db, challengeId);
  const purpose = consumed.purpose;

  if (purpose === "password_reset") {
    if (!consumed.userExists || !consumed.email) {
      throw new HttpsError("permission-denied", "요청을 완료할 수 없습니다. 이메일을 확인한 뒤 다시 시도해 주세요.");
    }
    const link = await getAuth().generatePasswordResetLink(String(consumed.email));
    return { ok: true, purpose, resetLink: link };
  }

  if (purpose === "onboarding" || purpose === "contact_change") {
    if (!request.auth || !request.auth.uid) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }
    if (String(consumed.uid) !== request.auth.uid) {
      throw new HttpsError("permission-denied", "인증 요청과 로그인 계정이 일치하지 않습니다.");
    }
    const ref = db.collection("hanlaw_user_profiles").doc(request.auth.uid);
    await ref.set(
      {
        identityVerified: true,
        verifiedLegalName: verified.verifiedLegalName,
        verifiedPhoneMasked: verified.verifiedPhoneMasked,
        identityVerifiedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      },
      { merge: true }
    );
    return {
      ok: true,
      purpose,
      verifiedLegalName: verified.verifiedLegalName,
      verifiedPhoneMasked: verified.verifiedPhoneMasked
    };
  }

  throw new HttpsError("failed-precondition", "처리할 수 없는 인증 유형입니다.");
}

async function finishWithMock(db, challengeId, request) {
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
}

/**
 * 본인인증 완료: PortOne 조회·검증 후 프로필 반영. HANLAW_IDENTITY_MOCK=1 이면 모의 완료(개발용).
 */
const finishIdentityChallenge = onCall({ region: REGION }, async (request) => {
  const data = request.data || {};
  const challengeId = String(data.challengeId || "").trim();
  if (!/^[0-9a-f]{48}$/.test(challengeId)) {
    throw new HttpsError("invalid-argument", "challengeId 형식이 올바르지 않습니다.");
  }

  const identityVerificationId = String(data.identityVerificationId || "").trim();
  const db = getFirestore();

  if (identityVerificationId) {
    if (!isPortoneIdentityConfigured()) {
      throw new HttpsError("failed-precondition", "본인인증 서비스가 준비 중입니다.");
    }
    return finishWithPortone(db, challengeId, identityVerificationId, request);
  }

  if (!isMockEnabled()) {
    throw new HttpsError(
      "failed-precondition",
      "본인인증을 완료할 수 없습니다. 본인인증 창에서 인증을 마친 뒤 다시 시도해 주세요."
    );
  }

  return finishWithMock(db, challengeId, request);
});

module.exports = {
  startIdentityChallenge,
  finishIdentityChallenge,
  isMockEnabled,
  isPortoneIdentityConfigured
};
