(function () {
  function tierUrl(tier) {
    var cfg = window.CREEM_CONFIG || {};
    return (cfg.links && cfg.links[tier]) || "";
  }

  function bind() {
    function customerPortalUrl() {
      var cfg = window.CREEM_CONFIG || {};
      var u = (cfg.customerPortalUrl || "").trim();
      return u || "https://creem.io/my-orders/login";
    }

    function refundHelpUrl() {
      var cfg = window.CREEM_CONFIG || {};
      var u = (cfg.refundHelpDocUrl || "").trim();
      return (
        u ||
        "https://docs.creem.io/for-customers/how-to-cancel-subscription"
      );
    }

    var portalBtn = document.getElementById("btn-creem-customer-portal");
    if (portalBtn) {
      portalBtn.addEventListener("click", function () {
        window.open(customerPortalUrl(), "_blank", "noopener,noreferrer");
      });
    }

    var refundBtn = document.getElementById("btn-creem-refund-contact");
    if (refundBtn) {
      refundBtn.addEventListener("click", function () {
        var cfg = window.CREEM_CONFIG || {};
        var email = (cfg.merchantSupportEmail || "").trim();
        if (email) {
          var sub = encodeURIComponent("[행정법Q] 환불·결제 문의");
          window.location.href = "mailto:" + email + "?subject=" + sub;
          return;
        }
        window.open(refundHelpUrl(), "_blank", "noopener,noreferrer");
      });
    }

    document.querySelectorAll("[data-creem-tier]").forEach(function (btn) {
      var tier = btn.getAttribute("data-creem-tier");
      if (!tier) return;

      function syncState() {
        var has = !!tierUrl(tier);
        btn.classList.toggle("btn--creem-pending", !has);
        btn.setAttribute("aria-disabled", has ? "false" : "true");
      }

      syncState();

      btn.addEventListener("click", function () {
        var url = tierUrl(tier);
        if (!url) {
          if (tier === "q1" || tier === "q10") {
            window.alert(
              "吏덈Ц沅?Creem 留곹겕媛 ?놁뒿?덈떎.\n\n" +
                "1) Creem?먯꽌 " +
                (typeof window.getQuestionPackPricesDisplay === "function"
                  ? window.getQuestionPackPricesDisplay()
                  : "1嫄?$2 쨌 10嫄?$10 USD") +
                " ?쇳쉶???곹뭹??留뚮벊?덈떎.\n" +
                "2) js/creem-config.js ??links.q1 / links.q10 ??怨듭쑀 寃곗젣 URL???ｌ뒿?덈떎.\n" +
                "3) 泥댄겕?꾩썐 硫뷀??곗씠?곗뿉 firebase_uid쨌hanlaw_question_pack(1 ?먮뒗 10)???섍린嫄곕굹, " +
                "Functions ?섍꼍蹂?섏뿉 ?곹뭹 ID瑜??깅줉?섏꽭??"
            );
          } else {
            window.alert(
              "Creem 寃곗젣 留곹겕媛 ?꾩쭅 ?놁뒿?덈떎.\n\n" +
                "1) creem.io ??쒕낫?쒖뿉????$7 쨌 ??$70 쨌 2??$100 ?곹뭹??留뚮벊?덈떎.\n" +
                "2) 媛??곹뭹??怨듭쑀 寃곗젣 留곹겕瑜?js/creem-config.js??links??遺숈뿬 ?ｌ뒿?덈떎."
            );
          }
          return;
        }
        if (tier === "q1" || tier === "q10") {
          if (typeof window.getHanlawUser === "function") {
            var user = window.getHanlawUser();
            if (!user) {
              window.alert("吏덈Ц沅?援щℓ??濡쒓렇????吏꾪뻾??二쇱꽭??");
              return;
            }
            var sep = url.indexOf("?") >= 0 ? "&" : "?";
            url = url + sep + "firebase_uid=" + encodeURIComponent(user.uid);
          }
        }
        window.location.href = url;
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }
})();

