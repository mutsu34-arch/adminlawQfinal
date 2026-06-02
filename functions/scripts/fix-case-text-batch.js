"use strict";

const { initializeApp, applicationDefault, getApps } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const {
  normalizeCaseDictionaryFields,
  caseFieldsNeedNormalize
} = require("../caseTextNormalize");

const projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || "adminlawq-b9dad";
const dryRun = process.argv.includes("--dry-run");

if (!getApps().length) {
  initializeApp({ credential: applicationDefault(), projectId });
}

async function main() {
  const db = getFirestore();
  const snap = await db.collection("hanlaw_dict_cases").get();
  let scanned = 0;
  let changed = 0;
  const samples = [];
  let batch = db.batch();
  let batchCount = 0;

  async function commit(force) {
    if (batchCount === 0) return;
    if (!force && batchCount < 400) return;
    if (!dryRun) await batch.commit();
    batch = db.batch();
    batchCount = 0;
  }

  for (const doc of snap.docs) {
    scanned += 1;
    const data = doc.data() || {};
    if (!caseFieldsNeedNormalize(data)) continue;
    const next = normalizeCaseDictionaryFields(data);
    changed += 1;
    if (samples.length < 10) {
      samples.push({ docId: doc.id, citation: String(data.citation || "").slice(0, 100) });
    }
    if (!dryRun) {
      batch.update(doc.ref, {
        facts: next.facts,
        issues: next.issues,
        judgment: next.judgment,
        updatedAt: FieldValue.serverTimestamp()
      });
      batchCount += 1;
      if (batchCount >= 400) await commit(true);
    }
  }
  await commit(true);

  console.log(JSON.stringify({ ok: true, dryRun, scanned, changed, samples }, null, 2));
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
