"use strict";

const https = require("https");
const { URL } = require("url");

const LAW_API_ORIGIN = "https://www.law.go.kr";
const LAW_API_VPC = {
  vpcConnector: "fn-connector-seoul",
  vpcConnectorEgressSettings: "ALL_TRAFFIC"
};

function getLawGoKrOc() {
  return String(process.env.LAW_GO_KR_OC || "").trim();
}

function normalizeArray(val) {
  if (!val) return [];
  return Array.isArray(val) ? val : [val];
}

function parseStatuteKey(statuteKey) {
  const raw = String(statuteKey || "").trim();
  if (!raw) return null;
  const parts = raw.split("|");
  const lawName = String(parts[0] || "").trim();
  const article = String(parts[1] || "").trim();
  const articleSub = String(parts[2] || "").trim();
  if (!lawName || !article) return null;
  return { lawName, article, articleSub: articleSub || "" };
}

function fetchUrlJson(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          "user-agent":
            "Mozilla/5.0 (compatible; HanlawQ/1.0; +https://adminlawq.ellution.co.kr)",
          accept: "application/json"
        }
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          if (!res.statusCode || res.statusCode >= 400) {
            reject(new Error("HTTP " + (res.statusCode || "?") + ": " + text.slice(0, 200)));
            return;
          }
          try {
            resolve(JSON.parse(text));
          } catch (e) {
            reject(new Error("JSON 파싱 실패: " + String((e && e.message) || e)));
          }
        });
      }
    );
    req.setTimeout(timeoutMs || 15000, () => req.destroy(new Error("timeout")));
    req.on("error", (e) => reject(e));
  });
}

function buildLawApiUrl(path, params) {
  const u = new URL(path, LAW_API_ORIGIN);
  Object.keys(params || {}).forEach((k) => {
    const v = params[k];
    if (v != null && v !== "") u.searchParams.set(k, String(v));
  });
  return u.toString();
}

async function lawApiGet(path, params) {
  const oc = getLawGoKrOc();
  if (!oc) {
    throw new Error("서버에 LAW_GO_KR_OC가 설정되지 않았습니다.");
  }
  const url = buildLawApiUrl(path, Object.assign({ OC: oc }, params || {}));
  const data = await fetchUrlJson(url, 20000);
  if (data && typeof data.result === "string" && /검증에 실패/.test(data.result)) {
    throw new Error(String(data.msg || data.result));
  }
  if (data && data.resultCode && data.resultCode !== "00") {
    throw new Error(String(data.resultMsg || "law.go.kr API 오류"));
  }
  return { url, data };
}

function normalizeLawName(s) {
  return String(s || "").replace(/\s+/g, "").trim();
}

function pickBestLawRow(lawName, searchData) {
  const rows = normalizeArray(searchData && searchData.LawSearch && searchData.LawSearch.law);
  if (!rows.length) return null;
  const target = normalizeLawName(lawName);
  let exact = null;
  let contains = null;
  for (let i = 0; i < rows.length; i++) {
    const name = normalizeLawName(rows[i].법령명한글);
    if (name === target) exact = rows[i];
    if (!contains && name.includes(target)) contains = rows[i];
  }
  return exact || contains || rows[0];
}

function getJoUnits(lawJson) {
  const jo = lawJson && lawJson.법령 && lawJson.법령.조문 && lawJson.법령.조문.조문단위;
  return normalizeArray(jo);
}

function articleTitlePattern(article, articleSub) {
  const sub = articleSub ? "의" + articleSub : "";
  return new RegExp("^제\\s*" + article + "\\s*조" + sub + "(?:\\(|\\s|제)");
}

function matchArticleUnit(units, article, articleSub) {
  const num = String(article || "").trim();
  const sub = String(articleSub || "").trim();
  const pat = articleTitlePattern(num, sub);
  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    if (String(u.조문여부 || "") !== "조문") continue;
    if (String(u.조문번호 || "").trim() !== num) continue;
    const content = String(u.조문내용 || "").trim();
    if (!pat.test(content)) continue;
    if (sub) {
      if (!content.includes("제" + num + "조의" + sub)) continue;
    } else if (/제\d+조의\d+/.test(content.split("(")[0] || content)) {
      continue;
    }
    return u;
  }
  return null;
}

function formatHangText(hangNode) {
  const rows = normalizeArray(hangNode);
  const lines = [];
  for (let i = 0; i < rows.length; i++) {
    const h = rows[i];
    const hoNo = String(h.호번호 || "").trim();
    let body = String(h.항내용 || h.호내용 || "").trim();
    if (body && hoNo) {
      const hoLabel = parseInt(hoNo, 10);
      if (Number.isFinite(hoLabel) && hoLabel >= 1 && !/^\d+\.\s/.test(body)) {
        body = hoLabel + ".  " + body;
      }
    }
    if (body) lines.push(body);
    if (h.호) {
      const hoLines = formatHangText(h.호);
      lines.push.apply(lines, hoLines);
    }
  }
  return lines;
}

