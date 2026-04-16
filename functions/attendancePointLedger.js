"use strict";

const { FieldValue } = require("firebase-admin/firestore");

/** 클라이언트 표시·검색용 코드 */
const REASON = {
  QUIZ_DAILY: "quiz_daily",
  CONVERT_LAWYER: "convert_lawyer",
  CONVERT_ELLY: "convert_elly",
  PROMOTION: "promotion",
  SUGGESTION: "suggestion",
  QA_VIEW_REWARD: "qa_view_reward"
};

const DEFAULT_LABELS = {
  [REASON.QUIZ_DAILY]: "퀴즈 출석 보상",
  [REASON.CONVERT_LAWYER]: "변호사 질문권으로 전환(차감)",
  [REASON.CONVERT_ELLY]: "엘리(AI) 질문권으로 전환(차감)",
  [REASON.PROMOTION]: "홍보 인증 보상",
  [REASON.SUGGESTION]: "개선 의견 채택 보상",
  [REASON.QA_VIEW_REWARD]: "공개 Q&A 답변 최초 열람 보상(질문자)"
};

/**
 * hanlaw_attendance_rewards/{uid}/point_log 에 한 줄 기록(트랜잭션 안에서 호출).
 * @param {FirebaseFirestore.Transaction} transaction
 * @param {FirebaseFirestore.DocumentReference} attendanceRewardsRef
 * @param {{ delta: number, reason: string, balanceAfter: number, label?: string, meta?: object }} opts
 */
function appendPointLog(transaction, attendanceRewardsRef, opts) {
  const delta = Math.trunc(Number(opts && opts.delta)) || 0;
  const reason = String((opts && opts.reason) || "unknown");
  const balanceAfter = Math.max(0, Math.trunc(Number(opts && opts.balanceAfter)) || 0);
  const label =
    opts && opts.label != null && String(opts.label).trim()
      ? String(opts.label).trim()
      : DEFAULT_LABELS[reason] || "포인트 변경";

  const logRef = attendanceRewardsRef.collection("point_log").doc();
  const row = {
    delta,
    reason,
    label,
    balanceAfter,
    createdAt: FieldValue.serverTimestamp()
  };
  if (opts && opts.meta && typeof opts.meta === "object" && Object.keys(opts.meta).length) {
    row.meta = opts.meta;
  }
  transaction.set(logRef, row);
}

module.exports = {
  appendPointLog,
  REASON,
  DEFAULT_LABELS
};
