"use strict";

const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { logger } = require("firebase-functions/v2");
const { normalizeCaseDictionaryFields } = require("./caseTextNormalize");

const WEEKLY_DOC_PATH = "hanlaw_public_content/weekly";
const PICK_COUNT = 5;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const REGION = "asia-northeast3";
const ELLY_QA_PREFIX = "elly_";

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

function normalizeAnswer(raw) {
  if (typeof raw === "boolean") return raw;
  const s = String(raw == null ? "" : raw).trim().toLowerCase();
  if (s === "true" || s === "o" || s === "1" || s === "참") return true;
  if (s === "false" || s === "x" || s === "0" || s === "거짓") return false;
  return null;
}

function sampleRandom(list, n) {
  const arr = list.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr.slice(0, Math.min(n, arr.length));
}

function weekKeyFromMs(ms) {
  const d = new Date(ms);
  const utc = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((utc - yearStart) / 86400000 + 1) / 7);
  return utc.getUTCFullYear() + "-W" + String(weekNo).padStart(2, "0");
}

function snapshotIsFresh(data) {
  if (!data || typeof data !== "object") return false;
  if (!Array.isArray(data.quiz) || !data.quiz.length) return false;
  const vu = data.validUntil;
  let untilMs = 0;
  if (vu && typeof vu.toMillis === "function") untilMs = vu.toMillis();
  else if (vu && typeof vu._seconds === "number") untilMs = vu._seconds * 1000;
  else if (typeof vu === "number") untilMs = vu;
  if (untilMs <= Date.now()) return false;

  const poolCounts = data.poolCounts && typeof data.poolCounts === "object" ? data.poolCounts : {};
  const categories = ["terms", "statutes", "cases", "quiz", "qa"];
  for (const key of categories) {
    const poolSize = Number(poolCounts[key]) || 0;
    if (poolSize <= 0) continue;
    const picked = Array.isArray(data[key]) ? data[key].length : 0;
    if (picked <= 0) return false;
  }
  return true;
}

function mapTermForSnapshot(doc) {
  const d = doc.data() || {};
  const term = String(d.term || doc.id || "").trim();
  if (!term) return null;
  const definition = String(d.definition || "").trim();
  if (!definition) return null;
  return {
    _docId: doc.id,
    term,
    aliases: Array.isArray(d.aliases) ? d.aliases : [],
    definition,
    source: d.source || "",
    sourceTag: d.sourceTag || "",
    normSourceTag: d.normSourceTag || "",
    tagAliases: Array.isArray(d.tagAliases) ? d.tagAliases : []
  };
}

function mapStatuteForSnapshot(doc) {
  const d = doc.data() || {};
  const key = String(d.statuteKey || doc.id || "").trim();
  const body = String(d.body != null ? d.body : "").trim();
  if (!key || !body) return null;
  return {
    _docId: doc.id,
    key,
    sourceTag: d.sourceTag || "",
    normSourceTag: d.normSourceTag || "",
    tagAliases: Array.isArray(d.tagAliases) ? d.tagAliases : [],
    heading: d.heading != null ? d.heading : "",
    body,
    appliedRules: d.appliedRules != null ? d.appliedRules : "",
    subordinateRules: d.subordinateRules != null ? d.subordinateRules : "",
    examPoint: d.examPoint != null ? d.examPoint : "",
    sourceNote: d.sourceNote != null ? d.sourceNote : ""
  };
}

function mapCaseForSnapshot(doc) {
  const d = doc.data() || {};
  if (d.hidden === true) return null;
  const citation = String(d.citation || "").trim();
  if (!citation) return null;
  const normalized = normalizeCaseDictionaryFields(d);
  return {
    _docId: doc.id,
    citation,
    title: d.title || "",
    sourceTag: d.sourceTag || "",
    normSourceTag: d.normSourceTag || "",
    tagAliases: Array.isArray(d.tagAliases) ? d.tagAliases : [],
    facts: normalized.facts,
    issues: normalized.issues,
    judgment: normalized.judgment,
    caseFullText: d.caseFullText || "",
    searchKeys: Array.isArray(d.searchKeys) ? d.searchKeys : [],
    topicKeywords: Array.isArray(d.topicKeywords)
      ? d.topicKeywords
      : Array.isArray(d.keywords)
        ? d.keywords
        : []
  };
}

