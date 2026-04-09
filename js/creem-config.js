/**
 * Creem.io 결제 연동 설정
 * https://creem.io 대시보드 → Products에서 $7 / $70 / $100 상품을 만든 뒤
 * 각 상품의「공유」결제 링크를 아래에 붙여 넣으세요. (노코드 방식)
 *
 * Checkout API로 세션을 만들려면 API 키가 필요하므로 서버(또는 서버리스)에서
 * 호출해야 합니다. 문서: https://docs.creem.io/getting-started/quickstart
 */
window.CREEM_CONFIG = {
  /** 결제 완료 후 돌아올 URL은 Creem 상품/링크 설정에서 지정합니다. */
  docsUrl: "https://docs.creem.io",
  dashboardUrl: "https://creem.io/dashboard",
  /**
   * 구독·일회성 주문 관리·해지(Creem 고객 포털 로그인).
   * 비우면 기본값 https://creem.io/my-orders/login 사용
   */
  customerPortalUrl: "https://creem.io/my-orders/login",
  /** 환불 절차 안내(Creem 고객용 도움말). */
  refundHelpDocUrl:
    "https://docs.creem.io/for-customers/how-to-cancel-subscription",
  /**
   * 운영(판매자) 이메일. 넣으면 요금제의 「환불·결제 문의」버튼이 메일 작성창으로 연결됩니다.
   * 비우면 위 refundHelpDocUrl 안내 페이지를 엽니다.
   */
  merchantSupportEmail: "",
  links: {
    monthly: "",
    yearly: "",
    twoYear: "",
    /** 질문권 1건 $2(USD) 일회성 결제 링크 */
    q1: "",
    /** 질문권 10건 $10(USD) 일회성 결제 링크 */
    q10: ""
  },
  /**
   * Creem 체크아웃에 메타데이터로 firebase_uid(또는 hanlaw_question_pack)를 넘기도록 설정하세요.
   * Cloud Functions creemQuestionWebhook 이 checkout.completed 시 지갑에 반영합니다.
   * Functions 환경변수 CREEM_Q1_PRODUCT_IDS / CREEM_Q10_PRODUCT_IDS 에 상품 ID를 넣으면 메타 없이도 매칭됩니다.
   */
  questionPackHelp:
    "질문권: 결제 링크/상품에 메타데이터 firebase_uid(로그인 UID)와 hanlaw_question_pack(값 1 또는 10)을 넣거나, Functions에 상품 ID를 등록하세요.",
  /**
   * 질문권 부족 알림·모달 등에 쓰는 구매 가격 표기(USD).
   * 이 값만 바꾸면 ticket-modal·Creem 안내 문구가 함께 바뀝니다.
   */
  questionPackPricesDisplay: "1건 $2 · 10건 $10 USD"
};

/** @returns {string} */
window.getQuestionPackPricesDisplay = function () {
  var c = window.CREEM_CONFIG || {};
  return c.questionPackPricesDisplay || "1건 $2 · 10건 $10 USD";
};