/** <개정 …>, [본조신설 …] 등 법령 개정 메타 표기 제거 */
function stripLawRevisionMeta(text) {
  return String(text || "")
    .replace(/<[^>\n]{0,240}>/g, "")
    .replace(
      /\[(?:본조)?(?:신설|개정|전문개정|제목개정|제개정|삭제|타법개정|타법)[^\]\n]{0,240}\]/gi,
      ""
    );
}

/** API·3단비교 평문을 읽기 좋은 줄바꿈(항·호) 구조로 정리 */
function normalizeLawStatutePlainText(text) {
  let s = String(text || "").replace(/\r\n/g, "\n").trim();
  if (!s) return "";
  s = stripLawRevisionMeta(s);

  s = s.replace(/([①-⑳])(?!\s)/g, "$1 ");
  s = s.replace(/([①-⑳])/g, "\n$1 ");

  s = s.replace(/\.(\d{1,2})\.\s+(?=[가-힣「『])/g, (match, num, offset, full) => {
    const before = full.slice(Math.max(0, offset - 10), offset);
    if (/\d{4}\.$/.test(before)) return match;
    return ".\n" + num + ". ";
  });

  s = s.replace(/([가-힣])(\d{1,2})\.\s+(?=[가-힣「『])/g, "$1\n$2. ");

  s = s.replace(/\n{3,}/g, "\n\n").trim();
  return s;
}

function formatArticleBody(unit) {
  const head = String(unit.조문내용 || "").trim();
  const hang = formatHangText(unit.항);
  let out;
  if (!hang.length) out = head;
  else if (head && /제\d+조/.test(head) && head.length > 40) out = [head].concat(hang).join("\n");
  else out = [head].concat(hang).filter(Boolean).join("\n");
  return normalizeLawStatutePlainText(out);
}

function buildHeading(lawMeta, unit, parsed) {
  const lawTitle = String(
    (lawMeta && lawMeta.기본정보 && lawMeta.기본정보.법령명_한글) || parsed.lawName
  ).trim();
  const joTitle = String(unit.조문제목 || "").trim();
  let label =
    "제" +
    parsed.article +
    "조" +
    (parsed.articleSub ? "의" + parsed.articleSub : "");
  if (joTitle) label += "(" + joTitle + ")";
  return lawTitle + " " + label;
}

async function searchLawByName(lawName) {
  const { url, data } = await lawApiGet("/DRF/lawSearch.do", {
    target: "law",
    type: "JSON",
    query: lawName,
    display: 20
  });
  const row = pickBestLawRow(lawName, data);
  if (!row) {
    return { ok: false, reason: "법령 검색 결과 없음", searchUrl: url, row: null };
  }
  return {
    ok: true,
    searchUrl: url,
    row,
    mst: String(row.법령일련번호 || "").trim(),
    lawId: String(row.법령ID || "").trim(),
    lawNameKo: String(row.법령명한글 || "").trim(),
    lawType: String(row.법령구분명 || "").trim(),
    effectiveDate: String(row.시행일자 || "").trim()
  };
}

async function searchLawRowsByQuery(query, display) {
  const { data } = await lawApiGet("/DRF/lawSearch.do", {
    target: "law",
    type: "JSON",
    query: query,
    display: display || 20
  });
  return normalizeArray(data && data.LawSearch && data.LawSearch.law);
}

function getBaseLawName(lawNameKo) {
  return String(lawNameKo || "")
    .replace(/\s*시행규칙\s*$/g, "")
    .replace(/\s*시행령\s*$/g, "")
    .replace(/\s+/g, "")
    .trim();
}

function isSubordinateLawName(lawNameKo) {
  return /시행령|시행규칙/.test(String(lawNameKo || ""));
}

function subordinateLawKind(lawNameKo) {
  const name = String(lawNameKo || "");
  if (/시행규칙/.test(name)) return "시행규칙";
  if (/시행령/.test(name)) return "시행령";
  return null;
}

function pickSubordinateLawRow(rows, kind) {
  const baseRows = normalizeArray(rows);
  let best = null;
  for (let i = 0; i < baseRows.length; i++) {
    const name = String(baseRows[i].법령명한글 || "").trim();
    if (kind === "시행규칙" && /시행규칙/.test(name)) {
      best = baseRows[i];
      break;
    }
    if (kind === "시행령" && /시행령/.test(name) && !/시행규칙/.test(name)) {
      best = baseRows[i];
      break;
    }
  }
  return best;
}

