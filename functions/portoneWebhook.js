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

function readRawBody(req) {
  if (req.rawBody && Buffer.isBuffer(req.rawBody)) {
    return req.rawBody.toString("utf8");
  }
  if (typeof req.body === "string") return req.body;
  return JSON.stringify(req.body || {});
}

const portoneWebhook = onRequest({ region: REGION }, async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, message: "POST only" });
    return;
  }

  const secret = webhookSecret();
  if (!secret) {
    res.status(500).json({ ok: false, message: "PORTONE_WEBHOOK_SECRET not configured" });
    return;
  }

  const rawBody = readRawBody(req);
  let webhook;
  try {
    webhook = await PortOne.Webhook.verify(secret, rawBody, req.headers);
  } catch (e) {
    if (e instanceof PortOne.Webhook.WebhookVerificationError) {
      res.status(400).json({ ok: false, message: "invalid signature" });
      return;
    }
    res.status(500).json({ ok: false, message: "verification failed" });
    return;
  }

  const data = webhook && webhook.data ? webhook.data : {};
  const type = String((webhook && webhook.type) || "");
  const paymentId = String(data.paymentId || "").trim();
  const billingKey = String(data.billingKey || "").trim();
  const timestamp = String((webhook && webhook.timestamp) || "");
  const dedupKey = [type, paymentId || billingKey || "na", timestamp || "na"].join(":");

  const db = getFirestore();
  const webhookRef = db.collection("hanlaw_portone_webhooks").doc(Buffer.from(dedupKey).toString("base64url"));
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

  // 상태 최종 반영은 서버 재조회 결과만 신뢰합니다.
  if (type === "Transaction.Paid" && paymentId) {
    try {
      await finalizePortOnePaymentById(paymentId, { dedupSource: "portone_webhook" });
    } catch (e) {
      if (e instanceof HttpsError && (e.code === "not-found" || e.code === "failed-precondition")) {
        res.status(200).json({ ok: true, ignored: true });
        return;
      }
      throw e;
    }
  }

  res.status(200).json({ ok: true });
});

module.exports = { portoneWebhook };
