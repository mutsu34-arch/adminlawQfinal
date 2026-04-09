(function () {
  var modal;
  var currentType = "report";
  var fileInputs = [];

  function $(id) {
    return document.getElementById(id);
  }

  function packPrices() {
    return typeof window.getQuestionPackPricesDisplay === "function"
      ? window.getQuestionPackPricesDisplay()
      : "1건 $2 · 10건 $10 USD";
  }

  function openModal(type) {
    currentType = "report";
    if (type === "question") currentType = "question";
    if (type === "promotion") currentType = "promotion";
    var title = $("ticket-modal-title");
    if (title) {
      title.textContent =
        currentType === "question"
          ? "질문하기"
          : currentType === "promotion"
            ? "홍보 인증 신청"
            : "오류 신고하기";
    }
    var body = $("ticket-modal-body");
    if (body) body.value = "";
    var links = $("ticket-modal-links");
    if (links) links.value = "";
    var bodyLabel = $("ticket-modal-body-label");
    var linksLabel = $("ticket-modal-links-label");
    if (body) {
      if (currentType === "promotion") {
        if (bodyLabel) bodyLabel.textContent = "홍보 활동 요약";
        body.placeholder =
          "블로그·SNS 등 어디에 어떻게 이 앱을 소개했는지 적어 주세요. (글 제목·날짜를 쓰면 검토에 도움이 됩니다.)";
        if (linksLabel) linksLabel.textContent = "홍보 게시글 URL (선택, 줄바꿈으로 여러 개)";
        if (links) links.placeholder = "공개된 게시글·포스트 주소를 한 줄에 하나씩 입력하세요.";
      } else if (currentType === "question") {
        if (bodyLabel) bodyLabel.textContent = "질문 내용";
        body.placeholder = "알고 싶은 점을 구체적으로 적어 주세요.";
        if (linksLabel) linksLabel.textContent = "참고 링크 (선택, 줄바꿈으로 여러 개)";
        if (links) links.placeholder = "관련 자료 URL이 있으면 한 줄에 하나씩 입력하세요.";
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
      if (currentType === "promotion" || currentType === "question") {
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
            (q.source ? "\n출처: " + q.source : "") +
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
    var qHint = $("ticket-modal-question-hint");
    if (qHint) {
      if (currentType === "question") {
        var pp = packPrices();
        qHint.innerHTML =
          "질문하기는 질문권 <strong>1건</strong>이 차감됩니다. 추가 질문권은 <strong>요금제</strong>에서 구매할 수 있습니다(" +
          pp +
          ", 구매일로부터 1년 유효). 오류 신고는 질문권이 필요하지 않습니다.";
        qHint.hidden = false;
      } else if (currentType === "promotion") {
        qHint.innerHTML =
          "이 학습 앱을 <strong>직접 소개한 공개 글·게시물</strong>이 있으면 아래에 요약하고, 링크나 화면 캡처를 함께 올려 주세요. " +
          "관리자 확인 후 승인된 경우에만 <strong>9,000 포인트</strong>가 지급됩니다. " +
          "타인의 얼굴·연락처 등 <strong>개인정보는 가림 처리</strong>해 주세요. 허위·무관한 증빙은 승인되지 않을 수 있습니다.";
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
  }

  function submit() {
    var user = typeof window.getHanlawUser === "function" ? window.getHanlawUser() : null;
    if (!user) {
      window.alert("로그인 후 이용할 수 있습니다.");
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
          : "내용을 입력하세요."
      );
      return;
    }
    if (typeof window.createSupportTicket !== "function") {
      fail("티켓 모듈을 불러오지 못했습니다.");
      return;
    }
    if (btn) btn.disabled = true;

    var chain = Promise.resolve();
    if (currentType === "question") {
      if (typeof window.consumeQuestionCreditCallable !== "function") {
        fail("질문권 차감 모듈을 불러오지 못했습니다.");
        if (btn) btn.disabled = false;
        return;
      }
      chain = window.consumeQuestionCreditCallable();
    }

    chain
      .then(function () {
        return window.createSupportTicket({
          type: currentType,
          message: body.trim(),
          links: links,
          files: files,
          quizContext: window.__QUIZ_QUESTION_CONTEXT || null
        });
      })
      .then(function () {
        closeModal();
        window.alert("접수되었습니다. 관리자 검토 후 알림으로 안내드립니다.");
      })
      .catch(function (e) {
        var code = e && e.code;
        var msg = (e && e.message) || "전송에 실패했습니다.";
        if (code === "functions/failed-precondition") {
          msg = e.message || "질문권이 부족합니다.";
          if (
            currentType === "question" &&
            msg.indexOf("$2") < 0 &&
            msg.indexOf("USD") < 0
          ) {
            msg +=
              " 요금제에서 질문권을 구매할 수 있습니다(" + packPrices() + ").";
          }
        }
        if (code === "functions/not-found") {
          msg =
            "질문권 차감 서버(Cloud Functions)가 배포되지 않았습니다. Firebase에 functions를 배포한 뒤 다시 시도하세요.";
        }
        if (code === "functions/unauthenticated") {
          msg = "로그인이 필요합니다.";
        }
        fail(msg);
      })
      .then(function () {
        if (btn) btn.disabled = false;
      });
  }

  document.addEventListener("DOMContentLoaded", function () {
    modal = $("ticket-modal");
    fileInputs = [
      $("ticket-file-1"),
      $("ticket-file-2"),
      $("ticket-file-3")
    ].filter(Boolean);

    var br = $("btn-ticket-report");
    var bq = $("btn-ticket-ask");
    var bp = $("btn-ticket-promo");
    if (br) br.addEventListener("click", function () { openModal("report"); });
    if (bq) {
      bq.addEventListener("click", function () {
        if (typeof window.waitForQuestionCreditState !== "function") {
          openModal("question");
          return;
        }
        window.waitForQuestionCreditState(function (state) {
          if (state.loading) {
            window.alert("질문권 정보를 불러오는 중입니다. 잠시 후 다시 시도하세요.");
            return;
          }
          if ((state.total || 0) < 1) {
            window.alert(
              "질문권이 없습니다.\n\n" +
                "· 유료 구독 회원: 매월 4건(한국시간 기준 월 단위)이 제공됩니다.\n" +
                "· 추가로 요금제 탭에서 질문권을 구매할 수 있습니다(" +
                packPrices() +
                ", 구매일로부터 1년 유효)."
            );
            return;
          }
          openModal("question");
        });
      });
    }
    if (bp) bp.addEventListener("click", function () { openModal("promotion"); });

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
})();
