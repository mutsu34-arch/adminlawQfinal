"use strict";

const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { releaseIdentityRegistryForUid } = require("./identityRegistry");

const FEEDBACK_MAX = 2000;

async function deleteQueryBatch(query, batchSize) {
  const snap = await query.limit(batchSize).get();
  if (snap.empty) return 0;
  const db = getFirestore();
  const batch = db.batch();
  snap.docs.forEach(function (doc) {
    batch.delete(doc.ref);
  });
  await batch.commit();
  return snap.size;
}

async function deleteAllInQuery(query) {
  let total = 0;
  for (;;) {
    const n = await deleteQueryBatch(query, 400);
    total += n;
    if (n < 400) break;
  }
  return total;
}

async function deleteSubcollectionAll(parentRef, subName) {
  const col = parentRef.collection(subName);
  let total = 0;
  for (;;) {
    const snap = await col.limit(400).get();
    if (snap.empty) break;
    const batch = getFirestore().batch();
    snap.docs.forEach(function (d) {
      batch.delete(d.ref);
    });
    await batch.commit();
    total += snap.size;
    if (snap.size < 400) break;
  }
  return total;
}

async function deleteUserFirestoreData(uid, emailOpt) {
  const db = getFirestore();
  const email = emailOpt ? String(emailOpt).trim().slice(0, 200) : "";

  await releaseIdentityRegistryForUid(db, uid);

  await deleteAllInQuery(db.collection("hanlaw_notifications").where("userId", "==", uid));
  await deleteAllInQuery(db.collection("hanlaw_tickets").where("userId", "==", uid));
  await deleteAllInQuery(db.collection("hanlaw_quiz_ai_asks").where("userId", "==", uid));
  await deleteAllInQuery(db.collection("hanlaw_qa_public").where("askerUserId", "==", uid));

  const chatRef = db.collection("hanlaw_support_chat").doc("user_" + uid);
  await deleteSubcollectionAll(chatRef, "messages");
  try {
    await chatRef.delete();
  } catch (e) {}

  const attRef = db.collection("hanlaw_attendance_rewards").doc(uid);
  await deleteSubcollectionAll(attRef, "point_log");
  const singleDocs = [
    "hanlaw_members",
    "hanlaw_question_wallet",
    "hanlaw_attendance_rewards",
    "hanlaw_quiz_ai_usage",
    "hanlaw_quiz_ai_wallet",
    "hanlaw_user_sessions",
    "hanlaw_user_profiles"
  ];
  for (let i = 0; i < singleDocs.length; i++) {
    try {
      await db.collection(singleDocs[i]).doc(uid).delete();
    } catch (e) {}
  }

  return { ok: true, email: email };
}

const deleteMyAccount = onCall({ region: "asia-northeast3", timeoutSeconds: 120 }, async (request) => {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
  }
  const uid = request.auth.uid;
  const data = request.data || {};
  const confirmed = data.confirmed === true || data.confirmed === "true";
  if (!confirmed) {
    throw new HttpsError("failed-precondition", "학습 데이터 삭제에 동의해 주세요.");
  }

  let feedback = String(data.feedback == null ? "" : data.feedback).trim();
  if (feedback.length > FEEDBACK_MAX) {
    feedback = feedback.slice(0, FEEDBACK_MAX);
  }

  const email = request.auth.token && request.auth.token.email ? String(request.auth.token.email) : "";

  if (feedback) {
    await getFirestore()
      .collection("hanlaw_account_withdrawal_feedback")
      .add({
        uid: uid,
        email: email || null,
        feedback: feedback,
        createdAt: FieldValue.serverTimestamp()
      });
  }

  await deleteUserFirestoreData(uid, email);

  try {
    await getAuth().deleteUser(uid);
  } catch (e) {
    const code = e && e.code ? String(e.code) : "";
    if (code === "auth/user-not-found") {
      /* already gone */
    } else {
      console.error("deleteUser auth:", e);
      throw new HttpsError(
        "internal",
        "계정 삭제 중 오류가 발생했습니다. 잠시 후 다시 시도하거나 고객센터로 문의해 주세요."
      );
    }
  }

  return {
    ok: true,
    hadFeedback: !!feedback
  };
});

module.exports = { deleteMyAccount, deleteUserFirestoreData };
