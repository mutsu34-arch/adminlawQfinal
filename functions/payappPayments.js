"use strict";

/**
 * @deprecated Firebase index.js에서 더 이상 require 하지 않습니다(PortOne 전환). 참고용 보관.
 *
 * PayApp (페이앱) — 질문권 + 구독
 *
 * 환경변수 (functions/.env):
 * - PAYAPP_USERID, PAYAPP_LINK_KEY, PAYAPP_LINK_VALUE
 * - PAYAPP_SHOP_NAME
 * 질문권: PAYAPP_KRW_Q1, PAYAPP_KRW_Q10 (기본 5000, 30000)
 * 엘리(AI) 질문권: PAYAPP_KRW_EQ10, PAYAPP_KRW_EQ20, PAYAPP_KRW_EQ30 (기본 5000, 10000, 15000) — var2 e10|e20|e30, 지갑 hanlaw_quiz_ai_wallet
 * 엘리 무제한 1개월: PAYAPP_KRW_ELLY_PASS_1M (기본 10000) — var2 sub_elly_pass_1m, hanlaw_members.ellyUnlimitedUntil
 * 구독: PAYAPP_KRW_SUB_MONTHLY, PAYAPP_KRW_SUB_YEARLY, PAYAPP_KRW_SUB_TWO_YEAR (기본 10000, 100000, 150000)
 * 비갱신(기간권): PAYAPP_KRW_NONRENEW_1M, PAYAPP_KRW_NONRENEW_3M, PAYAPP_KRW_NONRENEW_6M (기본 15000, 42750, 81000 — 3·6개월은 정가 대비 5%·10% 할인가)
 *
 * var2: 질문권 "1"|"10" · 엘리권 "e10"|"e20"|"e30" · 엘리 1개월권 "sub_elly_pass_1m" · 구독 "sub_monthly"|… · 비갱신 "sub_nonrenew_1m"|…
 *
 * 정기결제(PayApp rebill): 월 구독(monthly)만 https://docs.payapp.kr 정기결제 요청(JS) — PayApp.rebill()
 * · 연/2년 구독은 매뉴얼상 정기 주기가 Month·Week·Day뿐이라 기존 일회 결제(payrequest) 유지
 * · PAYAPP_REBILL_CYCLE_DAY (기본 15): 매월 결제일 1~31, 90=말일
 * · PAYAPP_REBILL_EXPIRE_YEARS (기본 10): 정기등록 만료일(오늘+년, KST yyyy-mm-dd)
 * 정기 해지: cancelPayAppRebill — 페이앱 cmd=rebillCancel (userid, rebill_no, linkkey)
 * 결제통보(payappQuestionFeedback): pay_state=1(요청 접수)은 금액 검증 전에 HTTP 200 + 본문 SUCCESS 필수. 미이행 시 에러 70080(고객사 응답 실패).
 * 판매자: 페이앱 관리자(PC)·설정·연동정보(linkkey/linkval) 일치, 정기결제 API는 가맹 계약에 따라 제공(판매자 이용가이드·고객센터 1800-3772).
 */

const querystring = require("querystring");
const https = require("https");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineString } = require("firebase-functions/params");
const functionsV1 = require("firebase-functions/v1");

/** 배포 시 .env / Cloud 환경변수와 동기화 (process.env만 쓸 때 누락되는 경우 방지) */
const payappUserIdParam = defineString("PAYAPP_USERID", { default: "" });
const payappLinkKeyParam = defineString("PAYAPP_LINK_KEY", { default: "" });
const payappLinkValParam = defineString("PAYAPP_LINK_VALUE", { default: "" });

let _db;
function db() {
  if (!_db) _db = getFirestore();
  return _db;
}

const BATCH_VALID_MS = 365 * 24 * 60 * 60 * 1000;
const ELLY_BATCH_VALID_MS = 30 * 24 * 60 * 60 * 1000;
const REGION = "asia-northeast3";

