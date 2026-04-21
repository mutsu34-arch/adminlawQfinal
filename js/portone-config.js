/**
 * PortOne(아임포트) 전환 설정.
 * 실제 키/PG 값은 전환 시점에 채우세요.
 */
(function () {
  window.PORTONE_CONFIG = Object.assign(
    {
      enabled: false,
      storeLabel: "행정법Q",
      channelKey: "",
      pg: "",
      payMethod: "CARD",
      notice:
        "결제 서비스 전환 작업 중입니다. 현재는 결제를 이용할 수 없습니다. 준비가 완료되면 포트원 결제가 자동으로 열립니다."
    },
    window.PORTONE_CONFIG || {}
  );
})();
