/**
 * 무료 회원: 상세 해설(detail)은 유료 또는 광고 확인 후 일정 기간 열람.
 * Google AdSense 표시 단위는 window.HANLAW_ADSENSE_DETAIL 로 설정 (ca-pub·slot).
 * 애드센스 정책·프로그램 규정은 사이트 운영자가 준수해야 합니다.
 */
(function () {
  var STORAGE_KEY = "hanlaw_detail_ad_unlock_v1";

  /**
   * unlockPolicy:
   * - "everyDetail" (기본): 문항의 상세 해설을 열 때마다 광고 확인(저장 없음)
   * - "timeWindow": 광고 확인 후 unlockTtlMs 동안(로컬 저장) 모든 문항 상세 해설 열람
   */
  function getConfig() {
    var c = window.HANLAW_ADSENSE_DETAIL;
    if (!c || typeof c !== "object") c = {};
    var enabled = c.enabled === true;
    var client = String(c.client || "").trim();
    var slot = String(c.slot || "").trim();
    var policyRaw = String(c.unlockPolicy || "everyDetail").trim().toLowerCase();
    var unlockPolicy = policyRaw === "everydetail" || policyRaw === "every_detail" ? "everyDetail" : "timeWindow";
    return {
      enabled: enabled,
      client: client,
      slot: slot,
      unlockPolicy: unlockPolicy,
      minViewMs:
        typeof c.minViewMs === "number" && c.minViewMs >= 0 ? Math.min(c.minViewMs, 120000) : 8000,
      unlockTtlMs:
        typeof c.unlockTtlMs === "number" && c.unlockTtlMs > 0
          ? Math.min(c.unlockTtlMs, 86400000 * 30)
          : 86400000
    };
  }

  function readExpiry() {
    try {
      var s = localStorage.getItem(STORAGE_KEY);
      if (!s) return 0;
      var o = JSON.parse(s);
      return typeof o.exp === "number" ? o.exp : 0;
    } catch (e) {
      return 0;
    }
  }

  function isUnlockedByAd() {
    return Date.now() < readExpiry();
  }

  function grantUnlock(ttlMs) {
    var cfg = getConfig();
    if (cfg.unlockPolicy === "everyDetail") {
      try {
        window.dispatchEvent(new CustomEvent("hanlaw-detail-unlocked"));
      } catch (e) {}
      return;
    }
    ttlMs = ttlMs != null ? ttlMs : cfg.unlockTtlMs;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ exp: Date.now() + ttlMs }));
    } catch (e) {}
    try {
      window.dispatchEvent(new CustomEvent("hanlaw-detail-unlocked"));
    } catch (e2) {}
  }

  function canViewDetail() {
    if (typeof window.isPaidMember === "function" && window.isPaidMember()) return true;
    if (getConfig().unlockPolicy === "everyDetail") return false;
    return isUnlockedByAd();
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

  var adScriptLoading = false;
  function loadAdSenseScript(clientId, done) {
    if (window.__hanlawAdsenseScriptReady) {
      done();
      return;
    }
    if (adScriptLoading) {
      var t = setInterval(function () {
        if (window.adsbygoogle || window.__hanlawAdsenseScriptFailed) {
          clearInterval(t);
          done();
        }
      }, 100);
      return;
    }
    adScriptLoading = true;
    var s = document.createElement("script");
    s.async = true;
    s.crossOrigin = "anonymous";
    s.src =
      "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=" +
      encodeURIComponent(clientId);
    s.onload = function () {
      window.__hanlawAdsenseScriptReady = true;
      adScriptLoading = false;
      done();
    };
    s.onerror = function () {
      window.__hanlawAdsenseScriptFailed = true;
      adScriptLoading = false;
      done();
    };
    document.head.appendChild(s);
  }

  /**
   * @param {HTMLElement} container
   * @param {{ detail: object }} q
   * @param {function(HTMLElement, object): void} buildDetailBlocks — (container, detailObject)
   */
  function render(container, q, buildDetailBlocks) {
    if (!container || !q || !q.detail) return;
    if (typeof buildDetailBlocks !== "function") return;

    if (typeof window.isPaidMember === "function" && window.isPaidMember()) {
      buildDetailBlocks(container, q.detail);
      return;
    }
    if (canViewDetail()) {
      buildDetailBlocks(container, q.detail);
      return;
    }

    container.innerHTML = "";
    var cfg = getConfig();
    var wrap = document.createElement("div");
    wrap.className = "feedback-detail-lock";

    var p1 = document.createElement("p");
    p1.className = "feedback-premium-lock";
    p1.textContent =
      cfg.unlockPolicy === "everyDetail"
        ? "법리·함정·판례 등 상세 해설은 유료 구독 회원에게 제공됩니다. 무료 회원은 이 문항마다 아래 광고를 확인한 뒤 상세 해설을 열 수 있습니다."
        : "법리·함정·판례 등 상세 해설은 유료 구독 회원에게 제공됩니다. 아래 광고를 확인한 뒤에는 일정 시간 동안 무료로 열람할 수 있습니다.";
    wrap.appendChild(p1);

    if (!cfg.enabled) {
      var btnSubOnly = document.createElement("button");
      btnSubOnly.type = "button";
      btnSubOnly.className = "btn btn--primary feedback-detail-unlock-btn";
      btnSubOnly.textContent = "요금제에서 구독하기";
      btnSubOnly.addEventListener("click", function () {
        goPricing();
      });
      wrap.appendChild(btnSubOnly);
      container.appendChild(wrap);
      return;
    }

    var sub = document.createElement("p");
    sub.className = "feedback-detail-lock__sub";
    sub.textContent =
      "Google AdSense 광고가 표시됩니다. 광고 영역이 보인 뒤 안내에 따라 버튼이 활성화되면 눌러 주세요.";
    wrap.appendChild(sub);

    var adSlot = document.createElement("div");
    adSlot.className = "hanlaw-detail-ad-slot";
    adSlot.setAttribute("aria-label", "광고");

    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn--secondary feedback-detail-unlock-btn";
    btn.disabled = true;

    var hint = document.createElement("p");
    hint.className = "feedback-detail-unlock-hint";

    wrap.appendChild(adSlot);
    wrap.appendChild(btn);
    wrap.appendChild(hint);
    container.appendChild(wrap);

    function applyDetail() {
      buildDetailBlocks(container, q.detail);
    }

    if (!cfg.client || !cfg.slot) {
      btn.disabled = false;
      btn.textContent = "요금제에서 구독하기";
      btn.className = "btn btn--primary feedback-detail-unlock-btn";
      btn.addEventListener("click", function () {
        goPricing();
      });
      return;
    }

    var startTs = Date.now();
    var minMs = cfg.minViewMs;
    var timer = null;

    function scheduleBtnUpdate() {
      var elapsed = Date.now() - startTs;
      var leftSec = Math.ceil(Math.max(0, minMs - elapsed) / 1000);
      if (elapsed >= minMs) {
        btn.disabled = false;
        btn.textContent = "상세 해설 보기";
        if (cfg.unlockPolicy === "everyDetail") {
          hint.textContent =
            "버튼을 누르면 이 문항의 상세 해설만 열립니다. 다른 문항으로 이동하면 다시 광고 확인이 필요합니다.";
        } else {
          var hrs = cfg.unlockTtlMs / 3600000;
          hint.textContent =
            "버튼을 누르면 이 기기에서 약 " +
            (hrs >= 1 ? Math.round(hrs) + "시간" : Math.round(cfg.unlockTtlMs / 60000) + "분") +
            " 동안 상세 해설이 열립니다.";
        }
        return;
      }
      btn.disabled = true;
      btn.textContent = "잠시 후 활성화 (" + leftSec + "초)";
      hint.textContent = "광고가 표시되는 동안 잠시만 기다려 주세요.";
      timer = window.setTimeout(scheduleBtnUpdate, 400);
    }

    loadAdSenseScript(cfg.client, function () {
      var adFailed = false;
      try {
        var ins = document.createElement("ins");
        ins.className = "adsbygoogle";
        ins.style.display = "block";
        ins.setAttribute("data-ad-client", cfg.client);
        ins.setAttribute("data-ad-slot", cfg.slot);
        ins.setAttribute("data-ad-format", "auto");
        ins.setAttribute("data-full-width-responsive", "true");
        adSlot.appendChild(ins);
        (window.adsbygoogle = window.adsbygoogle || []).push({});
      } catch (e) {
        adFailed = true;
        hint.textContent =
          "광고를 불러오지 못했습니다. 차단 여부를 확인하거나 유료 구독을 이용해 주세요.";
        btn.disabled = false;
        btn.textContent = "요금제 보기";
        btn.className = "btn btn--outline feedback-detail-unlock-btn";
        btn.addEventListener("click", function () {
          goPricing();
        });
      }
      if (!adFailed) {
        scheduleBtnUpdate();
        btn.addEventListener("click", function () {
          if (btn.disabled) return;
          if (timer) clearTimeout(timer);
          grantUnlock(cfg.unlockPolicy === "everyDetail" ? null : cfg.unlockTtlMs);
          applyDetail();
        });
      }
    });
  }

  window.addEventListener("membership-updated", function () {
    try {
      if (typeof window.isPaidMember === "function" && window.isPaidMember()) {
        window.dispatchEvent(new CustomEvent("hanlaw-detail-unlocked"));
      }
    } catch (e) {}
  });

  window.HanlawDetailUnlock = {
    canViewDetail: canViewDetail,
    isUnlockedByAd: isUnlockedByAd,
    getConfig: getConfig,
    grantUnlock: grantUnlock,
    render: render
  };
})();