function kstYearMonth(now = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit"
  });
  const parts = fmt.formatToParts(now);
  const y = parts.find((p) => p.type === "year").value;
  const m = parts.find((p) => p.type === "month").value;
  return y + "-" + m;
}

function normalizeWallet(data, periodKey) {
  const w = data || {};
  let monthlyUsed = w.monthlyUsed || 0;
  let batches = Array.isArray(w.batches) ? w.batches.slice() : [];
  if (w.monthlyPeriodKey !== periodKey) {
    monthlyUsed = 0;
  }
  return {
    monthlyPeriodKey: periodKey,
    monthlyUsed,
    batches
  };
}

function expectedKrwForPack(pack) {
  if (pack === 10) {
    return Math.max(1000, parseInt(process.env.PAYAPP_KRW_Q10 || "30000", 10) || 30000);
  }
  return Math.max(1000, parseInt(process.env.PAYAPP_KRW_Q1 || "5000", 10) || 5000);
}

function expectedKrwForEllyPack(pack) {
  if (pack === 10) {
    return Math.max(1000, parseInt(process.env.PAYAPP_KRW_EQ10 || "5000", 10) || 5000);
  }
  if (pack === 20) {
    return Math.max(1000, parseInt(process.env.PAYAPP_KRW_EQ20 || "10000", 10) || 10000);
  }
  if (pack === 30) {
    return Math.max(1000, parseInt(process.env.PAYAPP_KRW_EQ30 || "15000", 10) || 15000);
  }
  // 레거시 결제 건 정산 호환
  if (pack === 50) {
    return Math.max(1000, parseInt(process.env.PAYAPP_KRW_EQ50 || "20000", 10) || 20000);
  }
  if (pack === 100) {
    return Math.max(1000, parseInt(process.env.PAYAPP_KRW_EQ100 || "30000", 10) || 30000);
  }
  return 0;
}

function expectedKrwForEllyPassOneMonth() {
  return Math.max(1000, parseInt(process.env.PAYAPP_KRW_ELLY_PASS_1M || "10000", 10) || 10000);
}

function expectedKrwForSubPlan(plan) {
  const m = Math.max(1000, parseInt(process.env.PAYAPP_KRW_SUB_MONTHLY || "10000", 10) || 10000);
  const y = Math.max(1000, parseInt(process.env.PAYAPP_KRW_SUB_YEARLY || "100000", 10) || 100000);
  const t = Math.max(1000, parseInt(process.env.PAYAPP_KRW_SUB_TWO_YEAR || "150000", 10) || 150000);
  if (plan === "monthly") return m;
  if (plan === "yearly") return y;
  if (plan === "twoYear") return t;
  return 0;
}

function expectedKrwForNonRenewMonths(months) {
  const k1 = Math.max(1000, parseInt(process.env.PAYAPP_KRW_NONRENEW_1M || "15000", 10) || 15000);
  const k3 = Math.max(1000, parseInt(process.env.PAYAPP_KRW_NONRENEW_3M || "42750", 10) || 42750);
  const k6 = Math.max(1000, parseInt(process.env.PAYAPP_KRW_NONRENEW_6M || "81000", 10) || 81000);
  if (months === 1) return k1;
  if (months === 3) return k3;
  if (months === 6) return k6;
  return 0;
}

function packFromVar2(v) {
  const s = String(v || "").trim();
  if (s === "10" || s === "10건") return 10;
  if (s === "1" || s === "1건") return 1;
  const n = parseInt(s, 10);
  if (n === 10) return 10;
  if (n === 1) return 1;
  return 0;
}

