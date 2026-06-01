"use strict";

const { getFirestore } = require("firebase-admin/firestore");
const { onCall } = require("firebase-functions/v2/https");

const QUIZ_COLLECTION = "hanlaw_questions";

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

function toGuestQuestion(doc) {
  const d = doc.data() || {};
  if (d.hidden === true) return null;

  const q = { id: String(d.id || doc.id || "").trim() || doc.id };
  Object.keys(d).forEach((k) => {
    if (GUEST_STRIP_KEYS.has(k) || k === "hidden") return;
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

const getGuestQuestionBank = onCall({ region: "asia-northeast3" }, async () => {
  const snap = await getFirestore().collection(QUIZ_COLLECTION).get();
  const questions = [];
  snap.forEach((doc) => {
    const q = toGuestQuestion(doc);
    if (q) questions.push(q);
  });
  return { ok: true, questions };
});

module.exports = { getGuestQuestionBank };