async function findSubordinateLawRows(baseLawName) {
  const base = getBaseLawName(baseLawName);
  if (!base || isSubordinateLawName(baseLawName)) return [];
  const out = [];
  const decree = pickSubordinateLawRow(await searchLawRowsByQuery(base + " 시행령", 15), "시행령");
  const rule = pickSubordinateLawRow(await searchLawRowsByQuery(base + " 시행규칙", 15), "시행규칙");
  if (decree) out.push(decree);
  if (rule) out.push(rule);
  return out;
}

function mergeLawRowsUnique(primaryRows, extraRows) {
  const merged = normalizeArray(primaryRows).slice();
  const seen = new Set();
  for (let i = 0; i < merged.length; i++) {
    seen.add(normalizeLawName(merged[i].법령명한글));
  }
  const extras = normalizeArray(extraRows);
  for (let j = 0; j < extras.length; j++) {
    const key = normalizeLawName(extras[j].법령명한글);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(extras[j]);
  }
  return merged;
}

async function expandLawRowsWithSubordinates(lawRows, baseLawHint) {
  const bases = new Set();
  const hintBase = getBaseLawName(baseLawHint);
  if (hintBase) bases.add(hintBase);
  const rows = normalizeArray(lawRows);
  for (let i = 0; i < rows.length; i++) {
    const name = String(rows[i].법령명한글 || "").trim();
    if (!name || isSubordinateLawName(name)) continue;
    bases.add(getBaseLawName(name));
  }
  let merged = rows.slice();
  for (const base of bases) {
    if (!base) continue;
    merged = mergeLawRowsUnique(merged, await findSubordinateLawRows(base));
  }
  return merged;
}

async function fetchLawBodyJson(mst) {
  const mstStr = String(mst || "").trim();
  if (!mstStr) throw new Error("법령일련번호(MST)가 필요합니다.");
  const { url, data } = await lawApiGet("/DRF/lawService.do", {
    target: "law",
    MST: mstStr,
    type: "JSON"
  });
  return { bodyUrl: url, lawJson: data };
}

/**
 * statuteKey 예: 행정소송법|12|
 * opts.includeSubordinates — 상위법령 조회 시 위임조문 3단비교 API로 연결된 시행령·시행규칙도 함께 조회(기본 true)
 */
async function fetchStatuteArticleOpenApi(statuteKey, opts) {
  opts = opts || {};
  const includeSubordinates = opts.includeSubordinates !== false;
  const parsed = parseStatuteKey(statuteKey);
  if (!parsed) {
    throw new Error("statuteKey 형식이 올바르지 않습니다. 예: 행정소송법|12|");
  }
  const search = await searchLawByName(parsed.lawName);
  if (!search.ok || !search.mst) {
    return {
      ok: false,
      statuteKey,
      parsed,
      reason: search.reason || "법령을 찾지 못했습니다.",
      searchUrl: search.searchUrl
    };
  }
  const body = await fetchLawBodyJson(search.mst);
  const units = getJoUnits(body.lawJson);
  const unit = matchArticleUnit(units, parsed.article, parsed.articleSub);
  if (!unit) {
    return {
      ok: false,
      statuteKey,
      parsed,
      reason:
        "법령 본문에서 제" +
        parsed.article +
        "조" +
        (parsed.articleSub ? "의" + parsed.articleSub : "") +
        "를 찾지 못했습니다.",
      lawNameKo: search.lawNameKo,
      mst: search.mst,
      searchUrl: search.searchUrl,
      bodyUrl: body.bodyUrl
    };
  }
  const articleBody = formatArticleBody(unit);
  const heading = buildHeading(body.lawJson && body.lawJson.법령, unit, parsed);
  const eff = search.effectiveDate;
  const effLabel = eff && eff.length === 8 ? eff.slice(0, 4) + "." + eff.slice(4, 6) + "." + eff.slice(6, 8) : eff;
  const result = {
    ok: true,
    statuteKey,
    parsed,
    lawNameKo: search.lawNameKo,
    lawType: search.lawType,
    mst: search.mst,
    effectiveDate: search.effectiveDate,
    heading,
    body: articleBody,
    sourceNote:
      "국가법령정보 Open API 원문 (" +
      search.lawNameKo +
      (effLabel ? ", 시행 " + effLabel : "") +
      "). 개정 여부는 law.go.kr에서 재확인하세요.",
    searchUrl: search.searchUrl,
    bodyUrl: body.bodyUrl,
    lawGoKrWebUrl:
      "https://www.law.go.kr/법령/" + encodeURIComponent(search.lawNameKo || parsed.lawName)
  };

  if (includeSubordinates && !isSubordinateLawName(search.lawNameKo)) {
    const subordinateArticles = await fetchSubordinateArticlesForParent(
      parsed,
      search.lawNameKo,
      search.mst
    );
    if (subordinateArticles.length) result.subordinateArticles = subordinateArticles;
  }

  return result;
}