/** @returns {{ type: 'pack', pack: number } | { type: 'sub', plan: string } | { type: 'sub_nonrenew', months: number } | { type: 'elly_pack', pack: number } | { type: 'elly_pass' } | null} */
function parseVar2Product(v) {
  const s = String(v || "").trim();
  if (s === "sub_monthly") return { type: "sub", plan: "monthly" };
  if (s === "sub_yearly") return { type: "sub", plan: "yearly" };
  if (s === "sub_twoYear") return { type: "sub", plan: "twoYear" };
  if (s === "sub_nonrenew_1m") return { type: "sub_nonrenew", months: 1 };
  if (s === "sub_nonrenew_3m") return { type: "sub_nonrenew", months: 3 };
  if (s === "sub_nonrenew_6m") return { type: "sub_nonrenew", months: 6 };
  if (s === "sub_elly_pass_1m") return { type: "elly_pass" };
  if (s === "e10" || s === "e20" || s === "e30" || s === "e50" || s === "e100") {
    const ellyPack = s === "e10" ? 10 : s === "e20" ? 20 : s === "e30" ? 30 : s === "e50" ? 50 : 100;
    return { type: "elly_pack", pack: ellyPack };
  }
  const pack = packFromVar2(v);
  if (pack) return { type: "pack", pack };
  return null;
}

function expectedKrwForProduct(product) {
  if (!product) return 0;
  if (product.type === "pack") return expectedKrwForPack(product.pack);
  if (product.type === "elly_pack") return expectedKrwForEllyPack(product.pack);
  if (product.type === "elly_pass") return expectedKrwForEllyPassOneMonth();
  if (product.type === "sub") return expectedKrwForSubPlan(product.plan);
  if (product.type === "sub_nonrenew") return expectedKrwForNonRenewMonths(product.months);
  return 0;
}

function addCalendarMonthFromMs(fromMs) {
  const d = new Date(fromMs);
  d.setMonth(d.getMonth() + 1);
  return d.getTime();
}

function addSubscriptionUntilMs(fromMs, plan) {
  const d = new Date(fromMs);
  if (plan === "monthly") {
    d.setMonth(d.getMonth() + 1);
  } else if (plan === "yearly") {
    d.setFullYear(d.getFullYear() + 1);
  } else if (plan === "twoYear") {
    d.setFullYear(d.getFullYear() + 2);
  }
  return d.getTime();
}

/** 비갱신 기간권: 현재 유료 만료일 이후로 N개월 연장 */
function addNonRenewUntilMs(fromMs, months) {
  const d = new Date(fromMs);
  d.setMonth(d.getMonth() + months);
  return d.getTime();
}

/** KST 기준 오늘 날짜에 years 더한 yyyy-mm-dd (정기결제 rebillExpire) */
function rebillExpireYmdKst(yearsToAdd) {
  const add = Math.max(1, parseInt(String(yearsToAdd || "10"), 10) || 10);
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  const parts = fmt.formatToParts(new Date());
  const y = parseInt(parts.find((p) => p.type === "year").value, 10) + add;
  const m = parts.find((p) => p.type === "month").value;
  const d = parts.find((p) => p.type === "day").value;
  return `${y}-${m}-${d}`;
}

function normalizeRecvPhoneKr(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (digits.length >= 11 && digits.startsWith("01")) return digits.slice(0, 11);
  if (digits.length === 10 && digits.startsWith("01")) return digits;
  return "";
}

