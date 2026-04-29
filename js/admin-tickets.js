(function () {
  var selectedId = null;
  var ticketsCache = [];
  /** 홍보 티켓: getPromotionDraftParts() 결과 캐시 (최종 답변란에 넣기용) */
  var promoDraftPartsCache = null;

  function $(id) {
    return document.getElementById(id);
  }

  function isAdminUser(user) {
    if (!user || !user.email) return false;
    var emails = window.ADMIN_EMAILS || [];
    var mail = String(user.email).toLowerCase();
    for (var i = 0; i < emails.length; i++) {
      if (String(emails[i]).toLowerCase() === mail) return true;
    }
    return false;
  }

  function switchAdminTab(which) {
    var tabSingle = $("admin-tab-single");
    var tabQuizCreate = $("admin-tab-quiz-create");
    var tabCaseDictCreate = $("admin-tab-case-dict-create");
    var tabTermDictCreate = $("admin-tab-term-dict-create");
    var tabStatuteDictCreate = $("admin-tab-statute-dict-create");
    var tabJson = $("admin-tab-json");
    var tabExcel = $("admin-tab-excel");
    var tabReview = $("admin-tab-review");
    var tabLibrary = $("admin-tab-library");
    var tabInbox = $("admin-tab-inbox");
    var tabQuotes = $("admin-tab-quotes");
    var panelSingle = $("admin-panel-single");
    var panelQuizCreate = $("admin-panel-quiz-create");
    var panelCaseDictCreate = $("admin-panel-case-dict-create");
    var panelTermDictCreate = $("admin-panel-term-dict-create");
    var panelStatuteDictCreate = $("admin-panel-statute-dict-create");
    var panelJson = $("admin-panel-json");
    var panelExcel = $("admin-panel-excel");
    var panelReview = $("admin-panel-review");
    var panelLibrary = $("admin-panel-library");
    var panelInbox = $("admin-panel-inbox");
    var panelQuotes = $("admin-panel-quotes");
    function off() {
      [tabSingle, tabQuizCreate, tabCaseDictCreate, tabTermDictCreate, tabStatuteDictCreate, tabJson, tabExcel, tabReview, tabLibrary, tabInbox, tabQuotes].forEach(function (t) {
        if (t) t.classList.remove("admin-tab--active");
      });
      [panelSingle, panelQuizCreate, panelCaseDictCreate, panelTermDictCreate, panelStatuteDictCreate, panelJson, panelExcel, panelReview, panelLibrary, panelInbox, panelQuotes].forEach(
        function (p) {
          if (p) p.hidden = true;
        }
      );
    }
    off();
    if (which === "json") {
      if (tabJson) tabJson.classList.add("admin-tab--active");
      if (panelJson) panelJson.hidden = false;
    } else if (which === "excel") {
      if (tabExcel) tabExcel.classList.add("admin-tab--active");
      if (panelExcel) panelExcel.hidden = false;
    } else if (which === "review") {
      if (tabReview) tabReview.classList.add("admin-tab--active");
      if (panelReview) panelReview.hidden = false;
      if (typeof window.loadAdminReviewQueue === "function") window.loadAdminReviewQueue();
    } else if (which === "library") {
      if (tabLibrary) tabLibrary.classList.add("admin-tab--active");
      if (panelLibrary) panelLibrary.hidden = false;
      if (typeof window.loadAdminLibraryList === "function") window.loadAdminLibraryList();
    } else if (which === "inbox") {
      if (tabInbox) tabInbox.classList.add("admin-tab--active");
      if (panelInbox) panelInbox.hidden = false;
    } else if (which === "quotes") {
      if (tabQuotes) tabQuotes.classList.add("admin-tab--active");
      if (panelQuotes) panelQuotes.hidden = false;
      if (typeof window.loadAdminQuotesPanel === "function") window.loadAdminQuotesPanel();
    } else if (which === "quiz-create") {
      if (tabQuizCreate) tabQuizCreate.classList.add("admin-tab--active");
      if (panelQuizCreate) panelQuizCreate.hidden = false;
    } else if (which === "case-dict-create") {
      if (tabCaseDictCreate) tabCaseDictCreate.classList.add("admin-tab--active");
      if (panelCaseDictCreate) panelCaseDictCreate.hidden = false;
    } else if (which === "term-dict-create") {
      if (tabTermDictCreate) tabTermDictCreate.classList.add("admin-tab--active");
      if (panelTermDictCreate) panelTermDictCreate.hidden = false;
    } else if (which === "statute-dict-create") {
      if (tabStatuteDictCreate) tabStatuteDictCreate.classList.add("admin-tab--active");
      if (panelStatuteDictCreate) panelStatuteDictCreate.hidden = false;
    } else {
      if (tabSingle) tabSingle.classList.add("admin-tab--active");
      if (panelSingle) panelSingle.hidden = false;
    }
  }

  function fmtStatus(s) {
    var map = {
      pending: "접수",
      ai_drafted: "AI초안",
      approved: "승인완료"
    };
    return map[s] || s || "-";
  }

  function renderList() {
    var listEl = $("admin-inbox-list");
    if (!listEl) return;
    listEl.innerHTML = "";
    if (!ticketsCache.length) {
      listEl.innerHTML = "<p class=\"admin-inbox-empty\">티켓이 없습니다.</p>";
      return;
    }
    ticketsCache.forEach(function (t) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className =
        "admin-inbox-row" + (selectedId === t.id ? " admin-inbox-row--active" : "");
      btn.innerHTML =
        "<span class=\"admin-inbox-row__type\">" +
        (t.type === "question"
          ? "질문"
          : t.type === "promotion"
            ? "홍보"
            : t.type === "suggestion"
              ? "개선"
              : "신고") +
        "</span>" +
        "<span class=\"admin-inbox-row__status\">" +
        fmtStatus(t.status) +
        "</span>" +
        "<span class=\"admin-inbox-row__preview\">" +
        String(t.message || "").slice(0, 48) +
        (String(t.message || "").length > 48 ? "…" : "") +
        "</span>";
      btn.addEventListener("click", function () {
        selectedId = t.id;
        renderList();
        showDetail(t);
      });
      listEl.appendChild(btn);
    });
  }

  function showDetail(t) {
    var det = $("admin-inbox-detail");
    var meta = $("admin-inbox-meta");
    var msg = $("admin-inbox-message");
    var links = $("admin-inbox-links");
    var imgs = $("admin-inbox-images");
    var aiTa = $("admin-inbox-ai-draft");
    var replyTa = $("admin-inbox-reply");
    var msgAi = $("admin-inbox-msg-ai");
    if (!det) return;
    det.hidden = false;
    if (meta) {
      var metaLine =
        (t.userNickname ? "닉네임: " + t.userNickname + " · " : "") +
        (t.userEmail || t.userId || "") +
        " · " +
        (t.id || "") +
        " · " +
        fmtStatus(t.status);
      if (t.type === "suggestion" && t.status === "approved") {
        metaLine +=
          " · " +
          (t.suggestionAdopted ? "채택" : "미채택") +
          (typeof t.suggestionPointsAwarded === "number"
            ? " · 지급 " + t.suggestionPointsAwarded + "점"
            : "");
      }
      meta.textContent = metaLine;
    }
    if (msg) {
      if (typeof window.formatHanlawRichParagraphsHtml === "function") {
        msg.innerHTML = window.formatHanlawRichParagraphsHtml(t.message || "");
      } else {
        msg.textContent = t.message || "";
      }
    }
    if (links) {
      links.innerHTML = "";
      (t.linkUrls || []).forEach(function (u) {
        var a = document.createElement("a");
        a.href = u;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.textContent = u;
        links.appendChild(a);
      });
    }
    if (imgs) {
      imgs.innerHTML = "";
      (t.imageUrls || []).forEach(function (url) {
        var a = document.createElement("a");
        a.href = url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.className = "admin-inbox-thumb-link";
        var im = document.createElement("img");
        im.src = url;
        im.alt = "첨부";
        im.className = "admin-inbox-thumb";
        a.appendChild(im);
        imgs.appendChild(a);
      });
    }
    if (aiTa) aiTa.value = t.aiDraft || "";

    promoDraftPartsCache =
      typeof window.getPromotionDraftParts === "function" ? window.getPromotionDraftParts(t) : null;
    var promoPicks = $("admin-inbox-promo-reply-picks");
    if (promoPicks) promoPicks.hidden = !promoDraftPartsCache;

    var sugOpts = $("admin-inbox-suggestion-opts");
    if (sugOpts) {
      sugOpts.hidden = t.type !== "suggestion";
      if (t.type === "suggestion") {
        var adoptCb = $("admin-inbox-suggestion-adopt");
        var ptsIn = $("admin-inbox-suggestion-points");
        if (adoptCb) adoptCb.checked = false;
        if (ptsIn) {
          ptsIn.value = "3000";
          ptsIn.disabled = !adoptCb || !adoptCb.checked;
        }
      }
    }

    if (replyTa) {
      var hasAdmin = t.adminReply && String(t.adminReply).trim();
      if (hasAdmin) {
        replyTa.value = t.adminReply;
      } else if (promoDraftPartsCache) {
        replyTa.value = "";
      } else {
        replyTa.value = t.aiDraft || "";
      }
      if (promoDraftPartsCache) {
        replyTa.placeholder =
          "위 버튼으로 승인/불승인 안을 넣거나 직접 작성한 뒤, 수정하여 승인하세요.";
      } else if (t.type === "suggestion") {
        replyTa.placeholder =
          "사용자에게 전달할 답변을 작성하세요. (채택·포인트는 위 옵션에서 선택합니다.)";
      } else if (t.userNickname && String(t.userNickname).trim()) {
        var nn = String(t.userNickname).trim();
        replyTa.placeholder =
          nn + "님께 답변합니다. (예: " + nn + "님, 안녕하세요. 문의 주신 내용은 …)";
      } else {
        replyTa.placeholder = "검토 후 수정한 뒤 승인하세요.";
      }
    }
    if (msgAi) {
      msgAi.textContent = "";
      msgAi.hidden = true;
    }
  }

  function loadTickets() {
    var user = typeof window.getHanlawUser === "function" ? window.getHanlawUser() : null;
    if (!user || !isAdminUser(user)) return;
    var db = firebase.firestore();
    db.collection("hanlaw_tickets")
      .orderBy("createdAt", "desc")
      .limit(80)
      .get()
      .then(function (snap) {
        ticketsCache = snap.docs.map(function (d) {
          var x = d.data();
          x.id = d.id;
          return x;
        });
        renderList();
        if (selectedId) {
          var found = ticketsCache.filter(function (x) { return x.id === selectedId; })[0];
          if (found) showDetail(found);
        }
      })
      .catch(function (e) {
        console.warn(e);
        ticketsCache = [];
        renderList();
      });
  }

  function bind() {
    var tabInbox = $("admin-tab-inbox");
    var tabSingle = $("admin-tab-single");
    var tabQuizCreate = $("admin-tab-quiz-create");
    var tabCaseDictCreate = $("admin-tab-case-dict-create");
    var tabTermDictCreate = $("admin-tab-term-dict-create");
    var tabStatuteDictCreate = $("admin-tab-statute-dict-create");
    var tabJson = $("admin-tab-json");
    var tabExcel = $("admin-tab-excel");
    var tabReview = $("admin-tab-review");
    var tabLibrary = $("admin-tab-library");
    var tabQuotes = $("admin-tab-quotes");
    if (tabSingle) {
      tabSingle.addEventListener("click", function () {
        switchAdminTab("single");
      });
    }
    if (tabJson) {
      tabJson.addEventListener("click", function () {
        switchAdminTab("json");
      });
    }
    if (tabCaseDictCreate) {
      tabCaseDictCreate.addEventListener("click", function () {
        switchAdminTab("case-dict-create");
      });
    }
    if (tabQuizCreate) {
      tabQuizCreate.addEventListener("click", function () {
        switchAdminTab("quiz-create");
      });
    }
    if (tabTermDictCreate) {
      tabTermDictCreate.addEventListener("click", function () {
        switchAdminTab("term-dict-create");
      });
    }
    if (tabStatuteDictCreate) {
      tabStatuteDictCreate.addEventListener("click", function () {
        switchAdminTab("statute-dict-create");
      });
    }
    if (tabExcel) {
      tabExcel.addEventListener("click", function () {
        switchAdminTab("excel");
      });
    }
    if (tabReview) {
      tabReview.addEventListener("click", function () {
        switchAdminTab("review");
      });
    }
    if (tabLibrary) {
      tabLibrary.addEventListener("click", function () {
        switchAdminTab("library");
      });
    }
    if (tabInbox) {
      tabInbox.addEventListener("click", function () {
        switchAdminTab("inbox");
        loadTickets();
      });
    }
    if (tabQuotes) {
      tabQuotes.addEventListener("click", function () {
        switchAdminTab("quotes");
      });
    }

    var statuteMsg = $("admin-statute-create-msg");
    var btnStatuteGoExcel = $("admin-statute-go-excel");
    var btnStatuteSample = $("admin-statute-sample-download");
    function setStatuteMsg(text, isError) {
      if (!statuteMsg) return;
      statuteMsg.textContent = text || "";
      statuteMsg.classList.toggle("admin-msg--error", !!isError);
      statuteMsg.hidden = !text;
    }
    if (btnStatuteGoExcel) {
      btnStatuteGoExcel.addEventListener("click", function () {
        switchAdminTab("excel");
        var typeSel = $("admin-excel-type");
        if (typeSel) typeSel.value = "statute";
        setStatuteMsg("엑셀 업로드 탭으로 이동했습니다. 사전 종류가 '조문사전'으로 선택되었습니다.", false);
      });
    }
    if (btnStatuteSample) {
      btnStatuteSample.addEventListener("click", function () {
        var sampleBtn = $("admin-btn-excel-template-statute");
        if (!sampleBtn || typeof sampleBtn.click !== "function") {
          setStatuteMsg("조문사전 샘플 버튼을 찾지 못했습니다. 엑셀 업로드 탭에서 직접 내려받아 주세요.", true);
          return;
        }
        sampleBtn.click();
        setStatuteMsg("조문사전 샘플 파일 다운로드를 시작했습니다.", false);
      });
    }

    var btnAi = $("admin-btn-ai-draft");
    if (btnAi) {
      btnAi.addEventListener("click", function () {
        var user = typeof window.getHanlawUser === "function" ? window.getHanlawUser() : null;
        if (!isAdminUser(user)) return;
        var t = ticketsCache.filter(function (x) { return x.id === selectedId; })[0];
        if (!t) return;
        var msgAi = $("admin-inbox-msg-ai");
        if (msgAi) {
          msgAi.textContent = "AI 초안 생성 중…";
          msgAi.hidden = false;
        }
        window
          .fetchAIDraftForTicket(t)
          .then(function (draft) {
            var aiTa = $("admin-inbox-ai-draft");
            if (aiTa) aiTa.value = draft;
            return window.adminUpdateTicketDraft(t.id, draft);
          })
          .then(function () {
            if (msgAi) {
              msgAi.textContent = "초안이 저장되었습니다. 검토 후 답변란을 수정해 승인하세요.";
            }
            loadTickets();
          })
          .catch(function (e) {
            if (msgAi) {
              msgAi.textContent = (e && e.message) || "실패";
              msgAi.hidden = false;
            }
          });
      });
    }

    var btnApprove = $("admin-btn-approve-ticket");
    if (btnApprove) {
      btnApprove.addEventListener("click", function () {
        var user = typeof window.getHanlawUser === "function" ? window.getHanlawUser() : null;
        if (!isAdminUser(user) || !selectedId) return;
        var replyTa = $("admin-inbox-reply");
        var text = replyTa ? replyTa.value.trim() : "";
        if (!text) {
          window.alert("사용자에게 전달할 답변을 입력하세요.");
          return;
        }
        var tSel = ticketsCache.filter(function (x) {
          return x.id === selectedId;
        })[0];
        if (tSel && tSel.type === "suggestion") {
          if (typeof window.adminApproveSuggestionTicketCallable !== "function") {
            window.alert("티켓 모듈을 불러오지 못했습니다.");
            return;
          }
          var adopted = $("admin-inbox-suggestion-adopt") && $("admin-inbox-suggestion-adopt").checked;
          var ptsRaw = $("admin-inbox-suggestion-points") && $("admin-inbox-suggestion-points").value;
          var pts = parseInt(ptsRaw, 10);
          if (adopted && !Number.isFinite(pts)) pts = 3000;
          if (!adopted) pts = 0;
          if (adopted && Number.isFinite(pts) && pts < 0) pts = 0;
          window
            .adminApproveSuggestionTicketCallable(selectedId, text, user.email || "", adopted, pts)
            .then(function () {
              window.dispatchEvent(new CustomEvent("notifications-updated"));
              window.alert("처리되었으며 사용자 알림이 발송되었습니다.");
              loadTickets();
              var det = $("admin-inbox-detail");
              if (det) det.hidden = true;
              selectedId = null;
            })
            .catch(function (e) {
              window.alert((e && e.message) || "처리 실패");
            });
          return;
        }
        window
          .adminApproveTicket(selectedId, text, user.email || "")
          .then(function () {
            window.dispatchEvent(new CustomEvent("notifications-updated"));
            window.dispatchEvent(new CustomEvent("hanlaw-public-qa-refresh"));
            window.alert("승인되었으며 사용자 알림이 발송되었습니다.");
            loadTickets();
            var det = $("admin-inbox-detail");
            if (det) det.hidden = true;
            selectedId = null;
          })
          .catch(function (e) {
            window.alert((e && e.message) || "승인 처리 실패");
          });
      });
    }

    var btnRefresh = $("admin-inbox-refresh");
    if (btnRefresh) btnRefresh.addEventListener("click", loadTickets);

    var adoptCb = $("admin-inbox-suggestion-adopt");
    var ptsIn = $("admin-inbox-suggestion-points");
    if (adoptCb && ptsIn && !adoptCb._hanlawSuggestionBound) {
      adoptCb._hanlawSuggestionBound = true;
      adoptCb.addEventListener("change", function () {
        ptsIn.disabled = !adoptCb.checked;
      });
    }

    var btnPromoA = $("admin-inbox-promo-approve");
    var btnPromoR = $("admin-inbox-promo-reject");
    function applyPromoReply(which) {
      if (!promoDraftPartsCache) return;
      var replyTa = $("admin-inbox-reply");
      if (!replyTa) return;
      var text =
        which === "approve"
          ? promoDraftPartsCache.approveReply
          : promoDraftPartsCache.rejectReply;
      if (text == null) return;
      replyTa.value = String(text);
      replyTa.focus();
      try {
        replyTa.setSelectionRange(0, 0);
      } catch (e) {}
    }
    if (btnPromoA) {
      btnPromoA.addEventListener("click", function () {
        applyPromoReply("approve");
      });
    }
    if (btnPromoR) {
      btnPromoR.addEventListener("click", function () {
        applyPromoReply("reject");
      });
    }

    window.addEventListener("support-ticket-created", function () {
      if ($("admin-panel-inbox") && !$("admin-panel-inbox").hidden) loadTickets();
    });
  }

  document.addEventListener("DOMContentLoaded", bind);
})();
