"use strict";

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { logger } = require("firebase-functions/v2");
const { getFirestore, FieldValue, FieldPath } = require("firebase-admin/firestore");
const { appendPointLog, REASON } = require("./attendancePointLedger");

function db() {
  return getFirestore();
}
const REGION = "asia-northeast3";

/** 다른 사용자가 변호사 답변을 처음 열람할 때 질문자에게 지급하는 출석 포인트 */
const QA_VIEW_REWARD = 500;

function isAdminEmailFromAuth(auth) {
  const email = auth && auth.token && auth.token.email ? String(auth.token.email).toLowerCase() : "";
  if (!email) return false;
  const raw = process.env.ADMIN_EMAILS || "mutsu34@gmail.com";
  const admins = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return admins.includes(email);
}

/** 티켓 quizContext → 공개 목록용 필드(지문은 길이 제한) */
function quizFieldsForPublicDoc(ticket) {
  const ctx = ticket.quizContext && typeof ticket.quizContext === "object" ? ticket.quizContext : {};
  const topic = ctx.topic != null ? String(ctx.topic).trim() : "";
  const stmt = ctx.statement != null ? String(ctx.statement).trim() : "";
  return {
    quizTopic: topic ? topic.slice(0, 500) : null,
    quizStatement: stmt ? stmt.slice(0, 4000) : null
  };
}

/** 티켓의 quizContext를 클라이언트에 넘길 때: 문항 ID는 관리자 토큰에서만 포함 */
function clientQuizContextForReveal(ticket, auth) {
  const ctx =
    ticket.quizContext && typeof ticket.quizContext === "object" ? ticket.quizContext : {};
  const topic = ctx.topic != null ? String(ctx.topic).trim() : "";
  const statement = ctx.statement != null ? String(ctx.statement).trim() : "";
  const qid = ctx.questionId != null ? String(ctx.questionId).trim() : "";
  const out = {
    quizTopic: topic || null,
    quizStatement: statement || null,
    questionId: null
  };
  if (qid && isAdminEmailFromAuth(auth)) {
    out.questionId = qid;
  }
  return out;
}

function escapeRegExp(s) {
  return String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sanitizeAnswerForPublic(answer, ticket, viewerUid, askerUid) {
  let out = String(answer || "");
  if (!out) return out;
  // 질문자 본인에게는 원문 유지, 타인 공개 열람에서는 닉네임을 일반 호칭으로 마스킹
  if (viewerUid !== askerUid) {
    const nick =
      ticket && ticket.userNickname != null ? String(ticket.userNickname).trim() : "";
    if (nick) {
      const re = new RegExp(escapeRegExp(nick), "g");
      out = out.replace(re, "회원");
    }
  }
  return out;
}

/**
 * 질문 티켓 승인 후 공개 Q&A 목록(hanlaw_qa_public)에 반영. Admin SDK 쓰기로 Firestore 클라이언트 규칙에 의존하지 않음.
 */
exports.publishLawyerQaPublic = onCall({ region: REGION }, async (request) => {
  try {
    if (!request.auth || !request.auth.uid) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }
    if (!isAdminEmailFromAuth(request.auth)) {
      throw new HttpsError("permission-denied", "관리자만 실행할 수 있습니다.");
    }
    const ticketId = String((request.data && request.data.ticketId) || "").trim();
    if (!ticketId) {
      throw new HttpsError("invalid-argument", "ticketId가 필요합니다.");
    }

    const ticketSnap = await db().collection("hanlaw_tickets").doc(ticketId).get();
    if (!ticketSnap.exists) {
      throw new HttpsError("not-found", "티켓을 찾을 수 없습니다.");
    }
    const ticket = ticketSnap.data();
    const ticketType = String(ticket.type || "")
      .trim()
      .toLowerCase();
    if (ticketType !== "question") {
      throw new HttpsError("failed-precondition", "질문 유형이 아닙니다.");
    }
    const qmsg = String(ticket.message || "").trim();
    if (!qmsg) {
      throw new HttpsError("failed-precondition", "질문 본문이 없습니다.");
    }
    const asker = ticket.userId ? String(ticket.userId) : "";
    if (!asker) {
      throw new HttpsError("failed-precondition", "질문자 정보가 없습니다.");
    }
    if (ticket.qaAllowFutureCommunity === false) {
      return { ok: true, skipped: true };
    }

    const qf = quizFieldsForPublicDoc(ticket);
    const pubPayload = {
      ticketId,
      questionMessage: qmsg.slice(0, 8000),
      publishedAt: FieldValue.serverTimestamp(),
      /** 질문자가 「공개하기」를 누르기 전까지 Q&A 목록·타인 열람 불가 */
      communityVisible: false
    };
    if (qf.quizTopic) pubPayload.quizTopic = qf.quizTopic;
    if (qf.quizStatement) pubPayload.quizStatement = qf.quizStatement;

    await db().collection("hanlaw_qa_public").doc(ticketId).set(pubPayload, { merge: true });

    return { ok: true };
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    logger.error("publishLawyerQaPublic", err);
    const msg = err && err.message ? String(err.message) : String(err);
    throw new HttpsError(
      "failed-precondition",
      "Q&A 공개 목록 저장 중 서버 오류: " + msg
    );
  }
});

