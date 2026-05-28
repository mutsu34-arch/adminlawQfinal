"use strict";



const { getFirestore, FieldValue } = require("firebase-admin/firestore");

const { onCall, HttpsError } = require("firebase-functions/v2/https");



const DOC_PATH = "hanlaw_public_content/published";



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



function isLegacy36Text(s) {
  return /36\s*문항|36문항/i.test(String(s || ""));
}

function normalizeQuizBanner(banner) {
  const titleRaw = String((banner && banner.title) || "공개 퀴즈 5문항").trim();
  const leadRaw = String(
    (banner && banner.lead) ||
      "OX 5문항을 로그인 없이 풀고, 기본·상세 해설(법리·함정·판례)을 모두 확인할 수 있습니다."
  ).trim();
  return {
    title: isLegacy36Text(titleRaw) ? "공개 퀴즈 5문항" : titleRaw,
    lead: isLegacy36Text(leadRaw)
      ? "OX 5문항을 로그인 없이 풀고, 기본·상세 해설(법리·함정·판례)을 모두 확인할 수 있습니다."
      : leadRaw,
    href: String((banner && banner.href) || "/content/quiz-36.html").trim()
  };
}

function normalizePayload(data) {

  if (!data || typeof data !== "object") {

    throw new HttpsError("invalid-argument", "저장할 JSON 객체가 필요합니다.");

  }

  let introLead = String(data.introLead == null ? "" : data.introLead).trim();
  if (isLegacy36Text(introLead)) {
    introLead =
      "로그인 없이 열람할 수 있는 핵심 자료입니다. 공개 퀴즈 5문항은 기본·상세 해설을 모두 공개합니다.";
  }

  return {

    introLead,

    introDisclaimer: String(data.introDisclaimer == null ? "" : data.introDisclaimer).trim(),

    quizBanner: normalizeQuizBanner(data.quizBanner),

    qa: Array.isArray(data.qa) ? data.qa : []

  };

}



async function writePublished(payload, { stripLegacy = true } = {}) {

  const doc = {

    ...payload,

    updatedAt: FieldValue.serverTimestamp()

  };

  if (stripLegacy) {

    doc.terms = FieldValue.delete();

    doc.statutes = FieldValue.delete();

    doc.cases = FieldValue.delete();

  }

  await getFirestore().doc(DOC_PATH).set(doc, { merge: true });

}



const getPublicContentConfig = onCall({ region: "asia-northeast3" }, async () => {

  const snap = await getFirestore().doc(DOC_PATH).get();

  if (!snap.exists) return { config: null };

  const data = snap.data() || null;

  if (data && typeof data === "object") {

    delete data.terms;

    delete data.statutes;

    delete data.cases;

    if (isLegacy36Text(data.introLead)) {
      data.introLead =
        "로그인 없이 열람할 수 있는 핵심 자료입니다. 공개 퀴즈 5문항은 기본·상세 해설을 모두 공개합니다.";
    }
    data.quizBanner = normalizeQuizBanner(data.quizBanner);

  }

  return { config: data };

});



const adminGetPublicContentConfig = onCall({ region: "asia-northeast3" }, async (request) => {

  if (!isAdminEmailFromAuth(request.auth)) {

    throw new HttpsError("permission-denied", "관리자만 조회할 수 있습니다.");

  }

  const snap = await getFirestore().doc(DOC_PATH).get();

  if (!snap.exists) return { config: null };

  return { config: snap.data() || null };

});



const adminSavePublicContentConfig = onCall({ region: "asia-northeast3" }, async (request) => {

  if (!isAdminEmailFromAuth(request.auth)) {

    throw new HttpsError("permission-denied", "관리자만 저장할 수 있습니다.");

  }

  const data = request.data || {};

  let payload;

  if (typeof data.config === "string") {

    try {

      payload = normalizePayload(JSON.parse(data.config));

    } catch (e) {

      throw new HttpsError("invalid-argument", "JSON 형식이 올바르지 않습니다.");

    }

  } else {

    payload = normalizePayload(data.config || data);

  }

  payload.updatedBy =

    request.auth && request.auth.token && request.auth.token.email

      ? String(request.auth.token.email).trim().slice(0, 200)

      : null;

  await writePublished(payload, { stripLegacy: true });

  return { ok: true };

});



const adminResetPublicContentConfig = onCall({ region: "asia-northeast3" }, async (request) => {

  if (!isAdminEmailFromAuth(request.auth)) {

    throw new HttpsError("permission-denied", "관리자만 초기화할 수 있습니다.");

  }

  const payload = normalizePayload({});

  payload.updatedBy =

    request.auth && request.auth.token && request.auth.token.email

      ? String(request.auth.token.email).trim().slice(0, 200)

      : null;

  await writePublished(payload, { stripLegacy: true });

  return { ok: true };

});



module.exports = {

  getPublicContentConfig,

  adminGetPublicContentConfig,

  adminSavePublicContentConfig,

  adminResetPublicContentConfig,

  DOC_PATH

};

