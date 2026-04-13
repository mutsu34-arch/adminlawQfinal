"use strict";

const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { effectiveGeminiModelId } = require("./geminiModel");
const { getStoredNickname } = require("./userProfileServer");

function db() {
  return getFirestore();
}

const MAX_STR = 12000;
const GEMINI_MODEL_FALLBACKS = [
  "gemini-2.0-flash",
  "gemini-1.5-flash",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite"
];

function normTag(s) {
  return String(s || "")
    .normalize("NFC")
    .trim()
    .replace(/[\s.\-·]/g, "")
    .toLowerCase();
}

function makeSlug(tag) {
  const raw = String(tag).normalize("NFC").trim();
  let base = raw
    .replace(/[\s.\-·]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\uac00-\ud7a3]/gi, "_");
  if (!base) base = "entry";
  return base.slice(0, 700);
}

function isLikelyCaseTag(s) {
  const raw = String(s || "").trim().replace(/^#/, "");
  const variants = [
    raw,
    raw.replace(/^판례/i, "").trim(),
    raw.replace(/^대법원?/i, "").trim()
  ];
  for (let i = 0; i < variants.length; i++) {
    const t = variants[i];
    if (!t) continue;
    if (/헌재\s*\d{4}헌[가바마]\d+/i.test(t)) return true;
    if (/\d{2,4}\s*[누두구]\s*\d{2,7}/.test(t)) return true;
    if (/^\d{2,4}[누두구]\d{2,7}$/.test(t.replace(/\s/g, ""))) return true;
  }
  return false;
}

const CASENOTE_ORIGIN = "https://casenote.kr";
const CASENOTE_HIGH_COURTS = [
  "서울고등법원",
  "부산고등법원",
  "대구고등법원",
  "광주고등법원",
  "대전고등법원",
  "수원고등법원",
  "인천고등법원",
  "울산고등법원",
  "창원고등법원",
  "청주고등법원",
  "전주고등법원",
  "춘천고등법원"
];

function normalizeCaseNoToken(str) {
  let compact = String(str || "").replace(/\s/g, "").replace(/^판례/i, "");
  const hm = compact.match(/(\d{4}헌[가바마]\d+)/);
  if (hm) return hm[1];
  const m = compact.match(/(\d{2,4})([누두구])(\d{2,7})/);
  if (m) return m[1] + m[2] + m[3];
  return null;
}

function inferCasenoteCourt(citation, token) {
  const cit = String(citation || "");
  if (/헌법재판소|헌재/.test(cit)) return "헌법재판소";
  if (token && /\d{4}헌[가바마]/.test(token)) return "헌법재판소";
  for (let i = 0; i < CASENOTE_HIGH_COURTS.length; i++) {
    if (cit.includes(CASENOTE_HIGH_COURTS[i])) return CASENOTE_HIGH_COURTS[i];
  }
  if (/고등법원/.test(cit)) {
    const m = cit.match(/([\w가-힣]+고등법원)/);
    if (m) return m[1];
  }
  if (/행정법원/.test(cit)) {
    const em = cit.match(/([\w가-힣]+행정법원)/);
    if (em) return em[1];
  }
  if (/지방법원/.test(cit)) {
    const dm = cit.match(/([\w가-힣]+지방법원)/);
    if (dm) return dm[1];
  }
  if (/대법원|대법/.test(cit)) return "대법원";
  return "대법원";
}

function pickCaseTokenFromPayload(searchKeys, citation) {
  const keys = Array.isArray(searchKeys) ? searchKeys : [];
  for (let i = 0; i < keys.length; i++) {
    const t = normalizeCaseNoToken(keys[i]);
    if (t) return t;
  }
  return normalizeCaseNoToken(citation);
}

/** Casenote 판결문 전문 페이지 URL (없으면 빈 문자열). */
function computeCasenoteUrl(citation, searchKeys) {
  const token = pickCaseTokenFromPayload(searchKeys, citation);
  if (!token) return "";
  const court = inferCasenoteCourt(citation, token);
  return `${CASENOTE_ORIGIN}/${encodeURIComponent(court)}/${encodeURIComponent(token)}`;
}

function clampStr(v, max) {
  const s = v == null ? "" : String(v);
  return s.length > max ? s.slice(0, max) : s;
}

function parseJsonFromModel(text) {
  let t = String(text || "").trim();
  const fence = t.match(/^```(?:json)?\s*([\s\S]*?)```$/m);
  if (fence) t = fence[1].trim();
  return JSON.parse(t);
}

function nicknameHintLine(learnerNickname) {
  const n = learnerNickname && String(learnerNickname).trim();
  if (!n) return "";
  return (
    "요청 학습자의 닉네임은 「" +
    n +
    "」입니다. JSON 본문(정의·사실관계)은 객관적으로 유지하고, 필요하면 서론 한 문장에만 자연스럽게 호칭할 수 있습니다.\n\n"
  );
}

async function generateTermWithGemini(tag, apiKey, modelId, learnerNickname) {
  const gen = new GoogleGenerativeAI(apiKey);
  const prompt =
    nicknameHintLine(learnerNickname) +
    "당신은 한국 행정법 학습용 콘텐츠 편집자입니다. 아래 문자열은 법률 용어 또는 법령 조문 표기일 수 있습니다.\n" +
    "JSON만 출력하세요. 키: term(표제어 문자열), aliases(관련어 문자열 배열, 없으면 []), definition(해설 문자열, 3~8문장, 수험용으로 정확하고 중립적으로).\n" +
    "definition은 필요하면 줄을 바꾸고, 요점마다 '* **짧은 소제목:** 설명' 형식을 쓸 수 있습니다. (앱에서 불릿 기호는 숨기고 소제목만 강조됩니다.)\n" +
    "항목: " +
    JSON.stringify(tag);
  const o = await generateJsonWithModelFallback(gen, modelId, prompt);
  return {
    term: clampStr(o.term || tag, 200),
    aliases: Array.isArray(o.aliases) ? o.aliases.map((x) => clampStr(x, 120)).slice(0, 20) : [],
    definition: clampStr(o.definition, MAX_STR)
  };
}

async function generateCaseWithGemini(tag, apiKey, modelId, learnerNickname) {
  const gen = new GoogleGenerativeAI(apiKey);
  const prompt =
    nicknameHintLine(learnerNickname) +
    "당신은 한국 법학 교육용 요약가입니다. 아래는 판례 사건번호 또는 판례 식별 문자열입니다.\n" +
    "JSON만 출력. 키: citation(문자열, 예: 대법원 … 선고 …), title(한 줄 제목), facts(사실관계 요약), issues(쟁점), judgment(법적 판단 요약), " +
    "searchKeys(이 사건을 검색할 때 쓸 문자열 배열, 사건번호 변형 포함).\n" +
    "공개된 판례·교재 지식에 기반해 요약하되, 불확실하면 그렇게 밝히세요.\n" +
    "항목: " +
    JSON.stringify(tag);
  const o = await generateJsonWithModelFallback(gen, modelId, prompt);
  const keys = Array.isArray(o.searchKeys)
    ? o.searchKeys.map((x) => clampStr(x, 80)).slice(0, 12)
    : [];
  return {
    citation: clampStr(o.citation, 400),
    title: clampStr(o.title, 300),
    facts: clampStr(o.facts, MAX_STR),
    issues: clampStr(o.issues, MAX_STR),
    judgment: clampStr(o.judgment, MAX_STR),
    searchKeys: keys.length ? keys : [normTag(tag)]
  };
}

async function generateJsonWithModelFallback(gen, modelId, prompt) {
  const candidates = [];
  [modelId].concat(GEMINI_MODEL_FALLBACKS).forEach((m) => {
    const s = String(m || "").trim();
    if (!s || candidates.includes(s)) return;
    candidates.push(s);
  });
  let lastErr = null;
  for (let i = 0; i < candidates.length; i++) {
    const model = gen.getGenerativeModel({
      model: candidates[i],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.35
      }
    });
    try {
      const res = await model.generateContent(prompt);
      const txt = res.response.text();
      return parseJsonFromModel(txt);
    } catch (e) {
      lastErr = e;
      const msg = String((e && e.message) || e || "");
      const low = msg.toLowerCase();
      if (
        (low.includes("models/") && low.includes("not found")) ||
        (low.includes("404") && low.includes("no longer available"))
      ) {
        continue;
      }
      throw e;
    }
  }
  throw lastErr || new Error("Gemini 모델 호출에 실패했습니다.");
}

