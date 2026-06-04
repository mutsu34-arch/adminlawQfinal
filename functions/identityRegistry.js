"use strict";

const crypto = require("crypto");
const { FieldValue } = require("firebase-admin/firestore");
const { HttpsError } = require("firebase-functions/v2/https");

const REGISTRY_COL = "hanlaw_identity_registry";

const DUPLICATE_ACCOUNT_MSG =
  "이미 본인인증으로 가입된 계정이 있습니다. 기존 계정으로 로그인해 주세요. 추가 계정이 필요하면 고객센터로 문의해 주세요.";

function registryHashSecret() {
  return (
    String(process.env.IDENTITY_REGISTRY_SECRET || "").trim() ||
    String(process.env.PORTONE_API_SECRET || "").trim() ||
    "hanlaw-identity-registry-dev-only"
  );
}

function hashRegistryKey(raw) {
  const src = String(raw || "").trim();
  if (!src) return "";
  return crypto.createHmac("sha256", registryHashSecret()).update(src, "utf8").digest("hex");
}

function registryDocIdFromIdentity(di, ci) {
  const diRaw = String(di || "").trim();
  const ciRaw = String(ci || "").trim();
  if (diRaw) return hashRegistryKey("di:" + diRaw);
  if (ciRaw) return hashRegistryKey("ci:" + ciRaw);
  return "";
}

function extractCiDiFromVerifiedCustomer(vc) {
  const src = vc && typeof vc === "object" ? vc : {};
  const di = String(
    src.di || src.duplicationInfo || src.unique_in_site || src.uniqueInSite || ""
  ).trim();
  const ci = String(
    src.ci || src.connectingInfo || src.unique_key || src.uniqueKey || ""
  ).trim();
  return { di, ci };
}

function mockIdentityKeys() {
  return {
    di: "hanlaw:mock:identity:di:1",
    ci: "hanlaw:mock:identity:ci:1"
  };
}

async function commitVerifiedIdentity(db, uid, verified, purpose) {
  const userId = String(uid || "").trim();
  if (!userId) {
    throw new HttpsError("invalid-argument", "사용자 정보가 없습니다.");
  }
  const verifiedLegalName = String(verified.verifiedLegalName || "").trim();
  const verifiedPhoneMasked = String(verified.verifiedPhoneMasked || "").trim();
  const di = String(verified.di || "").trim();
  const ci = String(verified.ci || "").trim();
  const registryKey = registryDocIdFromIdentity(di, ci);
  if (!registryKey) {
    throw new HttpsError(
      "failed-precondition",
      "본인인증 결과에서 중복 확인 정보(DI/CI)를 받지 못했습니다. 잠시 후 다시 시도해 주세요."
    );
  }

  const profileRef = db.collection("hanlaw_user_profiles").doc(userId);
  const registryRef = db.collection(REGISTRY_COL).doc(registryKey);

  await db.runTransaction(async (t) => {
    const regSnap = await t.get(registryRef);
    const reg = regSnap.exists ? regSnap.data() || {} : {};
    const existingUid = String(reg.uid || "").trim();
    if (existingUid && existingUid !== userId) {
      throw new HttpsError("already-exists", DUPLICATE_ACCOUNT_MSG);
    }

    const profilePatch = {
      identityVerified: true,
      verifiedLegalName,
      verifiedPhoneMasked,
      identityRegistryKey: registryKey,
      identityVerifiedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    };

    t.set(registryRef, {
      uid: userId,
      lastPurpose: String(purpose || "onboarding"),
      linkedAt: reg.linkedAt || FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });

    t.set(profileRef, profilePatch, { merge: true });
  });

  return { registryKey };
}

async function releaseIdentityRegistryForUid(db, uid) {
  const userId = String(uid || "").trim();
  if (!userId) return;

  const profileRef = db.collection("hanlaw_user_profiles").doc(userId);
  const profileSnap = await profileRef.get();
  const profile = profileSnap.exists ? profileSnap.data() || {} : {};
  const registryKey = String(profile.identityRegistryKey || "").trim();

  if (registryKey) {
    try {
      await db.collection(REGISTRY_COL).doc(registryKey).delete();
    } catch (e) {
      /* ignore */
    }
  }

  const byUidSnap = await db.collection(REGISTRY_COL).where("uid", "==", userId).limit(5).get();
  if (!byUidSnap.empty) {
    const batch = db.batch();
    byUidSnap.docs.forEach(function (doc) {
      batch.delete(doc.ref);
    });
    await batch.commit();
  }
}

module.exports = {
  REGISTRY_COL,
  DUPLICATE_ACCOUNT_MSG,
  extractCiDiFromVerifiedCustomer,
  mockIdentityKeys,
  commitVerifiedIdentity,
  releaseIdentityRegistryForUid
};
