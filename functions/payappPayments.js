"use strict";

/**
 * PayApp (페이앱) — 질문권 + 구독 (Creem 과 병행)
 *
 * 환경변수 (functions/.env):
 * - PAYAPP_USERID, PAYAPP_LINK_KEY, PAYAPP_LINK_VALUE
 * - PAYAPP_SHOP_NAME
 * 질문권: PAYAPP_KRW_Q1, PAYAPP_KRW_Q10 (기본 3000, 15000)
 * 구독: PAYAPP_KRW_SUB_MONTHLY, PAYAPP_KRW_SUB_YEARLY, PAYAPP_KRW_SUB_TWO_YEAR (기본 10000, 100000, 150000)
 *
 * var2: 질문권 "1"|"10" · 구독 "sub_monthly"|"sub_yearly"|"sub_twoYear"
 */

const querystring = require("querystring");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const functionsV1 = require("firebase-functions/v1");

let _db;
function db() {
  if (!_db) _db = getFirestore();
  return _db;
}

const BATCH_VALID_MS = 365 * 24 * 60 * 60 * 1000;
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
    return Math.max(1000, parseInt(process.env.PAYAPP_KRW_Q10 || "15000", 10) || 15000);
  }
  return Math.max(1000, parseInt(process.env.PAYAPP_KRW_Q1 || "3000", 10) || 3000);
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

function packFromVar2(v) {
  const s = String(v || "").trim();
  if (s === "10" || s === "10건") return 10;
  if (s === "1" || s === "1건") return 1;
  const n = parseInt(s, 10);
  if (n === 10) return 10;
  if (n === 1) return 1;
  return 0;
}

/** @returns {{ type: 'pack', pack: number } | { type: 'sub', plan: string } | null} */
function parseVar2Product(v) {
  const s = String(v || "").trim();
  if (s === "sub_monthly") return { type: "sub", plan: "monthly" };
  if (s === "sub_yearly") return { type: "sub", plan: "yearly" };
  if (s === "sub_twoYear") return { type: "sub", plan: "twoYear" };
  const pack = packFromVar2(v);
  if (pack) return { type: "pack", pack };
  return null;
}

function expectedKrwForProduct(product) {
  if (!product) return 0;
  if (product.type === "pack") return expectedKrwForPack(product.pack);
  if (product.type === "sub") return expectedKrwForSubPlan(product.plan);
  return 0;
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
  const payappUserid = String(process.env.PAYAPP_USERID || "").trim();
  if (!payappUserid) {
    throw new HttpsError("failed-precondition", "PayApp(PAYAPP_USERID)이 설정되지 않았습니다.");
  }
  const feedbackUrl = feedbackUrlForProject();
  if (!feedbackUrl) {
    throw new HttpsError("failed-precondition", "프로젝트 ID를 확인할 수 없어 feedback URL을 만들 수 없습니다.");
  }
  return { payappUserid, feedbackUrl };
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

  return {
    userid: payappUserid,
    shopname,
    goodname,
    price,
    feedbackUrl,
    var1: uid,
    var2: String(pack),
    checkretry: "y",
    charset: "utf-8"
  };
});

/** 구독: 월 / 연 / 2년 — hanlaw_members.paidUntil 연장 */
const getPayAppSubscriptionCheckout = onCall({ region: REGION }, async (request) => {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
  }
  const uid = request.auth.uid;
  const plan = String((request.data && request.data.plan) || "").trim();
  if (plan !== "monthly" && plan !== "yearly" && plan !== "twoYear") {
    throw new HttpsError("invalid-argument", "plan은 monthly, yearly, twoYear 중 하나입니다.");
  }

  const { payappUserid, feedbackUrl } = assertPayAppConfigured();
  const shopname = String(process.env.PAYAPP_SHOP_NAME || "행정법Q").trim() || "행정법Q";

  let var2;
  let goodname;
  if (plan === "monthly") {
    var2 = "sub_monthly";
    goodname = "행정법Q 월 구독";
  } else if (plan === "yearly") {
    var2 = "sub_yearly";
    goodname = "행정법Q 연 구독";
  } else {
    var2 = "sub_twoYear";
    goodname = "행정법Q 2년 구독";
  }

  const price = expectedKrwForSubPlan(plan);

  return {
    userid: payappUserid,
    shopname,
    goodname,
    price,
    feedbackUrl,
    var1: uid,
    var2,
    checkretry: "y",
    charset: "utf-8"
  };
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

  const envUser = String(process.env.PAYAPP_USERID || "").trim();
  const envKey = String(process.env.PAYAPP_LINK_KEY || "").trim();
  const envVal = String(process.env.PAYAPP_LINK_VALUE || "").trim();

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

  const product = parseVar2Product(var2);
  const expectedPrice = expectedKrwForProduct(product);
  const priceOk = Number.isFinite(price) && price === expectedPrice;

  if (!product || !priceOk) {
    console.warn("payappQuestionFeedback: price/product mismatch", { price, var2, product });
    res.status(200).set("Content-Type", "text/plain; charset=utf-8").send("FAIL");
    return;
  }

  if (payState === 1) {
    res.status(200).set("Content-Type", "text/plain; charset=utf-8").send("SUCCESS");
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
          t.set(
            memRef,
            {
              membershipTier: "paid",
              paidUntil: newUntil,
              updatedAt: FieldValue.serverTimestamp(),
              payappSubscriptionPlan: plan,
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
  getPayAppSubscriptionCheckout,
  payappQuestionFeedback
};
