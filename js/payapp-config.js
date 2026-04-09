/**
 * 페이앱(PayApp) — 표시용 문구
 * 실제 금액은 Cloud Functions 환경변수와 일치시키세요.
 * @see https://docs.payapp.kr/dev_center01.html
 */
window.PAYAPP_CONFIG = {
  docsUrl: "https://docs.payapp.kr/dev_center01.html",
  /** 질문권 (서버 기본: PAYAPP_KRW_Q1 / Q10) */
  questionPackKrwDisplay: "1건 ₩3,000 · 10건 ₩15,000",
  /** 구독 (서버 기본: 월 10000 · 연 100000 · 2년 150000) */
  subscriptionKrwDisplay: "월 ₩10,000 · 연 ₩100,000 · 2년 ₩150,000"
};

window.getPayAppQuestionPackKrwDisplay = function () {
  var c = window.PAYAPP_CONFIG || {};
  return c.questionPackKrwDisplay || "1건 ₩3,000 · 10건 ₩15,000";
};

window.getPayAppSubscriptionKrwDisplay = function () {
  var c = window.PAYAPP_CONFIG || {};
  return c.subscriptionKrwDisplay || "월 ₩10,000 · 연 ₩100,000 · 2년 ₩150,000";
};