function padThdCmpArticleNo(article) {
  const n = parseInt(String(article || "").trim(), 10);
  if (!Number.isFinite(n) || n < 1) return "";
  return String(n).padStart(4, "0");
}

function padThdCmpArticleSub(articleSub) {
  const raw = String(articleSub || "").trim();
  if (!raw) return "00";
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return "00";
  return String(n).padStart(2, "0");
}

async function fetchThdCmpDelegatedComparison(mst) {
  const mstStr = String(mst || "").trim();
  if (!mstStr) throw new Error("법령일련번호(MST)가 필요합니다.");
  const { url, data } = await lawApiGet("/DRF/lawService.do", {
    target: "thdCmp",
    knd: 2,
    MST: mstStr,
    type: "JSON"
  });
  const root = data.LspttnThdCmpLawXService || data.ThdCmpService || data;
  const cmp = (root && root.위임조문삼단비교) || root || {};
  return {
    thdCmpUrl: url,
    entries: normalizeArray(cmp.법률조문)
  };
}

function findThdCmpLawArticleEntry(entries, article, articleSub) {
  const num = padThdCmpArticleNo(article);
  const sub = padThdCmpArticleSub(articleSub);
  if (!num) return null;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (String(e.조번호 || "") !== num) continue;
    if (String(e.조가지번호 || "00") !== sub) continue;
    return e;
  }
  return null;
}

function formatThdCmpJoHeading(lawNameKo, joNode) {
  const title = String((joNode && joNode.조제목) || "").trim();
  const law = String(lawNameKo || (joNode && joNode.법령명) || "").trim();
  if (law && title) return law + " " + title;
  return title || law || "";
}

function thdCmpNodeToSubordinateArticle(node, kind) {
  if (!node || typeof node !== "object") return null;
  const lawNameKo = String(node.법령명 || "").trim();
  const articleNo = parseInt(String(node.조번호 || "0"), 10);
  if (!Number.isFinite(articleNo) || articleNo < 1) return null;
  const subRaw = String(node.조가지번호 || "00").replace(/^0+/, "");
  const articleSub = subRaw && subRaw !== "0" ? subRaw : "";
  const lawKeyName = lawNameKo.replace(/\s+/g, "");
  if (!lawKeyName) return null;
  const statuteKey = lawKeyName + "|" + String(articleNo) + "|" + articleSub;
  const heading = formatThdCmpJoHeading(lawNameKo, node);
  const body = normalizeLawStatutePlainText(String(node.조내용 || "").trim());
  if (!body && !heading) return null;
  return {
    kind: kind || subordinateLawKind(lawNameKo) || "하위법령",
    statuteKey,
    heading,
    body,
    lawNameKo,
    lawType: kind || subordinateLawKind(lawNameKo) || "",
    sourceNote: "국가법령정보 위임조문 3단비교 Open API 원문",
    _fromThdCmp: true
  };
}

/** 법률 조문에 위임·연결된 시행령·시행규칙 조문(조번이 다를 수 있음) */
async function fetchSubordinateArticlesForParent(parentParsed, parentLawNameKo, parentMst) {
  if (isSubordinateLawName(parentLawNameKo)) return [];
  let entries = [];
  try {
    const cmp = await fetchThdCmpDelegatedComparison(parentMst);
    entries = cmp.entries;
  } catch (e) {
    return [];
  }
  const hit = findThdCmpLawArticleEntry(
    entries,
    parentParsed.article,
    parentParsed.articleSub
  );
  if (!hit) return [];
  const out = [];
  const decree = thdCmpNodeToSubordinateArticle(hit.시행령조문, "시행령");
  if (decree) out.push(decree);
  const rule = thdCmpNodeToSubordinateArticle(hit.시행규칙조문, "시행규칙");
  if (rule) out.push(rule);
  normalizeArray(hit.시행규칙조문목록).forEach((node) => {
    const r = thdCmpNodeToSubordinateArticle(node, "시행규칙");
    if (r) out.push(r);
  });
  return out;
}

function normalizeCaseNumberToken(citation) {
  const compact = String(citation || "")
    .replace(/\s/g, "")
    .replace(/^판례/i, "");
  const hm = compact.match(/(\d{4}헌[가바마]\d+)/i);
  if (hm) return hm[1];
  const m = compact.match(/(\d{2,4})([가-힣]{1,3})(\d{2,7})/);
  if (m) return m[1] + m[2] + m[3];
  return "";
}

function normalizePrecRows(searchData) {
  return normalizeArray(searchData && searchData.PrecSearch && searchData.PrecSearch.prec);
}

function pickBestPrecRow(token, rows) {
  const t = String(token || "").replace(/\s/g, "");
  if (!rows.length) return null;
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i].사건번호 || "").replace(/\s/g, "") === t) return rows[i];
  }
  return rows[0];
}