/** 공개 Q&A: 질문·답변 본문 부분 일치 검색(최근 공개 건만 스캔) */
const QA_SEARCH_MAX_SCAN = 500;
const QA_SEARCH_MAX_RESULTS = 50;

exports.searchLawyerQa = onCall({ region: REGION }, async (request) => {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
  }
  let raw = String((request.data && request.data.query) || "").trim();
  try {
    raw = raw.normalize("NFC");
  } catch (e) {
    /* ignore */
  }
  if (raw.length < 2) {
    throw new HttpsError("invalid-argument", "검색어는 2글자 이상 입력하세요.");
  }
  if (raw.length > 100) {
    throw new HttpsError("invalid-argument", "검색어는 100자 이하로 입력하세요.");
  }
  const needle = raw.toLowerCase();

  const pubSnap = await db()
    .collection("hanlaw_qa_public")
    .orderBy("publishedAt", "desc")
    .limit(QA_SEARCH_MAX_SCAN)
    .get();

  const matches = [];
  for (const doc of pubSnap.docs) {
    const ticketId = doc.id;
    const pub = doc.data() || {};
    if (pub.communityVisible === false) continue;
    const tSnap = await db().collection("hanlaw_tickets").doc(ticketId).get();
    if (!tSnap.exists) continue;
    const t = tSnap.data();
    const typ = String((t && t.type) || "")
      .trim()
      .toLowerCase();
    if (typ !== "question") continue;
    const qm = String((t && t.message) || "");
    const ar = String((t && t.adminReply) || "");
    const ctx = t && t.quizContext && typeof t.quizContext === "object" ? t.quizContext : {};
    const cstmt = String((ctx && ctx.statement) || "");
    const ctopic = String((ctx && ctx.topic) || "");
    const hay = (qm + "\n" + ar + "\n" + cstmt + "\n" + ctopic).toLowerCase();
    if (!hay.includes(needle)) continue;
    const qtext = String(pub.questionMessage || qm || "").trim() || "(내용 없음)";
    const qf = quizFieldsForPublicDoc(t);
    const matchRow = {
      ticketId,
      questionMessage: qtext.slice(0, 8000)
    };
    if (pub.quizTopic || qf.quizTopic) matchRow.quizTopic = pub.quizTopic || qf.quizTopic;
    if (pub.quizStatement || qf.quizStatement) {
      matchRow.quizStatement = pub.quizStatement || qf.quizStatement;
    }
    matches.push(matchRow);
    if (matches.length >= QA_SEARCH_MAX_RESULTS) break;
  }

  return {
    ok: true,
    matches,
    scanned: pubSnap.docs.length
  };
});