function firestoreToTermPayload(d) {
  return {
    term: d.term,
    aliases: d.aliases || [],
    definition: d.definition || ""
  };
}

function firestoreToCasePayload(d) {
  return {
    citation: d.citation || "",
    title: d.title || "",
    facts: d.facts || "",
    issues: d.issues || "",
    judgment: d.judgment || "",
    searchKeys: d.searchKeys || [],
    casenoteUrl: d.casenoteUrl || "",
    jisCntntsSrno: d.jisCntntsSrno || "",
    scourtPortalUrl: d.scourtPortalUrl || ""
  };
}

function stagingCollectionByKind(asCase) {
  return asCase ? "hanlaw_dict_cases_staging" : "hanlaw_dict_terms_staging";
}

function entryKeyByKind(asCase, payload) {
  return asCase ? String(payload.citation || "").trim() : String(payload.term || "").trim();
}

const generateOrGetDictionaryEntry = onCall({ region: "asia-northeast3" }, async (request) => {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
  }
  const raw = String((request.data && request.data.tag) || "")
    .replace(/^#/, "")
    .trim();
  if (!raw || raw.length > 160) {
    throw new HttpsError("invalid-argument", "태그가 올바르지 않습니다.");
  }

  const apiKey = process.env.GEMINI_API_KEY || "";
  const modelId = effectiveGeminiModelId();

  const asCase = isLikelyCaseTag(raw);
  const col = asCase ? "hanlaw_dict_cases" : "hanlaw_dict_terms";
  const slug = makeSlug(raw);
  const ref = db().collection(col).doc(slug);

  const existing = await ref.get();
  if (existing.exists) {
    const d = existing.data();
    return {
      ok: true,
      source: "store",
      kind: asCase ? "case" : "term",
      record: asCase ? firestoreToCasePayload(d) : firestoreToTermPayload(d)
    };
  }

  if (!apiKey) {
    throw new HttpsError(
      "failed-precondition",
      "서버에 GEMINI_API_KEY가 설정되지 않아 새 항목을 만들 수 없습니다."
    );
  }

  let learnerNick = "";
  try {
    learnerNick = await getStoredNickname(request.auth.uid);
  } catch (e) {
    console.warn("dictionaryGemini nickname skip", e && e.message);
  }

  try {
    const payload = asCase
      ? await generateCaseWithGemini(raw, apiKey, modelId, learnerNick)
      : await generateTermWithGemini(raw, apiKey, modelId, learnerNick);

    if (asCase) {
      const cn = computeCasenoteUrl(payload.citation, payload.searchKeys);
      if (cn) payload.casenoteUrl = cn;
    }

    const toSave = Object.assign({}, payload, {
      source: "gemini",
      tagInput: raw,
      normKey: normTag(raw),
      createdAt: FieldValue.serverTimestamp(),
      createdBy: request.auth.uid
    });

    // 운영 컬렉션에 즉시 반영하지 않고, 검수 대기(staging)에 적재한다.
    const stagingRef = db()
      .collection(stagingCollectionByKind(asCase))
      .doc(slug);
    await stagingRef.set(
      {
        entityType: asCase ? "case" : "term",
        entryKey: entryKeyByKind(asCase, payload),
        payload,
        status: "reviewing",
        source: "ai-tag",
        changeType: "upsert",
        tagInput: raw,
        normKey: normTag(raw),
        createdAt: FieldValue.serverTimestamp(),
        createdBy: request.auth.uid,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: request.auth.uid,
        approvedAt: null,
        approvedBy: null,
        rejectReason: "",
        version: 1
      },
      { merge: true }
    );

    return {
      ok: true,
      source: "generated-pending-review",
      kind: asCase ? "case" : "term",
      record: asCase ? firestoreToCasePayload(payload) : firestoreToTermPayload(payload)
    };
  } catch (e) {
    console.error("dictionaryGemini error", e);
    throw new HttpsError(
      "internal",
      (e && e.message) || "AI 생성 중 오류가 발생했습니다."
    );
  }
});

module.exports = { generateOrGetDictionaryEntry, makeSlug, normTag, isLikelyCaseTag };
