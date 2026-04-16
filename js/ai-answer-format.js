/**
 * 퀴즈 AI·용어사전·관리자 편집 본문 공통:
 * - <키워드> 또는 [키워드] → 굵은 강조(quiz-ai-answer__accent)
 * - 전각 ＜키워드＞ · ［키워드］ (한글 입력기) 동일 처리
 * - **굵게** / __굵게__
 * - formatHanlawAiAnswerHtml: 불릿·단락
 * - formatHanlawRichParagraphsHtml: 줄바꿈만(문항 지문 등, 불릿 해석 없음)
 */
(function () {
  var AI_LOADING_QUOTES = [
    "오늘의 한 문제가 내일의 합격을 만든다.",
    "반복은 비범을 만든다. 같은 문제를 다시 푸는 용기가 실력이다.",
    "망설이는 시간에 한 문제 더 풀어라.",
    "합격은 재능이 아니라 습관의 합이다.",
    "어렵다고 피하지 말고, 모른다고 멈추지 마라.",
    "계획 없는 공부는 꿈 없는 항해와 같다. 오늘의 목표를 정하라.",
    "남과 비교하지 말고 어제의 나와 비교하라.",
    "실수는 정답으로 가는 이정표다. 오답 노트가 곧 자산이다.",
    "집중 한 시간이 산만한 세 시간보다 낫다.",
    "포기하고 싶을 때가 곧 성장의 시작점이다.",
    "법은 읽는 것이 아니라 이해하는 것이다. 천천히, 꾸준히.",
    "시험장은 지식을 묻는 곳이 아니라 평소의 훈련을 묻는 곳이다.",
    "완벽을 기다리지 말라. 지금 할 수 있는 최선을 하라.",
    "두려움은 공부할수록 줄어든다.",
    "하루 한 조문, 한 판례가 쌓여 전문가가 된다.",
    "느려도 괜찮다. 멈추지만 않으면 된다.",
    "당신의 노력은 배신하지 않는다. 시간이 증명한다.",
    "쉬운 길을 택하지 말고, 올바른 길을 택하라.",
    "불안할 때일수록 기본으로 돌아가라. 개념이 곧 힘이다.",
    "합격은 끝이 아니라 새로운 시작의 문이다. 오늘도 한 걸음."
  ];

  function pickHanlawAiLoadingQuote() {
    var i = Math.floor(Math.random() * AI_LOADING_QUOTES.length);
    return AI_LOADING_QUOTES[i];
  }

  function escHtml(t) {
    return String(t)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatInline(md) {
    var s = String(md || "");
    // 전각 괄호 (IME·복붙 시 반각과 섞일 수 있음)
    s = s.replace(/＜([^＜＞\n]{1,200})＞/g, function (_, inner) {
      var t = String(inner || "").trim();
      return t ? "**" + t + "**" : "";
    });
    s = s.replace(/［([^［］\n]{1,200})］/g, function (_, inner) {
      var t = String(inner || "").trim();
      return t ? "**" + t + "**" : "";
    });
    // 관리자 편의: <강조어> → 굵게
    s = s.replace(/<([^<>\n]{1,200})>/g, function (_, inner) {
      var t = String(inner || "").trim();
      return t ? "**" + t + "**" : "";
    });
    // [강조어] → 굵게 (줄바꿈·닫는 ] 없는 본문은 제외)
    s = s.replace(/\[([^\]\n]{1,200})\]/g, function (_, inner) {
      var t = String(inner || "").trim();
      return t ? "**" + t + "**" : "";
    });
    // 흔한 오타 보정: "***강조**", "****강조****" 등을 "**강조**"로 정규화
    s = s.replace(/\*{2,}\s*([^*]+?)\s*\*{2,}/g, "**$1**");
    s = s.replace(/_{2,}\s*([^_]+?)\s*_{2,}/g, "__$1__");
    var out = [];
    var re = /(\*\*|__)(.+?)\1/g;
    var last = 0;
    var m;
    while ((m = re.exec(s)) !== null) {
      out.push(escHtml(s.slice(last, m.index)));
      out.push('<strong class="quiz-ai-answer__accent">' + escHtml(m[2]) + "</strong>");
      last = re.lastIndex;
    }
    out.push(escHtml(s.slice(last)));
    return out.join("");
  }

  function bulletLineToHtml(content, itemExtraClass) {
    var itemClass =
      "quiz-ai-answer__item" +
      (itemExtraClass ? " " + itemExtraClass : "");
    var c = String(content || "").trim();
    var m = /^\*\*(.+?)\*\*(.*)$/.exec(c);
    if (m) {
      var rest = String(m[2] || "")
        .replace(/^\s*:\s*/, "")
        .trim();
      return (
        '<div class="' +
        itemClass +
        '">' +
        '<span class="quiz-ai-answer__lead">' +
        escHtml(m[1]) +
        "</span>" +
        (rest
          ? '<span class="quiz-ai-answer__sep"> </span><span class="quiz-ai-answer__rest">' +
            formatInline(rest) +
            "</span>"
          : "") +
        "</div>"
      );
    }
    return (
      '<div class="' +
      itemClass +
      '"><span class="quiz-ai-answer__rest">' +
      formatInline(c) +
      "</span></div>"
    );
  }

  function formatHanlawAiAnswerHtml(raw) {
    var lines = String(raw || "")
      .replace(/\r\n/g, "\n")
      .split("\n");
    var blocks = [];
    var para = [];

    function flushPara() {
      if (!para.length) return;
      // 연속 줄(빈 줄 없이 Enter만 친 경우)은 단락 하나로 묶되, 줄바꿈은 유지한다.
      // 예전 join(" ")+collapse는 관리자가 넣은 줄바꿈을 지웠음.
      var raw = para.join("\n");
      if (!raw.trim()) {
        para = [];
        return;
      }
      var lines = raw.split("\n");
      var inner = lines
        .map(function (line) {
          return formatInline(line.replace(/\s+$/, ""));
        })
        .join("<br>");
      blocks.push("<p>" + inner + "</p>");
      para = [];
    }

    for (var i = 0; i < lines.length; i++) {
      var t = lines[i].replace(/\s+$/, "");

      if (t.trim() === "") {
        if (para.length) {
          flushPara();
        } else {
          // 연속 빈 줄: flush만으로는 간격이 한 번만 생겨 관리자가 띄운 줄간격이 사라짐 → 빈 단락으로 간격 유지
          blocks.push('<p class="hanlaw-para-gap" aria-hidden="true">\u00a0</p>');
        }
        continue;
      }

      var bullet = /^\s*[\*\-•]\s+(.+)$/.exec(t);
      if (bullet) {
        flushPara();
        blocks.push(bulletLineToHtml(bullet[1], ""));
        continue;
      }

      var num = /^\s*\d{1,2}[\.\)]\s+(.+)$/.exec(t);
      if (num) {
        flushPara();
        blocks.push(bulletLineToHtml(num[1], "quiz-ai-answer__item--num"));
        continue;
      }

      var sec = /^\s*\*\*(.+?)\*\*\s*$/.exec(t);
      if (sec) {
        flushPara();
        blocks.push(
          '<div class="quiz-ai-answer__section">' + escHtml(sec[1]) + "</div>"
        );
        continue;
      }

      para.push(t);
    }
    flushPara();
    return blocks.join("");
  }

  /**
   * 문항 지문·명언 등: 불릿/번호 목록 해석 없이 줄만 나누고, <>·[]·** 강조만 적용.
   */
  function formatHanlawRichParagraphsHtml(raw) {
    var lines = String(raw || "")
      .replace(/\r\n/g, "\n")
      .split("\n");
    if (!lines.length) return "";
    var inner = lines
      .map(function (line) {
        return formatInline(line.replace(/\s+$/, ""));
      })
      .join("<br>");
    return inner ? '<span class="hanlaw-rich-text">' + inner + "</span>" : "";
  }

  /**
   * 변호사 답변 등 표시용: 줄 시작의 목록 기호(- * • 숫자.)만 제거(마크다운 불릿이 그대로 보이지 않게).
   */
  function stripHanlawReplyListMarkers(raw) {
    return String(raw || "")
      .replace(/\r\n/g, "\n")
      .split("\n")
      .map(function (line) {
        return line.replace(/^\s*(?:(?:[-*•·])\s+|\d{1,3}[\.)]\s+)/, "");
      })
      .join("\n");
  }

  window.pickHanlawAiLoadingQuote = pickHanlawAiLoadingQuote;
  window.formatHanlawAiAnswerHtml = formatHanlawAiAnswerHtml;
  window.formatHanlawRichParagraphsHtml = formatHanlawRichParagraphsHtml;
  window.stripHanlawReplyListMarkers = stripHanlawReplyListMarkers;
})();