/** @see https://docs.payapp.kr — REST FORM POST UTF-8 */
function payappOapiPost(formObj) {
  const body = querystring.stringify(formObj);
  return new Promise((resolve, reject) => {
    const u = new URL("https://api.payapp.kr/oapi/apiLoad.html");
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "Content-Length": Buffer.byteLength(body, "utf8"),
          "User-Agent": "hanlaw-functions/payapp"
        }
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          try {
            resolve(querystring.parse(text));
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function parseFeedbackBody(req) {
  if (req.body && typeof req.body === "object" && Object.keys(req.body).length > 0) {
    return req.body;
  }
  if (req.rawBody && Buffer.isBuffer(req.rawBody)) {
    const raw = req.rawBody.toString("utf8");
    if (raw.trim().startsWith("{")) {
      try {
        return JSON.parse(raw);
      } catch (e) {
        /* fallthrough */
      }
    }
    return querystring.parse(raw);
  }
  return {};
}

function feedbackUrlForProject() {
  let projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || "";
  if (!projectId && process.env.FIREBASE_CONFIG) {
    try {
      projectId = JSON.parse(process.env.FIREBASE_CONFIG).projectId || "";
    } catch (e) {
      projectId = "";
    }
  }
  if (!projectId) return "";
  return `https://${REGION}-${projectId}.cloudfunctions.net/payappQuestionFeedback`;
}

function assertPayAppConfigured() {
  const payappUserid = String(payappUserIdParam.value() || process.env.PAYAPP_USERID || "").trim();
  if (!payappUserid) {
    throw new HttpsError("failed-precondition", "PayApp(PAYAPP_USERID)이 설정되지 않았습니다.");
  }
  const feedbackUrl = feedbackUrlForProject();
  if (!feedbackUrl) {
    throw new HttpsError("failed-precondition", "프로젝트 ID를 확인할 수 없어 feedback URL을 만들 수 없습니다.");
  }
  return { payappUserid, feedbackUrl };
}

/** 결제창 표시용: Firebase Auth 이메일 (var1은 uid 유지) */
function buyerDisplayEmailFromAuth(request) {
  const e = request.auth && request.auth.token && request.auth.token.email;
  return String(e || "").trim();
}

function payAppBuyerExtras(request) {
  const email = buyerDisplayEmailFromAuth(request);
  if (!email) return {};
  return { recvemail: email, buyerDisplay: email };
}

/** 질문권 1·10건 */
const getPayAppQuestionPackCheckout = onCall({ region: REGION }, async (request) => {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
  }
  const uid = request.auth.uid;
  const pack = parseInt((request.data && request.data.pack) || 0, 10);
  if (pack !== 1 && pack !== 10) {
    throw new HttpsError("invalid-argument", "pack은 1 또는 10이어야 합니다.");
  }

  const { payappUserid, feedbackUrl } = assertPayAppConfigured();
  const shopname = String(process.env.PAYAPP_SHOP_NAME || "행정법Q").trim() || "행정법Q";
  const goodname = pack === 10 ? "행정법Q 질문권 10건" : "행정법Q 질문권 1건";
  const price = expectedKrwForPack(pack);

  return Object.assign(
    {
      userid: payappUserid,
      shopname,
      goodname,
      price,
      feedbackUrl,
      var1: uid,
      var2: String(pack),
      checkretry: "y",
      charset: "utf-8"
    },
    payAppBuyerExtras(request)
  );
});

/** 엘리(AI) 질문권 10·20·30건 — hanlaw_quiz_ai_wallet */
const getPayAppEllyQuestionPackCheckout = onCall({ region: REGION }, async (request) => {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
  }
  const uid = request.auth.uid;
  const pack = parseInt((request.data && request.data.pack) || 0, 10);
  if (pack !== 10 && pack !== 20 && pack !== 30) {
    throw new HttpsError("invalid-argument", "pack은 10, 20 또는 30이어야 합니다.");
  }

  const { payappUserid, feedbackUrl } = assertPayAppConfigured();
  const shopname = String(process.env.PAYAPP_SHOP_NAME || "행정법Q").trim() || "행정법Q";
  const goodname = "행정법Q 엘리(AI) 질문권 " + pack + "건";
  const price = expectedKrwForEllyPack(pack);
  const var2 = pack === 10 ? "e10" : pack === 20 ? "e20" : "e30";

  return Object.assign(
    {
      userid: payappUserid,
      shopname,
      goodname,
      price,
      feedbackUrl,
      var1: uid,
      var2,
      checkretry: "y",
      charset: "utf-8"
    },
    payAppBuyerExtras(request)
  );
});

/** 엘리(AI) 무제한 1개월 — 일회 결제, ellyUnlimitedUntil 1개월 연장(잔여 기간이 있으면 이어서) */
const getPayAppEllyUnlimitedPassCheckout = onCall({ region: REGION }, async (request) => {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
  }
  const uid = request.auth.uid;

  const { payappUserid, feedbackUrl } = assertPayAppConfigured();
  const shopname = String(process.env.PAYAPP_SHOP_NAME || "행정법Q").trim() || "행정법Q";
  const goodname = "행정법Q 엘리(AI) 무제한 1개월";
  const price = expectedKrwForEllyPassOneMonth();

  return Object.assign(
    {
      userid: payappUserid,
      shopname,
      goodname,
      price,
      feedbackUrl,
      var1: uid,
      var2: "sub_elly_pass_1m",
      checkretry: "y",
      charset: "utf-8"
    },
    payAppBuyerExtras(request)
  );
});

