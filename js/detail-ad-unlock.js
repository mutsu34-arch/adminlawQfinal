/**
 * 상세 해설(detail) 열람 게이트.
 * 정책: 유료 구독 회원(및 관리자)만 상세 해설을 열람할 수 있습니다.
 * 무료 회원에게는 구독 안내(요금제 이동) UI를 표시합니다.
 * (과거 광고 시청 해제 기능은 운영 정책 변경으로 제거되었습니다.)
 */
(function () {
  function canViewDetail() {
    return typeof window.isPaidMember === "function" && window.isPaidMember();
  }

  function scrollToPricingSubscriptionBlock() {
    var anchor = document.getElementById("pricing-subscription-anchor");
    if (anchor) {
      anchor.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    var panel = document.getElementById("panel-pricing");
    if (panel) {
      try {
        panel.scrollIntoView({ behavior: "smooth", block: "start" });
      } catch (e) {}
    }
  }

  function goPricing() {
    if (typeof window.hanlawNavigateToPanel === "function") {
      window.hanlawNavigateToPanel("pricing");
    } else {
      var b = document.querySelector('.nav-main__btn[data-panel="pricing"]');
      if (b) b.click();
    }
    window.setTimeout(scrollToPricingSubscriptionBlock, 0);
    window.setTimeout(scrollToPricingSubscriptionBlock, 120);
  }

  /**
   * @param {HTMLElement} container
   * @param {{ detail?: object, explanation?: string, explanationBasic?: string }} q
   * @param {function(HTMLElement, object|undefined, object): void} buildDetailBlocks — (container, detail, q)
   */
  function render(container, q, buildDetailBlocks) {
    if (!container || !q) return;
    if (typeof buildDetailBlocks !== "function") return;

    if (canViewDetail()) {
      buildDetailBlocks(container, q.detail, q);
      return;
    }

    container.innerHTML = "";
    var wrap = document.createElement("div");
    wrap.className = "feedback-detail-lock";

    var p1 = document.createElement("p");
    p1.className = "feedback-premium-lock";
    p1.textContent = "법리·함정·판례 등 상세 해설은 유료 구독 회원에게 제공됩니다.";
    wrap.appendChild(p1);

    var btnSubOnly = document.createElement("button");
    btnSubOnly.type = "button";
    btnSubOnly.className = "btn btn--primary feedback-detail-unlock-btn";
    btnSubOnly.textContent = "요금제에서 구독하기";
    btnSubOnly.addEventListener("click", function () {
      goPricing();
    });
    wrap.appendChild(btnSubOnly);
    container.appendChild(wrap);
  }

  window.addEventListener("membership-updated", function () {
    try {
      if (canViewDetail()) {
        window.dispatchEvent(new CustomEvent("hanlaw-detail-unlocked"));
      }
    } catch (e) {}
  });

  window.HanlawDetailUnlock = {
    canViewDetail: canViewDetail,
    render: render
  };
})();
