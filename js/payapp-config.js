/**
 * 페이앱(PayApp) — 표시용 문구
 * 실제 금액은 Cloud Functions 환경변수와 일치시키세요.
 * @see https://docs.payapp.kr/dev_center01.html
 */
window.PAYAPP_CONFIG = {
  docsUrl: "https://docs.payapp.kr/dev_center01.html",
  /** 환불·결제 문의 — 비우면 문의 버튼이 개발자 문서로 연결됩니다. */
  merchantSupportEmail: "",
  /** 질문권 (서버 기본: PAYAPP_KRW_Q1 / Q10) */
  questionPackKrwDisplay: "1건 ₩3,000 · 10건 ₩15,000",
  /** 월 구독만 (서버 기본: PAYAPP_KRW_SUB_MONTHLY) — 페이앱 정기결제(rebill) */
  subscriptionKrwDisplay: "월 ₩10,000",
  /** 기간권·1년·2년 일회 표시 (1년·2년 정가는 월 ₩15,000 기준) */
  nonRenewKrwDisplay:
    "1개월 ₩15,000 · 3개월 ₩42,750(정가 대비 5%) · 6개월 ₩81,000(10%) · 1년 ₩100,000(약 44%) · 2년 ₩150,000(약 58%)"
};

window.getPayAppQuestionPackKrwDisplay = function () {
  var c = window.PAYAPP_CONFIG || {};
  return c.questionPackKrwDisplay || "1건 ₩3,000 · 10건 ₩15,000";
};

window.getPayAppSubscriptionKrwDisplay = function () {
  var c = window.PAYAPP_CONFIG || {};
  return c.subscriptionKrwDisplay || "월 ₩10,000";
};

window.getPayAppNonRenewKrwDisplay = function () {
  var c = window.PAYAPP_CONFIG || {};
  return (
    c.nonRenewKrwDisplay ||
    "1개월 ₩15,000 · 3개월 ₩42,750(정가 대비 5%) · 6개월 ₩81,000(10%) · 1년 ₩100,000(약 44%) · 2년 ₩150,000(약 58%)"
  );
};

/** 티켓 모달 등 질문권 가격 안내 (원화만) */
window.getQuestionPackPricesDisplay = function () {
  var c = window.PAYAPP_CONFIG || {};
  return c.questionPackPricesDisplay || window.getPayAppQuestionPackKrwDisplay();
};
