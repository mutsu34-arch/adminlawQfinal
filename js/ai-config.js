/**
 * 스택 정리
 * - 로그인·데이터베이스: Firebase 콘솔 (Authentication, Firestore, Storage 등).
 *   웹 앱 설정은 js/firebase-config.js 에 반영합니다.
 * - AI 문의 초안: Google Gemini. API 키는 브라우저에 두지 말고,
 *   Cloud Functions·Cloud Run 등 서버에서 Gemini API를 호출한 뒤
 *   아래 HTTPS URL로만 연결하세요.
 *
 * 엔드포인트 계약 (POST, JSON):
 *   요청 본문: tickets-service.js 의 fetchAIDraftForTicket 과 동일
 *     { ticketId, type, message, imageUrls?, linkUrls?, quizContext? }
 *   type 이 promotion 이면 홍보 인증 회신 초안(승인/보완 톤), question 이면 질문 답변, report 면 신고 안내로 생성하세요.
 *   응답: { "draft": "..." } 또는 { "text": "..." }
 *
 * 비우면(권장): 관리자가 Cloud Functions의 adminDraftTicketAi(서버 Gemini)를 호출합니다.
 *   배포: firebase deploy --only functions — Functions에 GEMINI_API_KEY 설정 필요.
 * 커스텀 URL을 쓰면 그쪽을 먼저 시도하고, 실패 시 adminDraftTicketAi로 폴백합니다.
 */
window.AI_DRAFT_ENDPOINT = "";
