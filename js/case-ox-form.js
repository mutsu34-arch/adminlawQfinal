/**
 * 판례 OX 퀴즈: 관리자 검수·판례 생성 화면에서 JSON 대신 항목별 입력용.
 */
(function () {
  var MAX = 5;

  function getMaxForWrap(wrap) {
    if (!wrap || !wrap.getAttribute) return MAX;
    var raw = wrap.getAttribute("data-ox-max");
    var n = parseInt(raw, 10);
    if (Number.isFinite(n) && n >= 1 && n <= 10) return n;
    return MAX;
  }

  function ensureBuilt(wrapId) {
    var wrap = document.getElementById(wrapId);
    if (!wrap || wrap.getAttribute("data-case-ox-built") === "1") return wrap;
    wrap.setAttribute("data-case-ox-built", "1");
    if (wrap.className.indexOf("case-ox-form") < 0) {
      wrap.className = (wrap.className ? wrap.className + " " : "") + "case-ox-form";
    }
    var localMax = getMaxForWrap(wrap);
    for (var i = 0; i < localMax; i++) {
      var fieldset = document.createElement("fieldset");
      fieldset.className = "case-ox-form__row";
      fieldset.setAttribute("data-ox-slot", String(i));

      var leg = document.createElement("legend");
      leg.className = "case-ox-form__legend";
      leg.textContent = "OX 문항 " + (i + 1);
      fieldset.appendChild(leg);

      var stLbl = document.createElement("label");
      stLbl.className = "field case-ox-form__field";
      var stSpan = document.createElement("span");
      stSpan.className = "field__label";
      stSpan.textContent = "지문";
      var stTa = document.createElement("textarea");
      stTa.className = "input textarea case-ox-form__statement";
      stTa.rows = 2;
      stLbl.appendChild(stSpan);
      stLbl.appendChild(stTa);
      fieldset.appendChild(stLbl);

      var ansLbl = document.createElement("label");
      ansLbl.className = "field case-ox-form__field case-ox-form__field--answer";
      var ansSpan = document.createElement("span");
      ansSpan.className = "field__label";
      ansSpan.textContent = "정답";
      var sel = document.createElement("select");
      sel.className = "select case-ox-form__answer";
      var opO = document.createElement("option");
      opO.value = "true";
      opO.textContent = "O(참)";
      var opX = document.createElement("option");
      opX.value = "false";
      opX.textContent = "X(거짓)";
      sel.appendChild(opO);
      sel.appendChild(opX);
      ansLbl.appendChild(ansSpan);
      ansLbl.appendChild(sel);
      fieldset.appendChild(ansLbl);

      var exLbl = document.createElement("label");
      exLbl.className = "field case-ox-form__field";
      var exSpan = document.createElement("span");
      exSpan.className = "field__label";
      exSpan.textContent = "해설";
      var exTa = document.createElement("textarea");
      exTa.className = "input textarea case-ox-form__explain";
      exTa.rows = 2;
      exLbl.appendChild(exSpan);
      exLbl.appendChild(exTa);
      fieldset.appendChild(exLbl);

      wrap.appendChild(fieldset);
    }
    return wrap;
  }

  function fill(wrapId, quizzes) {
    var wrap = ensureBuilt(wrapId);
    if (!wrap) return;
    var localMax = getMaxForWrap(wrap);
    var list = Array.isArray(quizzes) ? quizzes.slice(0, localMax) : [];
    for (var i = 0; i < localMax; i++) {
      var row = wrap.querySelector('[data-ox-slot="' + i + '"]');
      if (!row) continue;
      var q = list[i] || {};
      var st = row.querySelector(".case-ox-form__statement");
      var ans = row.querySelector(".case-ox-form__answer");
      var ex = row.querySelector(".case-ox-form__explain");
      if (st) st.value = String(q.statement || "").trim();
      if (ans) ans.value = q.answer === false ? "false" : "true";
      var expl = String(q.explanationBasic != null && String(q.explanationBasic).trim() ? q.explanationBasic : q.explanation || "").trim();
      if (ex) ex.value = expl;
    }
  }

  function collect(wrapId) {
    ensureBuilt(wrapId);
    var wrap = document.getElementById(wrapId);
    if (!wrap) return [];
    var localMax = getMaxForWrap(wrap);
    var out = [];
    for (var i = 0; i < localMax; i++) {
      var row = wrap.querySelector('[data-ox-slot="' + i + '"]');
      if (!row) continue;
      var stEl = row.querySelector(".case-ox-form__statement");
      var ansEl = row.querySelector(".case-ox-form__answer");
      var exEl = row.querySelector(".case-ox-form__explain");
      var statement = stEl ? String(stEl.value || "").trim() : "";
      if (!statement) continue;
      var answer = ansEl && ansEl.value === "false" ? false : true;
      var explanation = exEl ? String(exEl.value || "").trim() : "";
      out.push({
        statement: statement,
        answer: answer,
        explanation: explanation,
        explanationBasic: explanation
      });
    }
    return out;
  }

  function validateForSave(rows) {
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i] || {};
      if (!String(r.explanation || "").trim()) {
        return "OX 문항 " + (i + 1) + "의 해설을 입력해 주세요.";
      }
    }
    return "";
  }

  window.CaseOxForm = {
    MAX: MAX,
    ensureBuilt: ensureBuilt,
    fill: fill,
    collect: collect,
    validateForSave: validateForSave
  };
})();
