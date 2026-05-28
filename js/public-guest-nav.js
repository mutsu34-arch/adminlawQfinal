/**

 * 비회원·전체: 상단·하단 「공개콘텐츠」 → 동일 허브(panel-public) 화면

 */

(function () {

  function isGuest() {

    var u = typeof window.getHanlawUser === "function" ? window.getHanlawUser() : null;

    return !(u && u.email);

  }



  function closeMenu() {

    var menu = document.getElementById("nav-public-menu");

    var btn = document.getElementById("nav-btn-public-toggle");

    if (menu) menu.hidden = true;

    if (btn) btn.setAttribute("aria-expanded", "false");

  }



  function goPublicHub() {

    closeMenu();

    var panel = document.getElementById("panel-public");

    if (panel) panel.setAttribute("data-public-tab", "hub");

    if (typeof window.hanlawNavigateToPanel === "function") {

      window.hanlawNavigateToPanel("public", { syncUrl: true });

      if (window.HanlawPublicContentUI && typeof window.HanlawPublicContentUI.showHub === "function") {

        window.HanlawPublicContentUI.showHub();

      }

      return;

    }

    window.location.href = "/public";

  }



  function goPublicTab(kind) {

    closeMenu();

    if (!kind || kind === "hub") {

      goPublicHub();

      return;

    }

    if (typeof window.hanlawNavigateToPanel === "function") {

      var panel = document.getElementById("panel-public");

      if (panel) panel.setAttribute("data-public-tab", kind);

      window.hanlawNavigateToPanel("public", { syncUrl: true });

      if (window.HanlawPublicContentUI && typeof window.HanlawPublicContentUI.setPanelTab === "function") {

        window.HanlawPublicContentUI.setPanelTab(kind);

      }

      return;

    }

    window.location.href = "/content/public-view.html?type=" + encodeURIComponent(kind);

  }



  function syncVisibility() {

    var wrap = document.getElementById("nav-public-wrap");

    if (!wrap) return;

    wrap.hidden = !isGuest();

    if (!isGuest()) closeMenu();

  }



  function bind() {

    var wrap = document.getElementById("nav-public-wrap");

    var toggle = document.getElementById("nav-btn-public-toggle");

    var menu = document.getElementById("nav-public-menu");

    if (toggle) {

      toggle.addEventListener("click", function (e) {

        e.preventDefault();

        e.stopPropagation();

        goPublicHub();

      });

    }

    if (menu) {

      menu.addEventListener("click", function (e) {

        var btn = e.target.closest("[data-public-nav]");

        if (!btn) return;

        e.preventDefault();

        goPublicTab(btn.getAttribute("data-public-nav"));

      });

    }

    var footerBtn = document.getElementById("footer-open-public-content");

    if (footerBtn) {

      footerBtn.addEventListener("click", function (e) {

        e.preventDefault();

        goPublicHub();

      });

    }

  }



  function init() {

    bind();

    syncVisibility();

    try {

      if (typeof firebase !== "undefined" && firebase.auth) {

        firebase.auth().onAuthStateChanged(syncVisibility);

      }

    } catch (e) {}

    window.addEventListener("app-auth", syncVisibility);

    window.goHanlawPublicHub = goPublicHub;

    window.goHanlawPublicTab = goPublicTab;

  }



  if (document.readyState === "loading") {

    document.addEventListener("DOMContentLoaded", init);

  } else {

    init();

  }

})();

