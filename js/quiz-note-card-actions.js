/**
 * 오답·찜·마스터 노트 카드 — 퀴즈 본문과 동일한 액션(찜·마스터·티켓·AI·메모)
 */
(function () {
  var MEMO_SUB = "nm";

  function normalizeId(id) {
    return String(id == null ? "" : id).trim();
  }

  function findQuestionById(id) {
    var want = normalizeId(id);
    var bank = window.QUESTION_BANK || [];
    for (var i = 0; i < bank.length; i++) {
      if (normalizeId(bank[i].id) === want) return bank[i];
    }
    return null;
  }

  function starsLine(n) {
    var max = 5;
    var v = typeof n === "number" && n >= 0 ? Math.min(max, Math.floor(n)) : 0;
    var s = "";
    for (var i = 0; i < max; i++) s += i < v ? "★" : "☆";
    return s;
  }

  function getBasicExplain(q) {
    if (!q) return "";
    if (q.explanationBasic != null && q.explanationBasic !== "") return q.explanationBasic;
    return q.explanation != null ? q.explanation : "";
  }

  function buildQuizAiContext(q, userTrue) {
    if (!q) return null;
    var basic = getBasicExplain(q);
    var det = "";
    if (q.detail && typeof q.detail === "object") {
      if (q.detail.body != null && String(q.detail.body).trim()) {
        det = String(q.detail.body).trim() + "\n\n";
      } else {
        var keys = ["legal", "trap", "precedent"];
        var titles = { legal: "법리 근거", trap: "함정 포인트", precedent: "판례" };
        for (var i = 0; i < keys.length; i++) {
          var k = keys[i];
          if (q.detail[k]) det += (titles[k] || k) + ": " + q.detail[k] + "\n\n";
        }
      }
    }
    var stmt = String(q.statement || "");
    if (stmt.length > 4000) stmt = stmt.slice(0, 4000);
    var exB = String(basic || "");
    if (exB.length > 6000) exB = exB.slice(0, 6000);
    var exX = String(det || "");
    if (exX.length > 6000) exX = exX.slice(0, 6000);
    return {
      statement: stmt,
      topic: String(q.topic || "").slice(0, 200),
      correctAnswer: q.answer === true,
      userAnsweredTrue: userTrue === true,
      explanationBasic: exB,
      explanationExtra: exX
    };
  }

  function buildQuizQuestionContext(q) {
    var UI = window.HanlawNoteQuizUi;
    var src =
      UI && typeof UI.formatQuizSourceLine === "function" ? UI.formatQuizSourceLine(q) : "";
    var meta = q.topic || "—";
    if (q.importance) meta += " · 중요도 " + starsLine(q.importance);
    if (q.difficulty) meta += " · 난이도 " + starsLine(q.difficulty);
    return {
      questionId: q.id,
      statement: q.statement,
      topic: q.topic,
      exam: q.exam,
      year: q.year,
      examId: q.examId,
      source: src,
      meta: meta
    };
  }

  function userTrueFromArticle(article) {
    return article.getAttribute("data-user-true") === "1";
  }

  function setGlobalContexts(article, q, userTrue) {
    window.__QUIZ_QUESTION_CONTEXT = buildQuizQuestionContext(q);
    window.__HANLAW_QUIZ_AI_CONTEXT = buildQuizAiContext(q, userTrue);
  }

  function refreshFavMasterOnCard(article, q) {
    if (!article || !q) return;
    var fav = article.querySelector(".note-quiz-chrome__fav");
    var mas = article.querySelector(".note-quiz-chrome__master");
    var u = typeof window.getHanlawUser === "function" ? window.getHanlawUser() : null;
    var loggedIn = !!(u && u.email);
    if (fav) {
      fav.hidden = !loggedIn;
      if (loggedIn && window.QuizFavorites) {
        var on = window.QuizFavorites.has(q.id);
        fav.textContent = on ? "찜함 · 취소" : "찜하기";
        fav.classList.toggle("btn--quiz-fav--on", on);
        fav.setAttribute("aria-pressed", on ? "true" : "false");
      }
    }
    if (mas) {
      mas.hidden = !loggedIn;
      if (loggedIn && window.QuizMaster) {
        var mon = window.QuizMaster.has(q.id);
        mas.textContent = mon ? "마스터됨 · 취소" : "마스터";
        mas.classList.toggle("btn--quiz-master--on", mon);
        mas.setAttribute("aria-pressed", mon ? "true" : "false");
      }
    }
  }

  function syncMemoLoginClass(article) {
    var sec = article.querySelector(".note-quiz-memo");
    if (!sec) return;
    var u = typeof window.getHanlawUser === "function" ? window.getHanlawUser() : null;
    var loggedIn = !!(u && u.email);
    sec.classList.toggle("quiz-memo--need-login", !loggedIn);
  }

  function loadMemoIntoCard(article, q) {
    if (!window.QuizQuestionMemo || !q) return;
    var qid = normalizeId(q.id);
    if (!qid) return;
    var wrap = article.querySelector(".note-quiz-memo");
    if (!wrap) return;
    var ta = wrap.querySelector(".quiz-memo__textarea");
    var msg = wrap.querySelector(".quiz-memo__msg");
    var m = window.QuizQuestionMemo.get(qid);
    if (ta) ta.value = m && m.text ? m.text : "";
    var ctl = article._hanlawNoteMemoCtl;
    if (ctl) {
      if (typeof ctl.setEraser === "function") ctl.setEraser(false);
      if (m && m.drawing && String(m.drawing).indexOf("data:image") === 0) {
        ctl.loadDataUrl(m.drawing);
      } else if (typeof ctl.clear === "function") ctl.clear();
    }
    if (msg) {
      msg.textContent = "";
      msg.hidden = true;
    }
    syncMemoLoginClass(article);
  }

  function setMemoMsg(article, text, isError) {
    var msg = article.querySelector(".note-quiz-memo .quiz-memo__msg");
    if (!msg) return;
    msg.textContent = text || "";
    msg.hidden = !text;
    msg.classList.toggle("quiz-memo__msg--error", !!isError);
  }

  function updateMemoToolUi(article) {
    var ctl = article._hanlawNoteMemoCtl;
    if (!ctl) return;
    var wrap = article.querySelector(".note-quiz-memo");
    if (!wrap) return;
    var isEr = typeof ctl.isEraser === "function" && ctl.isEraser();
    var penB = wrap.querySelector(".quiz-memo__tool-btn[data-note-memo-tool='pen']");
    var erB = wrap.querySelector(".quiz-memo__tool-btn[data-note-memo-tool='eraser']");
    var colorIn = wrap.querySelector(".quiz-memo__color-input");
    var widthSel = wrap.querySelector(".quiz-memo__width-select");
    if (penB) {
      penB.classList.toggle("quiz-memo__tool-btn--active", !isEr);
      penB.setAttribute("aria-pressed", !isEr ? "true" : "false");
    }
    if (erB) {
      erB.classList.toggle("quiz-memo__tool-btn--active", !!isEr);
      erB.setAttribute("aria-pressed", isEr ? "true" : "false");
    }
    if (colorIn && typeof ctl.getPenColor === "function") {
      try {
        colorIn.value = ctl.getPenColor();
      } catch (e) {}
    }
    if (widthSel && typeof ctl.getLineWidth === "function") {
      var w = String(ctl.getLineWidth());
      var opts = widthSel.querySelectorAll("option");
      var oi;
      for (oi = 0; oi < opts.length; oi++) {
        if (opts[oi].value === w) {
          widthSel.value = w;
          break;
        }
      }
    }
  }

  function bindMemoOnce(article) {
    if (article._hanlawNoteMemoBound) return;
    article._hanlawNoteMemoBound = true;
    var wrap = article.querySelector(".note-quiz-memo");
    if (!wrap || !window.QuizQuestionMemo) return;
    var canvas = wrap.querySelector(".quiz-memo__canvas");
    var ta = wrap.querySelector(".quiz-memo__textarea");
    var toggle = wrap.querySelector("[data-note-memo-panel-toggle]");
    var body = wrap.querySelector("[data-note-memo-body]");
    var saveBtn = wrap.querySelector("[data-note-memo-save]");
    var clearBtn = wrap.querySelector("[data-note-memo-clear-canvas]");
    var settingsToggle = wrap.querySelector("[data-note-memo-draw-settings-toggle]");
    var settingsPanel = wrap.querySelector("[data-note-memo-draw-settings]");

    if (canvas && typeof window.QuizQuestionMemo.attachDrawingCanvas === "function") {
      article._hanlawNoteMemoCtl = window.QuizQuestionMemo.attachDrawingCanvas(canvas, {
        onChange: function () {}
      });
      var colorIn0 = wrap.querySelector(".quiz-memo__color-input");
      var widthSel0 = wrap.querySelector(".quiz-memo__width-select");
      var ctl0 = article._hanlawNoteMemoCtl;
      if (colorIn0 && ctl0.setPenColor) ctl0.setPenColor(colorIn0.value);
      if (widthSel0 && ctl0.setLineWidth) ctl0.setLineWidth(widthSel0.value);
      if (ctl0.setEraser) ctl0.setEraser(false);
      updateMemoToolUi(article);
    }

    if (toggle && body) {
      toggle.addEventListener("click", function () {
        var u = typeof window.getHanlawUser === "function" ? window.getHanlawUser() : null;
        if (!u || !u.email) {
          window.alert("나의 메모(암기·팁)는 로그인 후 이용할 수 있습니다.");
          return;
        }
        var nextOpen = !!body.hidden;
        body.hidden = !nextOpen;
        toggle.setAttribute("aria-expanded", nextOpen ? "true" : "false");
        toggle.textContent = nextOpen ? "나의 메모 (암기·팁) 접기" : "나의 메모 (암기·팁) 펼치기";
        if (nextOpen && ta) {
          try {
            ta.focus();
          } catch (e) {}
        }
      });
    }

    if (settingsToggle && settingsPanel) {
      settingsToggle.addEventListener("click", function () {
        var open = !!settingsPanel.hidden;
        settingsPanel.hidden = !open;
        settingsToggle.setAttribute("aria-expanded", open ? "true" : "false");
      });
    }

    var penBtn = wrap.querySelector(".quiz-memo__tool-btn[data-note-memo-tool='pen']");
    var eraserBtn = wrap.querySelector(".quiz-memo__tool-btn[data-note-memo-tool='eraser']");
    var ctl = article._hanlawNoteMemoCtl;
    if (penBtn && ctl) {
      penBtn.addEventListener("click", function () {
        if (ctl.setEraser) ctl.setEraser(false);
        updateMemoToolUi(article);
      });
    }
    if (eraserBtn && ctl) {
      eraserBtn.addEventListener("click", function () {
        if (ctl.setEraser) ctl.setEraser(true);
        updateMemoToolUi(article);
      });
    }
    var colorIn = wrap.querySelector(".quiz-memo__color-input");
    if (colorIn && ctl) {
      colorIn.addEventListener("input", function () {
        if (ctl.setPenColor) ctl.setPenColor(colorIn.value);
      });
    }
    var widthSel = wrap.querySelector(".quiz-memo__width-select");
    if (widthSel && ctl) {
      widthSel.addEventListener("change", function () {
        if (ctl.setLineWidth) ctl.setLineWidth(widthSel.value);
      });
    }
    if (clearBtn && ctl) {
      clearBtn.addEventListener("click", function () {
        if (typeof ctl.clear === "function") ctl.clear();
      });
    }
    if (saveBtn) {
      saveBtn.addEventListener("click", function () {
        var u = typeof window.getHanlawUser === "function" ? window.getHanlawUser() : null;
        if (!u || !u.email) {
          setMemoMsg(article, "로그인 후 이용할 수 있습니다.", true);
          return;
        }
        if (!window.QuizQuestionMemo || typeof window.QuizQuestionMemo.set !== "function") {
          setMemoMsg(article, "메모 저장을 사용할 수 없습니다.", true);
          return;
        }
        var q = findQuestionById(article.getAttribute("data-qid"));
        if (!q || !normalizeId(q.id)) {
          setMemoMsg(article, "문항 정보가 없습니다.", true);
          return;
        }
        var qid = normalizeId(q.id);
        var txt = ta ? String(ta.value || "").trim() : "";
        var drawing = "";
        var ctl2 = article._hanlawNoteMemoCtl;
        if (ctl2 && typeof ctl2.hasInk === "function" && ctl2.hasInk()) {
          try {
            drawing = canvas.toDataURL("image/jpeg", 0.88);
          } catch (e) {
            drawing = "";
          }
        }
        if (!txt && !drawing) {
          window.QuizQuestionMemo.remove(qid);
          setMemoMsg(article, "메모를 비웠습니다.", false);
          return;
        }
        window.QuizQuestionMemo.set(qid, { text: txt, drawing: drawing });
        setMemoMsg(article, "저장했습니다.", false);
      });
    }
  }

  function resetAiPanelInCard(article) {
    var root = article.querySelector(".note-quiz-chrome");
    if (!root) return;
    var p = root.querySelector(".note-quiz-chrome__ai-panel");
    var ta = root.querySelector(".note-quiz-chrome__ai-question");
    var ans = root.querySelector(".note-quiz-chrome__ai-answer");
    var err = root.querySelector(".note-quiz-chrome__ai-error");
    var load = root.querySelector(".note-quiz-chrome__ai-loading");
    var loadQ = root.querySelector(".note-quiz-chrome__ai-loading-quote");
    var btn = root.querySelector(".note-quiz-chrome__ai-toggle");
    if (p) p.hidden = true;
    if (ta) ta.value = "";
    if (load) {
      load.hidden = true;
      load.setAttribute("aria-busy", "false");
    }
    if (loadQ) loadQ.textContent = "";
    if (ans) {
      ans.textContent = "";
      ans.innerHTML = "";
      ans.hidden = true;
    }
    if (err) {
      err.textContent = "";
      err.hidden = true;
    }
    if (btn) btn.setAttribute("aria-expanded", "false");
  }

  function onCardRevealed(article, q, userTrue) {
    article.setAttribute("data-user-true", userTrue ? "1" : "0");
    setGlobalContexts(article, q, userTrue);
    bindMemoOnce(article);
    loadMemoIntoCard(article, q);
    refreshFavMasterOnCard(article, q);
    resetAiPanelInCard(article);
    if (typeof window.HanlawNoteQuizChromeSyncAiRemain === "function") {
      window.HanlawNoteQuizChromeSyncAiRemain();
    }
  }

  function refreshAllAnsweredCards() {
    document.querySelectorAll('[data-note-quiz][data-answered="1"]').forEach(function (art) {
      var q = findQuestionById(art.getAttribute("data-qid"));
      if (!q) return;
      refreshFavMasterOnCard(art, q);
    });
  }

  function refreshMemosOnAnsweredCards() {
    document.querySelectorAll('[data-note-quiz][data-answered="1"]').forEach(function (art) {
      var q = findQuestionById(art.getAttribute("data-qid"));
      if (q) loadMemoIntoCard(art, q);
    });
  }

  function appendChromeAndMemo(postEl) {
    var suid =
      MEMO_SUB +
      "-" +
      Math.random()
        .toString(36)
        .slice(2, 10);
    var memoBodyId = suid + "-body";

    var memoWrap = document.createElement("div");
    memoWrap.className = "quiz-memo note-quiz-memo";
    memoWrap.innerHTML =
      '<button type="button" class="btn btn--outline btn--small quiz-memo__panel-toggle" data-note-memo-panel-toggle="1" aria-expanded="false" aria-controls="' +
      memoBodyId +
      '">나의 메모 (암기·팁) 펼치기</button>' +
      '<div class="quiz-memo__body" data-note-memo-body="1" id="' +
      memoBodyId +
      '" hidden>' +
      '<p class="feedback__block-label quiz-memo__body-title">나의 메모 (암기·팁)</p>' +
      '<p class="quiz-memo__subhead">텍스트</p>' +
      '<div class="quiz-memo__panel quiz-memo__panel--text">' +
      '<textarea class="input textarea quiz-memo__textarea" rows="3" maxlength="8000" placeholder="암기 팁, 함정, 직접 정리한 요점 등을 적어 보세요." aria-label="텍스트 메모"></textarea>' +
      "</div>" +
      '<div class="quiz-memo__panel quiz-memo__panel--draw">' +
      '<p class="quiz-memo__subhead quiz-memo__subhead--draw">손글씨</p>' +
      '<div class="quiz-memo__split-actions" role="group" aria-label="손글씨 도구">' +
      '<button type="button" class="btn btn--outline btn--small quiz-memo__split-actions-btn" data-note-memo-draw-settings-toggle="1" aria-expanded="false" aria-controls="' +
      suid +
      '-drawset">펜·지우개 설정</button>' +
      '<button type="button" class="btn btn--outline btn--small quiz-memo__split-actions-btn" data-note-memo-clear-canvas="1">전부 지우기</button>' +
      "</div>" +
      '<div class="quiz-memo__draw-settings" data-note-memo-draw-settings="1" id="' +
      suid +
      '-drawset" hidden>' +
      '<div class="quiz-memo__tool-row"><span class="quiz-memo__tool-label">도구</span>' +
      '<div class="quiz-memo__tool-pills" role="group" aria-label="펜 또는 지우개">' +
      '<button type="button" class="quiz-memo__tool-btn quiz-memo__tool-btn--active" data-note-memo-tool="pen" aria-pressed="true">펜</button>' +
      '<button type="button" class="quiz-memo__tool-btn" data-note-memo-tool="eraser" aria-pressed="false">지우개</button>' +
      "</div></div>" +
      '<div class="quiz-memo__tool-row quiz-memo__tool-row--grow">' +
      '<label class="quiz-memo__tool-field"><span class="quiz-memo__tool-field-label">색</span>' +
      '<input type="color" class="quiz-memo__color-input" value="#cbd5e1" /></label>' +
      '<label class="quiz-memo__tool-field"><span class="quiz-memo__tool-field-label">굵기</span>' +
      '<select class="select quiz-memo__width-select">' +
      '<option value="2">가늘게</option><option value="4" selected>보통</option>' +
      '<option value="7">굵게</option><option value="12">아주 굵게</option></select></label></div></div>' +
      '<p class="quiz-memo__draw-hint">마우스나 손가락으로 그려 보세요.</p>' +
      '<canvas class="quiz-memo__canvas" width="960" height="400"></canvas></div>' +
      '<div class="quiz-memo__save-row">' +
      '<button type="button" class="btn btn--secondary btn--small" data-note-memo-save="1">메모 저장</button>' +
      '<span class="quiz-memo__msg" data-note-memo-msg="1" hidden role="status"></span></div></div>';

    var chrome = document.createElement("div");
    chrome.className = "quiz-ai-ask note-quiz-chrome";
    chrome.innerHTML =
      '<p class="quiz-ai-ask__remain note-quiz-chrome__remain" aria-live="polite"></p>' +
      '<div class="quiz-post-actions__toolbar" role="group" aria-label="문항 관련 동작">' +
      '<button type="button" class="btn btn--outline btn--quiz-fav note-quiz-chrome__fav" hidden aria-pressed="false">찜하기</button>' +
      '<button type="button" class="btn btn--outline btn--quiz-master note-quiz-chrome__master" hidden aria-pressed="false" title="이 문항을 일반 퀴즈 범위에서 제외합니다">마스터</button>' +
      '<button type="button" class="btn btn--ticket btn--ticket-report note-quiz-chrome__ticket-report">오류 신고하기</button>' +
      '<button type="button" class="btn btn--ticket btn--ticket-suggestion note-quiz-chrome__ticket-suggestion">개선 의견 보내기</button>' +
      '<button type="button" class="btn btn--secondary note-quiz-chrome__ai-toggle" aria-expanded="false">엘리에게 물어보기(AI)</button>' +
      '<button type="button" class="btn btn--ticket btn--ticket-ask note-quiz-chrome__ticket-ask">변호사에게 물어보기</button>' +
      "</div>" +
      '<div class="quiz-ai-panel note-quiz-chrome__ai-panel" hidden>' +
      '<label class="field"><span class="field__label">엘리(AI)에게 질문 (문항·해설 맥락이 함께 전달됩니다)</span>' +
      '<textarea class="input textarea note-quiz-chrome__ai-question" rows="3" maxlength="800" placeholder="비우면 ‘핵심만 다시 정리’ 요청으로 보냅니다. 예: 왜 이 경우 O인가요?"></textarea></label>' +
      '<button type="button" class="btn btn--primary note-quiz-chrome__ai-send">질문 보내기</button>' +
      '<p class="admin-msg admin-msg--error quiz-ai-error note-quiz-chrome__ai-error" hidden></p>' +
      '<div class="quiz-ai-loading note-quiz-chrome__ai-loading" hidden aria-live="polite" aria-busy="true">' +
      '<p class="quiz-ai-loading__status">답변 생성 중…</p>' +
      '<p class="quiz-ai-loading__quote note-quiz-chrome__ai-loading-quote"></p></div>' +
      '<div class="quiz-ai-answer note-quiz-chrome__ai-answer" hidden role="region" aria-label="AI 답변"></div></div>';

    postEl.appendChild(memoWrap);
    postEl.appendChild(chrome);
  }

  function ensureContextsForArticle(article) {
    var q = findQuestionById(article.getAttribute("data-qid"));
    if (!q) return null;
    setGlobalContexts(article, q, userTrueFromArticle(article));
    return q;
  }

  function openLawyerAskModal() {
    if (typeof window.openHanlawTicketModal !== "function") return;
    var u0 = typeof window.getHanlawUser === "function" ? window.getHanlawUser() : null;
    if (!u0 || !u0.email) {
      window.alert("변호사에게 물어보기는 로그인한 뒤, 질문권이 있을 때 이용할 수 있습니다.");
      return;
    }
    function go() {
      window.openHanlawTicketModal("question");
    }
    if (typeof window.waitForQuestionCreditState !== "function") {
      go();
      return;
    }
    window.waitForQuestionCreditState(function (state) {
      if (state.loading) {
        window.alert("질문권 정보를 불러오는 중입니다. 잠시 후 다시 시도하세요.");
        return;
      }
      if ((state.total || 0) < 1) {
        var pp =
          typeof window.getQuestionPackPricesDisplay === "function"
            ? window.getQuestionPackPricesDisplay()
            : "";
        window.alert(
          "질문권이 없습니다.\n\n· 유료 구독 회원: 매월 4건(한국시간 기준 월 단위)이 제공됩니다.\n· 추가로 요금제 탭에서 질문권을 구매할 수 있습니다(" +
            pp +
            ", 구매일로부터 1년 유효)."
        );
        return;
      }
      go();
    });
  }

  document.addEventListener("click", function (e) {
    var chromeBtn = e.target.closest(
      ".note-quiz-chrome__fav, .note-quiz-chrome__master, .note-quiz-chrome__ticket-report, .note-quiz-chrome__ticket-suggestion, .note-quiz-chrome__ticket-ask, .note-quiz-chrome__ai-toggle, .note-quiz-chrome__ai-send"
    );
    if (!chromeBtn) return;
    var article = chromeBtn.closest("[data-note-quiz]");
    if (!article) return;

    if (chromeBtn.classList.contains("note-quiz-chrome__fav")) {
      var u = typeof window.getHanlawUser === "function" ? window.getHanlawUser() : null;
      if (!u || !u.email) {
        window.alert("찜하기는 로그인 후 이용할 수 있습니다.");
        return;
      }
      var qf = ensureContextsForArticle(article);
      if (!qf || !window.QuizFavorites) return;
      window.QuizFavorites.toggle(normalizeId(qf.id));
      refreshFavMasterOnCard(article, qf);
      return;
    }

    if (chromeBtn.classList.contains("note-quiz-chrome__master")) {
      var u2 = typeof window.getHanlawUser === "function" ? window.getHanlawUser() : null;
      if (!u2 || !u2.email) {
        window.alert("로그인 후 이용할 수 있습니다.");
        return;
      }
      var qm = ensureContextsForArticle(article);
      if (!qm || !window.QuizMaster) return;
      window.QuizMaster.toggle(normalizeId(qm.id));
      refreshFavMasterOnCard(article, qm);
      return;
    }

    if (chromeBtn.classList.contains("note-quiz-chrome__ticket-report")) {
      var ur = typeof window.getHanlawUser === "function" ? window.getHanlawUser() : null;
      if (!ur || !ur.email) {
        window.alert("오류 신고하기는 로그인 후 이용할 수 있습니다.");
        return;
      }
      ensureContextsForArticle(article);
      if (typeof window.openHanlawTicketModal === "function") window.openHanlawTicketModal("report");
      return;
    }

    if (chromeBtn.classList.contains("note-quiz-chrome__ticket-suggestion")) {
      var us = typeof window.getHanlawUser === "function" ? window.getHanlawUser() : null;
      if (!us || !us.email) {
        window.alert("개선 의견은 로그인한 뒤 보낼 수 있습니다.");
        return;
      }
      ensureContextsForArticle(article);
      if (typeof window.openHanlawTicketModal === "function") window.openHanlawTicketModal("suggestion");
      return;
    }

    if (chromeBtn.classList.contains("note-quiz-chrome__ticket-ask")) {
      ensureContextsForArticle(article);
      openLawyerAskModal();
      return;
    }

    if (chromeBtn.classList.contains("note-quiz-chrome__ai-toggle")) {
      ensureContextsForArticle(article);
      if (typeof window.isPaidMember !== "function" || !window.isPaidMember()) {
        window.alert("엘리에게 물어보기(AI)는 유료 회원에 한해 이용할 수 있습니다.");
        return;
      }
      var root = article.querySelector(".note-quiz-chrome");
      var p = root && root.querySelector(".note-quiz-chrome__ai-panel");
      if (!p) return;
      var open = p.hidden;
      p.hidden = !open;
      chromeBtn.setAttribute("aria-expanded", open ? "true" : "false");
      return;
    }

    if (chromeBtn.classList.contains("note-quiz-chrome__ai-send")) {
      ensureContextsForArticle(article);
      if (window.QuizAiAsk && typeof window.QuizAiAsk.sendFromNoteArticle === "function") {
        window.QuizAiAsk.sendFromNoteArticle(article);
      }
    }
  });

  window.HanlawNoteQuizChrome = {
    appendChromeAndMemo: appendChromeAndMemo,
    onCardRevealed: onCardRevealed,
    refreshAllAnsweredCards: refreshAllAnsweredCards,
    refreshMemosOnAnsweredCards: refreshMemosOnAnsweredCards
  };

  window.HanlawNoteQuizChromeSyncAiRemain = function () {
    var main = document.getElementById("quiz-ai-remain");
    var txt = main ? main.textContent : "";
    document.querySelectorAll(".note-quiz-chrome__remain").forEach(function (el) {
      el.textContent = txt;
    });
  };
})();
