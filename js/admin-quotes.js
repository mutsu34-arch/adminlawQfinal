(function () {
  /** 서버에서 불러온 노출 명언 줄 단위 (textarea 대신 목록 UI와 동기화) */
  var publishedLinesCache = [];
  /** 개별 명언 수정 모드인 행 인덱스 (한 번에 한 줄만) */
  var editingPublishedIndex = null;

  function $(id) {
    return document.getElementById(id);
  }

  function trashIconSvg() {
    return (
      '<svg class="admin-quote-published-del__icon" viewBox="0 0 24 24" width="20" height="20" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
      '<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14zM10 11v6M14 11v6"/>' +
      "</svg>"
    );
  }

  function pencilIconSvg() {
    return (
      '<svg class="admin-quote-published-edit__icon" viewBox="0 0 24 24" width="20" height="20" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
      '<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/>' +
      "</svg>"
    );
  }

  function renderPublishedList() {
    var wrap = $("admin-quote-published-list");
    if (!wrap) return;
    wrap.innerHTML = "";
    if (!publishedLinesCache.length) {
      var empty = document.createElement("p");
      empty.className = "admin-quote-empty";
      empty.textContent = "노출 중인 명언이 없습니다.";
      wrap.appendChild(empty);
      return;
    }
    publishedLinesCache.forEach(function (line, idx) {
      var row = document.createElement("div");
      row.className = "admin-quote-published-row";
      row.setAttribute("role", "listitem");
      if (editingPublishedIndex === idx) {
        row.classList.add("admin-quote-published-row--editing");
      }

      var box = document.createElement("div");
      box.className = "admin-quote-published-box";

      if (editingPublishedIndex === idx) {
        var ta = document.createElement("textarea");
        ta.className = "admin-quote-published-textarea input textarea";
        ta.setAttribute("rows", "3");
        ta.setAttribute("maxlength", "400");
        ta.setAttribute("aria-label", "명언 수정");
        ta.value = line;
        box.appendChild(ta);
      } else {
        box.textContent = line;
      }

      var actions = document.createElement("div");
      actions.className = "admin-quote-published-actions";

      if (editingPublishedIndex === idx) {
        actions.classList.add("admin-quote-published-actions--editing");
        var bSave = document.createElement("button");
        bSave.type = "button";
        bSave.className = "btn btn--secondary btn--small admin-quote-published-save";
        bSave.setAttribute("data-published-save", String(idx));
        bSave.textContent = "저장";
        bSave.setAttribute("title", "이 줄만 반영 (앱 반영은 목록 저장 필요)");
        var bCancel = document.createElement("button");
        bCancel.type = "button";
        bCancel.className = "btn btn--outline btn--small admin-quote-published-cancel";
        bCancel.setAttribute("data-published-cancel", "1");
        bCancel.textContent = "취소";
        actions.appendChild(bSave);
        actions.appendChild(bCancel);
      } else {
        var edit = document.createElement("button");
        edit.type = "button";
        edit.className = "admin-quote-published-edit";
        edit.setAttribute("data-published-edit", String(idx));
        edit.setAttribute("aria-label", "이 명언 수정");
        edit.setAttribute("title", "수정");
        edit.innerHTML = pencilIconSvg();

        var del = document.createElement("button");
        del.type = "button";
        del.className = "admin-quote-published-del";
        del.setAttribute("data-published-index", String(idx));
        del.setAttribute("aria-label", "이 명언을 목록에서 삭제");
        del.setAttribute("title", "목록에서 삭제 (저장 시 앱에 반영)");
        del.innerHTML = trashIconSvg();

        actions.appendChild(edit);
        actions.appendChild(del);
      }

      row.appendChild(box);
      row.appendChild(actions);
      wrap.appendChild(row);
    });
  }

  function setMsg(el, text, isError) {
    if (!el) return;
    el.textContent = text || "";
    el.hidden = !text;
    el.classList.toggle("admin-msg--error", !!isError);
  }

  function renderStagingList(items) {
    var list = $("admin-quote-staging-list");
    if (!list) return;
    list.innerHTML = "";
    if (!items || !items.length) {
      list.innerHTML = "<p class=\"admin-quote-empty\">검수 대기 중인 명언이 없습니다.</p>";
      return;
    }
    items.forEach(function (it) {
      var row = document.createElement("div");
      row.className = "admin-quote-staging-row";
      var head = document.createElement("div");
      head.className = "admin-quote-staging-head";
      var badge = document.createElement("span");
      badge.className =
        "admin-quote-badge" + (it.source === "ai" ? " admin-quote-badge--ai" : "");
      badge.textContent = it.source === "ai" ? "AI" : "직접";
      head.appendChild(badge);
      var p = document.createElement("p");
      p.className = "admin-quote-staging-text";
      if (typeof window.formatHanlawRichParagraphsHtml === "function") {
        p.innerHTML = window.formatHanlawRichParagraphsHtml(it.text || "");
      } else {
        p.textContent = it.text || "";
      }
      var actions = document.createElement("div");
      actions.className = "admin-quote-staging-actions";
      var bOk = document.createElement("button");
      bOk.type = "button";
      bOk.className = "btn btn--secondary btn--small";
      bOk.textContent = "승인·앱 반영";
      bOk.setAttribute("data-quote-approve", it.id);
      var bNo = document.createElement("button");
      bNo.type = "button";
      bNo.className = "btn btn--outline btn--small";
      bNo.textContent = "반려";
      bNo.setAttribute("data-quote-reject", it.id);
      actions.appendChild(bOk);
      actions.appendChild(bNo);
      row.appendChild(head);
      row.appendChild(p);
      row.appendChild(actions);
      list.appendChild(row);
    });
  }

  function loadStaging() {
    var msg = $("admin-quote-staging-msg");
    if (typeof window.adminQuoteListStaging !== "function") {
      setMsg(msg, "Functions(adminQuoteListStaging)를 불러오지 못했습니다.", true);
      return;
    }
    setMsg(msg, "목록 불러오는 중…", false);
    window
      .adminQuoteListStaging()
      .then(function (data) {
        setMsg(msg, "", false);
        renderStagingList((data && data.items) || []);
      })
      .catch(function (e) {
        setMsg(
          msg,
          (e && e.message) || "목록을 불러오지 못했습니다. Functions 배포를 확인하세요.",
          true
        );
      });
  }

  function loadPublishedEditor() {
    var msg = $("admin-quote-published-msg");
    if (typeof window.adminQuoteGetPublished !== "function") return;
    setMsg(msg, "불러오는 중…", false);
    window
      .adminQuoteGetPublished()
      .then(function (data) {
        setMsg(msg, "", false);
        editingPublishedIndex = null;
        var arr = (data && data.quotes) || [];
        publishedLinesCache = arr.map(function (x) {
          return String(x || "").trim();
        }).filter(Boolean);
        renderPublishedList();
      })
      .catch(function (e) {
        setMsg(msg, (e && e.message) || "불러오기 실패", true);
      });
  }

  window.loadAdminQuotesPanel = function () {
    loadStaging();
    loadPublishedEditor();
  };

  function bind() {
    var stagingMsg = $("admin-quote-staging-msg");
    var pubMsg = $("admin-quote-published-msg");

    var btnAdd = $("admin-quote-btn-add-staging");
    if (btnAdd) {
      btnAdd.addEventListener("click", function () {
        var ta = $("admin-quote-manual-input");
        var text = ta ? String(ta.value || "").trim() : "";
        if (!text) {
          setMsg(stagingMsg, "명언을 입력해 주세요.", true);
          return;
        }
        if (typeof window.adminQuoteAddStaging !== "function") {
          setMsg(stagingMsg, "Functions를 불러오지 못했습니다.", true);
          return;
        }
        setMsg(stagingMsg, "추가 중…", false);
        btnAdd.disabled = true;
        window
          .adminQuoteAddStaging(text)
          .then(function () {
            setMsg(stagingMsg, "검수 대기에 추가했습니다.", false);
            if (ta) ta.value = "";
            loadStaging();
          })
          .catch(function (e) {
            setMsg(stagingMsg, (e && e.message) || "추가 실패", true);
          })
          .then(function () {
            btnAdd.disabled = false;
          });
      });
    }

    var btnAi = $("admin-quote-btn-ai");
    if (btnAi) {
      btnAi.addEventListener("click", function () {
        if (typeof window.adminQuoteGenerateAi !== "function") {
          setMsg(stagingMsg, "Functions를 불러오지 못했습니다.", true);
          return;
        }
        if (!window.confirm("AI가 명언 약 8개를 생성해 검수 대기에 올립니다. 계속할까요?")) return;
        setMsg(stagingMsg, "AI 생성 중… (잠시만요)", false);
        btnAi.disabled = true;
        window
          .adminQuoteGenerateAi(8)
          .then(function (data) {
            var n = data && data.added != null ? data.added : "?";
            setMsg(stagingMsg, "AI 명언 " + n + "건을 검수 대기에 올렸습니다.", false);
            loadStaging();
          })
          .catch(function (e) {
            var m = (e && e.message) || "생성 실패";
            setMsg(stagingMsg, m, true);
          })
          .then(function () {
            btnAi.disabled = false;
          });
      });
    }

    var btnRefresh = $("admin-quote-btn-refresh-staging");
    if (btnRefresh) {
      btnRefresh.addEventListener("click", function () {
        loadStaging();
      });
    }

    var list = $("admin-quote-staging-list");
    if (list) {
      list.addEventListener("click", function (e) {
        var approve = e.target && e.target.getAttribute && e.target.getAttribute("data-quote-approve");
        var reject = e.target && e.target.getAttribute && e.target.getAttribute("data-quote-reject");
        var id = approve || reject;
        if (!id) return;
        if (reject && !window.confirm("이 명언을 검수 목록에서 삭제할까요?")) return;
        var fn =
          approve && typeof window.adminQuoteApprove === "function"
            ? window.adminQuoteApprove
            : typeof window.adminQuoteReject === "function"
              ? window.adminQuoteReject
              : null;
        if (!fn) {
          setMsg(stagingMsg, "Functions를 불러오지 못했습니다.", true);
          return;
        }
        setMsg(stagingMsg, "처리 중…", false);
        fn(id)
          .then(function () {
            setMsg(stagingMsg, approve ? "앱에 반영했습니다." : "목록에서 제거했습니다.", false);
            loadStaging();
            loadPublishedEditor();
          })
          .catch(function (err) {
            setMsg(stagingMsg, (err && err.message) || "처리 실패", true);
          });
      });
    }

    var pubList = $("admin-quote-published-list");
    if (pubList) {
      pubList.addEventListener("click", function (e) {
        var cancelBtn = e.target && e.target.closest && e.target.closest("[data-published-cancel]");
        if (cancelBtn) {
          editingPublishedIndex = null;
          renderPublishedList();
          return;
        }

        var saveBtn = e.target && e.target.closest && e.target.closest("[data-published-save]");
        if (saveBtn) {
          var six = parseInt(saveBtn.getAttribute("data-published-save"), 10);
          if (!Number.isFinite(six) || six < 0 || six >= publishedLinesCache.length) return;
          var rowEl = saveBtn.closest(".admin-quote-published-row");
          var taEl = rowEl && rowEl.querySelector(".admin-quote-published-textarea");
          var next = taEl ? String(taEl.value || "").trim() : "";
          if (!next) {
            setMsg(pubMsg, "명언 내용을 입력해 주세요.", true);
            return;
          }
          publishedLinesCache[six] = next;
          editingPublishedIndex = null;
          renderPublishedList();
          setMsg(pubMsg, "해당 줄을 수정했습니다. 앱에 반영하려면 「목록 저장·앱 반영」을 누르세요.", false);
          return;
        }

        var editBtn = e.target && e.target.closest && e.target.closest("[data-published-edit]");
        if (editBtn) {
          var eix = parseInt(editBtn.getAttribute("data-published-edit"), 10);
          if (!Number.isFinite(eix) || eix < 0 || eix >= publishedLinesCache.length) return;
          editingPublishedIndex = eix;
          renderPublishedList();
          var rowAfter = pubList.querySelector(".admin-quote-published-row--editing");
          var taFocus = rowAfter && rowAfter.querySelector(".admin-quote-published-textarea");
          if (taFocus) {
            try {
              taFocus.focus();
              taFocus.select();
            } catch (err) {}
          }
          return;
        }

        var btn = e.target && e.target.closest && e.target.closest("[data-published-index]");
        if (!btn) return;
        var ix = parseInt(btn.getAttribute("data-published-index"), 10);
        if (!Number.isFinite(ix) || ix < 0 || ix >= publishedLinesCache.length) return;
        if (!window.confirm("이 명언을 목록에서 제거할까요? (「목록 저장·앱 반영」 후 앱에 반영됩니다.)")) return;
        if (editingPublishedIndex === ix) editingPublishedIndex = null;
        publishedLinesCache.splice(ix, 1);
        renderPublishedList();
        setMsg(pubMsg, "목록에서 제거했습니다. 앱에 반영하려면 저장을 누르세요.", false);
      });
    }

    var btnSavePub = $("admin-quote-btn-save-published");
    if (btnSavePub) {
      btnSavePub.addEventListener("click", function () {
        if (typeof window.adminQuoteReplacePublished !== "function") {
          setMsg(pubMsg, "저장 함수를 찾지 못했습니다.", true);
          return;
        }
        var lines = publishedLinesCache.slice();
        if (!window.confirm("앱에 노출되는 명언 목록을 " + lines.length + "줄로 덮어씁니다. 계속할까요?")) {
          return;
        }
        setMsg(pubMsg, "저장 중…", false);
        btnSavePub.disabled = true;
        window
          .adminQuoteReplacePublished(lines)
          .then(function (data) {
            var c = data && data.count != null ? data.count : lines.length;
            setMsg(pubMsg, "저장했습니다. (" + c + "개)", false);
          })
          .catch(function (e) {
            setMsg(pubMsg, (e && e.message) || "저장 실패", true);
          })
          .then(function () {
            btnSavePub.disabled = false;
          });
      });
    }

    var btnReloadPub = $("admin-quote-btn-reload-published");
    if (btnReloadPub) {
      btnReloadPub.addEventListener("click", function () {
        loadPublishedEditor();
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }
})();
