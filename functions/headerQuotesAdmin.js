"use strict";

const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { uniqueGeminiModelCandidates } = require("./geminiModel");

const STAGING = "hanlaw_quote_staging";
const PUB_COL = "hanlaw_header_quotes";
const PUB_ID = "published";

function db() {
  return getFirestore();
}

function assertAdmin(request) {
  if (!request.auth || !request.auth.token || !request.auth.token.email) {
    throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
  }
  const email = String(request.auth.token.email).toLowerCase();
  const raw = process.env.ADMIN_EMAILS || "mutsu34@gmail.com";
  const admins = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (!admins.includes(email)) {
    throw new HttpsError("permission-denied", "관리자만 사용할 수 있습니다.");
  }
}

function sanitizeQuoteText(s) {
  const t = String(s || "")
    .trim()
    .replace(/\s+/g, " ");
  if (!t || t.length > 400) return "";
  return t;
}

function parseQuotesFromAiText(raw) {
  let s = String(raw || "").trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  try {
    const arr = JSON.parse(s);
    if (Array.isArray(arr)) {
      return arr.map((x) => String(x || "").trim()).filter(Boolean);
    }
  } catch (e) {
    /* fall through */
  }
  return s
    .split(/\n/)
    .map((l) =>
      l
        .replace(/^[\s\d.\)\-\*\u2022]+/, "")
        .replace(/^["']|["']$/g, "")
        .trim()
    )
    .filter(Boolean);
}

exports.adminQuoteAddStaging = onCall({ region: "asia-northeast3" }, async (request) => {
  assertAdmin(request);
  const text = sanitizeQuoteText((request.data && request.data.text) || "");
  if (!text) {
    throw new HttpsError("invalid-argument", "명언 문구를 입력해 주세요. (최대 400자)");
  }

  const ref = db().collection(STAGING).doc();
  await ref.set({
    text,
    source: "manual",
    status: "pending",
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  });
  return { ok: true, id: ref.id };
});

exports.adminQuoteGenerateAi = onCall({ region: "asia-northeast3" }, async (request) => {
  assertAdmin(request);
  const apiKey = process.env.GEMINI_API_KEY || "";
  if (!apiKey) {
    throw new HttpsError("failed-precondition", "GEMINI_API_KEY가 설정되어 있지 않습니다.");
  }

  const n = Math.min(15, Math.max(3, parseInt((request.data && request.data.count) || 8, 10) || 8));

  const prompt = [
    "당신은 수험생을 돕는 카피라이터입니다. 한국어로만 출력합니다.",
    "아래 조건을 만족하는 문자열을 정확히 " + n + "개 담은 JSON 배열만 출력하세요.",
    "",
    "[내용 규칙]",
    "- 각 항목은 **유명인의 말을 인용한 한 줄**입니다. 역사·철학·정치·문학·스포츠·기업·과학·예능·SNS 등 **시대와 분야를 다양하게** 섞으세요. (고전 인물부터 현대 유명인까지 모두 가능.)",
    "- **형식 (필수)**: 인용문(또는 짧은 문장) 다음에 구분 기호( — 또는 · )와 함께 **발화자 이름**을 붙입니다. 예: 늦었다고 생각할 때가 가장 빠르다 — 박명수",
    "- 실제로 널리 인용되는 말을 우선하고, 속담·격언도 가능합니다. 같은 인물을 반복하지 마세요.",
    "- 공부·끈기·행정법·시험 마음가짐과 어울리면 좋습니다.",
    "- 각 문자열은 400자 이내, 따옴표로 전체를 감싸지 마세요.",
    "",
    "[출력 형식]",
    '유효한 JSON 배열만. 예: ["문구 — 홍길동","다른 인용 — 스티브 잡스"]',
    "설명 문장·번호·마크다운 코드펜스 없이 배열만 출력하세요."
  ].join("\n");

  const gen = new GoogleGenerativeAI(apiKey);
  const candidates = uniqueGeminiModelCandidates();

  let text = "";
  let lastErr = null;
  for (let i = 0; i < candidates.length; i++) {
    const modelId = candidates[i];
    const model = gen.getGenerativeModel({
      model: modelId,
      generationConfig: { temperature: 0.88, maxOutputTokens: 2048 }
    });
    try {
      const res = await model.generateContent(prompt);
      text = res.response.text();
      lastErr = null;
      break;
    } catch (e) {
      lastErr = e;
      const msg = String((e && e.message) || e || "").toLowerCase();
      const modelGone =
        (msg.includes("models/") && msg.includes("not found")) ||
        (msg.includes("404") && (msg.includes("not found") || msg.includes("not supported")));
      if (modelGone) {
        console.warn("adminQuoteGenerateAi model skip:", modelId, e && e.message);
        continue;
      }
      console.error("adminQuoteGenerateAi", e);
      throw new HttpsError("internal", (e && e.message) || "AI 호출 실패");
    }
  }
  if (!text && lastErr) {
    console.error("adminQuoteGenerateAi all models failed", lastErr);
    throw new HttpsError("internal", (lastErr && lastErr.message) || "AI 호출 실패");
  }

  const lines = parseQuotesFromAiText(text);
  if (!lines.length) {
    throw new HttpsError("internal", "AI가 유효한 명언 목록을 만들지 못했습니다. 다시 시도하세요.");
  }

  const batch = db().batch();
  let added = 0;
  for (const raw of lines) {
    const t = sanitizeQuoteText(raw);
    if (!t) continue;
    const ref = db().collection(STAGING).doc();
    batch.set(ref, {
      text: t,
      source: "ai",
      status: "pending",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });
    added++;
    if (added >= 20) break;
  }
  if (!added) {
    throw new HttpsError("internal", "추가할 명언이 없습니다.");
  }
  await batch.commit();
  return { ok: true, added };
});

exports.adminQuoteListStaging = onCall({ region: "asia-northeast3" }, async (request) => {
  assertAdmin(request);
  const snap = await db().collection(STAGING).get();
  const items = snap.docs
    .map((doc) => {
      const d = doc.data() || {};
      if (String(d.status || "pending") !== "pending") return null;
      return {
        id: doc.id,
        text: String(d.text || ""),
        source: d.source === "ai" ? "ai" : "manual",
        createdAtMs:
          d.createdAt && typeof d.createdAt.toMillis === "function" ? d.createdAt.toMillis() : 0
      };
    })
    .filter(Boolean)
    .sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0))
    .slice(0, 80);
  return { ok: true, items };
});