exports.revealLawyerQaAnswer = onCall({ region: REGION }, async (request) => {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
  }
  const viewerUid = request.auth.uid;
  const ticketId = String((request.data && request.data.ticketId) || "").trim();
  if (!ticketId) {
    throw new HttpsError("invalid-argument", "ticketId가 필요합니다.");
  }

  const pubSnap = await db().collection("hanlaw_qa_public").doc(ticketId).get();
  if (!pubSnap.exists) {
    throw new HttpsError("not-found", "공개 목록에 없는 질문입니다.");
  }
  const pub = pubSnap.data();
  const askerUserIdFromPub = pub.askerUserId ? String(pub.askerUserId) : "";

  const ticketSnap = await db().collection("hanlaw_tickets").doc(ticketId).get();
  if (!ticketSnap.exists) {
    throw new HttpsError("not-found", "티켓을 찾을 수 없습니다.");
  }
  const ticket = ticketSnap.data();
  const askerUserId = ticket && ticket.userId ? String(ticket.userId) : askerUserIdFromPub;
  if (!askerUserId) {
    throw new HttpsError("failed-precondition", "질문자 정보가 없습니다.");
  }
  if (viewerUid !== askerUserId && pub.communityVisible === false) {
    throw new HttpsError(
      "permission-denied",
      "아직 Q&A에 공개되지 않은 질문입니다. 질문자가 공개한 뒤에 답변을 볼 수 있습니다."
    );
  }
  const ticketTypeReveal = String(ticket.type || "")
    .trim()
    .toLowerCase();
  if (ticketTypeReveal !== "question") {
    throw new HttpsError("failed-precondition", "질문 유형이 아닙니다.");
  }
  const answerRaw = String(ticket.adminReply || "").trim();
  const answer = sanitizeAnswerForPublic(answerRaw, ticket, viewerUid, askerUserId);
  if (!answer) {
    throw new HttpsError("failed-precondition", "아직 변호사 답변이 등록되지 않았습니다.");
  }

  if (viewerUid === askerUserId) {
    return {
      ok: true,
      answer,
      selfView: true,
      pointsAwardedToAsker: 0,
      ...clientQuizContextForReveal(ticket, request.auth)
    };
  }

  const logRef = db().collection("hanlaw_qa_view_logs").doc(ticketId + "_" + viewerUid);

  const pointsAwardedToAsker = await db().runTransaction(async (tx) => {
    const logSnap = await tx.get(logRef);
    if (logSnap.exists) {
      return 0;
    }
    const attRef = db().collection("hanlaw_attendance_rewards").doc(askerUserId);
    const attSnap = await tx.get(attRef);
    let pts = Math.max(
      0,
      parseInt(attSnap.exists ? attSnap.data().attendancePoints : 0, 10) || 0
    );
    pts += QA_VIEW_REWARD;
    tx.set(logRef, {
      ticketId,
      viewerUid,
      askerUserId,
      pointsAwarded: QA_VIEW_REWARD,
      createdAt: FieldValue.serverTimestamp()
    });
    tx.set(
      attRef,
      {
        attendancePoints: pts,
        updatedAt: FieldValue.serverTimestamp()
      },
      { merge: true }
    );
    appendPointLog(tx, attRef, {
      delta: QA_VIEW_REWARD,
      reason: REASON.QA_VIEW_REWARD,
      balanceAfter: pts,
      meta: { ticketId }
    });
    return QA_VIEW_REWARD;
  });

  return {
    ok: true,
    answer,
    selfView: false,
    pointsAwardedToAsker,
    firstReward: pointsAwardedToAsker > 0,
    ...clientQuizContextForReveal(ticket, request.auth)
  };
});

/**
 * 질문자 본인: 변호사 답변 등록 후 Q&A 섹션에 질문·답변을 공개(옵트인).
 */
exports.publishLawyerQaCommunity = onCall({ region: REGION }, async (request) => {
  try {
    if (!request.auth || !request.auth.uid) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }
    const uid = request.auth.uid;
    const ticketId = String((request.data && request.data.ticketId) || "").trim();
    if (!ticketId) {
      throw new HttpsError("invalid-argument", "ticketId가 필요합니다.");
    }

    const ticketSnap = await db().collection("hanlaw_tickets").doc(ticketId).get();
    if (!ticketSnap.exists) {
      throw new HttpsError("not-found", "티켓을 찾을 수 없습니다.");
    }
    const ticket = ticketSnap.data();
    const ticketType = String(ticket.type || "")
      .trim()
      .toLowerCase();
    if (ticketType !== "question") {
      throw new HttpsError("failed-precondition", "질문 유형이 아닙니다.");
    }
    if (String(ticket.userId || "") !== uid) {
      throw new HttpsError("permission-denied", "본인이 작성한 질문만 공개할 수 있습니다.");
    }
    if (ticket.qaAllowFutureCommunity === false) {
      throw new HttpsError(
        "failed-precondition",
        "질문 접수 시 Q&A 공개를 허용하지 않았습니다. 새 질문에서 공개를 선택한 뒤 이용해 주세요."
      );
    }
    const answer = String(ticket.adminReply || "").trim();
    if (!answer) {
      throw new HttpsError(
        "failed-precondition",
        "변호사 답변이 등록된 뒤에 공개할 수 있습니다."
      );
    }

    const qmsg = String(ticket.message || "").trim();
    if (!qmsg) {
      throw new HttpsError("failed-precondition", "질문 본문이 없습니다.");
    }

    const qf = quizFieldsForPublicDoc(ticket);
    const pubRef = db().collection("hanlaw_qa_public").doc(ticketId);
    const pubSnap = await pubRef.get();
    if (!pubSnap.exists) {
      const pubPayload = {
        ticketId,
        questionMessage: qmsg.slice(0, 8000),
        publishedAt: FieldValue.serverTimestamp(),
        communityVisible: true,
        communityPublishedAt: FieldValue.serverTimestamp()
      };
      if (qf.quizTopic) pubPayload.quizTopic = qf.quizTopic;
      if (qf.quizStatement) pubPayload.quizStatement = qf.quizStatement;
      await pubRef.set(pubPayload, { merge: true });
    } else {
      await pubRef.set(
        {
          communityVisible: true,
          communityPublishedAt: FieldValue.serverTimestamp()
        },
        { merge: true }
      );
    }

    await db().collection("hanlaw_tickets").doc(ticketId).set(
      {
        qaCommunityPublished: true,
        qaCommunityPublishedAt: FieldValue.serverTimestamp()
      },
      { merge: true }
    );

    return { ok: true };
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    logger.error("publishLawyerQaCommunity", err);
    const msg = err && err.message ? String(err.message) : String(err);
    throw new HttpsError("failed-precondition", "Q&A 공개 처리 중 오류: " + msg);
  }
});

