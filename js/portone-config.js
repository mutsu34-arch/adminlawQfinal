/**
 * PortOne(포트원) V2 브라우저 결제 설정
 *
 * enabled: true 이면 data-portone-product 버튼이 포트원 결제창으로 연결됩니다.
 * 스토어 ID·채널 키·API 시크릿은 클라이언트에 두지 말고 Firebase Functions 환경변수에만 설정하세요:
 *   PORTONE_STORE_ID, PORTONE_CHANNEL_KEY_KPN, PORTONE_API_SECRET
 *
 * KPN 채널 추가: 포트원 관리자콘솔 결제 연동 채널관리
 * @see https://help.portone.io/content/kpn
 */
(function () {
  window.PORTONE_CONFIG = Object.assign(
    {
      enabled: true,
      sdkUrl: "https://cdn.portone.io/v2/browser-sdk.js",
      // true면 레이어 대신 리다이렉트 기반으로 결제창을 엽니다(가독성 개선 목적)
      preferRedirect: true
    },
    window.PORTONE_CONFIG || {}
  );
})();
