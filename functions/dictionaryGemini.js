"use strict";

const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const https = require("https");
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
    if (/\d{2,4}\s*[가-힣]{1,3}\s*\d{2,7}/.test(t)) return true;
    if (/^\d{2,4}[가-힣]{1,3}\d{2,7}$/.test(t.replace(/\s/g, ""))) return true;
  }
  return false;
}

const CASENOTE_ORIGIN = "https://casenote.kr";
const SCOURT_LX_LIST = "https://lx.scourt.go.kr/search/precedent/get/list";
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
  const m = compact.match(/(\d{2,4})([가-힣]{1,3})(\d{2,7})/);
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

function fetchUrlText(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36",
          accept: "text/html,application/xhtml+xml,application/json"
        }
      },
      (res) => {
        if (!res || !res.statusCode || res.statusCode >= 400) {
          reject(new Error("HTTP " + (res && res.statusCode ? res.statusCode : "?")));
          return;
        }
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      }
    );
    req.setTimeout(timeoutMs || 7000, () => req.destroy(new Error("timeout")));
    req.on("error", (e) => reject(e));
  });
}

function stripHtmlToPlain(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchStatuteWebContext(statuteKey) {
  const q = String(statuteKey || "").trim();
  if (!q) return { text: "", attempted: 0, succeeded: 0, triedUrls: [], results: [] };
  const urls = [
    "https://www.law.go.kr/lsSc.do?query=" + encodeURIComponent(q),
    "https://www.law.go.kr/lsSc.do?query=" + encodeURIComponent(q + " 준용"),
    "https://www.law.go.kr/lsSc.do?query=" + encodeURIComponent(q + " 시행령 시행규칙")
  ];
  const blocks = [];
  const triedUrls = [];
  const results = [];
  let succeeded = 0;
  for (let i = 0; i < urls.length; i++) {
    triedUrls.push(urls[i]);
    try {
      const raw = await fetchUrlText(urls[i], 8000);
      const plain = stripHtmlToPlain(raw);
      if (!plain) {
        results.push({ url: urls[i], ok: false, reason: "본문 없음" });
        continue;
      }
      succeeded += 1;
      results.push({ url: urls[i], ok: true, reason: "수집 성공" });
      blocks.push("[법령검색 " + (i + 1) + "] " + urls[i] + "\n" + plain.slice(0, 14000));
    } catch (e) {
      const msg = String((e && e.message) || "요청 실패").slice(0, 180);
      results.push({ url: urls[i], ok: false, reason: msg });
    }
  }
  return {
    text: blocks.join("\n\n"),
    attempted: urls.length,
    succeeded,
    triedUrls,
    results
  };
}

function buildScourtLawListUrl(citation, searchKeys) {
  const token = pickCaseTokenFromPayload(searchKeys, citation);
  const searchTxt = token || String(citation || "").trim();
  if (!searchTxt) return "";
  const isConst = /헌법재판소|헌재/.test(String(citation || "")) || (token && /\d{4}헌[가바마]/.test(token));
  let q =
    "search_txt=" +
    encodeURIComponent(searchTxt) +
    "&page_no=1&display=20&search_mode=simple";
  if (isConst) {
    q += "&tab_idx=2";
  } else {
    q += "&order_by=des&order_column=d&tab_idx=0";
  }
  return SCOURT_LX_LIST + "?" + q;
}

async function retrieveCaseWebContext(citation, searchKeys) {
  const casenoteUrl = computeCasenoteUrl(citation, searchKeys);
  const scourtListUrl = buildScourtLawListUrl(citation, searchKeys);
  const urls = [casenoteUrl, scourtListUrl].filter(Boolean);
  const blocks = [];
  for (let i = 0; i < urls.length; i++) {
    const u = urls[i];
    try {
      const raw = await fetchUrlText(u, 8000);
      const plain = stripHtmlToPlain(raw);
      if (!plain) continue;
      blocks.push("[웹수집 " + (i + 1) + "] " + u + "\n" + plain.slice(0, 12000));
    } catch (e) {
      // ignore each source and continue
    }
  }
  return blocks.join("\n\n");
}

function clampStr(v, max) {
  const s = v == null ? "" : String(v);
  return s.length > max ? s.slice(0, max) : s;
}

function normalizeCaseIssuesText(raw) {
  const src = String(raw || "").replace(/\r\n/g, "\n");
  if (!src.trim()) return "";
  const lines = src
    .split("\n")
    .map((x) => String(x || "").trim())
    .filter(Boolean);
  if (lines.length > 1) return lines.join("\n");

  const one = lines[0] || "";
  if (!one.includes(",")) return one;
  const parts = one
    .split(",")
    .map((x) => String(x || "").trim())
    .filter(Boolean);
  if (parts.length < 2) return one;

  // "A 여부, B 여부, C 여부"처럼 쟁점 나열일 때만 줄바꿈으로 정규화한다.
  let issueLikeCount = 0;
  for (let i = 0; i < parts.length; i++) {
    if (/(여부|쟁점|문제)$/.test(parts[i])) issueLikeCount += 1;
  }
  if (issueLikeCount >= Math.max(2, Math.floor(parts.length / 2))) {
    return parts.join("\n");
  }
  return one;
}

function normalizeOxAnswer(v) {
  if (v === true || v === false) return v;
  const s = String(v == null ? "" : v).trim().toLowerCase();
  if (s === "o" || s === "true" || s === "참" || s === "1") return true;
  if (s === "x" || s === "false" || s === "거짓" || s === "0") return false;
  return null;
}

function sanitizeOxQuizzes(input, maxCount) {
  const cap =
    Number.isFinite(maxCount) && maxCount > 0 ? Math.min(10, Math.floor(maxCount)) : 5;
  if (!Array.isArray(input)) return [];
  const out = [];
  for (let i = 0; i < input.length; i++) {
    const row = input[i] || {};
    const statement = clampStr(row.statement, 600).trim();
    const answer = normalizeOxAnswer(row.answer);
    const explanation = clampStr(row.explanation, 2000).trim();
    if (!statement || answer == null || !explanation) continue;
    out.push({
      statement,
      answer,
      explanation,
      explanationBasic: explanation
    });
    if (out.length >= cap) break;
  }
  return out;
}

function buildFallbackOxQuizzes(base) {
  const out = [];
  function push(statement, explanation) {
    const st = clampStr(statement, 600).trim();
    const ex = clampStr(explanation, 2000).trim();
    if (!st || !ex) return;
    out.push({
      statement: st,
      answer: true,
      explanation: ex,
      explanationBasic: ex
    });
  }
  const citation = String((base && base.citation) || "").trim();
  const facts = String((base && base.facts) || "").trim();
  const issues = String((base && base.issues) || "").trim();
  const judgment = String((base && base.judgment) || "").trim();
  if (facts) {
    push(
      "이 사건의 사실관계는 판례 요약의 사실관계 항목을 중심으로 정리해야 한다.",
      "요약에서 제시된 사실관계가 사건 전개의 기초가 되므로, 쟁점·판단 해석도 해당 사실관계를 전제로 해야 합니다."
    );
  }
  if (issues) {
    push(
      "이 사건의 핵심 쟁점은 요약의 쟁점 항목에 기재된 법률문제를 중심으로 파악할 수 있다.",
      "쟁점 항목은 법원이 판단한 법률문제를 압축한 부분이므로, 결론을 이해할 때 우선 확인해야 합니다."
    );
  }
  if (judgment) {
    push(
      "이 사건의 법적 결론은 요약의 법적 판단 항목과 일치하게 이해해야 한다.",
      "법적 판단 항목은 판결의 결론과 이유를 정리한 부분이므로, 사건번호만으로 추정하지 말고 해당 내용을 기준으로 봐야 합니다."
    );
  }
  if (!out.length) {
    push(
      "판례 요약은 사건번호만이 아니라 판결 이유(법적 판단)까지 함께 확인해야 정확하다.",
      "동일·유사 사건번호만으로 결론을 단정하면 오해가 생길 수 있어, 사실관계·쟁점·법적 판단을 함께 읽는 것이 필요합니다."
    );
  }
  if (out.length < 3) {
    push(
      "이 판례(" + (citation || "해당 사건") + ")는 사실관계와 쟁점을 구분해 읽어야 법적 판단을 정확히 이해할 수 있다.",
      "사실관계와 쟁점을 분리해 보면 법원이 어떤 법률문제에 답했는지, 그리고 그 결론이 왜 나왔는지 더 명확해집니다."
    );
  }
  if (out.length < 3) {
    push(
      "판례 학습 시에는 결론만 외우기보다 판단 이유를 함께 정리하는 방식이 효과적이다.",
      "결론만 암기하면 유사사안 적용이 어려워지므로, 판단 이유를 함께 정리해야 응용형 문제 대응력이 높아집니다."
    );
  }
  return out.slice(0, 5);
}

function buildFallbackOxQuizzesTerm(base) {
  const out = [];
  function push(statement, explanation) {
    const st = clampStr(statement, 600).trim();
    const ex = clampStr(explanation, 2000).trim();
    if (!st || !ex) return;
    out.push({
      statement: st,
      answer: true,
      explanation: ex,
      explanationBasic: ex
    });
  }
  const term = String((base && base.term) || "").trim();
  const def = String((base && base.definition) || "").trim();
  if (term && def) {
    push(
      "「" + term + "」의 의미와 효과는 위 해설에 정리된 범위 안에서 이해하는 것이 타당하다.",
      "정의 문장에서 요건·효과·예외를 짚은 뒤, 비슷한 용어와 구별하는 연습을 병행하면 기초 이해도가 올라갑니다."
    );
  }
  if (out.length < 2 && def) {
    push(
      "이 용어는 행정법에서 자주 등장하므로, 해설에 나온 핵심 문장만이라도 정확히 짚고 넘어가는 것이 좋다.",
      "정의를 통째로 외우기보다 한 문장으로 요약할 수 있을 때까지 읽는 편이 응용에 유리합니다."
    );
  }
  if (!out.length) {
    push(
      "행정법 용어는 정의와 함께 관련 제도(절차·구제)까지 연결해 학습하는 것이 효과적이다.",
      "용어 하나만 따로 암기하기보다 대표적인 적용 사례를 한 가지 떠올려 보는 방식을 권합니다."
    );
  }
  return out.slice(0, 3);
}

function buildFallbackOxQuizzesStatute(base) {
  const out = [];
  function push(statement, explanation) {
    const st = clampStr(statement, 600).trim();
    const ex = clampStr(explanation, 2000).trim();
    if (!st || !ex) return;
    out.push({
      statement: st,
      answer: true,
      explanation: ex,
      explanationBasic: ex
    });
  }
  const hd = String((base && base.heading) || "").trim().slice(0, 160);
  const body = String((base && base.body) || "").trim();
  const snippet = body.replace(/\s+/g, " ").slice(0, 240);
  if (hd) {
    push(
      "이 조항은 표제(「" + hd + "」)와 본문 문언을 함께 읽어야 그 취지를 정확히 파악할 수 있다.",
      "조문은 제목만 보고 단정하기 쉬우므로, 본문의 요건·효과·예외 규정을 문장 단위로 확인하는 것이 좋습니다."
    );
  }
  if (out.length < 2 && snippet) {
    push(
      "본문에 명시된 요건을 벗어난 해석은 피하고, 문언에 근거한 적용 범위를 따져야 한다.",
      snippet.length
        ? "위 발췌 범위 안에서 ‘누가·언제·어떤 효과가 나는지’를 질문 형태로 정리해 보세요."
        : "조문 학습에서는 항·호·문장 번호를 따라가며 요건과 효과를 구분해 적어 보는 방식이 효과적입니다."
    );
  }
  if (!out.length) {
    push(
      "법령 조문은 체계·연혁·관련 조문을 함께 확인할 때 이해가 깊어진다.",
      "단일 조문만 보지 말고 목차·관련 조·시행령을 연결해 읽는 습관을 들이면 실무·수험 모두에 도움이 됩니다."
    );
  }
  return out.slice(0, 3);
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
    "」입니다. JSON 본문(정의·사실관계)은 객관적으로 유지하고, '관리자님/수험생님' 같은 직접 호칭·대화체·안내문은 절대 쓰지 마세요.\n\n"
  );
}