exports.adminQuoteApprove = onCall({ region: "asia-northeast3" }, async (request) => {
  assertAdmin(request);
  const id = String((request.data && request.data.id) || "").trim();
  if (!id) throw new HttpsError("invalid-argument", "id가 필요합니다.");

  const pubRef = db().collection(PUB_COL).doc(PUB_ID);
  const stRef = db().collection(STAGING).doc(id);
  const email = String(request.auth.token.email || "").toLowerCase();

  await db().runTransaction(async (t) => {
    const st = await t.get(stRef);
    if (!st.exists) throw new HttpsError("not-found", "대기 항목이 없습니다.");
    const sd = st.data() || {};
    if (String(sd.status || "") !== "pending") {
      throw new HttpsError("failed-precondition", "이미 처리된 항목입니다.");
    }
    const line = sanitizeQuoteText(sd.text);
    if (!line) throw new HttpsError("invalid-argument", "명언 내용이 비어 있습니다.");

    const ps = await t.get(pubRef);
    const cur = ps.exists && ps.data() ? ps.data() : {};
    let quotes = Array.isArray(cur.quotes)
      ? cur.quotes.map((x) => String(x || "").trim()).filter(Boolean)
      : [];
    const exists = quotes.some((q) => q === line);
    if (!exists) {
      quotes.push(line);
      if (quotes.length > 200) quotes = quotes.slice(-200);
    }
    t.set(
      pubRef,
      {
        quotes,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: email
      },
      { merge: true }
    );
    t.delete(stRef);
  });
  return { ok: true };
});

exports.adminQuoteReject = onCall({ region: "asia-northeast3" }, async (request) => {
  assertAdmin(request);
  const id = String((request.data && request.data.id) || "").trim();
  if (!id) throw new HttpsError("invalid-argument", "id가 필요합니다.");
  await db().collection(STAGING).doc(id).delete();
  return { ok: true };
});

exports.adminQuoteGetPublished = onCall({ region: "asia-northeast3" }, async (request) => {
  assertAdmin(request);
  const snap = await db().collection(PUB_COL).doc(PUB_ID).get();
  const d = snap.exists ? snap.data() : {};
  const quotes = Array.isArray(d.quotes)
    ? d.quotes.map((x) => String(x || "").trim()).filter(Boolean)
    : [];
  return { ok: true, quotes };
});

exports.adminQuoteReplacePublished = onCall({ region: "asia-northeast3" }, async (request) => {
  assertAdmin(request);
  const raw = request.data && request.data.quotes;
  const lines = Array.isArray(raw)
    ? raw
    : String(raw || "")
        .split(/\r?\n/)
        .map((x) => x.trim())
        .filter(Boolean);
  const quotes = [];
  const seen = {};
  for (const ln of lines) {
    const t = sanitizeQuoteText(ln);
    if (!t || seen[t]) continue;
    seen[t] = true;
    quotes.push(t);
    if (quotes.length >= 200) break;
  }
  await db()
    .collection(PUB_COL)
    .doc(PUB_ID)
    .set(
      {
        quotes,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: String(request.auth.token.email || "").toLowerCase()
      },
      { merge: true }
    );
  return { ok: true, count: quotes.length };
});
