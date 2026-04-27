(function () {
  /** 서버에서 불러온 노출 명언 줄 단위 (textarea 대신 목록 UI와 동기화) */
  var publishedLinesCache = [];
  /** 개별 명언 수정 모드인 행 인덱스 (한 번에 한 줄만) */
  var editingPublishedIndex = null;
  /** 검수 대기 개별 수정 모드 id (한 번에 한 줄만) */
  var editingStagingId = "";

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

  function normHeaderKey(k) {
    return String(k == null ? "" : k).replace(/^\uFEFF/, "").trim().toLowerCase().replace(/\s/g, "");
  }

  function pickQuoteTextFromRow(row) {
    if (!row || typeof row !== "object") return "";
    var headerMap = {
      quote: "quote",
      quotes: "quote",
      text: "quote",
      content: "quote",
      message: "quote",
      명언: "quote",
      문구: "quote",
      내용: "quote"
    };
    var picked = "";
    Object.keys(row).some(function (key) {
      var nk = normHeaderKey(key);
      if (headerMap[nk] !== "quote") return false;
      picked = String(row[key] == null ? "" : row[key]).trim();
      return !!picked;
    });
    return picked;
  }

  function parseQuoteWorkbook(buffer) {
    if (typeof XLSX === "undefined") {
      throw new Error("엑셀 라이브러리(xlsx)를 불러오지 못했습니다.");
    }
    var wb = XLSX.read(buffer, { type: "array" });
    if (!wb.SheetNames || !wb.SheetNames.length) {
      throw new Error("시트가 없습니다.");
    }
    var sheet = wb.Sheets[wb.SheetNames[0]];
    var rows = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false });
    var out = [];
    if (rows.length) {
      rows.forEach(function (row) {
        var text = pickQuoteTextFromRow(row);
        if (text) out.push(text);
      });
    } else {
      var aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false });
      for (var i = 0; i < aoa.length; i++) {
        var cell = String((aoa[i] && aoa[i][0]) || "").trim();
        if (!cell) continue;
        if (i === 0 && /^(quote|quotes|text|명언|문구|내용)$/i.test(cell)) continue;
        out.push(cell);
      }
    }
    var uniq = [];
    var seen = {};
    out.forEach(function (line) {
      var s = String(line || "").trim();
      if (!s || seen[s]) return;
      seen[s] = true;
      uniq.push(s);
    });
    return uniq;
  }

  function downloadQuoteTemplate() {
    if (typeof XLSX === "undefined") {
      window.alert("xlsx 라이브러리를 불러온 뒤 다시 시도하세요.");
      return;
    }
    var head = ["quote"];
    var sample1 = ["오늘의 한 줄이 내일의 실력을 만든다."];
    var sample2 = ["원칙을 정확히 알면, 사례는 흔들리지 않는다."];
    var wsData = XLSX.utils.aoa_to_sheet([head, sample1, sample2]);
    var wsGuide = XLSX.utils.aoa_to_sheet([
      ["명언 엑셀 업로드 가이드"],
      [""],
      ["필수 헤더", "quote (또는 명언/문구/내용)"],
      ["권장 형식", "한 행당 명언 1개"],
      ["최대 길이", "400자 이하 권장"],
      ["반영 방식", "업로드 시 '검수 대기'에 추가되며 승인 후 앱 반영"]
    ]);
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, wsData, "quotes");
    XLSX.utils.book_append_sheet(wb, wsGuide, "guide");
    XLSX.writeFile(wb, "hanlaw_quotes_template.xlsx");
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
      if (editingStagingId === it.id) {
        var ta = document.createElement("textarea");
        ta.className = "input textarea";
        ta.setAttribute("rows", "3");
        ta.setAttribute("maxlength", "400");
        ta.setAttribute("aria-label", "검수 대기 명언 수정");
        ta.setAttribute("data-quote-edit-text", it.id);
        ta.value = it.text || "";
        p.appendChild(ta);
      } else {
        if (typeof window.formatHanlawRichParagraphsHtml === "function") {
          p.innerHTML = window.formatHanlawRichParagraphsHtml(it.text || "");
        } else {
          p.textContent = it.text || "";
        }
      }
      var actions = document.createElement("div");
      actions.className = "admin-quote-staging-actions";
      if (editingStagingId === it.id) {
        var bSave = document.createElement("button");
        bSave.type = "button";
        bSave.className = "btn btn--secondary btn--small";
        bSave.textContent = "수정 저장";
        bSave.setAttribute("data-quote-edit-save", it.id);
        var bCancel = document.createElement("button");
        bCancel.type = "button";
        bCancel.className = "btn btn--outline btn--small";
        bCancel.textContent = "취소";
        bCancel.setAttribute("data-quote-edit-cancel", it.id);
        actions.appendChild(bSave);
        actions.appendChild(bCancel);
      } else {
        var bEdit = document.createElement("button");
        bEdit.type = "button";
        bEdit.className = "btn btn--outline btn--small";
        bEdit.textContent = "수정";
        bEdit.setAttribute("data-quote-edit", it.id);
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
        actions.appendChild(bEdit);
        actions.appendChild(bOk);
        actions.appendChild(bNo);
      }
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
    var excelMsg = $("admin-quote-excel-msg");
    var excelDropzone = $("admin-quote-excel-dropzone");

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

    var btnApproveAll = $("admin-quote-btn-approve-all");
    if (btnApproveAll) {
      btnApproveAll.addEventListener("click", function () {
        if (typeof window.adminQuoteApproveAllPending !== "function") {
          setMsg(stagingMsg, "일괄 승인 함수를 불러오지 못했습니다. Functions 배포를 확인해 주세요.", true);
          return;
        }
        if (!window.confirm("검수 대기 중인 명언을 모두 승인하여 앱에 반영할까요?")) return;
        setMsg(stagingMsg, "일괄 승인 처리 중…", false);
        btnApproveAll.disabled = true;
        window
          .adminQuoteApproveAllPending()
          .then(function (data) {
            var n = data && data.approved != null ? data.approved : 0;
            setMsg(stagingMsg, "일괄 승인 완료: " + n + "건 반영", false);
            editingStagingId = "";
            loadStaging();
            loadPublishedEditor();
          })
          .catch(function (e) {
            setMsg(stagingMsg, (e && e.message) || "일괄 승인 실패", true);
          })
          .then(function () {
            btnApproveAll.disabled = false;
          });
      });
    }

    var btnTemplate = $("admin-quote-btn-download-template");
    if (btnTemplate) {
      btnTemplate.addEventListener("click", function () {
        downloadQuoteTemplate();
      });
    }

    var btnExcelUpload = $("admin-quote-btn-upload-excel");
    var excelFile = $("admin-quote-excel-file");

    function setSelectedExcelFile(file) {
      if (!excelFile || !file) return;
      try {
        var dt = new DataTransfer();
        dt.items.add(file);
        excelFile.files = dt.files;
      } catch (e) {
        // 일부 환경에서는 file input files 대입이 제한될 수 있음
      }
    }

    function processExcelFile(file) {
        if (!file) {
          setMsg(excelMsg, "엑셀 파일(.xlsx/.xls)을 선택해 주세요.", true);
          return;
        }
        var lowerName = String(file.name || "").toLowerCase();
        if (lowerName.indexOf(".xlsx") === -1 && lowerName.indexOf(".xls") === -1) {
          setMsg(excelMsg, "엑셀 파일(.xlsx/.xls)만 업로드할 수 있습니다.", true);
          return;
        }
        if (typeof window.adminQuoteAddStaging !== "function") {
          setMsg(excelMsg, "업로드 함수를 불러오지 못했습니다. Functions 배포를 확인해 주세요.", true);
          return;
        }
        setMsg(excelMsg, "엑셀 읽는 중…", false);
        btnExcelUpload.disabled = true;
        var reader = new FileReader();
        reader.onload = function () {
          var lines = [];
          try {
            lines = parseQuoteWorkbook(new Uint8Array(reader.result));
          } catch (err) {
            setMsg(excelMsg, (err && err.message) || "엑셀 파싱에 실패했습니다.", true);
            btnExcelUpload.disabled = false;
            return;
          }
          if (!lines.length) {
            setMsg(excelMsg, "유효한 명언 행이 없습니다. 샘플 형식을 확인해 주세요.", true);
            btnExcelUpload.disabled = false;
            return;
          }
          setMsg(excelMsg, lines.length + "건 검수 대기에 추가 중…", false);
          var idx = 0;
          var okCount = 0;
          var failCount = 0;
          var firstFail = "";
          var seq = Promise.resolve();
          lines.forEach(function (text) {
            seq = seq.then(function () {
              idx += 1;
              return window.adminQuoteAddStaging(text).then(function () {
                okCount += 1;
              }).catch(function (e) {
                failCount += 1;
                if (!firstFail) {
                  firstFail = idx + "행: " + ((e && e.message) || "추가 실패");
                }
              });
            });
          });
          seq.then(function () {
            var msg = "업로드 완료: 성공 " + okCount + "건";
            if (failCount > 0) msg += ", 실패 " + failCount + "건";
            if (firstFail) msg += " (" + firstFail + ")";
            setMsg(excelMsg, msg, failCount > 0 && okCount === 0);
            excelFile.value = "";
            loadStaging();
          }).finally(function () {
            btnExcelUpload.disabled = false;
          });
        };
        reader.onerror = function () {
          setMsg(excelMsg, "파일을 읽지 못했습니다.", true);
          btnExcelUpload.disabled = false;
        };
        reader.readAsArrayBuffer(file);
    }

    if (btnExcelUpload && excelFile) {
      btnExcelUpload.addEventListener("click", function () {
        var file = excelFile.files && excelFile.files[0];
        processExcelFile(file);
      });

      excelFile.addEventListener("change", function () {
        var selected = excelFile.files && excelFile.files[0];
        if (!selected) return;
        setMsg(excelMsg, "선택됨: " + (selected.name || ""), false);
      });
    }

    if (excelDropzone && excelFile) {
      function setDropActive(on) {
        excelDropzone.classList.toggle("admin-excel-dropzone--active", !!on);
      }
      ["dragenter", "dragover"].forEach(function (evt) {
        excelDropzone.addEventListener(evt, function (e) {
          e.preventDefault();
          e.stopPropagation();
          setDropActive(true);
        });
      });
      ["dragleave", "drop"].forEach(function (evt) {
        excelDropzone.addEventListener(evt, function (e) {
          e.preventDefault();
          e.stopPropagation();
          setDropActive(false);
        });
      });
      excelDropzone.addEventListener("drop", function (e) {
        var files = (e.dataTransfer && e.dataTransfer.files) || [];
        var f = files[0];
        if (!f) return;
        setSelectedExcelFile(f);
        processExcelFile(f);
      });
      excelDropzone.addEventListener("click", function () {
        excelFile.click();
      });
      excelDropzone.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          excelFile.click();
        }
      });
    }

    var list = $("admin-quote-staging-list");
    if (list) {
      list.addEventListener("click", function (e) {
        var edit = e.target && e.target.closest && e.target.closest("[data-quote-edit]");
        if (edit) {
          editingStagingId = String(edit.getAttribute("data-quote-edit") || "");
          loadStaging();
          return;
        }
        var cancelEdit = e.target && e.target.closest && e.target.closest("[data-quote-edit-cancel]");
        if (cancelEdit) {
          editingStagingId = "";
          loadStaging();
          return;
        }
        var saveEdit = e.target && e.target.closest && e.target.closest("[data-quote-edit-save]");
        if (saveEdit) {
          var sid = String(saveEdit.getAttribute("data-quote-edit-save") || "").trim();
          if (!sid) return;
          if (typeof window.adminQuoteUpdateStaging !== "function") {
            setMsg(stagingMsg, "수정 함수를 불러오지 못했습니다. Functions 배포를 확인해 주세요.", true);
            return;
          }
          var ta = list.querySelector("[data-quote-edit-text=\"" + sid + "\"]");
          var nextText = ta ? String(ta.value || "").trim() : "";
          if (!nextText) {
            setMsg(stagingMsg, "수정할 명언 내용을 입력해 주세요.", true);
            return;
          }
          setMsg(stagingMsg, "수정 저장 중…", false);
          window.adminQuoteUpdateStaging(sid, nextText)
            .then(function () {
              setMsg(stagingMsg, "수정 저장 완료", false);
              editingStagingId = "";
              loadStaging();
            })
            .catch(function (err) {
              setMsg(stagingMsg, (err && err.message) || "수정 저장 실패", true);
            });
          return;
        }

        var approveBtn = e.target && e.target.closest && e.target.closest("[data-quote-approve]");
        var rejectBtn = e.target && e.target.closest && e.target.closest("[data-quote-reject]");
        var approve = approveBtn && approveBtn.getAttribute("data-quote-approve");
        var reject = rejectBtn && rejectBtn.getAttribute("data-quote-reject");
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
            editingStagingId = "";
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
