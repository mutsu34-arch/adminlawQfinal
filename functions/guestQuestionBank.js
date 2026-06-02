"use strict";

const crypto = require("crypto");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");

const QUIZ_COLLECTION = "hanlaw_questions";
const GUEST_THROTTLE_COLLECTION = "hanlaw_guest_bank_throttle";

// 비인증 게스트 문항 API 남용(스크래핑) 완화용 IP 단위 rate limit.
// 일반 게스트는 세션당 1회 정도 호출하므로 넉넉하게 둔다. (학원·기업 공유 IP 고려)
const GUEST_RATE_LIMIT = { windowMs: 60 * 60 * 1000, maxCalls: 60 };

function clientIpFromRequest(request) {
  try {
    const raw = request && request.rawRequest;
    if (!raw) return "";
    const fwd = raw.headers && raw.headers["x-forwarded-for"];
    if (fwd) {
      const first = String(Array.isArray(fwd) ? fwd[0] : fwd).split(",")[0].trim();
      if (first) return first;
    }
    return String(raw.ip || "").trim();
  } catch (e) {
    return "";
  }
}

async function enforceGuestRateLimit(request) {
  const ip = clientIpFromRequest(request);
  if (!ip) return; // IP를 식별할 수 없으면 통과(가용성 우선)
  const id = crypto.createHash("sha256").update(ip).digest("hex").slice(0, 40);
  const ref = getFirestore().collection(GUEST_THROTTLE_COLLECTION).doc(id);
  const now = Date.now();
  await getFirestore().runTransaction(async (t) => {
    const snap = await t.get(ref);
    let windowStart = now;
    let count = 0;
    if (snap.exists) {
      const d = snap.data() || {};
      windowStart = typeof d.windowStart === "number" ? d.windowStart : now;
      count = typeof d.count === "number" ? d.count : 0;
      if (now - windowStart >= GUEST_RATE_LIMIT.windowMs) {
        windowStart = now;
        count = 0;
      }
    }
    if (count >= GUEST_RATE_LIMIT.maxCalls) {
      throw new HttpsError(
        "resource-exhausted",
        "요청이 많아 잠시 후 다시 시도해 주세요. 회원가입 후에는 제한 없이 이용할 수 있습니다."
      );
    }
    t.set(
      ref,
      { windowStart, count: count + 1, updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
  });
}

const GUEST_STRIP_KEYS = new Set([
  "explanation",
  "explanationBasic",
  "detail",
  "tags",
  "explainVerBasic",
  "explainVerDetail",
  "createdAt",
  "updatedAt"
]);

// 무료(로그인) 회원: 기본 해설까지는 제공하고 유료 전용 상세 해설(detail)만 제거.
const MEMBER_STRIP_KEYS = new Set(["detail", "explainVerDetail", "createdAt", "updatedAt"]);

function normalizeAnswer(raw) {
  if (typeof raw === "boolean") return raw;
  const s = String(raw == null ? "" : raw).trim().toLowerCase();
  if (s === "true" || s === "o" || s === "1" || s === "참") return true;
  if (s === "false" || s === "x" || s === "0" || s === "거짓") return false;
  return raw;
}

function normalizeYear(raw) {
  if (raw == null || raw === "") return null;
  const n = typeof raw === "number" && Number.isFinite(raw) ? Math.floor(raw) : parseInt(String(raw).trim(), 10);
  return Number.isFinite(n) ? n : null;
}

function toPublicQuestion(doc, stripKeys) {
  const d = doc.data() || {};
  if (d.hidden === true) return null;

  const q = { id: String(d.id || doc.id || "").trim() || doc.id };
  Object.keys(d).forEach((k) => {
    if (stripKeys.has(k) || k === "hidden") return;
    q[k] = d[k];
  });

  if (q.examId != null && q.examId !== "") {
    q.examId = String(q.examId).trim().toLowerCase();
  }
  q.year = normalizeYear(q.year);
  q.answer = normalizeAnswer(q.answer);

  if (q.importance != null && q.importance !== "") {
    const n = parseInt(q.importance, 10);
    if (Number.isFinite(n)) q.importance = Math.max(1, Math.min(5, n));
  }
  if (q.difficulty != null && q.difficulty !== "") {
    const n = parseInt(q.difficulty, 10);
    if (Number.isFinite(n)) q.difficulty = Math.max(1, Math.min(5, n));
  }

  if (!q.statement || !String(q.statement).trim()) return null;
  if (typeof q.answer !== "boolean") return null;

  return q;
}

async function buildQuestionBank(stripKeys) {
  const snap = await getFirestore().collection(QUIZ_COLLECTION).get();
  const questions = [];
  snap.forEach((doc) => {
    const q = toPublicQuestion(doc, stripKeys);
    if (q) questions.push(q);
  });
  return questions;
}

const getGuestQuestionBank = onCall({ region: "asia-northeast3" }, async (request) => {
  await enforceGuestRateLimit(request);
  const questions = await buildQuestionBank(GUEST_STRIP_KEYS);
  return { ok: true, questions };
});

// 로그인한 무료 회원용: 기본 해설 포함, 유료 상세 해설(detail)은 서버에서 제거.
// 유료/관리자 회원은 Firestore 규칙에 따라 hanlaw_questions 를 직접 읽어 detail 까지 수신.
const getMemberQuestionBank = onCall({ region: "asia-northeast3" }, async (request) => {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
  }
  const questions = await buildQuestionBank(MEMBER_STRIP_KEYS);
  return { ok: true, questions };
});

module.exports = { getGuestQuestionBank, getMemberQuestionBank };