/** 구독: 월 / 연 / 2년 — hanlaw_members.paidUntil 연장 */
const getPayAppSubscriptionCheckout = onCall({ region: REGION }, async (request) => {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
  }
  const uid = request.auth.uid;
  const plan = String((request.data && request.data.plan) || "").trim();
  const allowed = [
    "monthly",
    "yearly",
    "twoYear",
    "nonrenew1m",
    "nonrenew3m",
    "nonrenew6m"
  ];
  if (allowed.indexOf(plan) < 0) {
    throw new HttpsError(
      "invalid-argument",
      "plan은 monthly, yearly, twoYear, nonrenew1m, nonrenew3m, nonrenew6m 중 하나입니다."
    );
  }

  const { payappUserid, feedbackUrl } = assertPayAppConfigured();
  const shopname = String(process.env.PAYAPP_SHOP_NAME || "행정법Q").trim() || "행정법Q";

  let var2;
  let goodname;
  let price;
  if (plan === "monthly") {
    var2 = "sub_monthly";
    goodname = "행정법Q 월 구독";
    price = expectedKrwForSubPlan("monthly");
  } else if (plan === "yearly") {
    var2 = "sub_yearly";
    goodname = "행정법Q 1년 구독";
    price = expectedKrwForSubPlan("yearly");
  } else if (plan === "twoYear") {
    var2 = "sub_twoYear";
    goodname = "행정법Q 2년 구독";
    price = expectedKrwForSubPlan("twoYear");
  } else if (plan === "nonrenew1m") {
    var2 = "sub_nonrenew_1m";
    goodname = "행정법Q 1개월";
    price = expectedKrwForNonRenewMonths(1);
  } else if (plan === "nonrenew3m") {
    var2 = "sub_nonrenew_3m";
    goodname = "행정법Q 3개월";
    price = expectedKrwForNonRenewMonths(3);
  } else {
    var2 = "sub_nonrenew_6m";
    goodname = "행정법Q 6개월";
    price = expectedKrwForNonRenewMonths(6);
  }

  if (plan === "monthly") {
    const recvphone = normalizeRecvPhoneKr((request.data && request.data.recvphone) || "");
    if (!recvphone) {
      throw new HttpsError(
        "invalid-argument",
        "월 정기구독은 페이앱 정기결제 연동을 위해 휴대폰 번호가 필요합니다. (숫자만 입력)"
      );
    }
    const rebillCycleMonth = String(process.env.PAYAPP_REBILL_CYCLE_DAY || "15").trim() || "15";
    const expireYears = parseInt(process.env.PAYAPP_REBILL_EXPIRE_YEARS || "10", 10) || 10;
    const rebillExpire = rebillExpireYmdKst(expireYears);
    const failUrl = feedbackUrl;
    return Object.assign(
      {
        payMode: "rebill",
        userid: payappUserid,
        goodname,
        goodprice: price,
        recvphone,
        feedbackUrl,
        failUrl,
        var1: uid,
        var2,
        rebillCycleType: "Month",
        rebillCycleMonth,
        rebillExpire,
        smsuse: "n",
        checkretry: "y",
        charset: "utf-8",
        memo: "행정법Q 월 정기구독"
      },
      payAppBuyerExtras(request)
    );
  }

  return Object.assign(
    {
      payMode: "onetime",
      userid: payappUserid,
      shopname,
      goodname,
      price,
      feedbackUrl,
      var1: uid,
      var2,
      checkretry: "y",
      charset: "utf-8"
    },
    payAppBuyerExtras(request)
  );
});

