/**
 * 요금제 패널의 PG 선택·환경변수 안내 등은 관리자(ADMIN_EMAILS)와 지정 테스트 계정에게만 표시합니다.
 */
(function () {
  var TEST_PRICING_EMAIL = "test@ellution.co.kr";

  function normalizedViewerEmail() {
    var u = typeof window.getHanlawUser === "function" ? window.getHanlawUser() : null;
    if (u && u.email) return String(u.email).toLowerCase().trim();
    try {
      if (typeof firebase !== "undefined" && firebase.auth && firebase.auth().currentUser) {
        var cu = firebase.auth().currentUser;
        if (cu && cu.email) return String(cu.email).toLowerCase().trim();
        if (cu && cu.providerData && cu.providerData.length) {
          for (var i = 0; i < cu.providerData.length; i++) {
            var em = cu.providerData[i] && cu.providerData[i].email;
            if (em) return String(em).toLowerCase().trim();
          }
        }
      }
    } catch (e) {}
    return "";
  }

  function isListedAdminEmail(email) {
    if (!email) return false;
    var emails = window.ADMIN_EMAILS || [];
    for (var i = 0; i < emails.length; i++) {
      if (String(emails[i]).toLowerCase() === email) return true;
    }
    return false;
  }

  function shouldShowPricingDevSections() {
    var mail = normalizedViewerEmail();
    if (!mail) return false;
    if (mail === TEST_PRICING_EMAIL) return true;
    return isListedAdminEmail(mail);
  }

  window.syncPricingDevSectionsVisibility = function () {
    var on = shouldShowPricingDevSections();
    var dev = document.getElementById("pricing-checkout-devtools");
    var note = document.getElementById("pricing-recurring-devnote");
    if (dev) dev.hidden = !on;
    if (note) note.hidden = !on;
  };

  function bind() {
    window.syncPricingDevSectionsVisibility();
    window.addEventListener("app-auth", function () {
      window.syncPricingDevSectionsVisibility();
    });
    try {
      if (typeof firebase !== "undefined" && firebase.auth) {
        firebase.auth().onAuthStateChanged(function () {
          window.syncPricingDevSectionsVisibility();
        });
      }
    } catch (e) {}
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }
})();
