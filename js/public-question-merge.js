/**
 * 공개 36문항: 확장 해설 병합 + publicContent 플래그
 * questions.js 로드 직후 실행
 */
(function () {
  function applyEnrichment(q) {
    if (!q || !q.id) return q;
    var enrich = (window.HANLAW_PUBLIC_QUESTION_ENRICHMENTS || {})[String(q.id)];
    if (!enrich || typeof enrich !== "object") return q;
    if (enrich.explanationBasic) {
      q.explanationBasic = enrich.explanationBasic;
      if (!q.explanation) q.explanation = enrich.explanationBasic;
    }
    if (enrich.explanation) q.explanation = enrich.explanation;
    if (enrich.detail && typeof enrich.detail === "object") {
      q.detail = Object.assign({}, q.detail || {}, enrich.detail);
    }
    if (enrich.importance != null) q.importance = enrich.importance;
    if (enrich.difficulty != null) q.difficulty = enrich.difficulty;
    if (enrich.tags && enrich.tags.length) q.tags = enrich.tags.slice();
    return q;
  }

  function markPublic(q) {
    if (!q || !q.id) return;
    if (typeof window.isHanlawPublicContentQuestion === "function" && window.isHanlawPublicContentQuestion(q)) {
      q.publicContent = true;
      applyEnrichment(q);
    }
  }

  function mergeBank(list) {
    if (!Array.isArray(list)) return;
    for (var i = 0; i < list.length; i++) markPublic(list[i]);
  }

  function run() {
    mergeBank(window.QUESTION_BANK);
    mergeBank(window.QUESTION_BANK_STATIC);
    try {
      window.dispatchEvent(new CustomEvent("hanlaw-public-questions-ready"));
    } catch (e) {}
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run);
  } else {
    run();
  }
})();
