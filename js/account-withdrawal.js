/**
 * 설정 — 회원 탈퇴 (학습 데이터 삭제 안내 · 피드백 · 작별 인사)
 */
(function () {
  var step = "confirm";
  var busy = false;

  function $(id) {
    return document.getElementById(id);
  }

  function isLoggedIn() {
    var u = typeof window.getHanlawUser === "function" ? window.getHanlawUser() : null;
    return !!(u && u.email);
  }

  function syncBlock() {
    var block = $("settings-withdrawal-block");
    if (!block) return;
    block.hidden = !isLoggedIn();
  }

  function setModalOpen(on) {
    var modal = $("account-withdrawal-modal");
    if (!modal) return;
    modal.hidden = !on;
    modal.setAttribute("aria-hidden", on ? "false" : "true");
    document.body.classList.toggle("modal-open", !!on);
  }

  function renderConfirmStep() {
    step = "confirm";
    var body = $("account-withdrawal-body");
    var actions = $("account-withdrawal-actions");
    if (!body || !actions) return;

    body.innerHTML =
      "<p class=\"account-withdrawal-lead\">" +
      "탈퇴하시면 <strong>오답노트·찜노트·마스터 노트·휴지통·학습 통계·엘리 질문 기록·닉네임·구독·질문권</strong> 등 " +
      "이 계정에 연결된 학습·이용 데이터가 삭제되며, <strong>복구할 수 없습니다</strong>." +
      "</p>" +
      "<p class=\"account-withdrawal-lead\">" +
      "결제·환불 관련 기록은 관계 법령에 따라 일정 기간 보관될 수 있습니다(개인정보처리방침 참고)." +
      "</p>" +
      "<p class=\"account-withdrawal-lead\">" +
      "그래도 탈퇴하시겠습니까?" +
      "</p>" +
      "<label class=\"account-withdrawal-check field field--row field--row--checkbox\">" +
      "<input type=\"checkbox\" id=\"account-withdrawal-agree\" />" +
      "<span>학습·이용 데이터가 모두 삭제되는 것에 동의합니다.</span>" +
      "</label>" +
      "<label class=\"field\">" +
      "<span class=\"field__label\">개선점·불만사항 (선택)</span>" +
      "<textarea id=\"account-withdrawal-feedback\" class=\"input textarea\" rows=\"4\" maxlength=\"2000\" " +
      "placeholder=\"서비스를 이용하시며 느끼신 점을 자유롭게 적어 주세요. 없으면 비워 두셔도 됩니다.\"></textarea>" +
      "</label>";

    actions.innerHTML =
      "<button type=\"button\" class=\"btn btn--outline\" id=\"account-withdrawal-cancel\">취소</button>" +
      "<button type=\"button\" class=\"btn btn--secondary account-withdrawal-submit\" id=\"account-withdrawal-submit\">탈퇴하기</button>";

    $("account-withdrawal-cancel").addEventListener("click", function () {
      setModalOpen(false);
    });
    $("account-withdrawal-submit").addEventListener("click", onSubmitWithdrawal);
  }

  function renderFarewellStep(hadFeedback) {
    step = "done";
    var body = $("account-withdrawal-body");
    var actions = $("account-withdrawal-actions");
    if (!body || !actions) return;

    var parts = [];
    if (hadFeedback) {
      parts.push(
        "<p class=\"account-withdrawal-lead\">소중한 의견을 남겨 주셔서 <strong>진심으로 감사합니다</strong>. 참고하여 서비스를 개선하겠습니다.</p>"
      );
    }
    parts.push(
      "<p class=\"account-withdrawal-lead\">" +
        "그동안 행정법Q를 이용해 주셔서 감사합니다. 수험생활에 힘내시고, 좋은 결과 있으시길 진심으로 기원합니다." +
        "</p>" +
        "<p class=\"account-withdrawal-lead account-withdrawal-lead--muted\">계정 탈퇴가 완료되었습니다.</p>"
    );
    body.innerHTML = parts.join("");

    actions.innerHTML =
      "<button type=\"button\" class=\"btn btn--primary\" id=\"account-withdrawal-done\">확인</button>";

    $("account-withdrawal-done").addEventListener("click", function () {
      setModalOpen(false);
      window.location.href = "/";
    });
  }

  function clearLocalHanlawData() {
    try {
      var keys = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf("hanlaw_") === 0) keys.push(k);
      }
      keys.forEach(function (k) {
        localStorage.removeItem(k);
      });
    } catch (e) {}
  }

  function onSubmitWithdrawal() {
    if (busy || step !== "confirm") return;
    var agree = $("account-withdrawal-agree");
    if (!agree || !agree.checked) {
      alert("학습·이용 데이터 삭제에 동의해 주세요.");
      return;
    }
    if (!confirm("정말 탈퇴하시겠습니까? 삭제된 데이터는 복구할 수 없습니다.")) {
      return;
    }

    var feedbackEl = $("account-withdrawal-feedback");
    var feedback = feedbackEl ? String(feedbackEl.value || "").trim() : "";

    if (typeof firebase === "undefined" || !firebase.app) {
      alert("서비스 연결을 확인할 수 없습니다. 새로고침 후 다시 시도해 주세요.");
      return;
    }

    busy = true;
    var submitBtn = $("account-withdrawal-submit");
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "처리 중…";
    }

    var region = (window.FIREBASE_CONFIG && window.FIREBASE_CONFIG.functionsRegion) || "asia-northeast3";
    var fn = firebase.app().functions(region).httpsCallable("deleteMyAccount");

    fn({ confirmed: true, feedback: feedback })
      .then(function (res) {
        var hadFeedback = !!(res && res.data && res.data.hadFeedback);
        clearLocalHanlawData();
        try {
          if (firebase.auth) return firebase.auth().signOut();
        } catch (e) {}
        return hadFeedback;
      })
      .then(function (hadFeedback) {
        renderFarewellStep(hadFeedback);
        if (typeof window.dispatchEvent === "function") {
          window.dispatchEvent(new CustomEvent("app-auth"));
        }
      })
      .catch(function (err) {
        var msg =
          (err && err.message) ||
          "탈퇴 처리에 실패했습니다. 잠시 후 다시 시도하거나 채팅 문의·이메일(ellutionsoft@gmail.com)로 연락해 주세요.";
        alert(msg);
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = "탈퇴하기";
        }
        busy = false;
      });
  }

  function openModal() {
    if (!isLoggedIn()) {
      alert("로그인 후 탈퇴할 수 있습니다.");
      return;
    }
    renderConfirmStep();
    setModalOpen(true);
    var agree = $("account-withdrawal-agree");
    if (agree) agree.focus();
  }

  function bind() {
    var btn = $("btn-settings-withdrawal");
    if (btn) btn.addEventListener("click", openModal);

    var close = $("account-withdrawal-modal-close");
    if (close) {
      close.addEventListener("click", function () {
        if (step === "done") {
          window.location.href = "/";
        } else {
          setModalOpen(false);
        }
      });
    }

    syncBlock();
    try {
      if (typeof firebase !== "undefined" && firebase.auth) {
        firebase.auth().onAuthStateChanged(syncBlock);
      }
    } catch (e) {}
    window.addEventListener("app-auth", syncBlock);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }
})();
