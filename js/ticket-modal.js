(function () {
  var modal;
  var currentType = "report";
  var fileInputs = [];
  var promoNavBtn = null;

  function $(id) {
    return document.getElementById(id);
  }

  /** app.js 의 isViewerLoggedIn 과 동일 — 이메일이 있는 계정만 로그인으로 간주 */
  function isTicketViewerLoggedIn() {
    var u = typeof window.getHanlawUser === "function" ? window.getHanlawUser() : null;
    return !!(u && u.email);
  }

  function isAdminViewer() {
    var u = typeof window.getHanlawUser === "function" ? window.getHanlawUser() : null;
    if (!u || !u.email) return false;
    var emails = window.ADMIN_EMAILS || [];
    var mail = String(u.email).toLowerCase();
    for (var i = 0; i < emails.length; i++) {
      if (String(emails[i]).toLowerCase() === mail) return true;
    }
    return false;
  }

  function openModal(type) {
    currentType = "report";
    if (type === "promotion") currentType = "promotion";
    if (type === "suggestion") currentType = "suggestion";
    if (promoNavBtn) {
      promoNavBtn.classList.toggle("nav-main__btn--active", currentType === "promotion");
      promoNavBtn.setAttribute("aria-current", currentType === "promotion" ? "page" : "false");
    }
    var title = $("ticket-modal-title");
    if (title) {
      title.textContent =
        currentType === "promotion"
          ? "홍보 인증 신청"
          : currentType === "suggestion"
            ? "개선 의견 보내기"
            : "오류 신고하기";
    }
    var body = $("ticket-modal-body");
    if (body) body.value = "";
    var links = $("ticket-modal-links");
    if (links) links.value = "";
    var bodyLabel = $("ticket-modal-body-label");
    var linksLabel = $("ticket-modal-links-label");
    if (body) {
      if (currentType === "suggestion") {
        if (bodyLabel) bodyLabel.textContent = "개선 내용";
        body.placeholder =
          "UI·기능 제안, 학습 경험, 콘텐츠 아이디어 등 구체적으로 적어 주세요.";
        if (linksLabel) linksLabel.textContent = "참고 링크 (선택, 줄바꿈으로 여러 개)";
        if (links) links.placeholder = "관련 URL이 있으면 한 줄에 하나씩 입력하세요.";
      } else if (currentType === "promotion") {
        if (bodyLabel) bodyLabel.textContent = "홍보 활동 요약";
        body.placeholder =
          "블로그·SNS 등 어디에 어떻게 이 앱을 소개했는지 적어 주세요. (글 제목·날짜를 쓰면 검토에 도움이 됩니다.)";
        if (linksLabel) linksLabel.textContent = "홍보 게시글 URL (선택, 줄바꿈으로 여러 개)";
        if (links) links.placeholder = "공개된 게시글·포스트 주소를 한 줄에 하나씩 입력하세요.";
      } else {
        if (bodyLabel) bodyLabel.textContent = "내용";
        body.placeholder =
          "오류 내용, 화면에 보이는 메시지, 재현 순서를 구체적으로 적어 주세요.";
        if (linksLabel) linksLabel.textContent = "참고 링크 (선택, 줄바꿈으로 여러 개)";
        if (links) links.placeholder = "관련 URL이 있으면 한 줄에 하나씩 입력하세요.";
      }
    }
    fileInputs.forEach(function (inp) {
      if (inp) inp.value = "";
    });
    var ctx = $("ticket-modal-context");
    if (ctx) {
      if (currentType === "promotion" || currentType === "suggestion") {
        ctx.textContent = "";
        ctx.hidden = true;
      } else {
        var q = window.__QUIZ_QUESTION_CONTEXT;
        if (q && q.questionId) {
          ctx.textContent =
            "연결된 문항: " +
            (q.questionId || "") +
            " · " +
            (q.topic || "") +
            (isAdminViewer() && q.source ? "\n출처: " + q.source : "") +
            (q.statement
              ? "\n" + String(q.statement).slice(0, 200) + (q.statement.length > 200 ? "…" : "")
              : "");
          ctx.hidden = false;
        } else {
          ctx.textContent = "";
          ctx.hidden = true;
        }
      }
    }
    var err = $("ticket-modal-error");
    if (err) {
      err.textContent = "";
      err.hidden = true;
    }
    var qaPrivacyRow = $("ticket-modal-qa-privacy-row");
    var qaCommunityCb = $("ticket-modal-qa-community");
    if (qaPrivacyRow) {
      qaPrivacyRow.hidden = true;
    }
    if (qaCommunityCb) {
      qaCommunityCb.checked = false;
    }
    var qHint = $("ticket-modal-question-hint");
    if (qHint) {
      if (currentType === "promotion") {
        qHint.innerHTML =
          "이 학습 앱을 <strong>직접 소개한 공개 글·게시물</strong>이 있으면 아래에 요약하고, 링크나 화면 캡처를 함께 올려 주세요. " +
          "관리자 확인 후 승인된 경우에만 <strong>9,000 포인트</strong>가 지급됩니다. " +
          "타인의 얼굴·연락처 등 <strong>개인정보는 가림 처리</strong>해 주세요. 허위·무관한 증빙은 승인되지 않을 수 있습니다.";
        qHint.hidden = false;
      } else if (currentType === "suggestion") {
        qHint.innerHTML =
          "<strong>로그인한 회원</strong>만 접수할 수 있습니다. 검토 후 답변이 알림으로 전달됩니다. " +
          "의견이 <strong>채택</strong>된 경우 포인트가 지급될 수 있습니다(기본 <strong>3,000점</strong>, 운영 정책·관리자 판단에 따름). " +
          "질문권 차감 없이 보낼 수 있습니다.";
        qHint.hidden = false;
      } else {
        qHint.hidden = true;
      }
    }
    if (modal) {
      modal.hidden = false;
      modal.setAttribute("aria-hidden", "false");
    }
  }

  function closeModal() {
    if (modal) {
      modal.hidden = true;
      modal.setAttribute("aria-hidden", "true");
    }
    if (promoNavBtn) {
      promoNavBtn.classList.remove("nav-main__btn--active");
      promoNavBtn.setAttribute("aria-current", "false");
    }
  }

  function submit() {
    var user = typeof window.getHanlawUser === "function" ? window.getHanlawUser() : null;
    if (!user || !String(user.email || "").trim()) {
      window.alert("로그인 후 이용할 수 있습니다.");
      return;
    }
    submitTicketPayload();
  }

  function submitTicketPayload() {
    var user = typeof window.getHanlawUser === "function" ? window.getHanlawUser() : null;
    if (!user || !String(user.email || "").trim()) {
      window.alert("로그인 후 이용할 수 있습니다.");
      return;
    }
    if (currentType === "suggestion" && (!user.email || !String(user.email).trim())) {
      window.alert("개선 의견은 이메일로 가입한 계정에서만 보낼 수 있습니다.");
      return;
    }
    var body = ($("ticket-modal-body") && $("ticket-modal-body").value) || "";
    var linksText = ($("ticket-modal-links") && $("ticket-modal-links").value) || "";
    var links = linksText
      .split(/\r?\n/g)
      .map(function (x) { return x.trim(); })
      .filter(Boolean);
    var files = [];
    fileInputs.forEach(function (inp) {
      if (inp && inp.files && inp.files[0]) files.push(inp.files[0]);
    });
    var errEl = $("ticket-modal-error");
    var btn = $("ticket-modal-submit");
    function fail(msg) {
      if (errEl) {
        errEl.textContent = msg;
        errEl.hidden = false;
      }
    }
    if (!body.trim()) {
      fail(
        currentType === "promotion"
          ? "홍보 활동 요약을 입력해 주세요."
          : currentType === "suggestion"
            ? "개선 내용을 입력해 주세요."
            : "내용을 입력하세요."
      );
      return;
    }
    if (typeof window.createSupportTicket !== "function") {
      fail("티켓 모듈을 불러오지 못했습니다.");
      return;
    }
    if (btn) btn.disabled = true;

    Promise.resolve()
      .then(function () {
        var opts = {
          type: currentType,
          message: body.trim(),
          links: links,
          files: files,
          quizContext: window.__QUIZ_QUESTION_CONTEXT || null
        };
        return window.createSupportTicket(opts);
      })
      .then(function () {
        closeModal();
        window.alert("접수되었습니다. 관리자 검토 후 알림으로 안내드립니다.");
      })
      .catch(function (e) {
        var code = e && e.code;
        var msg = (e && e.message) || "전송에 실패했습니다.";
        if (code === "functions/failed-precondition") {
          msg = e.message || msg;
        }
        if (code === "functions/not-found") {
          msg =
            "티켓 처리 서버(Cloud Functions)가 배포되지 않았습니다. Firebase에 functions를 배포한 뒤 다시 시도하세요.";
        }
        if (code === "functions/unauthenticated") {
          msg = "로그인이 필요합니다.";
        }
        if (
          code === "permission-denied" ||
          (msg && /Missing or insufficient permissions/i.test(msg))
        ) {
          msg =
            "저장 권한이 없습니다. 로그인을 다시 확인해 주세요. 개발 중이면 Firebase Console에 최신 firestore.rules·storage.rules를 배포했는지 확인하세요.";
        }
        fail(msg);
      })
      .then(function () {
        if (btn) btn.disabled = false;
      });
  }

  document.addEventListener("DOMContentLoaded", function () {
    modal = $("ticket-modal");
    promoNavBtn = $("btn-ticket-promo");
    fileInputs = [
      $("ticket-file-1"),
      $("ticket-file-2"),
      $("ticket-file-3")
    ].filter(Boolean);

    var br = $("btn-ticket-report");
    var bp = promoNavBtn;
    if (br) {
      br.addEventListener("click", function () {
        if (!isTicketViewerLoggedIn()) {
          window.alert("오류 신고하기는 로그인 후 이용할 수 있습니다.");
          return;
        }
        openModal("report");
      });
    }
    if (bp) {
      bp.addEventListener("click", function () {
        if (!isTicketViewerLoggedIn()) {
          window.alert("로그인 후 이용할 수 있습니다.");
          return;
        }
        openModal("promotion");
      });
    }

    var bsug = $("btn-ticket-suggestion");
    if (bsug) {
      bsug.addEventListener("click", function () {
        var u0 = typeof window.getHanlawUser === "function" ? window.getHanlawUser() : null;
        if (!u0 || !u0.email) {
          window.alert("개선 의견은 로그인한 뒤 보낼 수 있습니다.");
          return;
        }
        openModal("suggestion");
      });
    }

    var bc = $("ticket-modal-close");
    var bx = $("ticket-modal-cancel");
    if (bc) bc.addEventListener("click", closeModal);
    if (bx) bx.addEventListener("click", closeModal);

    var bs = $("ticket-modal-submit");
    if (bs) bs.addEventListener("click", submit);

    if (modal) {
      modal.addEventListener("click", function (e) {
        if (e.target === modal) closeModal();
      });
    }
  });

  window.openHanlawTicketModal = openModal;
})();