function htmlToPlain(html) {
  return String(html || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\u2018|\u2019/g, "'")
    .replace(/\u201c|\u201d/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function formatYmdLabel(ymd) {
  const s = String(ymd || "").replace(/\D/g, "");
  if (s.length !== 8) return String(ymd || "").trim();
  return s.slice(0, 4) + "." + s.slice(4, 6) + "." + s.slice(6, 8);
}

async function searchPrecedentByCaseNumber(caseToken, opts) {
  const token = String(caseToken || "").trim();
  if (!token) {
    return { ok: false, reason: "사건번호를 파싱하지 못했습니다.", searchUrl: "" };
  }
  const params = {
    target: "prec",
    type: "JSON",
    nb: token,
    display: 20
  };
  if (opts && opts.datSrcNm) params.datSrcNm = opts.datSrcNm;
  const { url, data } = await lawApiGet("/DRF/lawSearch.do", params);
  const rows = normalizePrecRows(data);
  const totalCnt = parseInt((data.PrecSearch && data.PrecSearch.totalCnt) || "0", 10) || 0;
  if (!rows.length && totalCnt < 1) {
    const fallback = await lawApiGet("/DRF/lawSearch.do", {
      target: "prec",
      type: "JSON",
      query: token,
      display: 20
    });
    const fbRows = normalizePrecRows(fallback.data);
    const row = pickBestPrecRow(token, fbRows);
    if (!row) {
      return {
        ok: false,
        reason: "국가법령정보센터에서 해당 사건번호 판례를 찾지 못했습니다.",
        searchUrl: url,
        caseToken: token
      };
    }
    return {
      ok: true,
      searchUrl: fallback.url,
      row,
      caseToken: token,
      matchedBy: "query"
    };
  }
  const row = pickBestPrecRow(token, rows);
  if (!row) {
    return {
      ok: false,
      reason: "판례 검색 결과를 해석하지 못했습니다.",
      searchUrl: url,
      caseToken: token
    };
  }
  return { ok: true, searchUrl: url, row, caseToken: token, matchedBy: "nb" };
}

async function fetchPrecedentBodyJson(precId) {
  const id = String(precId || "").trim();
  if (!id) throw new Error("판례일련번호(ID)가 필요합니다.");
  const { url, data } = await lawApiGet("/DRF/lawService.do", {
    target: "prec",
    ID: id,
    type: "JSON"
  });
  const svc = data && data.PrecService ? data.PrecService : null;
  if (!svc) {
    throw new Error("판례 본문 응답 형식이 올바르지 않습니다.");
  }
  return { bodyUrl: url, prec: svc };
}

/**
 * citation 예: 2016두31616, 대법원 2018. 6. 28. 선고 2018두54752 판결
 */
async function fetchCasePrecedentOpenApi(citation) {
  const rawCitation = String(citation || "").trim();
  const caseToken = normalizeCaseNumberToken(rawCitation);
  if (!caseToken) {
    throw new Error(
      "사건번호 형식을 인식하지 못했습니다. 예: 2016두31616, 2018헌마123"
    );
  }
  let search = await searchPrecedentByCaseNumber(caseToken, { datSrcNm: "대법원" });
  if (!search.ok && /헌[가바마]/.test(caseToken)) {
    search = await searchPrecedentByCaseNumber(caseToken, {});
  }
  if (!search.ok) {
    return Object.assign({ ok: false, citation: rawCitation, caseToken }, search);
  }
  const row = search.row;
  const precId = String(row.판례일련번호 || "").trim();
  if (!precId) {
    return {
      ok: false,
      citation: rawCitation,
      caseToken,
      reason: "판례일련번호를 찾지 못했습니다.",
      searchUrl: search.searchUrl
    };
  }
  const body = await fetchPrecedentBodyJson(precId);
  const p = body.prec;
  const caseNo = String(p.사건번호 || row.사건번호 || caseToken).trim();
  const court = String(p.법원명 || row.법원명 || "").trim();
  const title = String(p.사건명 || row.사건명 || "").trim();
  const decided = formatYmdLabel(p.선고일자 || row.선고일자 || "");
  const fullText = htmlToPlain(p.판례내용 || "");
  const issues = htmlToPlain(p.판시사항 || "");
  const judgment = htmlToPlain(p.판결요지 || "");
  const sourceNote =
    "국가법령정보 Open API 판결문 (" +
    (court ? court + " " : "") +
    caseNo +
    (decided ? ", 선고 " + decided : "") +
    "). 최신 여부는 law.go.kr에서 재확인하세요.";
  return {
    ok: true,
    citation: rawCitation,
    caseToken: caseNo || caseToken,
    title,
    court,
    decidedDate: decided,
    precId,
    dataSource: String(row.데이터출처명 || p.데이터출처명 || "").trim(),
    caseFullText: fullText,
    issues,
    judgment,
    refStatutes: htmlToPlain(p.참조조문 || ""),
    sourceNote,
    searchUrl: search.searchUrl,
    bodyUrl: body.bodyUrl,
    matchedBy: search.matchedBy,
    lawGoKrWebUrl: "https://www.law.go.kr/precSc.do?query=" + encodeURIComponent(caseNo || caseToken)
  };
}

const CONSTITUTIONAL_CASE_RE = /^\d{4}헌[가바마]/i;

function isConstitutionalCaseToken(token) {
  return CONSTITUTIONAL_CASE_RE.test(String(token || "").replace(/\s/g, ""));
}

function isSupremeCourtName(courtName) {
  const c = String(courtName || "").trim();
  return /대법원/.test(c) && !/고등/.test(c);
}

/** 판결문 본문에서 인용·원심 등에 등장하는 사건번호 토큰 추출 */
function extractCaseTokensFromPrecedentText(text) {
  const seen = {};
  const out = [];
  const re = /\d{2,4}[가-힣]{1,3}\d{2,7}/g;
  const src = String(text || "");
  let m;
  while ((m = re.exec(src)) !== null) {
    const token = normalizeCaseNumberToken(m[0]);
    if (!token || seen[token]) continue;
    if (isConstitutionalCaseToken(token)) continue;
    seen[token] = true;
    out.push(token);
  }
  return out;
}

function precedentCourtRank(courtName) {
  const c = String(courtName || "");
  if (/고등법원|특허법원|특허심판원|회생법원/.test(c)) return 60;
  if (/행정법원|지방법원|가정법원|군사법원/.test(c)) return 40;
  if (/심판|위원회/.test(c)) return 35;
  return 30;
}

function isLowerCourtPrecedentMeta(courtName) {
  const c = String(courtName || "");
  if (!c) return false;
  if (isSupremeCourtName(c)) return false;
  if (/헌법재판소|헌재/.test(c)) return false;
  return true;
}

async function fetchPrecedentBriefByCaseToken(caseToken) {
  const token = normalizeCaseNumberToken(caseToken);
  if (!token || isConstitutionalCaseToken(token)) return null;
  let search;
  try {
    search = await searchPrecedentByCaseNumber(token, {});
  } catch (e) {
    return null;
  }
  if (!search.ok) return null;
  const precId = String(search.row.판례일련번호 || "").trim();
  if (!precId) return null;
  let body;
  try {
    body = await fetchPrecedentBodyJson(precId);
  } catch (e) {
    return null;
  }
  const p = body.prec;
  const court = String(p.법원명 || search.row.법원명 || "").trim();
  if (!isLowerCourtPrecedentMeta(court)) return null;
  const caseNo = String(p.사건번호 || search.row.사건번호 || token).trim();
  const fullText = htmlToPlain(p.판례내용 || "").trim();
  if (!fullText) return null;
  return {
    caseToken: caseNo || token,
    court,
    title: String(p.사건명 || search.row.사건명 || "").trim(),
    decidedDate: formatYmdLabel(p.선고일자 || search.row.선고일자 || ""),
    caseFullText: fullText,
    courtRank: precedentCourtRank(court)
  };
}

/**
 * 대법원 판결 primaryOut 기준: 본문에 등장하는 하급심 사건번호를 Open API로 추가 조회.
 * 헌법재판소 결정·비대법원 본건에는 적용하지 않습니다.
 */
async function fetchLowerCourtPrecedentsForCase(primaryOut, opts) {
  opts = opts || {};
  const maxFetch = typeof opts.maxFetch === "number" && opts.maxFetch > 0 ? opts.maxFetch : 4;
  if (!primaryOut || !primaryOut.ok) return [];
  const primaryToken = normalizeCaseNumberToken(primaryOut.caseToken || primaryOut.citation || "");
  if (!primaryToken || isConstitutionalCaseToken(primaryToken)) return [];
  if (!isSupremeCourtName(primaryOut.court)) return [];

  const tokens = extractCaseTokensFromPrecedentText(primaryOut.caseFullText || "");
  const candidates = tokens.filter((t) => t !== primaryToken);
  const fetched = [];
  const seenFetched = {};

  for (let i = 0; i < candidates.length && fetched.length < maxFetch; i++) {
    const want = candidates[i];
    if (seenFetched[want]) continue;
    seenFetched[want] = true;
    try {
      const row = await fetchPrecedentBriefByCaseToken(want);
      if (!row || !row.caseFullText) continue;
      const key = normalizeCaseNumberToken(row.caseToken) || want;
      if (key === primaryToken || seenFetched["got:" + key]) continue;
      seenFetched["got:" + key] = true;
      fetched.push(row);
    } catch (e) {
      // 개별 하급심 조회 실패는 건너뜀
    }
  }

  fetched.sort((a, b) => (b.courtRank || 0) - (a.courtRank || 0));
  return fetched.slice(0, maxFetch);
}

async function verifyLawGoKrApi() {
  const oc = getLawGoKrOc();
  if (!oc) {
    return { ok: false, reason: "LAW_GO_KR_OC 미설정" };
  }
  const { url, data } = await lawApiGet("/DRF/lawSearch.do", {
    target: "law",
    type: "JSON",
    query: "행정소송법",
    display: 1
  });
  const row = pickBestLawRow("행정소송법", data);
  return {
    ok: true,
    oc,
    searchUrl: url,
    sampleLaw: row ? row.법령명한글 : null,
    resultCode: data && data.LawSearch ? data.LawSearch.resultCode : null
  };
}

const LAW_NAME_ALIASES = [
  { alias: "행정소송법", law: "행정소송법" },
  { alias: "행정소송", law: "행정소송법" },
  { alias: "소송법", law: "행정소송법" },
  { alias: "행정절차법", law: "행정절차법" },
  { alias: "행정절차", law: "행정절차법" },
  { alias: "절차법", law: "행정절차법" },
  { alias: "지방자치법", law: "지방자치법" },
  { alias: "지방자치", law: "지방자치법" },
  { alias: "국가공무원법", law: "국가공무원법" },
  { alias: "공무원법", law: "국가공무원법" },
  { alias: "헌법", law: "헌법" },
  { alias: "민법", law: "민법" },
  { alias: "형법", law: "형법" }
];

const EXAM_STATUTE_LAW_PRIORITY = [
  "행정소송법",
  "행정절차법",
  "지방자치법",
  "헌법",
  "민법",
  "형법",
  "국가공무원법",
  "공무원임용령"
];

function parseStatuteSearchQuery(query) {
  const raw = String(query || "")
    .trim()
    .replace(/\s+/g, " ");
  if (!raw) {
    return { raw: "", article: null, articleSub: null, lawHint: "", keywords: "" };
  }
  let article = null;
  let articleSub = null;
  const artM = raw.match(/(?:제\s*)?(\d+)\s*조(?:의\s*(\d+))?/);
  if (artM) {
    article = artM[1];
    articleSub = artM[2] || null;
  }
  let tail = raw
    .replace(/(?:제\s*)?\d+\s*조(?:의\s*\d+)?(?:\s*제\s*\d+\s*항)?(?:\s*제\s*\d+\s*호)?/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  let lawHint = "";
  let keywords = tail;
  const tailNorm = normalizeLawName(tail);
  const aliases = LAW_NAME_ALIASES.slice().sort((a, b) => b.alias.length - a.alias.length);
  for (let i = 0; i < aliases.length; i++) {
    const aliasNorm = normalizeLawName(aliases[i].alias);
    if (tailNorm === aliasNorm || tailNorm.startsWith(aliasNorm) || tailNorm.includes(aliasNorm)) {
      lawHint = aliases[i].law;
      keywords = tail.replace(new RegExp(aliases[i].alias, "gi"), " ").replace(/\s+/g, " ").trim();
      break;
    }
  }
  if (!lawHint) {
    const lawM = tail.match(/([가-힣·]+(?:법|령|규칙))/);
    if (lawM) {
      lawHint = lawM[1].replace(/·/g, "");
      keywords = tail.replace(lawM[0], "").replace(/\s+/g, " ").trim();
    }
  }
  if (!lawHint && tailNorm === normalizeLawName("헌법")) {
    lawHint = "헌법";
    keywords = "";
  }
  if (!keywords && !lawHint) keywords = tail;
  return { raw, article, articleSub, lawHint, keywords: keywords || "" };
}

function scoreArticleCandidate(parsed, unit, lawKeyName, kwNorm) {
  const num = String(unit.조문번호 || "").trim();
  const title = String(unit.조문제목 || "").trim();
  const content = String(unit.조문내용 || "").trim();
  const contentHead = content.split("(")[0] || content;
  if (parsed.articleSub) {
    if (!content.includes("제" + num + "조의" + parsed.articleSub)) return null;
  } else if (parsed.article && /제\d+조의\d+/.test(contentHead)) {
    return null;
  }
  let score = 0;
  const reasons = [];
  if (parsed.article) {
    if (num !== String(parsed.article)) return null;
    score += 72;
    reasons.push("조문번호");
  }
  const blob = normalizeLawName(title + content);
  const kw = kwNorm || normalizeLawName(parsed.keywords || parsed.raw);
  if (kw.length >= 2) {
    if (blob.includes(kw)) {
      score += 58;
      reasons.push(title && normalizeLawName(title).includes(kw) ? "조문 제목" : "본문 키워드");
    } else if (!parsed.article) {
      return null;
    }
  } else if (!parsed.article) {
    return null;
  }
  if (score <= 0) return null;
  const priIdx = EXAM_STATUTE_LAW_PRIORITY.indexOf(lawKeyName);
  if (priIdx >= 0) score += Math.max(0, 18 - priIdx * 2);
  const subLawKind = subordinateLawKind(lawKeyName);
  if (subLawKind === "시행령") {
    score -= 4;
    reasons.push("시행령");
  } else if (subLawKind === "시행규칙") {
    score -= 6;
    reasons.push("시행규칙");
  }
  const sub = parsed.articleSub || "";
  const statuteKey = lawKeyName + "|" + num + "|" + sub;
  return {
    statuteKey,
    score,
    reason: reasons.join(" · "),
    snippet: title || content.slice(0, 120),
    articleNo: num,
    articleSub: sub,
    joTitle: title
  };
}

/**
 * 사용자 검색어로 법령·조문 후보를 유추합니다(국가법령 Open API).
 */
async function suggestStatuteArticlesOpenApi(query, opts) {
  const maxResults = Math.min(15, Math.max(1, parseInt((opts && opts.maxResults) || 10, 10) || 10));
  const parsed = parseStatuteSearchQuery(query);
  if (!parsed.raw) {
    return { ok: true, suggestions: [], parsed };
  }

  const suggestions = [];
  const seen = new Set();
  const kwNorm = normalizeLawName(parsed.keywords || "");

  function pushSuggestion(item) {
    const key = String(item.statuteKey || "").trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    suggestions.push(item);
  }

  let lawRows = [];
  if (parsed.lawHint) {
    const { data } = await lawApiGet("/DRF/lawSearch.do", {
      target: "law",
      type: "JSON",
      query: parsed.lawHint,
      display: 8
    });
    lawRows = normalizeArray(data && data.LawSearch && data.LawSearch.law).slice(0, 5);
  } else {
    const scanLaws = EXAM_STATUTE_LAW_PRIORITY.slice(0, 5);
    for (let i = 0; i < scanLaws.length; i++) {
      const search = await searchLawByName(scanLaws[i]);
      if (search.ok && search.row) lawRows.push(search.row);
    }
  }

  for (let ri = 0; ri < lawRows.length; ri++) {
    const row = lawRows[ri];
    const mst = String(row.법령일련번호 || "").trim();
    const lawNameKo = String(row.법령명한글 || "").trim();
    const lawKeyName = lawNameKo.replace(/\s+/g, "");
    if (!mst || !lawKeyName) continue;
    let body;
    try {
      body = await fetchLawBodyJson(mst);
    } catch (e) {
      continue;
    }
    const units = getJoUnits(body.lawJson);
    for (let ui = 0; ui < units.length; ui++) {
      const u = units[ui];
      if (String(u.조문여부 || "") !== "조문") continue;
      const hit = scoreArticleCandidate(parsed, u, lawKeyName, kwNorm);
      if (!hit) continue;
      const pseudoParsed = {
        lawName: lawKeyName,
        article: hit.articleNo,
        articleSub: hit.articleSub || null
      };
      pushSuggestion({
        statuteKey: hit.statuteKey,
        displayTitle: buildHeading(body.lawJson && body.lawJson.법령, u, pseudoParsed),
        snippet: hit.snippet,
        score: hit.score,
        reason: hit.reason,
        lawNameKo,
        source: "openApi"
      });
    }
  }

  suggestions.sort((a, b) => b.score - a.score || String(a.displayTitle).localeCompare(String(b.displayTitle), "ko"));
  return { ok: true, suggestions: suggestions.slice(0, maxResults), parsed };
}

module.exports = {
  LAW_API_VPC,
  getLawGoKrOc,
  parseStatuteKey,
  normalizeCaseNumberToken,
  fetchStatuteArticleOpenApi,
  fetchCasePrecedentOpenApi,
  searchLawByName,
  searchLawRowsByQuery,
  findSubordinateLawRows,
  fetchThdCmpDelegatedComparison,
  findThdCmpLawArticleEntry,
  thdCmpNodeToSubordinateArticle,
  getBaseLawName,
  isSubordinateLawName,
  subordinateLawKind,
  searchPrecedentByCaseNumber,
  fetchLawBodyJson,
  fetchPrecedentBodyJson,
  verifyLawGoKrApi,
  parseStatuteSearchQuery,
  suggestStatuteArticlesOpenApi,
  normalizeLawStatutePlainText,
  stripLawRevisionMeta,
  isConstitutionalCaseToken,
  isSupremeCourtName,
  extractCaseTokensFromPrecedentText,
  fetchLowerCourtPrecedentsForCase,
  fetchPrecedentBriefByCaseToken
};
