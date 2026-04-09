/**
 * 퀴즈 AI·용어사전 등 공통: 마크다운 스타일 텍스트 → HTML (불릿 숨김, 강조는 CSS 클래스)
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
    var out = [];
    var re = /\*\*(.+?)\*\*/g;
    var last = 0;
    var m;
    while ((m = re.exec(s)) !== null) {
      out.push(escHtml(s.slice(last, m.index)));
      out.push('<strong class="quiz-ai-answer__accent">' + escHtml(m[1]) + "</strong>");
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
      var text = para.join(" ").replace(/\s+/g, " ").trim();
      if (text) blocks.push("<p>" + formatInline(text) + "</p>");
      para = [];
    }

    for (var i = 0; i < lines.length; i++) {
      var t = lines[i].replace(/\s+$/, "");

      if (t.trim() === "") {
        flushPara();
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

  window.pickHanlawAiLoadingQuote = pickHanlawAiLoadingQuote;
  window.formatHanlawAiAnswerHtml = formatHanlawAiAnswerHtml;
})();
