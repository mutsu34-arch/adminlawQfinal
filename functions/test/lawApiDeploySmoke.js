"use strict";

const admin = require("firebase-admin");
const https = require("https");

const PROJECT = "adminlawq-b9dad";
const API_KEY = "AIzaSyCCI91pU9mmX5OZPKff-Myk1f2EAd6dzrw";
const REGION = "asia-northeast3";
const ADMIN_EMAIL = "mutsu34@gmail.com";

admin.initializeApp({ projectId: PROJECT });

function postJson(url, body, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = JSON.stringify(body);
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + (u.search || ""),
        method: "POST",
        headers: Object.assign(
          { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) },
          headers || {}
        )
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          try {
            resolve({ status: res.statusCode, json: JSON.parse(text) });
          } catch (_) {
            resolve({ status: res.statusCode, text });
          }
        });
      }
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

async function getIdToken() {
  const user = await admin.auth().getUserByEmail(ADMIN_EMAIL);
  const customToken = await admin.auth().createCustomToken(user.uid);
  const signIn = await postJson(
    "https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=" + API_KEY,
    { token: customToken, returnSecureToken: true }
  );
  if (!signIn.json || !signIn.json.idToken) {
    throw new Error("signIn failed: " + JSON.stringify(signIn));
  }
  return signIn.json.idToken;
}

async function callCallable(name, idToken, data) {
  const url = "https://" + REGION + "-" + PROJECT + ".cloudfunctions.net/" + name;
  return postJson(url, { data: data || {} }, { Authorization: "Bearer " + idToken });
}

async function main() {
  const idToken = await getIdToken();
  const verify = await callCallable("adminVerifyLawGoKrApi", idToken, {});
  console.log("adminVerifyLawGoKrApi:", JSON.stringify(verify, null, 2));
  const article = await callCallable("adminFetchStatuteArticleOpenApi", idToken, {
    statuteKey: "행정소송법|12|"
  });
  console.log("adminFetchStatuteArticleOpenApi:", JSON.stringify(article, null, 2));
  console.log("\n=== adminFetchCasePrecedentOpenApi ===");
  const prec = await callCallable("adminFetchCasePrecedentOpenApi", idToken, {
    citation: "2016두31616"
  });
  const precBody = prec && prec.json && prec.json.result && prec.json.result.caseFullText;
  console.log(
    "adminFetchCasePrecedentOpenApi:",
    JSON.stringify(
      Object.assign({}, prec.json && prec.json.result, {
        caseFullText: precBody ? precBody.slice(0, 120) + "…" : ""
      }),
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
