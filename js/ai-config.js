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
 *     { ticketId, type, message, imageUrls?, quizContext? }
 *   응답: { "draft": "..." } 또는 { "text": "..." }
 *
 * 비우면: 관리자 화면에서는 데모용 고정 문구 초안만 채워집니다.
 */
window.AI_DRAFT_ENDPOINT = "";
