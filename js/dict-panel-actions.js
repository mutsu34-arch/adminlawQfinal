(function () {
  var MEMO_VER = "v1";
  var LS = "hanlaw_dict_panel_memos_" + MEMO_VER + "_";

  function $(id) {
    return document.getElementById(id);
  }

  function stripHtmlToPlain(html) {
    var d = document.createElement("div");
    d.innerHTML = String(html || "");
    var t = d.textContent || d.innerText || "";
    return t.replace(/\s+/g, " ").trim();
  }

  function normMemo(s) {
    return String(s || "")
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, 200);
  }

  function memoStorageKey() {
    var uid = "local";
    try {
      if (typeof window.getHanlawUser === "function") {
        var u = window.getHanlawUser();
        if (u && u.uid) uid = u.uid;
      }
    } catch (e) {}
    return LS + uid;
  }

  function readMemoStore() {
    try {
      var s = localStorage.getItem(memoStorageKey());
      if (!s) return { entries: {} };
      var o = JSON.parse(s);
      if (!o || typeof o.entries !== "object" || !o.entries) return { entries: {} };
      return o;
    } catch (e) {
      return { entries: {} };
    }
  }

  function writeMemoStore(data) {
    try {
      localStorage.setItem(memoStorageKey(), JSON.stringify(data));
    } catch (e) {}
  }

  var dictMemoCanvasApi = { term: null, statute: null, case: null };
  var dictMemoPanMode = { term: false, statute: false, case: false };
  /** 전부 지우기로 캔버스를 비운 뒤에는 저장 시 기존 손글씨를 되살리지 않음 */
  var dictMemoDrawingUserCleared = { term: false, statute: false, case: false };

  function ensureMemoCanvasApi(kind) {
    if (dictMemoCanvasApi[kind]) return dictMemoCanvasApi[kind];
    if (!window.QuizQuestionMemo || typeof window.QuizQuestionMemo.attachDrawingCanvas !== "function") {
      return null;
    }
    var c = $("dict-" + kind + "-memo-canvas");
    if (!c) return null;
    dictMemoCanvasApi[kind] = window.QuizQuestionMemo.attachDrawingCanvas(c, { onChange: function () {} });
    return dictMemoCanvasApi[kind];
  }

  function updateDictMemoToolUi(kind) {
    var api = dictMemoCanvasApi[kind];
    if (!api) return;
    var pre = "dict-" + kind + "-memo";
    var isEr = typeof api.isEraser === "function" && api.isEraser();
    var penB = $(pre + "-tool-pen");
    var erB = $(pre + "-tool-eraser");
    var colorIn = $(pre + "-pen-color");
    var widthSel = $(pre + "-pen-width");
    if (penB) {
      penB.classList.toggle("quiz-memo__tool-btn--active", !isEr);
      penB.setAttribute("aria-pressed", !isEr ? "true" : "false");
    }
    if (erB) {
      erB.classList.toggle("quiz-memo__tool-btn--active", !!isEr);
      erB.setAttribute("aria-pressed", isEr ? "true" : "false");
    }
    if (colorIn) {
      colorIn.disabled = !!isEr;
      if (typeof api.getPenColor === "function") {
        var pc = api.getPenColor();
        if (pc && pc.indexOf("#") === 0) colorIn.value = pc;
      }
    }
    if (widthSel && typeof api.getLineWidth === "function") {
      var w = String(api.getLineWidth());
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

  function applyDictMemoPanMode(kind, on) {
    var pre = "dict-" + kind + "-memo";
    var pan = !!on;
    dictMemoPanMode[kind] = pan;
    var canvas = $(pre + "-canvas");
    var scrollWrap = canvas ? canvas.closest(".quiz-memo__canvas-scroll") : null;
    if (canvas) canvas.classList.toggle("quiz-memo__canvas--pan", pan);
    if (scrollWrap) scrollWrap.classList.toggle("quiz-memo__canvas-scroll--pan", pan);
    var panBtn = $(pre + "-pan-toggle");
    if (panBtn) {
      panBtn.setAttribute("aria-pressed", pan ? "true" : "false");
      panBtn.classList.toggle("quiz-memo__split-actions-btn--active", pan);
      panBtn.textContent = pan ? "그리기" : "이동";
    }
    var api = ensureMemoCanvasApi(kind);
    if (api && typeof api.setDrawingEnabled === "function") {
      var locked = canvas && canvas.classList.contains("quiz-memo__canvas--locked");
      api.setDrawingEnabled(!pan && !locked);
    }
  }

  /** 손글씨 저장 후·불러올 때 잠금 — 퀴즈 나의 메모와 동일 */
  function applyDictMemoDrawingLock(kind, locked) {
    var pre = "dict-" + kind + "-memo";
    var canvas = $(pre + "-canvas");
    ensureMemoCanvasApi(kind);
    if (!canvas) return;
    canvas.classList.toggle("quiz-memo__canvas--locked", !!locked);
    var editBtn = $(pre + "-edit-draw");
    if (editBtn) editBtn.hidden = !locked;
    var toolIds = [
      pre + "-draw-settings-toggle",
      pre + "-clear-canvas",
      pre + "-tool-pen",
      pre + "-tool-eraser",
      pre + "-pen-color",
      pre + "-pen-width"
    ];
    var ti;
    for (ti = 0; ti < toolIds.length; ti++) {
      var node = $(toolIds[ti]);
      if (node) node.disabled = !!locked;
    }
    if (locked) {
      var settingsPanel = $(pre + "-draw-settings");
      var settingsToggle = $(pre + "-draw-settings-toggle");
      if (settingsPanel) settingsPanel.hidden = true;
      if (settingsToggle) settingsToggle.setAttribute("aria-expanded", "false");
    } else {
      updateDictMemoToolUi(kind);
    }
    applyDictMemoPanMode(kind, dictMemoPanMode[kind]);
  }

  function syncDictMemoCanvasFromInputs(kind) {
    var api = ensureMemoCanvasApi(kind);
    if (!api) return;
    var pre = "dict-" + kind + "-memo";
    var colorIn0 = $(pre + "-pen-color");
    var widthSel0 = $(pre + "-pen-width");
    if (colorIn0 && api.setPenColor) api.setPenColor(colorIn0.value);
    if (widthSel0 && api.setLineWidth) api.setLineWidth(widthSel0.value);
    if (api.setEraser) api.setEraser(false);
    updateDictMemoToolUi(kind);
  }

  function loadMemoEntry(entryKey) {
    if (!entryKey) return { text: "", drawing: "" };
    var d = readMemoStore();
    var e = d.entries[entryKey];
    if (e == null) return { text: "", drawing: "" };
    if (typeof e === "string") return { text: String(e), drawing: "" };
    return {
      text: e.text != null ? String(e.text) : "",
      drawing: e.drawing != null ? String(e.drawing) : ""
    };
  }

  function saveMemoEntry(entryKey, text, drawing) {
    if (!entryKey) return;
    var t = String(text || "").trim().slice(0, 8000);
    var dr = drawing != null ? String(drawing).trim() : "";
    if (dr.length > 1200000) dr = dr.slice(0, 1200000);
    var d = readMemoStore();
    if (!t && !dr) {
      delete d.entries[entryKey];
    } else {
      d.entries[entryKey] = { text: t, drawing: dr, updated: Date.now() };
    }
    writeMemoStore(d);
  }

  function clearAiContexts() {
    window.__HANLAW_QUIZ_AI_CONTEXT = null;
    window.__QUIZ_QUESTION_CONTEXT = null;
    window.__HANLAW_DICT_MEMO_KEY = "";
  }

  function buildFromTermCard(article) {
    var titleEl = article.querySelector(".dict-result-card__title");
    var title = titleEl ? titleEl.textContent.trim() : "";
    var bodyEl = article.querySelector(".dict-result-card__body");
    var plain = stripHtmlToPlain(bodyEl ? bodyEl.innerHTML : "");
    var snip = plain.slice(0, 4000);
    window.__HANLAW_QUIZ_AI_CONTEXT = {
      mode: "dictionary",
      topic: "[용어사전] " + (title || "항목"),
      statement: snip || "(내용 없음)",
      explanationBasic: "",
      questionId: "dict-term:" + encodeURIComponent(title || "unknown")
    };
    window.__QUIZ_QUESTION_CONTEXT = {
      questionId: "dict-term:" + encodeURIComponent(title || "unknown"),
      topic: "[용어사전] " + title,
      statement: plain.slice(0, 900),
      meta: "dictionary:term"
    };
    window.__HANLAW_DICT_MEMO_KEY = "term:" + normMemo(title);
  }

  function buildFromStatuteCard(article) {
    var key = article.getAttribute("data-statute-key") || "";
    var titleEl = article.querySelector(".dict-result-card__title");
    var title = titleEl ? titleEl.textContent.trim() : key;
    var bodyEl = article.querySelector(".dict-result-card__body");
    var plain = stripHtmlToPlain(bodyEl ? bodyEl.innerHTML : "");
    var foot = article.querySelector(".dict-result-card__foot");
    var extra = foot ? foot.textContent.trim() : "";
    var full = plain + (extra ? "\n\n[출처·주의]\n" + extra : "");
    window.__HANLAW_QUIZ_AI_CONTEXT = {
      mode: "dictionary",
      topic: "[조문사전] " + (title || key),
      statement: full.slice(0, 4000) || "(내용 없음)",
      explanationBasic: "",
      questionId: "dict-statute:" + encodeURIComponent(key || title || "unknown")
    };
    window.__QUIZ_QUESTION_CONTEXT = {
      questionId: "dict-statute:" + encodeURIComponent(key || title || "unknown"),
      topic: "[조문사전] " + title,
      statement: plain.slice(0, 900),
      meta: "dictionary:statute:" + key
    };
    window.__HANLAW_DICT_MEMO_KEY = "statute:" + normMemo(key || title);
  }

  function buildFromCaseCard(article) {
    var cit = article.getAttribute("data-case-citation") || "";
    var cEl = article.querySelector(".case-result-card__citation");
    var tEl = article.querySelector(".case-result-card__title");
    var citeText = stripHtmlToPlain(cEl ? cEl.innerHTML : cit);
    var titleText = tEl ? stripHtmlToPlain(tEl.innerHTML) : "";
    var label = citeText || titleText || "판례";
    var secs = article.querySelectorAll(".case-result-card__text");
    var parts = [];
    for (var i = 0; i < secs.length; i++) {
      parts.push(stripHtmlToPlain(secs[i].innerHTML));
    }
    var plain = parts.join("\n\n").trim();
    window.__HANLAW_QUIZ_AI_CONTEXT = {
      mode: "dictionary",
      topic: "[판례사전] " + label,
      statement: plain.slice(0, 4000) || "(내용 없음)",
      explanationBasic: titleText ? "사건명: " + titleText : "",
      questionId: "dict-case:" + encodeURIComponent(cit || label)
    };
    window.__QUIZ_QUESTION_CONTEXT = {
      questionId: "dict-case:" + encodeURIComponent(cit || label),
      topic: "[판례사전] " + label,
      statement: plain.slice(0, 900),
      meta: "dictionary:case"
    };
    window.__HANLAW_DICT_MEMO_KEY = "case:" + normMemo(cit || label);
  }

  function syncDictionaryPanelContexts(kind) {
    var root =
      kind === "term"
        ? $("dict-term-results")
        : kind === "statute"
          ? $("statute-search-results")
          : kind === "case"
            ? $("case-search-results")
            : null;
    if (!root) return;

    if (kind === "term") {
      var onlyCase = root.querySelector(".case-result-card");
      var termCard = root.querySelector(".dict-result-card");
      if (onlyCase && !termCard) {
        buildFromCaseCard(onlyCase);
        refreshMemoFieldsForKind("term");
        return;
      }
      if (termCard) {
        buildFromTermCard(termCard);
        refreshMemoFieldsForKind("term");
        return;
      }
    } else if (kind === "statute") {
      var st = root.querySelector(".dict-result-card--statute");
      if (st) {
        buildFromStatuteCard(st);
        refreshMemoFieldsForKind("statute");
        return;
      }
    } else if (kind === "case") {
      var cs = root.querySelector(".case-result-card");
      if (cs) {
        buildFromCaseCard(cs);
        refreshMemoFieldsForKind("case");
        return;
      }
    }

    clearAiContexts();
    refreshMemoFieldsForKind(kind);
  }

  function refreshMemoFieldsForKind(kind) {
    var map = {
      term: "dict-term-memo-text",
      statute: "dict-statute-memo-text",
      case: "dict-case-memo-text"
    };
    var id = map[kind];
    var ta = id ? $(id) : null;
    if (!ta) return;
    var key = window.__HANLAW_DICT_MEMO_KEY || "";
    var api = ensureMemoCanvasApi(kind);
    if (!key) {
      ta.value = "";
      dictMemoDrawingUserCleared[kind] = false;
      if (api) {
        if (typeof api.setEraser === "function") api.setEraser(false);
        if (typeof api.clear === "function") api.clear();
        updateDictMemoToolUi(kind);
      }
      applyDictMemoDrawingLock(kind, false);
      return;
    }
    var m = loadMemoEntry(key);
    ta.value = m.text || "";
    if (api) {
      if (typeof api.setEraser === "function") api.setEraser(false);
      if (m.drawing && String(m.drawing).indexOf("data:image") === 0 && typeof api.loadDataUrl === "function") {
        dictMemoDrawingUserCleared[kind] = false;
        api.loadDataUrl(m.drawing);
      } else if (typeof api.clear === "function") {
        dictMemoDrawingUserCleared[kind] = false;
        api.clear();
      }
      updateDictMemoToolUi(kind);
    }
    var hasDrawingSaved = !!(m.drawing && String(m.drawing).indexOf("data:image") === 0);
    applyDictMemoDrawingLock(kind, hasDrawingSaved);
  }

  function setMemoMsg(kind, text, isError) {
    var mid =
      kind === "term"
        ? "dict-term-memo-msg"
        : kind === "statute"
          ? "dict-statute-memo-msg"
          : "dict-case-memo-msg";
    var el = $(mid);
    if (!el) return;
    el.textContent = text || "";
    el.hidden = !text;
    el.classList.toggle("admin-msg--error", !!isError);
  }

  function isViewerLoggedIn() {
    var u = typeof window.getHanlawUser === "function" ? window.getHanlawUser() : null;
    return !!(u && u.email);
  }

  function packPrices() {
    return typeof window.getQuestionPackPricesDisplay === "function"
      ? window.getQuestionPackPricesDisplay()
      : "1건 ₩5,000 · 10건 ₩30,000";
  }

  function ensureTicketContext(kind) {
    syncDictionaryPanelContexts(kind);
    return !!(window.__QUIZ_QUESTION_CONTEXT && window.__QUIZ_QUESTION_CONTEXT.questionId);
  }

  function openTicket(kind, type) {
    if (!ensureTicketContext(kind)) {
      window.alert(
        "연결할 사전 항목이 없습니다. 검색하여 결과 카드가 표시된 뒤 다시 시도해 주세요."
      );
      return;
    }
    if (type === "report") {
      if (!isViewerLoggedIn()) {
        window.alert("오류 신고하기는 로그인 후 이용할 수 있습니다.");
        return;
      }
      if (typeof window.openHanlawTicketModal === "function") {
        window.openHanlawTicketModal("report");
      }
      return;
    }
    if (type === "suggestion") {
      var u0 = typeof window.getHanlawUser === "function" ? window.getHanlawUser() : null;
      if (!u0 || !u0.email) {
        window.alert("개선 의견은 로그인한 뒤 보낼 수 있습니다.");
        return;
      }
      if (typeof window.openHanlawTicketModal === "function") {
        window.openHanlawTicketModal("suggestion");
      }
      return;
    }
    if (type === "question") {
      var u1 = typeof window.getHanlawUser === "function" ? window.getHanlawUser() : null;
      if (!u1 || !u1.email) {
        window.alert("변호사에게 질문하기는 로그인한 뒤, 질문권이 있을 때 이용할 수 있습니다.");
        return;
      }
      if (typeof window.waitForQuestionCreditState !== "function") {
        if (typeof window.openHanlawTicketModal === "function") {
          window.openHanlawTicketModal("question");
        }
        return;
      }
      window.waitForQuestionCreditState(function (state) {
        if (state.loading) {
          window.alert("질문권 정보를 불러오는 중입니다. 잠시 후 다시 시도하세요.");
          return;
        }
        if ((state.total || 0) < 1) {
          if (typeof window.showLawyerCreditsNeededModal === "function") {
            window.showLawyerCreditsNeededModal();
          } else {
            window.alert(
              "질문권이 없습니다.\n\n" +
                "· 유료 구독 회원: 매월 4건(한국시간 기준 월 단위)이 제공됩니다.\n" +
                "· 추가로 요금제 탭에서 질문권을 구매할 수 있습니다(" +
                packPrices() +
                ", 구매일로부터 1년 유효)."
            );
          }
          return;
        }
        if (typeof window.openHanlawTicketModal === "function") {
          window.openHanlawTicketModal("question");
        }
      });
    }
  }

  function bindKind(kind, pre, eliPre) {
    var toggleAi = $(eliPre + "-toggle");
    var toggleMemo = $(pre + "-memo-toggle");
    var panelAi = $(eliPre + "-panel");
    var panelMemo = $(pre + "-memo-panel");
    var sendAi = $(eliPre + "-send");
    var memoSave = $(pre + "-memo-save");
    var memoTa = $(pre + "-memo-text");

    if (toggleAi && panelAi && window.QuizAiAsk) {
      toggleAi.addEventListener("click", function () {
        if (typeof window.QuizAiAsk.toggleDictionaryAiPanel === "function") {
          window.QuizAiAsk.toggleDictionaryAiPanel(kind);
        }
      });
    }
    if (sendAi && window.QuizAiAsk) {
      sendAi.addEventListener("click", function () {
        if (typeof window.QuizAiAsk.sendDictionaryPanelAsk === "function") {
          window.QuizAiAsk.sendDictionaryPanelAsk(kind);
        }
      });
    }
    if (toggleMemo && panelMemo) {
      toggleMemo.addEventListener("click", function () {
        var wasHidden = panelMemo.hidden;
        if (wasHidden) {
          ensureTicketContext(kind);
          if (!window.__HANLAW_DICT_MEMO_KEY) {
            window.alert("메모를 남길 사전 항목이 없습니다. 검색하여 항목이 표시된 뒤 이용해 주세요.");
            return;
          }
          if (!isViewerLoggedIn()) {
            window.alert("나의 메모는 로그인 후 이용할 수 있습니다.");
            return;
          }
        }
        panelMemo.hidden = !wasHidden;
        toggleMemo.setAttribute("aria-expanded", wasHidden ? "true" : "false");
        if (wasHidden) {
          refreshMemoFieldsForKind(kind);
        }
      });
    }
    if (memoSave && memoTa) {
      memoSave.addEventListener("click", function () {
        if (!isViewerLoggedIn()) {
          window.alert("나의 메모는 로그인 후 이용할 수 있습니다.");
          return;
        }
        var k = window.__HANLAW_DICT_MEMO_KEY;
        if (!k) {
          ensureTicketContext(kind);
          k = window.__HANLAW_DICT_MEMO_KEY;
        }
        if (!k) {
          window.alert("저장할 항목이 없습니다. 검색 결과가 있을 때 다시 시도해 주세요.");
          return;
        }
        var api = ensureMemoCanvasApi(kind);
        var canvas = $("dict-" + kind + "-memo-canvas");
        var drawing = "";
        var hadInk = api && typeof api.hasInk === "function" && api.hasInk();
        if (hadInk && canvas) {
          try {
            drawing = canvas.toDataURL("image/jpeg", 0.88);
          } catch (e) {
            drawing = "";
          }
        } else if (!dictMemoDrawingUserCleared[kind]) {
          var prev = loadMemoEntry(k);
          if (prev.drawing && String(prev.drawing).indexOf("data:image") === 0) {
            drawing = prev.drawing;
          }
        }
        saveMemoEntry(k, memoTa.value, drawing);
        var hasDrawingSaved = !!(drawing && String(drawing).indexOf("data:image") === 0);
        applyDictMemoDrawingLock(kind, hasDrawingSaved);
        setMemoMsg(kind, "메모를 저장했습니다.", false);
        setTimeout(function () {
          var mid =
            kind === "term"
              ? "dict-term-memo-msg"
              : kind === "statute"
                ? "dict-statute-memo-msg"
                : "dict-case-memo-msg";
          var el = $(mid);
          if (el) el.hidden = true;
        }, 2200);
      });
    }

    var rep = $(pre + "-ticket-report");
    if (rep) {
      rep.addEventListener("click", function () {
        openTicket(kind, "report");
      });
    }
    var sug = $(pre + "-ticket-suggestion");
    if (sug) {
      sug.addEventListener("click", function () {
        openTicket(kind, "suggestion");
      });
    }
    var ask = $(pre + "-ticket-ask");
    if (ask) {
      ask.addEventListener("click", function () {
        openTicket(kind, "question");
      });
    }
  }

  function bindDictMemoDrawingTools() {
    if (window.__hanlawDictMemoDrawingToolsBound) return;
    window.__hanlawDictMemoDrawingToolsBound = true;
    ["term", "statute", "case"].forEach(function (kind) {
      var pre = "dict-" + kind + "-memo";
      var settingsToggle = $(pre + "-draw-settings-toggle");
      var settingsPanel = $(pre + "-draw-settings");
      if (settingsToggle && settingsPanel) {
        settingsToggle.addEventListener("click", function () {
          var open = !!settingsPanel.hidden;
          settingsPanel.hidden = !open;
          settingsToggle.setAttribute("aria-expanded", open ? "true" : "false");
        });
      }
      syncDictMemoCanvasFromInputs(kind);

      var penBtn = $(pre + "-tool-pen");
      var eraserBtn = $(pre + "-tool-eraser");
      if (penBtn) {
        penBtn.addEventListener("click", function () {
          var api = ensureMemoCanvasApi(kind);
          if (api && api.setEraser) {
            api.setEraser(false);
            updateDictMemoToolUi(kind);
          }
        });
      }
      if (eraserBtn) {
        eraserBtn.addEventListener("click", function () {
          var api = ensureMemoCanvasApi(kind);
          if (api && api.setEraser) {
            api.setEraser(true);
            updateDictMemoToolUi(kind);
          }
        });
      }
      var colorIn = $(pre + "-pen-color");
      if (colorIn) {
        colorIn.addEventListener("input", function () {
          var api = ensureMemoCanvasApi(kind);
          if (api && api.setPenColor) api.setPenColor(colorIn.value);
        });
      }
      var widthSel = $(pre + "-pen-width");
      if (widthSel) {
        widthSel.addEventListener("change", function () {
          var api = ensureMemoCanvasApi(kind);
          if (api && api.setLineWidth) api.setLineWidth(widthSel.value);
        });
      }
      var clearBtn = $(pre + "-clear-canvas");
      if (clearBtn) {
        clearBtn.addEventListener("click", function () {
          dictMemoDrawingUserCleared[kind] = true;
          var api = ensureMemoCanvasApi(kind);
          if (api && typeof api.clear === "function") api.clear();
        });
      }
      var panBtn = $(pre + "-pan-toggle");
      if (panBtn) {
        panBtn.addEventListener("click", function () {
          applyDictMemoPanMode(kind, !dictMemoPanMode[kind]);
        });
        applyDictMemoPanMode(kind, false);
      }
      var editDraw = $(pre + "-edit-draw");
      if (editDraw) {
        editDraw.addEventListener("click", function () {
          applyDictMemoDrawingLock(kind, false);
        });
      }
    });
  }

  function goBackToDictList(kind) {
    if (kind === "term") {
      var it = $("dict-term-query");
      if (it) it.value = "";
      if (window.DictionaryUI && typeof window.DictionaryUI.refreshTermSearch === "function") {
        window.DictionaryUI.refreshTermSearch();
      }
    } else if (kind === "statute") {
      var is = $("statute-article-query");
      if (is) is.value = "";
      if (window.DictionaryUI && typeof window.DictionaryUI.refreshStatuteSearch === "function") {
        window.DictionaryUI.refreshStatuteSearch();
      }
    } else if (kind === "case") {
      var ic = $("case-number-query");
      if (ic) ic.value = "";
      if (window.DictionaryUI && typeof window.DictionaryUI.refreshCaseSearch === "function") {
        window.DictionaryUI.refreshCaseSearch();
      }
    }
  }

  function bindDictBackButtons() {
    document.body.addEventListener("click", function (e) {
      var b = e.target && e.target.closest ? e.target.closest(".dict-back-to-list") : null;
      if (!b) return;
      var k = b.getAttribute("data-dict-back");
      if (!k) return;
      e.preventDefault();
      goBackToDictList(k);
      if (b.closest && b.closest("#tag-dict-modal") && typeof window.closeTagDictModal === "function") {
        window.closeTagDictModal();
      }
    });
  }

  window.addEventListener("dict-panel-results-updated", function (e) {
    var k = e && e.detail && e.detail.kind;
    if (k) syncDictionaryPanelContexts(k);
  });

  window.addEventListener("app-auth", function () {
    ["term", "statute", "case"].forEach(function (k) {
      syncDictionaryPanelContexts(k);
    });
  });

  function initDictPanelActions() {
    bindKind("term", "dict-term", "dict-term-eli");
    bindKind("statute", "dict-statute", "dict-statute-eli");
    bindKind("case", "dict-case", "dict-case-eli");
    bindDictMemoDrawingTools();
    bindDictBackButtons();
    syncDictionaryPanelContexts("term");
    syncDictionaryPanelContexts("statute");
    syncDictionaryPanelContexts("case");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initDictPanelActions);
  } else {
    initDictPanelActions();
  }
})();
