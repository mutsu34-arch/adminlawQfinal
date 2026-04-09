/**
 * Firebase 실제 로그인 사용자가 있으면 우선, 없으면 목업 로그인(__hanlawMockUser)을 반환합니다.
 * firebase-config.js 다음, auth.js 이전에 로드하세요.
 */
(function () {
  window.getHanlawUser = function () {
    try {
      if (typeof firebase !== "undefined" && firebase.auth) {
        var u = firebase.auth().currentUser;
        if (u) return u;
      }
    } catch (e) {}
    return window.__hanlawMockUser || null;
  };
})();
