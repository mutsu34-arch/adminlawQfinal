/**
 * 판례 사전 본문(facts/issues/judgment) 줄바꿈·날짜 표기 정규화
 */
(function () {
  function fixBrokenDateNewlines(text) {
    var s = String(text || "").replace(/\r\n/g, "\n");
    for (var pass = 0; pass < 4; pass++) {
      var before = s;
      s = s.replace(/(\d{4})\.\s*\n+\s*(\d{1,2})\.\s*\n+\s*(\d{1,2})\./g, "$1. $2. $3.");
      s = s.replace(/(\d{4})\.\s*\n+\s*(\d{1,2})\.\s+(\d{1,2})\./g, "$1. $2. $3.");
      s = s.replace(/(\d{4})\.\s+(\d{1,2})\.\s*\n+\s*(\d{1,2})\./g, "$1. $2. $3.");
      s = s.replace(/(\d{4})\.\s*\n+\s*(\d{1,2})\.(?=[^\n]*\n[^\n]*\d{1,2}\.)/g, "$1. $2.");
      if (s === before) break;
    }
    return s;
  }

  function lineLooksLikeDateFragment(line) {
    var t = String(line || "").trim();
    return /^\d{1,4}\.$/.test(t) || /^\d{1,2}\.$/.test(t);
  }

  function blockLooksLikeIssueList(lines) {
    if (!lines.length) return false;
    var listLike = 0;
    for (var i = 0; i < lines.length; i++) {
      var ln = String(lines[i] || "").trim();
      if (!ln) continue;
      if (
        /^(?:첫|둘|셋|넷|다섯|여섯|일곱|여덟|아홉|열)(?:째)?\s*,/.test(ln) ||
        /^[\*\-•]\s+/.test(ln) ||
        /^\d{1,2}[\.\)]\s+/.test(ln)
      ) {
        listLike += 1;
      }
    }
    return listLike >= Math.max(2, Math.floor(lines.length / 2));
  }

  function collapseSpuriousSingleNewlines(text) {
    var blocks = String(text || "").split(/\n\n+/);
    var out = [];
    for (var b = 0; b < blocks.length; b++) {
      var lines = String(blocks[b] || "")
        .split("\n")
        .map(function (x) {
          return String(x || "").trim();
        })
        .filter(Boolean);
      if (lines.length <= 1) {
        out.push(lines[0] || "");
        continue;
      }
      if (blockLooksLikeIssueList(lines)) {
        out.push(lines.join("\n"));
        continue;
      }
      if (lines.some(lineLooksLikeDateFragment)) {
        out.push(lines.join(" "));
        continue;
      }
      var merged = lines[0];
      for (var j = 1; j < lines.length; j++) {
        var ln = lines[j];
        if (!/[.!?…)]$/.test(merged) || lineLooksLikeDateFragment(ln)) {
          merged += " " + ln;
        } else {
          merged += "\n" + ln;
        }
      }
      out.push(merged);
    }
    return out.join("\n\n");
  }

  function normalizeCaseProseText(raw, opts) {
    opts = opts || {};
    var s = String(raw || "").replace(/\r\n/g, "\n").trim();
    if (!s) return "";
    s = fixBrokenDateNewlines(s);
    if (!opts.preserveIssueList) {
      s = collapseSpuriousSingleNewlines(s);
    }
    return s.replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  }

  window.normalizeCaseProseText = normalizeCaseProseText;
})();
