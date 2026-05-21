"use strict";

const { onRequest, HttpsError } = require("firebase-functions/v2/https");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const PortOne = require("@portone/server-sdk");
const { finalizePortOnePaymentById } = require("./portonePayments");

const REGION = "asia-northeast3";

function webhookSecret() {
  return String(
    process.env.PORTONE_WEBHOOK_SECRET ||
      process.env.PORTONE_WEBHOOK_SECRET_PROD ||
      process.env.PORTONE_WEBHOOK_SECRET_TEST ||
      ""
  ).trim();
}

/** 포트원 서명 검증용 — JSON 재파싱 문자열이 아닌 원문 바이트 문자열 */
function readRawBody(req) {
  if (req.rawBody && Buffer.isBuffer(req.rawBody)) {
    return req.rawBody.toString("utf8");
  }
  if (typeof req.body === "string") return req.body;
  if (req.body && typeof req.body === "object") {
    console.warn("[portoneWebhook] rawBody 없음 — JSON.stringify fallback (서명 검증 실패 가능)");
    return JSON.stringify(req.body);
  }
  return "";
}

function isVerificationError(e) {
  if (!e) return false;
  if (e instanceof PortOne.Webhook.WebhookVerificationError) return true;
  return e.name === "WebhookVerificationError" || e.name === "InvalidInputError";
}

const portoneWebhook = onRequest({ region: REGION }, async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, message: "POST only" });
    return;
  }

  const secret = webhookSecret();
  if (!secret) {
    console.error("[portoneWebhook] PORTONE_WEBHOOK_SECRET 미설정");
    res.status(500).json({ ok: false, message: "PORTONE_WEBHOOK_SECRET not configured" });
    return;
  }

  const rawBody = readRawBody(req);
  let webhook;
  try {
    webhook = await PortOne.Webhook.verify(secret, rawBody, req.headers);
  } catch (e) {
    if (isVerificationError(e)) {
      const reason = e && e.reason ? String(e.reason) : e.name || "verify";
      console.warn("[portoneWebhook] verify rejected:", reason);
      res.status(400).json({ ok: false, message: "invalid signature" });
      return;
    }
    console.error("[portoneWebhook] verify error:", e && e.message ? e.message : e);
    res.status(500).json({ ok: false, message: "verification failed" });
    return;
  }

  const type = String((webhook && webhook.type) || "");
  const data = webhook && webhook.data ? webhook.data : {};
  const paymentId = String(data.paymentId || "").trim();
  const billingKey = String(data.billingKey || "").trim();
  const timestamp = String((webhook && webhook.timestamp) || "");
  const dedupKey = [type, paymentId || billingKey || "na", timestamp || "na"].join(":");

  try {
    const db = getFirestore();
    const webhookRef = db
      .collection("hanlaw_portone_webhooks")
      .doc(Buffer.from(dedupKey).toString("base64url"));
    await webhookRef.set(
      {
        type,
        paymentId: paymentId || null,
        billingKey: billingKey || null,
        storeId: data.storeId || null,
        transactionId: data.transactionId || null,
        cancellationId: data.cancellationId || null,
        timestamp: timestamp || null,
        payload: webhook,
        receivedAt: FieldValue.serverTimestamp()
      },
      { merge: true }
    );
  } catch (e) {
    console.error("[portoneWebhook] log write failed:", e && e.message ? e.message : e);
    res.status(500).json({ ok: false, message: "log write failed" });
    return;
  }

  // 단건 결제 보조 처리 — 실패해도 포트원에는 200 (재시도 폭주 방지)
  if (type === "Transaction.Paid" && paymentId) {
    try {
      await finalizePortOnePaymentById(paymentId, { dedupSource: "portone_webhook" });
      console.log("[portoneWebhook] finalize ok:", paymentId);
    } catch (e) {
      const code = e instanceof HttpsError ? e.code : "";
      const msg = e && e.message ? String(e.message) : "";
      console.warn("[portoneWebhook] finalize skipped:", paymentId, code, msg);
    }
  } else {
    console.log("[portoneWebhook] received:", type || "(no type)");
  }

  res.status(200).json({ ok: true });
});

module.exports = { portoneWebhook };
