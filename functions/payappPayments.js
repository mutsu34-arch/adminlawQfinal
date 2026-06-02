"use strict";

/**
 * @deprecated PortOne 전환으로 PayApp 신규 결제는 사용하지 않습니다.
 *
 * 이 파일에는 과거 PayApp 월 정기결제(rebill)를 이용 중인 레거시 회원의
 * "정기결제 해지"만 남겨 둡니다. (cancelPayAppRebill — index.js에서만 export)
 *
 * 제거됨(미배포 데드코드): PayApp 질문권/엘리권/무제한권/구독(월·연·2년·비갱신) 체크아웃,
 * 결제통보 웹훅(payappQuestionFeedback). 신규 결제·충전은 PortOne(portonePayments.js)로 처리합니다.
 *
 * 환경변수(functions/.env): PAYAPP_USERID, PAYAPP_LINK_KEY (해지 API 호출용)
 * 정기 해지: 페이앱 cmd=rebillCancel (userid, rebill_no, linkkey)
 * @see https://docs.payapp.kr
 */

const querystring = require("querystring");
const https = require("https");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineString } = require("firebase-functions/params");

const payappUserIdParam = defineString("PAYAPP_USERID", { default: "" });
const payappLinkKeyParam = defineString("PAYAPP_LINK_KEY", { default: "" });

const REGION = "asia-northeast3";

let _db;
function db() {
  if (!_db) _db = getFirestore();
  return _db;
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

/** PayApp 정기결제 해지 (rebillCancel) — 레거시 월 구독 등록이 있는 본인만 */
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
      "해지할 PayApp 월 정기결제 등록이 없습니다. (이미 해지했거나 일회 결제만 이용 중일 수 있습니다.)"
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

module.exports = {
  cancelPayAppRebill
};