/** PayApp 정기결제 해지 (rebillCancel) — 월 구독 등록이 있는 본인만 */
const cancelPayAppRebill = onCall({ region: REGION }, async (request) => {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
  }
  const uid = request.auth.uid;
  const payappUserid = String(payappUserIdParam.value() || process.env.PAYAPP_USERID || "").trim();
  const linkKey = String(payappLinkKeyParam.value() || process.env.PAYAPP_LINK_KEY || "").trim();
  if (!payappUserid || !linkKey) {
    throw new HttpsError("failed-precondition", "PayApp 연동 정보(PAYAPP_USERID, PAYAPP_LINK_KEY)가 설정되지 않았습니다.");
  }

  const memRef = db().collection("hanlaw_members").doc(uid);
  const snap = await memRef.get();
  const m = snap.exists ? snap.data() : {};
  const rebillNo = String(m.payappRebillNo || "").trim();
  if (!rebillNo) {
    throw new HttpsError(
      "failed-precondition",
      "해지할 PayApp 월 정기결제 등록이 없습니다. (이미 해지했거나 연·2년·비갱신 일회 결제만 이용 중일 수 있습니다.)"
    );
  }

  let oRes;
  try {
    oRes = await payappOapiPost({
      cmd: "rebillCancel",
      userid: payappUserid,
      rebill_no: rebillNo,
      linkkey: linkKey
    });
  } catch (e) {
    console.error("cancelPayAppRebill: payappOapiPost", e);
    throw new HttpsError("internal", "페이앱 서버와 통신하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }

  if (String(oRes.state) !== "1") {
    const errMsg = String(oRes.errorMessage || oRes.errmsg || "").trim() || "정기결제 해지에 실패했습니다.";
    console.warn("cancelPayAppRebill: payapp error", { errno: oRes.errno, errMsg, rebillNo });
    throw new HttpsError("internal", errMsg);
  }

  await memRef.set(
    {
      payappRebillNo: FieldValue.delete(),
      payappRebillCancelledAt: FieldValue.serverTimestamp(),
      payappRebillCancelledNo: rebillNo,
      updatedAt: FieldValue.serverTimestamp()
    },
    { merge: true }
  );

  return { ok: true };
});

const payappQuestionFeedback = functionsV1.region(REGION).https.onRequest(async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).set("Content-Type", "text/plain; charset=utf-8").send("Method Not Allowed");
    return;
  }

  const body = parseFeedbackBody(req);
  const userid = String(body.userid || "").trim();
  const linkkey = String(body.linkkey || "").trim();
  const linkval = String(body.linkval || "").trim();
  const payState = parseInt(body.pay_state, 10);
  const mulNo = body.mul_no != null ? String(body.mul_no) : "";
  const var1 = String(body.var1 || "").trim();
  const var2 = String(body.var2 || "").trim();
  const price = parseInt(body.price, 10);

  const envUser = String(payappUserIdParam.value() || process.env.PAYAPP_USERID || "").trim();
  const envKey = String(payappLinkKeyParam.value() || process.env.PAYAPP_LINK_KEY || "").trim();
  const envVal = String(payappLinkValParam.value() || process.env.PAYAPP_LINK_VALUE || "").trim();

  const okSeller =
    envUser &&
    envKey &&
    envVal &&
    userid === envUser &&
    linkkey === envKey &&
    linkval === envVal;

  if (!okSeller) {
    console.warn("payappQuestionFeedback: seller verification failed");
    res.status(200).set("Content-Type", "text/plain; charset=utf-8").send("FAIL");
    return;
  }

  if (payState === 99) {
    console.warn("payappQuestionFeedback: 결제 실패 통보(정기결제 2회차 이후 등)", {
      var1,
      var2,
      mulNo,
      rebill_no: body.rebill_no
    });
    res.status(200).set("Content-Type", "text/plain; charset=utf-8").send("SUCCESS");
    return;
  }

  /**
   * pay_state=1: 결제·정기결제 요청 접수 단계 노티. 문서상 이 응답에 SUCCESS가 있어야 이후 결제창이 진행됨.
   * 금액·var2 검증 전에 처리해야 함(선행 노티에 price 불일치 시 에러 70080 고객사 응답 실패).
   * @see https://docs.payapp.kr — 결제통보, 정기결제 요청(JS)
   */
  if (payState === 1) {
    res.status(200).set("Content-Type", "text/plain; charset=utf-8").send("SUCCESS");
    return;
  }

  const product = parseVar2Product(var2);
  const expectedPrice = expectedKrwForProduct(product);
  const priceOk = Number.isFinite(price) && price === expectedPrice;

  if (!product || !priceOk) {
    console.warn("payappQuestionFeedback: price/product mismatch", { price, var2, product });
    res.status(200).set("Content-Type", "text/plain; charset=utf-8").send("FAIL");
    return;
  }

  if (payState === 4) {
    if (!var1 || !mulNo) {
      res.status(200).set("Content-Type", "text/plain; charset=utf-8").send("FAIL");
      return;
    }

    const uid = var1;
    const dedupId = `payapp_${mulNo}_4`;
    const dedupRef = db().collection("hanlaw_webhook_events").doc(dedupId);

    try {
      if (product.type === "pack") {
        const amount = product.pack;
        const walletRef = db().collection("hanlaw_question_wallet").doc(uid);
        const exp = Timestamp.fromMillis(Date.now() + BATCH_VALID_MS);

        await db().runTransaction(async (t) => {
          const dup = await t.get(dedupRef);
          if (dup.exists) return;

          const wsnap = await t.get(walletRef);
          const data = wsnap.exists ? wsnap.data() : {};
          const periodKey = kstYearMonth();
          const norm = normalizeWallet(data, periodKey);
          const batches = norm.batches.slice();
          batches.push({
            amount,
            expiresAt: exp,
            purchasedAt: FieldValue.serverTimestamp()
          });

          t.set(dedupRef, {
            processedAt: FieldValue.serverTimestamp(),
            source: "payapp",
            kind: "question_pack",
            uid,
            amount,
            mulNo,
            payState: 4
          });
          t.set(
            walletRef,
            {
              monthlyPeriodKey: periodKey,
              monthlyUsed: norm.monthlyUsed,
              batches,
              updatedAt: FieldValue.serverTimestamp()
            },
            { merge: true }
          );
        });
      } else if (product.type === "elly_pack") {
        const amount = product.pack;
        const walletRef = db().collection("hanlaw_quiz_ai_wallet").doc(uid);
        const exp = Timestamp.fromMillis(Date.now() + BATCH_VALID_MS);

        await db().runTransaction(async (t) => {
          const dup = await t.get(dedupRef);
          if (dup.exists) return;

          const wsnap = await t.get(walletRef);
          const data = wsnap.exists ? wsnap.data() : {};
          const batches = Array.isArray(data.batches) ? data.batches.slice() : [];
          batches.push({
            amount,
            expiresAt: exp,
            purchasedAt: Timestamp.now()
          });

          t.set(dedupRef, {
            processedAt: FieldValue.serverTimestamp(),
            source: "payapp",
            kind: "elly_question_pack",
            uid,
            amount,
            mulNo,
            payState: 4
          });
          t.set(
            walletRef,
            {
              batches,
              updatedAt: FieldValue.serverTimestamp()
            },
            { merge: true }
          );
        });
      } else if (product.type === "elly_pass") {
        const memRef = db().collection("hanlaw_members").doc(uid);

        await db().runTransaction(async (t) => {
          const dup = await t.get(dedupRef);
          if (dup.exists) return;

          const msnap = await t.get(memRef);
          const mdata = msnap.exists ? msnap.data() : {};
          const now = Date.now();
          let base = now;
          const prev = mdata.ellyUnlimitedUntil;
          if (prev && typeof prev.toMillis === "function") {
            base = Math.max(now, prev.toMillis());
          }
          const newUntil = Timestamp.fromMillis(addCalendarMonthFromMs(base));

          t.set(dedupRef, {
            processedAt: FieldValue.serverTimestamp(),
            source: "payapp",
            kind: "elly_unlimited_pass",
            uid,
            mulNo,
            payState: 4
          });
          t.set(
            memRef,
            {
              ellyUnlimitedUntil: newUntil,
              updatedAt: FieldValue.serverTimestamp()
            },
            { merge: true }
          );
        });
      } else if (product.type === "sub") {
        const plan = product.plan;
        const memRef = db().collection("hanlaw_members").doc(uid);

        await db().runTransaction(async (t) => {
          const dup = await t.get(dedupRef);
          if (dup.exists) return;

          const msnap = await t.get(memRef);
          const mdata = msnap.exists ? msnap.data() : {};
          const now = Date.now();
          let base = now;
          if (mdata.membershipTier === "paid" && mdata.paidUntil && typeof mdata.paidUntil.toMillis === "function") {
            base = Math.max(now, mdata.paidUntil.toMillis());
          }
          const newUntilMs = addSubscriptionUntilMs(base, plan);
          const newUntil = Timestamp.fromMillis(newUntilMs);

          t.set(dedupRef, {
            processedAt: FieldValue.serverTimestamp(),
            source: "payapp",
            kind: "subscription",
            uid,
            plan,
            mulNo,
            payState: 4
          });
          const rebillNo = body.rebill_no != null ? String(body.rebill_no).trim() : "";
          const subPatch = {
            membershipTier: "paid",
            paidUntil: newUntil,
            updatedAt: FieldValue.serverTimestamp(),
            payappSubscriptionPlan: plan,
            payappLastMulNo: mulNo
          };
          if (rebillNo) {
            subPatch.payappRebillNo = rebillNo;
            subPatch.payappRebillCancelledAt = FieldValue.delete();
            subPatch.payappRebillCancelledNo = FieldValue.delete();
          }
          t.set(memRef, subPatch, { merge: true });
        });
      } else if (product.type === "sub_nonrenew") {
        const months = product.months;
        const memRef = db().collection("hanlaw_members").doc(uid);
        const planKey = "nonrenew_" + months + "m";

        await db().runTransaction(async (t) => {
          const dup = await t.get(dedupRef);
          if (dup.exists) return;

          const msnap = await t.get(memRef);
          const mdata = msnap.exists ? msnap.data() : {};
          const now = Date.now();
          let base = now;
          if (mdata.membershipTier === "paid" && mdata.paidUntil && typeof mdata.paidUntil.toMillis === "function") {
            base = Math.max(now, mdata.paidUntil.toMillis());
          }
          const newUntilMs = addNonRenewUntilMs(base, months);
          const newUntil = Timestamp.fromMillis(newUntilMs);

          t.set(dedupRef, {
            processedAt: FieldValue.serverTimestamp(),
            source: "payapp",
            kind: "subscription_nonrenew",
            uid,
            months,
            mulNo,
            payState: 4
          });
          t.set(
            memRef,
            {
              membershipTier: "paid",
              paidUntil: newUntil,
              updatedAt: FieldValue.serverTimestamp(),
              payappSubscriptionPlan: planKey,
              payappLastMulNo: mulNo
            },
            { merge: true }
          );
        });
      }
    } catch (e) {
      console.error("payappQuestionFeedback grant error", e);
      res.status(500).set("Content-Type", "text/plain; charset=utf-8").send("FAIL");
      return;
    }

    res.status(200).set("Content-Type", "text/plain; charset=utf-8").send("SUCCESS");
    return;
  }

  res.status(200).set("Content-Type", "text/plain; charset=utf-8").send("SUCCESS");
});

module.exports = {
  getPayAppQuestionPackCheckout,
  getPayAppEllyQuestionPackCheckout,
  getPayAppEllyUnlimitedPassCheckout,
  getPayAppSubscriptionCheckout,
  cancelPayAppRebill,
  payappQuestionFeedback
};