function stripUndesiredLeadPhrases(text) {
  let s = String(text || "").trim();
  if (!s) return s;
  s = s.replace(/^\s*(관리자님|수험생님|학습자님)[,，]?\s*/g, "");
  s = s.replace(/^\s*요청하신\s*['"“”]?[^\n"'“”]*['"“”]?\s*(용어|판례)[^\n]*\n?/g, "");
  s = s.replace(/^\s*요청\s*학습자[^\n]*\n?/g, "");
  s = s.replace(/^\s*학습\s*콘텐츠입니다\.?\s*/g, "");
  s = s.replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

async function generateTermWithGemini(tag, apiKey, modelId, learnerNickname) {
  const gen = new GoogleGenerativeAI(apiKey);
  const prompt =
    nicknameHintLine(learnerNickname) +
    "당신은 한국 행정법 학습용 콘텐츠 편집자입니다. 아래 문자열은 법률 용어 또는 법령 조문 표기일 수 있습니다.\n" +
    "JSON만 출력하세요.\n" +
    "키: term(표제어 문자열), aliases(관련어 문자열 배열, 없으면 []), definition(해설 문자열, 3~8문장, 수험용으로 정확하고 중립적으로), " +
    "oxQuizzes(배열, 1~3개, 각 원소는 statement/answer/explanation).\n" +
    "definition은 필요하면 줄을 바꾸고, 요점마다 '* **짧은 소제목:** 설명' 형식을 쓸 수 있습니다. (앱에서 불릿 기호는 숨기고 소제목만 강조됩니다.)\n" +
    "oxQuizzes 목적: 기초 수준에서 용어를 정확히 짚기 위한 확인용. 난이도는 입문~중급, 지문은 한 문장 위주로 짧게.\n" +
    "oxQuizzes 규칙: answer는 boolean(true=O, false=X). 반드시 definition에 근거할 수 있는 문장만 작성하고, 해설에 없는 추측·단정은 금지.\n" +
    "정의의 핵심 요건·효과·구별(비슷한 개념과의 차이)·절차상 위치 등을 고르게 다루고, 흔한 오개념은 X 문항으로 다룰 수 있음.\n" +
    "항목: " +
    JSON.stringify(tag);
  const o = await generateJsonWithModelFallback(gen, modelId, prompt);
  const term = clampStr(o.term || tag, 200);
  const aliases = Array.isArray(o.aliases) ? o.aliases.map((x) => clampStr(x, 120)).slice(0, 20) : [];
  const definition = clampStr(stripUndesiredLeadPhrases(o.definition), MAX_STR);
  let oxQuizzes = sanitizeOxQuizzes(o.oxQuizzes, 3);
  if (oxQuizzes.length < 1) {
    const oxPrompt =
      "아래 용어 해설을 바탕으로 OX 퀴즈를 1~3개만 JSON으로 출력하세요.\n" +
      "키는 oxQuizzes 하나만. 각 원소는 statement/answer/explanation. answer는 boolean(true=O, false=X).\n" +
      "해설에 근거 없는 단정 금지. 기초 확인용으로 짧은 한 문장 지문 위주.\n\n" +
      "[표제어]\n" +
      JSON.stringify(term) +
      "\n\n[해설]\n" +
      JSON.stringify(definition.slice(0, 12000));
    try {
      const oxOnly = await generateJsonWithModelFallback(gen, modelId, oxPrompt);
      oxQuizzes = sanitizeOxQuizzes(oxOnly && oxOnly.oxQuizzes, 3);
    } catch (e) {
      // OX 보강 실패 시 정의만 유지
    }
  }
  if (oxQuizzes.length < 1) {
    oxQuizzes = buildFallbackOxQuizzesTerm({ term, definition, aliases });
  }
  return {
    term,
    aliases,
    definition,
    oxQuizzes
  };
}

async function generateCaseWithGemini(tag, apiKey, modelId, learnerNickname, caseFullText) {
  const gen = new GoogleGenerativeAI(apiKey);
  const fullText = String(caseFullText || "").trim();
  let webContext = "";
  if (!fullText) {
    try {
      webContext = await retrieveCaseWebContext(tag, [tag]);
    } catch (e) {
      webContext = "";
    }
  }
  const prompt =
    nicknameHintLine(learnerNickname) +
    "당신은 한국 법학 교육용 요약가입니다.\n" +
    "JSON만 출력. 키: citation(문자열, 예: 대법원 … 선고 …), title(한 줄 제목), facts(사실관계 요약), issues(쟁점), judgment(법적 판단 요약), " +
    "oxQuizzes(배열, 3~5개, 각 원소는 statement/answer/explanation), " +
    "searchKeys(이 사건을 검색할 때 쓸 문자열 배열, 사건번호 변형 포함).\n" +
    "문체 규칙: facts/issues/judgment/explanation은 반드시 정중한 서술형(합니다체, 예: ~하였습니다/~입니다)으로 작성하고, 반말체(~하였다/~했다)는 사용하지 마세요.\n" +
    "facts/issues/judgment는 반드시 '사실관계 → 쟁점 → 법적 판단' 관점으로 정리하고, 불확실하면 그렇게 밝히세요.\n" +
    "가독성 규칙: facts와 judgment는 2~4개 단락으로 나누고, 각 단락은 1~2문장으로 짧게 작성하세요.\n" +
    "issues는 2~5개 핵심 쟁점을 줄바꿈으로 나열하고, 반드시 '첫째, ...\\n둘째, ...\\n셋째, ...' 형식으로 작성하세요.\n" +
    "oxQuizzes 생성 규칙: answer는 boolean(true=O, false=X), 사실관계/쟁점/법적판단을 고르게 포함하고, 전문에 없는 단정은 금지.\n" +
    (fullText
      ? "아래 판결문 전문(또는 전문 발췌)을 최우선 근거로 요약하세요. 전문에 없는 사실을 단정해 추가하지 마세요.\n\n" +
        "[판례 식별자]\n" +
        JSON.stringify(tag) +
        "\n\n[판결문 전문]\n" +
        fullText
      : "아래 판례 사건번호 또는 판례 식별 문자열을 기준으로 공개 판결문/판례정보를 우선 활용하세요.\n" +
        "웹수집 텍스트가 있으면 이를 우선 근거로 사용하고, 필요하면 하급심 내용도 반영하세요.\n" +
        "항목: " +
        JSON.stringify(tag) +
        (webContext ? "\n\n[자동 수집 텍스트(대법원/관련 판례 검색)]\n" + webContext : ""));
  const o = await generateJsonWithModelFallback(gen, modelId, prompt);
  const keys = Array.isArray(o.searchKeys)
    ? o.searchKeys.map((x) => clampStr(x, 80)).slice(0, 12)
    : [];
  let oxQuizzes = sanitizeOxQuizzes(o.oxQuizzes, 5);
  if (oxQuizzes.length < 3) {
    const oxPrompt =
      "아래 판례 요약/원문을 바탕으로 OX 퀴즈를 3~5개 JSON만 출력하세요.\n" +
      "키는 oxQuizzes 하나만 사용하고, 각 원소는 statement/answer/explanation 이어야 합니다.\n" +
      "answer는 boolean(true=O, false=X). 전문/요약에 없는 단정은 금지.\n\n" +
      "[판례 식별자]\n" +
      JSON.stringify(tag) +
      "\n\n[요약 초안]\n" +
      JSON.stringify({
        citation: o.citation || "",
        title: o.title || "",
        facts: o.facts || "",
        issues: o.issues || "",
        judgment: o.judgment || ""
      }) +
      (fullText ? "\n\n[판결문 전문]\n" + fullText : "");
    try {
      const oxOnly = await generateJsonWithModelFallback(gen, modelId, oxPrompt);
      oxQuizzes = sanitizeOxQuizzes(oxOnly && oxOnly.oxQuizzes, 5);
    } catch (e) {
      // OX 보강 실패 시 본문 요약은 유지
    }
  }
  if (oxQuizzes.length < 3) {
    oxQuizzes = buildFallbackOxQuizzes(o);
  }
  return {
    citation: clampStr(o.citation, 400),
    title: clampStr(o.title, 300),
    facts: clampStr(o.facts, MAX_STR),
    issues: clampStr(normalizeCaseIssuesText(o.issues), MAX_STR),
    judgment: clampStr(o.judgment, MAX_STR),
    oxQuizzes,
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

/**
 * 조문 본문 기반 OX 퀴즈(1~3개). 관리자 callable에서 사용.
 */
async function generateStatuteOxQuizzesGemini(statuteKey, heading, body, apiKey, modelId) {
  const gen = new GoogleGenerativeAI(apiKey);
  const sk = clampStr(statuteKey, 400).trim();
  const hd = clampStr(heading, 500).trim();
  const bd = clampStr(body, MAX_STR).trim();
  if (!bd) return [];
  const prompt =
    "당신은 한국 행정법 학습용 콘텐츠 편집자입니다.\n" +
    "아래 조문(식별자·표제·본문)을 읽고, 기초 이해를 확인하는 OX 퀴즈를 1~3개만 JSON으로 출력하세요.\n" +
    "키는 oxQuizzes 하나만. 각 원소는 statement/answer/explanation. answer는 boolean(true=O, false=X).\n" +
    "목적: 조문의 요건·효과·적용 범위를 문언에 맞게 이해했는지 확인.\n" +
    "규칙: 지문은 한 문장 위주로 짧게. 본문에 근거 없는 추측은 금지.\n" +
    "요건·효과·예외·금지되는 해석 등을 고르게 다룰 것.\n\n" +
    "[조문 식별자]\n" +
    JSON.stringify(sk) +
    "\n\n[표제]\n" +
    JSON.stringify(hd) +
    "\n\n[본문]\n" +
    JSON.stringify(bd.slice(0, 12000));
  const o = await generateJsonWithModelFallback(gen, modelId, prompt);
  let ox = sanitizeOxQuizzes(o.oxQuizzes, 3);
  if (ox.length < 1) {
    const oxPrompt =
      "동일 조문에 대해 OX 퀴즈 oxQuizzes만 1~3개 JSON으로 다시 출력하세요. 최소 1개는 반드시.\n" +
      "각 원소: statement/answer/explanation, answer는 boolean. 본문에 근거 없는 단정 금지.\n\n" +
      "[본문]\n" +
      JSON.stringify(bd.slice(0, 12000));
    try {
      const o2 = await generateJsonWithModelFallback(gen, modelId, oxPrompt);
      ox = sanitizeOxQuizzes(o2 && o2.oxQuizzes, 3);
    } catch (e) {
      // ignore
    }
  }
  if (ox.length < 1) {
    ox = buildFallbackOxQuizzesStatute({ statuteKey: sk, heading: hd, body: bd });
  }
  return ox;
}

async function generateStatuteEntryFromWebGemini(statuteKey, headingHint, bodyHint, apiKey, modelId) {
  const gen = new GoogleGenerativeAI(apiKey);
  const sk = clampStr(statuteKey, 400).trim();
  const headingRaw = clampStr(headingHint, 500).trim();
  const bodyRaw = clampStr(bodyHint, MAX_STR).trim();
  const webInfo = await fetchStatuteWebContext(sk);
  const webCtx = String(webInfo && webInfo.text ? webInfo.text : "").trim();
  const prompt =
    "당신은 한국 행정법 조문사전 편집자입니다.\n" +
    "아래 조문 키를 기준으로 조문사전용 JSON을 출력하세요. 반드시 JSON만 출력.\n" +
    "키: heading, body, appliedRules, subordinateRules, examPoint, sourceNote, oxQuizzes.\n" +
    "body는 반드시 '조문 원문(가능한 한 원문 그대로)' 중심으로 작성하고, 요약/해설문 위주로 쓰지 마세요.\n" +
    "appliedRules에는 준용 규정만, subordinateRules에는 하위법령(시행령/시행규칙)만, examPoint에는 수험 포인트만 분리해 쓰세요.\n" +
    "위 3개 섹션 내용을 body에 중복해서 길게 넣지 마세요.\n" +
    "불확실한 내용은 '확인 필요'로 표시하고 단정 금지.\n" +
    "oxQuizzes는 1~3개, statement/answer/explanation 형식.\n\n" +
    "[조문 키]\n" +
    JSON.stringify(sk) +
    (headingRaw ? "\n\n[관리자 입력 표제 힌트]\n" + JSON.stringify(headingRaw) : "") +
    (bodyRaw ? "\n\n[관리자 입력 본문 힌트]\n" + JSON.stringify(bodyRaw.slice(0, 12000)) : "") +
    (webCtx ? "\n\n[자동 수집 법령검색 텍스트]\n" + webCtx : "");

  const o = await generateJsonWithModelFallback(gen, modelId, prompt);
  const heading = clampStr(o.heading || headingRaw || sk, 500);
  const bodyRawOut = clampStr(o.body || bodyRaw || "", MAX_STR);
  const appliedRulesRaw = clampStr(o.appliedRules || "", 3000);
  const subordinateRulesRaw = clampStr(o.subordinateRules || "", 3000);
  const examPointRaw = clampStr(o.examPoint || "", 3000);

  // 모델이 섹션을 body에 몰아 쓰는 경우를 대비해 서버에서 강제 분리한다.
  function splitSectionsFromBody(bodyText) {
    const lines = String(bodyText || "")
      .replace(/\r\n/g, "\n")
      .split("\n")
      .map((x) => String(x || "").trim());
    const kept = [];
    const applied = [];
    const sub = [];
    const exam = [];
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i];
      if (!ln) continue;
      const low = ln.toLowerCase();
      const isApplied = ln.includes("준용") || low.includes("appliedrules");
      const isSub =
        ln.includes("하위법령") || ln.includes("시행령") || ln.includes("시행규칙") || low.includes("subordinaterules");
      const isExam = ln.includes("수험 포인트") || ln.includes("수험포인트") || low.includes("exampoint");
      if (isApplied) {
        applied.push(ln.replace(/^(준용\s*규정|appliedrules)\s*[:：]?\s*/i, "").trim());
        continue;
      }
      if (isSub) {
        sub.push(ln.replace(/^(하위법령|subordinaterules)\s*[:：]?\s*/i, "").trim());
        continue;
      }
      if (isExam) {
        exam.push(ln.replace(/^(수험\s*포인트|수험포인트|exampoint)\s*[:：]?\s*/i, "").trim());
        continue;
      }
      kept.push(ln);
    }
    return {
      body: clampStr(kept.join("\n").trim(), MAX_STR),
      appliedRules: clampStr(applied.filter(Boolean).join("\n").trim(), 3000),
      subordinateRules: clampStr(sub.filter(Boolean).join("\n").trim(), 3000),
      examPoint: clampStr(exam.filter(Boolean).join("\n").trim(), 3000)
    };
  }

  const split = splitSectionsFromBody(bodyRawOut);
  const body = split.body || bodyRawOut;
  const appliedRules = split.appliedRules || appliedRulesRaw;
  const subordinateRules = split.subordinateRules || subordinateRulesRaw;
  const examPoint = split.examPoint || examPointRaw;
  const sourceNote = clampStr(
    o.sourceNote ||
      "내부 자동 생성: 법령 검색 텍스트를 참고해 작성됨. 최신 조문은 국가법령정보센터에서 재확인 필요.",
    500
  );
  let oxQuizzes = sanitizeOxQuizzes(o.oxQuizzes, 3);
  if (oxQuizzes.length < 1 && body) {
    oxQuizzes = buildFallbackOxQuizzesStatute({
      statuteKey: sk,
      heading,
      body
    });
  }
  return {
    statuteKey: sk,
    heading,
    body,
    appliedRules,
    subordinateRules,
    examPoint,
    sourceNote,
    oxQuizzes,
    fetchSummary: {
      attempted: webInfo && webInfo.attempted ? webInfo.attempted : 0,
      succeeded: webInfo && webInfo.succeeded ? webInfo.succeeded : 0,
      triedUrls: webInfo && Array.isArray(webInfo.triedUrls) ? webInfo.triedUrls : [],
      results: webInfo && Array.isArray(webInfo.results) ? webInfo.results : []
    }
  };
}

function firestoreToTermPayload(d) {
  return {
    term: d.term,
    aliases: d.aliases || [],
    definition: d.definition || "",
    oxQuizzes: sanitizeOxQuizzes(d.oxQuizzes, 3)
  };
}

function firestoreToCasePayload(d) {
  return {
    citation: d.citation || "",
    title: d.title || "",
    facts: d.facts || "",
    issues: normalizeCaseIssuesText(d.issues || ""),
    judgment: d.judgment || "",
    caseFullText: d.caseFullText || "",
    oxQuizzes: sanitizeOxQuizzes(d.oxQuizzes, 5),
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
  const caseFullText = String((request.data && request.data.caseFullText) || "").trim().slice(0, 120000);

  const asCase = isLikelyCaseTag(raw);
  const col = asCase ? "hanlaw_dict_cases" : "hanlaw_dict_terms";
  const slug = makeSlug(raw);
  const ref = db().collection(col).doc(slug);

  const forceRegenerateFromFullText = asCase && !!caseFullText;
  const existing = await ref.get();
  if (existing.exists && !forceRegenerateFromFullText) {
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
      ? await generateCaseWithGemini(raw, apiKey, modelId, learnerNick, caseFullText)
      : await generateTermWithGemini(raw, apiKey, modelId, learnerNick);

    if (asCase) {
      if (caseFullText) payload.caseFullText = caseFullText;
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

    const stagingSnap = await stagingRef.get();
    const stagingData = stagingSnap.data() || {};
    const stagingVersion = parseInt(stagingData.version, 10);
    const resolvedVersion = Number.isFinite(stagingVersion) ? stagingVersion : 1;

    return {
      ok: true,
      source: "generated-pending-review",
      kind: asCase ? "case" : "term",
      record: asCase ? firestoreToCasePayload(payload) : firestoreToTermPayload(payload),
      stagingDocId: slug,
      stagingVersion: resolvedVersion
    };
  } catch (e) {
    console.error("dictionaryGemini error", e);
    throw new HttpsError(
      "internal",
      (e && e.message) || "AI 생성 중 오류가 발생했습니다."
    );
  }
});

module.exports = {
  generateOrGetDictionaryEntry,
  generateStatuteOxQuizzesGemini,
  generateStatuteEntryFromWebGemini,
  makeSlug,
  normTag,
  isLikelyCaseTag
};
