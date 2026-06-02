/**
 * 요금제·엘리 팩·포인트 전환 표시 단일 소스.
 * 기본값은 서버(functions/portonePayments.js)의 청구 금액과 동일하게 둔다.
 * 페이지 로드 시 getPublicPricingConfig(서버)에서 실제 금액을 받아와 DOM을 갱신하므로,
 * env(PORTONE_KRW_*)로 가격을 바꾸면 UI가 자동으로 따라온다.
 *
 * 사용법(HTML):
 * - 가격만 들어가는 요소:  <p data-price="recurring_basic">₩10,000</p>
 * - 1개월 환산 표시:       <p data-price="one_month_basic">₩12,000</p>  (정기 카드 취소선)
 * - 템플릿 치환:           <p data-price-tmpl="월 {one_month_basic} → {recurring_basic}">…</p>
 *                          토큰: {one_month_*} {recurring_*} {elly_10|20|30} {daily_basic|super|ultra} {elly_per_won}
 *                          {points} → data-elly-convert-count × 포인트 단가
 */
(function () {
  var DEFAULTS = {
    prices: {
      one_month_basic: 12000,
      one_month_super: 18000,
      one_month_ultra: 24000,
      recurring_basic: 10000,
      recurring_super: 15000,
      recurring_ultra: 20000,
      elly_10: 5000,
      elly_20: 10000,
      elly_30: 15000
    },
    ellyDaily: { basic: 5, super: 10, ultra: 20 },
    pointPerEllyCredit: 500
  };

  var CONFIG = {
    prices: Object.assign({}, DEFAULTS.prices),
    ellyDaily: Object.assign({}, DEFAULTS.ellyDaily),
    pointPerEllyCredit: DEFAULTS.pointPerEllyCredit
  };

  function won(n) {
    return "₩" + Number(n || 0).toLocaleString("ko-KR");
  }
  function num(n) {
    return Number(n || 0).toLocaleString("ko-KR");
  }

  function tokenMap() {
    var p = CONFIG.prices || {};
    var m = {};
    Object.keys(p).forEach(function (k) {
      m[k] = won(p[k]);
    });
    var d = CONFIG.ellyDaily || {};
    m.daily_basic = String(d.basic);
    m.daily_super = String(d.super);
    m.daily_ultra = String(d.ultra);
    var perWon = p.elly_10 ? Math.round(p.elly_10 / 10) : CONFIG.pointPerEllyCredit;
    m.elly_per_won = num(perWon);
    return m;
  }

  function fillTemplate(tmpl, map, el) {
    return String(tmpl).replace(/\{(\w+)\}/g, function (_, key) {
      if (key === "points") {
        var cnt = parseInt(el && el.getAttribute("data-elly-convert-count"), 10) || 0;
        return num(cnt * (CONFIG.pointPerEllyCredit || 500));
      }
      return map[key] != null ? map[key] : "{" + key + "}";
    });
  }

  function applyPricingToDom() {
    var map = tokenMap();
    var i, el, k;
    var priceEls = document.querySelectorAll("[data-price]");
    for (i = 0; i < priceEls.length; i++) {
      el = priceEls[i];
      k = el.getAttribute("data-price");
      if (map[k] != null) el.textContent = map[k];
    }
    var tmplEls = document.querySelectorAll("[data-price-tmpl]");
    for (i = 0; i < tmplEls.length; i++) {
      el = tmplEls[i];
      el.textContent = fillTemplate(el.getAttribute("data-price-tmpl"), map, el);
    }
    var htmlEls = document.querySelectorAll("[data-price-html-tmpl]");
    for (i = 0; i < htmlEls.length; i++) {
      el = htmlEls[i];
      el.innerHTML = fillTemplate(el.getAttribute("data-price-html-tmpl"), map, el);
    }
  }

  function fetchServerConfig() {
    try {
      if (typeof firebase === "undefined" || !firebase.app) return;
      var region = (window.FIREBASE_CONFIG && window.FIREBASE_CONFIG.functionsRegion) || "asia-northeast3";
      firebase
        .app()
        .functions(region)
        .httpsCallable("getPublicPricingConfig")({})
        .then(function (res) {
          var d = res && res.data;
          if (!d || !d.ok) return;
          if (d.prices) CONFIG.prices = Object.assign({}, CONFIG.prices, d.prices);
          if (d.ellyDaily) CONFIG.ellyDaily = Object.assign({}, CONFIG.ellyDaily, d.ellyDaily);
          if (typeof d.pointPerEllyCredit === "number" && d.pointPerEllyCredit > 0) {
            CONFIG.pointPerEllyCredit = d.pointPerEllyCredit;
            // 포인트 전환 단가의 단일 소스를 서버 값으로 통일(learning-stats.js 가 사용)
            window.HANLAW_ATTENDANCE_POINTS_PER_ELLY_CREDIT = d.pointPerEllyCredit;
          }
          applyPricingToDom();
        })
        .catch(function () {});
    } catch (e) {}
  }

  window.PRICING_CONFIG = CONFIG;
  window.applyPricingToDom = applyPricingToDom;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      applyPricingToDom();
      fetchServerConfig();
    });
  } else {
    applyPricingToDom();
    fetchServerConfig();
  }
})();
