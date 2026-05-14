/**
 * Firebase 콘솔(https://console.firebase.google.com)에서 프로젝트 생성 후
 * 프로젝트 설정 > 일반 > 내 앱 > 웹 앱 구성 값을 아래에 붙여 넣으세요.
 * Authentication에서 이메일/비밀번호, Google 로그인을 사용 설정하세요.
 */
window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyCCI91pU9mmX5OZPKff-Myk1f2EAd6dzrw",
  authDomain: "adminlawq.ellution.co.kr",
  projectId: "adminlawq-b9dad",
  storageBucket: "adminlawq-b9dad.firebasestorage.app",
  messagingSenderId: "781477414814",
  appId: "1:781477414814:web:f202dc9cddc6510559388f",
  measurementId: "G-0K0S0KQ63Q"
};

/**
 * Firestore·Storage 등에서 앱이 아직 없으면 초기화합니다(auth.js보다 먼저 로드되는 스크립트용).
 * @returns {boolean}
 */
window.ensureHanlawFirebaseApp = function () {
  if (typeof firebase === "undefined") return false;
  var c = window.FIREBASE_CONFIG || {};
  if (!c.apiKey || !c.projectId) return false;
  if (String(c.apiKey).indexOf("YOUR_") === 0) return false;
  try {
    if (!firebase.apps.length) {
      firebase.initializeApp(c);
    }
    return true;
  } catch (err) {
    console.warn("Firebase initializeApp:", err);
    return false;
  }
};

/** Cloud Functions 리전. functions/index.js 와 동일하게 맞추세요. */
window.FIREBASE_FUNCTIONS_REGION = "asia-northeast3";

/**
 * 엑셀에 examId·year 열이 없을 때만 사용(js/exam-catalog.js 의 id·연도와 맞출 것).
 * 퀴즈 왼쪽 시험·연도 선택과 같아야 문항이 나옵니다.
 */
window.HANLAW_EXCEL_DEFAULT_EXAM_ID = "grade9";
window.HANLAW_EXCEL_DEFAULT_YEAR = 2025;

/**
 * true: 상단 버튼이 목업 관리자로만 즉시 로그인(로그인 창·Google 버튼이 안 보임). Firestore 쓰기는 실제 Firebase 로그인이 필요하므로 false 권장.
 */
window.USE_MOCK_ADMIN_LOGIN = false;
/** 목업 사용 시에만 쓰는 이메일 */
window.MOCK_ADMIN_EMAIL = "admin@mock.hanlaw.local";

/** 관리자로 인정할 로그인 이메일(소문자 비교). firestore.rules·storage.rules 의 관리자 목록과 맞추세요. */
window.ADMIN_EMAILS = ["mutsu34@gmail.com"].map(function (e) {
  return String(e).toLowerCase();
});
if (window.USE_MOCK_ADMIN_LOGIN && window.MOCK_ADMIN_EMAIL) {
  var _m = String(window.MOCK_ADMIN_EMAIL).toLowerCase();
  if (window.ADMIN_EMAILS.indexOf(_m) < 0) window.ADMIN_EMAILS.push(_m);
}

/**
 * 본인인증 게이트 우회
 *
 * - HANLAW_BYPASS_IDENTITY_GATE_ON_LOCALHOST (기본 true): 호스트가 localhost / 127.0.0.1 일 때
 *   로그인만 되면 본인인증 없이 앱 사용(로컬 개발용). 운영 URL에서는 적용되지 않습니다.
 * - HANLAW_ADMIN_BYPASS_IDENTITY_GATE (기본 true): ADMIN_EMAILS 에 포함된 계정은 어떤 호스트에서도 게이트 생략.
 * - HANLAW_IDENTITY_GATE_BYPASS_EMAILS: 위 관리자 외에 우회할 일반 테스트 계정 이메일(소문자 권장).
 * - HANLAW_BYPASS_IDENTITY_GATE (기본 false): true 면 모든 계정·모든 호스트에서 게이트 비활성(비상·내부용만).
 */
window.HANLAW_BYPASS_IDENTITY_GATE_ON_LOCALHOST = true;
window.HANLAW_BYPASS_IDENTITY_GATE = false;
window.HANLAW_ADMIN_BYPASS_IDENTITY_GATE = true;
/** 본인인증 게이트 우회(일반 테스트 계정). 비밀번호는 여기에 두지 않습니다. Firebase Authentication 에 동일 이메일 계정이 있어야 로그인됩니다(콘솔에서 추가하거나 앱에서 회원가입). */
window.HANLAW_IDENTITY_GATE_BYPASS_EMAILS = ["test@ellution.co.kr"];

/** 문의·신고: Firestore(hanlaw_tickets, hanlaw_notifications) + Storage(ticket_images/) + 질문권(hanlaw_question_wallet, Functions) + AI 초안은 Gemini */