/**
 * 질문자 본인: 이미 공개한 질문·답변을 Q&A 목록에서 비공개로 전환.
 */
exports.unpublishLawyerQaCommunity = onCall({ region: REGION }, async (request) => {
  try {
    if (!request.auth || !request.auth.uid) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }
    const uid = request.auth.uid;
    const ticketId = String((request.data && request.data.ticketId) || "").trim();
    if (!ticketId) {
      throw new HttpsError("invalid-argument", "ticketId가 필요합니다.");
    }

    const ticketRef = db().collection("hanlaw_tickets").doc(ticketId);
    const ticketSnap = await ticketRef.get();
    if (!ticketSnap.exists) {
      throw new HttpsError("not-found", "티켓을 찾을 수 없습니다.");
    }
    const ticket = ticketSnap.data();
    const ticketType = String(ticket.type || "")
      .trim()
      .toLowerCase();
    if (ticketType !== "question") {
      throw new HttpsError("failed-precondition", "질문 유형이 아닙니다.");
    }
    if (String(ticket.userId || "") !== uid) {
      throw new HttpsError("permission-denied", "본인이 작성한 질문만 비공개 전환할 수 있습니다.");
    }

    await db().collection("hanlaw_qa_public").doc(ticketId).set(
      {
        communityVisible: false,
        communityUnpublishedAt: FieldValue.serverTimestamp()
      },
      { merge: true }
    );

    await ticketRef.set(
      {
        qaCommunityPublished: false,
        qaCommunityUnpublishedAt: FieldValue.serverTimestamp()
      },
      { merge: true }
    );

    return { ok: true };
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    logger.error("unpublishLawyerQaCommunity", err);
    const msg = err && err.message ? String(err.message) : String(err);
    throw new HttpsError("failed-precondition", "Q&A 비공개 처리 중 오류: " + msg);
  }
});

/** 기존 hanlaw_qa_public 문서에 communityVisible 필드가 없으면 true로 채움(구 데이터 Q&A 노출 유지). 관리자 1회 실행. */
exports.adminBackfillLawyerQaCommunityVisible = onCall({ region: REGION }, async (request) => {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
  }
  if (!isAdminEmailFromAuth(request.auth)) {
    throw new HttpsError("permission-denied", "관리자만 실행할 수 있습니다.");
  }
  let updated = 0;
  let lastDoc = null;
  for (;;) {
    let q = db().collection("hanlaw_qa_public").orderBy(FieldPath.documentId()).limit(400);
    if (lastDoc) q = q.startAfter(lastDoc);
    const snap = await q.get();
    if (!snap.docs.length) break;
    const batch = db().batch();
    let n = 0;
    for (const doc of snap.docs) {
      const d = doc.data();
      if (d.communityVisible === undefined) {
        batch.update(doc.ref, { communityVisible: true });
        n++;
      }
    }
    if (n > 0) {
      await batch.commit();
      updated += n;
    }
    lastDoc = snap.docs[snap.docs.length - 1];
    if (snap.docs.length < 400) break;
  }
  return { ok: true, updated };
});
