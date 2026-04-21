(function () {
  var ACTIVE = "free-trial-subtabs__btn--active";

  var QUIZ_IDS = [
    "q-ex-defendant-transfer",
    "q1",
    "q3",
    "q7",
    "q22"
  ];

  var TERM_TAGS = ["법률유보", "비례원칙", "신뢰보호원칙", "재량권 일탈", "원고적격"];
  var STATUTE_QUERIES = ["행정소송법 제13조", "행정소송법 제12조", "행정절차법 제21조", "행정절차법 제22조", "국가배상법 제2조"];
  var CASE_QUERIES = ["원고적격", "비례원칙", "권한 승계", "절차 하자", "신뢰보호"];

  function uniqueBy(list, keyFn) {
    var out = [];
    var seen = {};
    for (var i = 0; i < list.length; i++) {
      var k = String(keyFn(list[i]) || "").trim();
      if (!k || seen[k]) continue;
      seen[k] = true;
      out.push(list[i]);
    }
    return out;
  }

  function setActiveTab(which) {
    document.querySelectorAll(".free-trial-subtabs__btn").forEach(function (b) {
      var on = b.getAttribute("data-free-tab") === which;
      b.classList.toggle(ACTIVE, on);
      b.classList.toggle("btn--outline", !on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
    document.querySelectorAll(".free-trial-pane").forEach(function (p) {
      p.hidden = p.getAttribute("data-free-pane") !== which;
    });
  }

  function renderQuiz() {
    var root = document.getElementById("free-trial-quiz-list");
    if (!root) return;
    root.innerHTML = "";
    var bank = Array.isArray(window.QUESTION_BANK) ? window.QUESTION_BANK : [];
    var byId = {};
    bank.forEach(function (q) {
      byId[String(q.id || "")] = q;
    });
    var picked = [];
    QUIZ_IDS.forEach(function (id) {
      if (byId[id]) picked.push(byId[id]);
    });
    if (picked.length < 5) {
      for (var i = 0; i < bank.length && picked.length < 5; i++) picked.push(bank[i]);
    }
    picked = uniqueBy(picked, function (q) { return q && q.id; }).slice(0, 5);

    picked.forEach(function (q, idx) {
      var card = document.createElement("article");
      card.className = "card card--question free-trial-quiz-card";

      var meta = document.createElement("p");
      meta.className = "q-meta";
      meta.textContent = "무료체험 " + (idx + 1) + " / 5";
      card.appendChild(meta);

      var txt = document.createElement("p");
      txt.className = "q-text";
      txt.textContent = q.statement || "";
      card.appendChild(txt);

      var actions = document.createElement("div");
      actions.className = "q-actions";

      var btnO = document.createElement("button");
      btnO.type = "button";
      btnO.className = "btn btn--ox btn--o";
      btnO.textContent = "O";
      btnO.setAttribute("data-answer", "true");
      var btnX = document.createElement("button");
      btnX.type = "button";
      btnX.className = "btn btn--ox btn--x";
      btnX.textContent = "X";
      btnX.setAttribute("data-answer", "false");
      actions.appendChild(btnO);
      actions.appendChild(btnX);
      card.appendChild(actions);

      var fb = document.createElement("div");
      fb.className = "feedback";
      fb.hidden = true;

      var result = document.createElement("p");
      result.className = "feedback__result";
      fb.appendChild(result);

      var explain = document.createElement("p");
      explain.className = "feedback__explain quiz-ai-answer";
      explain.textContent = q.explanationBasic || q.explanation || "";
      fb.appendChild(explain);

      var detail = document.createElement("div");
      detail.className = "feedback-detail";
      var body = q.detail && (q.detail.body || q.detail.legal || q.detail.trap || q.detail.precedent);
      if (body) {
        var line = document.createElement("p");
        line.className = "feedback-detail__line";
        line.textContent = q.detail.body || [q.detail.legal, q.detail.trap, q.detail.precedent].filter(Boolean).join(" / ");
        detail.appendChild(line);
      }
      fb.appendChild(detail);

      var toolbar = document.createElement("div");
      toolbar.className = "quiz-post-actions__toolbar free-trial-mock-toolbar";
      toolbar.innerHTML =
        '<button type="button" class="btn btn--ticket btn--ticket-ask" data-free-mock-action="lawyer-question">변호사에게 질문하기</button>' +
        '<button type="button" class="btn btn--ticket btn--ticket-report" data-free-mock-action="error-report">오류 신고하기</button>' +
        '<button type="button" class="btn btn--ticket btn--ticket-suggestion" data-free-mock-action="improve">개선하기</button>' +
        '<button type="button" class="btn btn--outline btn--small" data-free-mock-action="memo">메모</button>' +
        '<button type="button" class="btn btn--outline btn--small" data-free-mock-action="favorite">☆ 찜하기</button>' +
        '<button type="button" class="btn btn--secondary btn--small" data-free-mock-action="ai-ask">엘리(AI)에게 질문하기</button>';
      card.appendChild(toolbar);
      card.appendChild(fb);

      function handlePick(userTrue) {
        var correct = !!q.answer;
        result.textContent = userTrue === correct ? "정답입니다." : "오답입니다. 정답은 " + (correct ? "O" : "X") + " 입니다.";
        fb.hidden = false;
        btnO.disabled = true;
        btnX.disabled = true;
        actions.classList.add("q-actions--revealed");
        if (correct) {
          (btnO).classList.add("btn--ox-reveal-correct");
          (btnX).classList.add("btn--ox-reveal-dim");
        } else {
          (btnX).classList.add("btn--ox-reveal-correct");
          (btnO).classList.add("btn--ox-reveal-dim");
        }
      }
      btnO.addEventListener("click", function () { handlePick(true); });
      btnX.addEventListener("click", function () { handlePick(false); });
      root.appendChild(card);
    });
  }

  function renderDict() {
    var DU = window.DictionaryUI;
    if (!DU) return;

    var termRoot = document.getElementById("free-trial-term-results");
    var stRoot = document.getElementById("free-trial-statute-results");
    var caseRoot = document.getElementById("free-trial-case-results");
    if (!termRoot || !stRoot || !caseRoot) return;

    var terms = [];
    TERM_TAGS.forEach(function (t) {
      var it = DU.findTermForTag && DU.findTermForTag(t);
      if (it) terms.push(it);
    });
    terms = uniqueBy(terms, function (x) { return x && x.term; }).slice(0, 5);
    DU.renderTermResults(termRoot, terms, { skipNavBack: true, skipFavButton: true });
    appendMockToolbar(termRoot, "term");

    var statutes = [];
    STATUTE_QUERIES.forEach(function (q) {
      var list = DU.searchStatutes ? DU.searchStatutes(q) : [];
      if (list && list.length) statutes.push(list[0]);
    });
    if (statutes.length < 5 && DU.searchStatutes) {
      var fbSt = DU.searchStatutes("법");
      for (var si = 0; si < fbSt.length && statutes.length < 5; si++) statutes.push(fbSt[si]);
    }
    statutes = uniqueBy(statutes, function (x) { return x && x.key; }).slice(0, 5);
    DU.renderStatuteResults(stRoot, statutes, { skipNavBack: true, skipFavButton: true });
    appendMockToolbar(stRoot, "statute");

    var cases = [];
    CASE_QUERIES.forEach(function (q) {
      var c = DU.findCaseForTag && DU.findCaseForTag(q);
      if (c) cases.push(c);
    });
    if (cases.length < 5 && DU.searchCases) {
      var fbCases = DU.searchCases("행정");
      for (var ci = 0; ci < fbCases.length && cases.length < 5; ci++) cases.push(fbCases[ci]);
    }
    cases = uniqueBy(cases, function (x) { return x && (x.citation || x.title); }).slice(0, 5);
    DU.renderCaseResults(caseRoot, cases, "case", { skipNavBack: true, skipFavButton: true });
    appendMockToolbar(caseRoot, "case");
  }

  function appendMockToolbar(root, kind) {
    if (!root) return;
    root.querySelectorAll(".free-trial-mock-toolbar").forEach(function (x) {
      x.remove();
    });
    root.querySelectorAll(".dict-result-card, .case-result-card").forEach(function (card) {
      var bar = document.createElement("div");
      bar.className = "quiz-post-actions__toolbar free-trial-mock-toolbar";
      bar.innerHTML =
        '<button type="button" class="btn btn--secondary btn--small" data-free-mock-action="ai-ask">엘리(AI)에게 질문하기</button>' +
        '<button type="button" class="btn btn--ticket btn--ticket-ask" data-free-mock-action="lawyer-question">변호사에게 질문하기</button>' +
        '<button type="button" class="btn btn--ticket btn--ticket-report" data-free-mock-action="error-report">오류 신고하기</button>' +
        '<button type="button" class="btn btn--ticket btn--ticket-suggestion" data-free-mock-action="improve">개선하기</button>' +
        '<button type="button" class="btn btn--outline btn--small" data-free-mock-action="memo">메모</button>' +
        '<button type="button" class="btn btn--outline btn--small" data-free-mock-action="favorite">☆ 찜하기</button>';
      bar.setAttribute("data-free-kind", kind);
      card.appendChild(bar);
    });
  }

  function showMockGuide(action) {
    var box = document.getElementById("free-trial-mock-guide");
    if (!box) return;
    var title = "";
    if (action === "lawyer-question") title = "변호사 질문";
    else if (action === "error-report") title = "오류 신고";
    else if (action === "improve") title = "개선 제안";
    else if (action === "memo") title = "메모";
    else if (action === "favorite") title = "찜하기";
    else if (action === "ai-ask") title = "엘리(AI) 질문";
    else title = "이 기능";
    box.hidden = false;
    box.textContent =
      title +
      " 기능은 실제 서비스에서 동일한 흐름으로 동작합니다. 무료체험에서는 목업으로만 보여주며, 회원가입 후 전체 기능(저장/전송/동기화)이 활성화됩니다.";
  }

  function bind() {
    var wrap = document.querySelector("#panel-freequiz .free-trial-subtabs");
    if (wrap) {
      wrap.addEventListener("click", function (e) {
        var b = e.target.closest("[data-free-tab]");
        if (!b) return;
        setActiveTab(b.getAttribute("data-free-tab"));
      });
    }
    var panel = document.getElementById("panel-freequiz");
    if (panel) {
      panel.addEventListener("click", function (e) {
        var m = e.target.closest("[data-free-mock-action]");
        if (!m) return;
        e.preventDefault();
        showMockGuide(m.getAttribute("data-free-mock-action"));
      });
    }
    renderQuiz();
    renderDict();
    window.addEventListener("dict-remote-updated", renderDict);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }
})();
