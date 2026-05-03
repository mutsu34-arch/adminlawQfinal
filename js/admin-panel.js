(function () {
  function isAdminUser(user) {
    if (!user || !user.email) return false;
    var emails = window.ADMIN_EMAILS || [];
    var mail = String(user.email).toLowerCase();
    for (var i = 0; i < emails.length; i++) {
      if (String(emails[i]).toLowerCase() === mail) return true;
    }
    return false;
  }

  function setMsg(el, text, isError) {
    if (!el) return;
    el.textContent = text || "";
    el.classList.toggle("admin-msg--error", !!isError);
    el.hidden = !text;
  }

  function parseTags(str) {
    if (!str || !String(str).trim()) return undefined;
    return String(str)
      .split(/[,#]/g)
      .map(function (s) { return s.trim(); })
      .filter(Boolean);
  }

  function parseDetailJson(str) {
    if (!str || !String(str).trim()) return undefined;
    try {
      var o = JSON.parse(str);
      if (o && (o.legal || o.trap || o.precedent)) return o;
    } catch (e) {}
    return undefined;
  }

  function validateCore(q) {
    if (!q.id || !String(q.id).trim()) return "문항 ID를 입력하세요.";
    if (!q.examId) return "시험 종류(examId)를 선택하세요.";
    if (q.year == null || q.year === "") return "연도를 입력하세요.";
    if (!q.topic || !String(q.topic).trim()) return "주제(단원)를 입력하세요.";
    if (!q.statement || !String(q.statement).trim()) return "문제 본문을 입력하세요.";
    if (typeof q.answer !== "boolean") return "정답 O/X를 선택하세요.";
    if (!q.explanation || !String(q.explanation).trim()) return "해설을 입력하세요.";
    return null;
  }

  function readAnswerO() {
    var el = document.querySelector('input[name="admin-q-answer"]:checked');
    if (!el) return null;
    return el.value === "true";
  }

  function buildQuestionFromForm(get) {
    var id = get("admin-q-id").trim();
    var yearVal = parseInt(get("admin-q-year"), 10);
    var imp = get("admin-q-importance");
    var diff = get("admin-q-difficulty");
    var ans = readAnswerO();
    var q = {
      id: id,
      examId: get("admin-exam-id"),
      year: isNaN(yearVal) ? new Date().getFullYear() : yearVal,
      exam: get("admin-q-exam").trim() || get("admin-exam-id"),
      topic: get("admin-q-topic").trim(),
      statement: get("admin-q-statement").trim(),
      answer: ans,
      explanation: get("admin-q-explanation").trim()
    };
    var basic = get("admin-q-explanation-basic").trim();
    if (basic) q.explanationBasic = basic;
    var det = parseDetailJson(get("admin-q-detail-json"));
    if (det) q.detail = det;
    var tags = parseTags(get("admin-q-tags"));
    if (tags && tags.length) q.tags = tags;
    if (imp) {
      var im = parseInt(imp, 10);
      if (!isNaN(im)) q.importance = im;
    }
    if (diff) {
      var df = parseInt(diff, 10);
      if (!isNaN(df)) q.difficulty = df;
    }
    return q;
  }

  function fillExamSelect(select) {
    if (!select || !window.EXAM_CATALOG) return;
    var prev = String(select.value || "").trim();
    select.innerHTML = "";
    window.EXAM_CATALOG.forEach(function (ex) {
      var o = document.createElement("option");
      o.value = ex.id;
      o.textContent = ex.label;
      select.appendChild(o);
    });
    if (prev) {
      for (var i = 0; i < select.options.length; i++) {
        if (select.options[i].value === prev) {
          select.value = prev;
          break;
        }
      }
    }
  }

  function bind() {
    var form = document.getElementById("admin-form-single");
    var fileInput = document.getElementById("admin-json-file");
    var btnJson = document.getElementById("admin-btn-json-upload");
    var msgSingle = document.getElementById("admin-msg-single");
    var msgJson = document.getElementById("admin-msg-json");
    var examSel = document.getElementById("admin-exam-id");
    fillExamSelect(examSel);

    if (form) {
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        var user = typeof window.getHanlawUser === "function" ? window.getHanlawUser() : null;
        if (!isAdminUser(user)) {
          setMsg(msgSingle, "관리자만 등록할 수 있습니다.", true);
          return;
        }
        function get(id) {
          var el = document.getElementById(id);
          return el ? el.value : "";
        }
        var q = buildQuestionFromForm(get);
        var err = validateCore(q);
        if (err) {
          setMsg(msgSingle, err, true);
          return;
        }
        setMsg(msgSingle, "저장 중…", false);
        window
          .saveQuestionToFirestore(q)
          .then(function () {
            setMsg(msgSingle, "저장되었습니다. 퀴즈에 반영되었습니다.", false);
            form.reset();
            fillExamSelect(examSel);
            document.getElementById("admin-q-id").value =
              "custom-" + Date.now().toString(36);
            var yN = document.getElementById("admin-q-year");
            if (yN) yN.value = String(new Date().getFullYear());
          })
          .catch(function (err2) {
            setMsg(
              msgSingle,
              (err2 && err2.message) || "저장에 실패했습니다. Firestore 규칙·네트워크를 확인하세요.",
              true
            );
          });
      });
    }

    if (btnJson && fileInput) {
      btnJson.addEventListener("click", function () {
        var user = typeof window.getHanlawUser === "function" ? window.getHanlawUser() : null;
        if (!isAdminUser(user)) {
          setMsg(msgJson, "관리자만 업로드할 수 있습니다.", true);
          return;
        }
        var f = fileInput.files && fileInput.files[0];
        if (!f) {
          setMsg(msgJson, "JSON 파일을 선택하세요.", true);
          return;
        }
        var reader = new FileReader();
        reader.onload = function () {
          try {
            var data = JSON.parse(reader.result);
            if (!Array.isArray(data)) data = [data];
            var ok = [];
            for (var i = 0; i < data.length; i++) {
              var q = data[i];
              var err = validateCore(q);
              if (err) {
                setMsg(msgJson, i + 1 + "번째 항목: " + err, true);
                return;
              }
              ok.push(q);
            }
            setMsg(msgJson, ok.length + "건 업로드 중…", false);
            window
              .saveQuestionsBatchToFirestore(ok)
              .then(function () {
                setMsg(msgJson, ok.length + "건 반영되었습니다.", false);
                fileInput.value = "";
              })
              .catch(function (err2) {
                setMsg(
                  msgJson,
                  (err2 && err2.message) || "업로드 실패. Firestore를 확인하세요.",
                  true
                );
              });
          } catch (parseErr) {
            setMsg(msgJson, "JSON 형식이 올바르지 않습니다.", true);
          }
        };
        reader.readAsText(f, "UTF-8");
      });
    }

    var yEl = document.getElementById("admin-q-year");
    if (yEl && !yEl.value) yEl.value = String(new Date().getFullYear());
    document.getElementById("admin-q-id").value =
      "custom-" + Date.now().toString(36);

    window.addEventListener("question-bank-updated", function () {
      fillExamSelect(document.getElementById("admin-exam-id"));
    });
  }

  document.addEventListener("DOMContentLoaded", bind);

  window.AdminQuestionUtils = {
    validateCore: validateCore,
    parseTags: parseTags,
    parseDetailJson: parseDetailJson
  };
})();
