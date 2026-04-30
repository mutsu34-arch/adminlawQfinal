/**
 * 요금제·엘리 팩 표시용 문구 (실제 청구 금액은 Cloud Functions / PortOne과 맞출 것)
 */
(function () {
  window.PRICING_DISPLAY = {
    merchantSupportEmail: "",
    ellyQuestionPackKrwDisplay: "10건 ₩5,000 · 20건 ₩10,000 · 30건 ₩15,000",
    subscriptionKrwDisplay: "정기 구독: 베이직 월 ₩10,000 · 슈퍼 ₩15,000 · 울트라 ₩20,000",
    nonRenewKrwDisplay: "1개월권: 베이직 ₩12,000 · 슈퍼 ₩18,000 · 울트라 ₩24,000"
  };

  window.getEllyQuestionPackKrwDisplay = function () {
    var c = window.PRICING_DISPLAY || {};
    return c.ellyQuestionPackKrwDisplay || "10건 ₩5,000 · 20건 ₩10,000 · 30건 ₩15,000";
  };

  window.getSubscriptionKrwDisplay = function () {
    var c = window.PRICING_DISPLAY || {};
    return c.subscriptionKrwDisplay || "월 ₩10,000";
  };

  window.getNonRenewKrwDisplay = function () {
    var c = window.PRICING_DISPLAY || {};
    return c.nonRenewKrwDisplay || "1개월권: 베이직 ₩12,000 · 슈퍼 ₩18,000 · 울트라 ₩24,000";
  };

  window.getQuestionPackPricesDisplay = function () {
    return window.getEllyQuestionPackKrwDisplay();
  };
})();