function mapQuestionForSnapshot(doc) {
  const d = doc.data() || {};
  if (d.hidden === true) return null;
  const statement = String(d.statement || "").trim();
  const answer = normalizeAnswer(d.answer);
  if (!statement || typeof answer !== "boolean") return null;
  const detail = d.detail && typeof d.detail === "object" ? d.detail : null;
  return {
    id: String(d.id || doc.id || "").trim() || doc.id,
    statement,
    answer,
    explanation: String(d.explanation || "").trim(),
    explanationBasic: String(d.explanationBasic || d.explanation || "").trim(),
    detail,
    topic: d.topic != null ? String(d.topic) : "",
    examId: d.examId != null ? String(d.examId) : "",
    year: d.year != null ? d.year : null,
    publicContent: true
  };
}

async function loadQaPool(db) {
  const pubSnap = await db.collection("hanlaw_qa_public").where("communityVisible", "==", true).get();
  const items = [];
  for (const doc of pubSnap.docs) {
    const pub = doc.data() || {};
    const ticketId = doc.id;
    if (ticketId.startsWith(ELLY_QA_PREFIX)) {
      const askId = ticketId.slice(ELLY_QA_PREFIX.length);
      if (!askId) continue;
      const askSnap = await db.collection("hanlaw_quiz_ai_asks").doc(askId).get();
      if (!askSnap.exists) continue;
      const ask = askSnap.data() || {};
      const answer = String(ask.answerFull || ask.answerPreview || "").trim();
      if (!answer) continue;
      items.push({
        id: ticketId,
        quizTopic: String(pub.quizTopic || ask.quizTopic || "").trim(),
        quizStatement: String(pub.quizStatement || ask.quizStatement || "").slice(0, 4000),
        questionMessage: String(pub.questionMessage || ask.userQuestion || "").slice(0, 8000),
        answer
      });
      continue;
    }
    const tSnap = await db.collection("hanlaw_tickets").doc(ticketId).get();
    if (!tSnap.exists) continue;
    const t = tSnap.data() || {};
    if (String(t.type || "").trim().toLowerCase() !== "question") continue;
    const answer = String(t.adminReply || "").trim();
    if (!answer) continue;
    const qctx = t.quizContext && typeof t.quizContext === "object" ? t.quizContext : {};
    items.push({
      id: ticketId,
      quizTopic: String(pub.quizTopic || qctx.topic || "").trim(),
      quizStatement: String(pub.quizStatement || qctx.statement || "").slice(0, 4000),
      questionMessage: String(pub.questionMessage || t.message || "").slice(0, 8000),
      answer
    });
  }
  return items;
}

