/**
 * PortOne 전환 전 임시 차단 + 전환 골격.
 * 기존 data-payapp-* 버튼을 그대로 받아 결제 진입을 통제한다.
 */
(function () {
  function cfg() {
    return window.PORTONE_CONFIG || {};
  }

  function isEnabled() {
    return cfg().enabled === true;
  }

  function showBlockedNotice() {
    var msg =
      String(cfg().notice || "").trim() ||
      "결제 서비스 전환 작업 중입니다. 현재는 결제를 이용할 수 없습니다.";
    window.alert(msg);
  }

  function disableLegacyButtons() {
    var selectors = [
      "[data-payapp-pack]",
      "[data-payapp-elly-pack]",
      "[data-payapp-sub]",
      "#dashboard-buy-question-credits"
    ];
    var nodes = document.querySelectorAll(selectors.join(","));
    nodes.forEach(function (btn) {
      if (!btn || btn.dataset.portoneBound === "1") return;
      btn.dataset.portoneBound = "1";
      if (!isEnabled()) {
        btn.disabled = true;
        if (btn.tagName === "BUTTON") {
          btn.title = "결제 서비스 전환 작업 중";
          if (btn.textContent && btn.textContent.indexOf("결제") >= 0) {
            btn.textContent = "결제 준비중";
          }
        }
      }
    });
  }

  function bindClickBlocker() {
    document.body.addEventListener(
      "click",
      function (e) {
        var target =
          e.target && e.target.closest
            ? e.target.closest("[data-payapp-pack],[data-payapp-elly-pack],[data-payapp-sub],#dashboard-buy-question-credits")
            : null;
        if (!target) return;
        if (isEnabled()) {
          // TODO: PortOne 결제창 호출 구현 위치
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        showBlockedNotice();
      },
      true
    );
  }

  function bindLegacyInfoButtons() {
    ["dashboard-payapp-rebill-cancel"].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      el.addEventListener("click", function (e) {
        if (isEnabled()) return;
        e.preventDefault();
        showBlockedNotice();
      });
    });
  }

  function init() {
    disableLegacyButtons();
    bindClickBlocker();
    bindLegacyInfoButtons();
  }

  window.HanlawPortoneCheckout = {
    isEnabled: isEnabled
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
