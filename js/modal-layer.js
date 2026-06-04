/**
 * 관리자 수정 등 2중 모달 — 기본 modal(z-index 400) 위에 표시
 */
(function () {
  function raiseHanlawModalLayer(modal) {
    if (!modal || !modal.nodeType) return modal;
    modal.classList.add("modal--stack-top");
    if (modal.parentNode !== document.body) {
      document.body.appendChild(modal);
    }
    return modal;
  }

  window.raiseHanlawModalLayer = raiseHanlawModalLayer;
})();