async function generateWeeklyPublicContentSnapshot(db, { force = false } = {}) {
  const ref = db.doc(WEEKLY_DOC_PATH);
  if (!force) {
    const existing = await ref.get();
    if (snapshotIsFresh(existing.data())) {
      return existing.data();
    }
  }

  const now = Date.now();
  const validUntil = Timestamp.fromMillis(now + WEEK_MS);
  const weekKey = weekKeyFromMs(now);

  const [termSnap, statuteSnap, caseSnap, questionSnap, qaPool] = await Promise.all([
    db.collection("hanlaw_dict_terms").get(),
    db.collection("hanlaw_dict_statutes").get(),
    db.collection("hanlaw_dict_cases").get(),
    db.collection("hanlaw_questions").get(),
    loadQaPool(db)
  ]);

  const termPool = [];
  termSnap.forEach((doc) => {
    const t = mapTermForSnapshot(doc);
    if (t) termPool.push(t);
  });
  const statutePool = [];
  statuteSnap.forEach((doc) => {
    const s = mapStatuteForSnapshot(doc);
    if (s) statutePool.push(s);
  });
  const casePool = [];
  caseSnap.forEach((doc) => {
    const c = mapCaseForSnapshot(doc);
    if (c) casePool.push(c);
  });
  const questionPool = [];
  questionSnap.forEach((doc) => {
    const q = mapQuestionForSnapshot(doc);
    if (q) questionPool.push(q);
  });

  const payload = {
    weekKey,
    generatedAt: FieldValue.serverTimestamp(),
    validUntil,
    terms: sampleRandom(termPool, PICK_COUNT),
    statutes: sampleRandom(statutePool, PICK_COUNT),
    cases: sampleRandom(casePool, PICK_COUNT),
    quiz: sampleRandom(questionPool, PICK_COUNT),
    qa: sampleRandom(qaPool, PICK_COUNT),
    poolCounts: {
      terms: termPool.length,
      statutes: statutePool.length,
      cases: casePool.length,
      quiz: questionPool.length,
      qa: qaPool.length
    }
  };

  await ref.set(payload, { merge: false });
  logger.info("publicContentWeekly: generated", {
    weekKey,
    poolCounts: payload.poolCounts,
    picked: {
      terms: payload.terms.length,
      statutes: payload.statutes.length,
      cases: payload.cases.length,
      quiz: payload.quiz.length,
      qa: payload.qa.length
    }
  });

  const saved = await ref.get();
  return saved.data() || payload;
}

async function ensureWeeklyPublicContentSnapshot(db) {
  return generateWeeklyPublicContentSnapshot(db, { force: false });
}

function serializeWeeklyForClient(data) {
  if (!data || typeof data !== "object") {
    return {
      weekKey: "",
      validUntil: null,
      terms: [],
      statutes: [],
      cases: [],
      quiz: [],
      qa: [],
      poolCounts: {}
    };
  }
  const vu = data.validUntil;
  let validUntil = null;
  if (vu && typeof vu.toDate === "function") validUntil = vu.toDate().toISOString();
  else if (vu && typeof vu._seconds === "number") validUntil = new Date(vu._seconds * 1000).toISOString();
  return {
    weekKey: String(data.weekKey || ""),
    validUntil,
    terms: Array.isArray(data.terms) ? data.terms : [],
    statutes: Array.isArray(data.statutes) ? data.statutes : [],
    cases: Array.isArray(data.cases) ? data.cases : [],
    quiz: Array.isArray(data.quiz) ? data.quiz : [],
    qa: Array.isArray(data.qa) ? data.qa : [],
    poolCounts: data.poolCounts && typeof data.poolCounts === "object" ? data.poolCounts : {}
  };
}

const refreshWeeklyPublicContentSchedule = onSchedule(
  {
    region: REGION,
    schedule: "0 4 * * 1",
    timeZone: "Asia/Seoul"
  },
  async () => {
    const db = getFirestore();
    await generateWeeklyPublicContentSnapshot(db, { force: true });
  }
);

const adminRefreshWeeklyPublicContent = onCall({ region: REGION }, async (request) => {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
  }
  if (!isAdminEmailFromAuth(request.auth)) {
    throw new HttpsError("permission-denied", "관리자만 실행할 수 있습니다.");
  }
  const db = getFirestore();
  const data = await generateWeeklyPublicContentSnapshot(db, { force: true });
  const weekly = serializeWeeklyForClient(data);
  return { ok: true, weekKey: weekly.weekKey, validUntil: weekly.validUntil };
});

module.exports = {
  WEEKLY_DOC_PATH,
  ensureWeeklyPublicContentSnapshot,
  generateWeeklyPublicContentSnapshot,
  serializeWeeklyForClient,
  refreshWeeklyPublicContentSchedule,
  adminRefreshWeeklyPublicContent
};
