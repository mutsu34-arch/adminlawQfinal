/**
 * 페이앱(PayApp) — 표시용 문구
 * 실제 금액은 Cloud Functions 환경변수와 일치시키세요.
 * @see https://docs.payapp.kr/dev_center01.html
 */
window.PAYAPP_CONFIG = {
  docsUrl: "https://docs.payapp.kr/dev_center01.html",
  /** 환불·결제 문의 — 비우면 문의 버튼이 개발자 문서로 연결됩니다. */
  merchantSupportEmail: "",
  /** 엘리(AI) 질문권 (PAYAPP_KRW_EQ10 / EQ20 / EQ30) — 일일 한도 초과 시 추가용 */
  ellyQuestionPackKrwDisplay: "10건 ₩5,000 · 20건 ₩10,000 · 30건 ₩15,000",
  /** 월 정기 구독(페이앱 rebill) */
  subscriptionKrwDisplay: "정기 구독: 베이직 월 ₩10,000 · 슈퍼 ₩15,000 · 울트라 ₩20,000",
  /** 1개월 구독권(일회) */
  nonRenewKrwDisplay: "1개월권: 베이직 ₩12,000 · 슈퍼 ₩18,000 · 울트라 ₩24,000"
};

window.getPayAppEllyQuestionPackKrwDisplay = function () {
  var c = window.PAYAPP_CONFIG || {};
  return c.ellyQuestionPackKrwDisplay || "10건 ₩5,000 · 20건 ₩10,000 · 30건 ₩15,000";
};

window.getPayAppSubscriptionKrwDisplay = function () {
  var c = window.PAYAPP_CONFIG || {};
  return c.subscriptionKrwDisplay || "월 ₩10,000";
};

window.getPayAppNonRenewKrwDisplay = function () {
  var c = window.PAYAPP_CONFIG || {};
  return c.nonRenewKrwDisplay || "1개월권: 베이직 ₩12,000 · 슈퍼 ₩18,000 · 울트라 ₩24,000";
};

/** 레거시 호환: 엘리 질문권 팩 가격 표시 */
window.getQuestionPackPricesDisplay = function () {
  return window.getPayAppEllyQuestionPackKrwDisplay();
};
