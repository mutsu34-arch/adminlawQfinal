/**
 * 태그 문자열이 「법령명 + 제N조…」 형태인지 파싱합니다.
 * 예: 행정소송법 제13조, 헌법 제37조 제2항, 민법 제103조의2 제1항
 */
(function () {
  function normalizeSpaces(s) {
    return String(s || "")
      .replace(/^#/, "")
      .trim()
      .replace(/\s+/g, " ");
  }

  /**
   * @returns {null|{ lawName: string, article: string, articleSub: string|null, paragraph: string|null, item: string|null, displayTitle: string }}
   */
  function parseStatuteArticleTag(tag) {
    var t = normalizeSpaces(tag);
    if (!t || !/제\s*\d+\s*조/.test(t)) return null;

    var m = t.match(
      /^(.+?)\s*제\s*(\d+)\s*조(?:의\s*(\d+))?(?:\s*제\s*(\d+)\s*항)?(?:\s*제\s*(\d+)\s*호)?\s*$/
    );
    if (!m) return null;

    var lawName = m[1].replace(/\s+$/g, "").trim();
    if (!lawName || lawName.length < 2) return null;

    return {
      lawName: lawName,
      article: m[2],
      articleSub: m[3] || null,
      paragraph: m[4] || null,
      item: m[5] || null,
      displayTitle: t
    };
  }

  function statuteCacheKey(parsed) {
    if (!parsed) return "";
    return (
      parsed.lawName.replace(/\s+/g, "") +
      "|" +
      parsed.article +
      "|" +
      (parsed.articleSub || "")
    );
  }

  function lookupStaticStatuteArticle(parsed) {
    if (!parsed || !window.STATUTE_ARTICLE_STATIC) return null;
    var key = statuteCacheKey(parsed);
    var map = window.STATUTE_ARTICLE_STATIC;
    if (map[key]) return map[key];
    var altKey = parsed.lawName.replace(/\s+/g, "") + "|" + parsed.article + "|";
    if (map[altKey]) return map[altKey];
    return null;
  }

  /** 국가법령정보센터 웹에서 검색하기 좋은 문구 */
  function lawGoKrSearchQuery(parsed) {
    if (!parsed) return "";
    var s =
      parsed.lawName +
      " 제" +
      parsed.article +
      "조" +
      (parsed.articleSub ? "의" + parsed.articleSub : "");
    if (parsed.paragraph) s += "제" + parsed.paragraph + "항";
    if (parsed.item) s += "제" + parsed.item + "호";
    return s;
  }

  /** 법령 전체 본문(위키문헌 등) 바로가기 — 조문이 정적 DB에 없을 때 보조 링크로 사용 */
  window.STATUTE_FULLTEXT_HINT_URL = {
    행정소송법:
      "https://ko.wikisource.org/wiki/%EB%8C%80%ED%95%9C%EB%AF%BC%EA%B5%AD_%ED%96%89%EC%A0%95%EC%86%8C%EC%86%A1%EB%B2%95",
    헌법:
      "https://ko.wikisource.org/wiki/%EB%8C%80%ED%95%9C%EB%AF%BC%EA%B5%AD_%ED%97%8C%EB%B2%95",
    민법: "https://ko.wikisource.org/wiki/%EB%8C%80%ED%95%9C%EB%AF%BC%EA%B5%AD_%EB%AF%BC%EB%B2%95",
    행정절차법:
      "https://ko.wikisource.org/wiki/%EB%8C%80%ED%95%9C%EB%AF%BC%EA%B5%AD_%ED%96%89%EC%A0%95%EC%A0%88%EC%B0%A8%EB%B2%95"
  };

  window.parseStatuteArticleTag = parseStatuteArticleTag;
  window.lookupStaticStatuteArticle = lookupStaticStatuteArticle;
  window.statuteCacheKey = statuteCacheKey;
  window.lawGoKrSearchQuery = lawGoKrSearchQuery;
})();

