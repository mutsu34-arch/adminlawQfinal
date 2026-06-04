/**
 * 관리자 — 공개 학습 콘텐츠(Firestore published): 안내·배너·Q&A만 JSON 편집
 * 용어·조문·판례·퀴즈 문항은 앱 사전·hanlaw_questions 와 동일 모달로 편집합니다.
 */
(function () {
  function $(id) {
    return document.getElementById(id);
  }

  function setMsg(text, isError) {
    var el = $("admin-public-content-msg");
    if (!el) return;
    el.textContent = text || "";
    el.hidden = !text;
    el.classList.toggle("admin-msg--error", !!isError);
  }

  function callable(name) {
    if (typeof firebase === "undefined" || !firebase.app) {
      return Promise.reject(new Error("Firebase가 로드되지 않았습니다."));
    }
    var region = (window.FIREBASE_CONFIG && window.FIREBASE_CONFIG.functionsRegion) || "asia-northeast3";
    return firebase.app().functions(region).httpsCallable(name);
  }

  function waitForAuthUser() {
    return new Promise(function (resolve, reject) {
      if (typeof firebase === "undefined" || !firebase.auth) {
        reject(new Error("로그인이 필요합니다."));
        return;
      }
      var u = firebase.auth().currentUser;
      if (u) {
        resolve(u);
        return;
      }
      var done = false;
      var unsub = firebase.auth().onAuthStateChanged(function (user) {
        if (done) return;
        if (user) {
          done = true;
          if (typeof unsub === "function") unsub();
          resolve(user);
        }
      });
      setTimeout(function () {
        if (done) return;
        done = true;
        if (typeof unsub === "function") unsub();
        reject(new Error("로그인이 필요합니다. 관리자 계정으로 다시 로그인해 주세요."));
      }, 8000);
    });
  }

  function stripLegacyDictFields(cfg) {
    if (!cfg || typeof cfg !== "object") return cfg;
    var out = JSON.parse(JSON.stringify(cfg));
    delete out.terms;
    delete out.statutes;
    delete out.cases;
    return out;
  }

  function configForMerge() {
    var cfg =
      typeof window.getHanlawPublicContentConfig === "function"
        ? window.getHanlawPublicContentConfig()
        : null;
    if (!cfg || (!cfg.qa && cfg.introLead == null)) return buildSampleFromStatic();
    var out = stripLegacyDictFields(cfg);
    if (!Array.isArray(out.qa) || !out.qa.length) {
      out.qa = (window.HANLAW_PUBLIC_CONTENT_INDEX && window.HANLAW_PUBLIC_CONTENT_INDEX.qa) || [];
    }
    return out;
  }

  function matchPublicItem(arr, before) {
    var beforeVal = String((before && before.id) || "").trim();
    if (!beforeVal) return -1;
    for (var i = 0; i < arr.length; i++) {
      if (String((arr[i] && arr[i].id) || "").trim() === beforeVal) return i;
    }
    return -1;
  }

  window.savePublicQuizBanner = function (banner) {
    banner = banner || {};
    return waitForAuthUser()
      .then(function () {
        var cfg = configForMerge();
        cfg.quizBanner = Object.assign({}, cfg.quizBanner || {}, {
          title: String(banner.title || "").trim(),
          lead: String(banner.lead || "").trim(),
          href: String(banner.href || "/content/quiz-36.html").trim()
        });
        return callable("adminSavePublicContentConfig")({ config: JSON.stringify(cfg) });
      })
      .then(function () {
        if (typeof window.refreshHanlawPublicContentConfig === "function") {
          return window.refreshHanlawPublicContentConfig();
        }
      });
  };

  function bindQuizBannerModal() {
    var modal = $("public-quiz-banner-edit-modal");
    if (!modal) return;
    var btnClose = $("public-quiz-banner-edit-close");
    var btnCancel = $("public-quiz-banner-edit-cancel");
    var btnSave = $("public-quiz-banner-edit-save");
    var titleIn = $("public-quiz-banner-edit-title-input");
    var leadIn = $("public-quiz-banner-edit-lead");
    var hrefIn = $("public-quiz-banner-edit-href");
    var msg = $("public-quiz-banner-edit-msg");

    function setBannerMsg(text, isError) {
      if (!msg) return;
      msg.textContent = text || "";
      msg.hidden = !text;
      msg.classList.toggle("admin-msg--error", !!isError);
    }

    function openModal() {
      var cfg =
        typeof window.getHanlawPublicContentConfig === "function"
          ? window.getHanlawPublicContentConfig()
          : null;
      var b = (cfg && cfg.quizBanner) || {};
      if (titleIn) titleIn.value = b.title || "공개 퀴즈 5문항";
      if (leadIn) {
        leadIn.value =
          b.lead ||
          "OX 5문항을 로그인 없이 풀고, 기본·상세 해설(법리·함정·판례)을 모두 확인할 수 있습니다.";
      }
      if (hrefIn) hrefIn.value = b.href || "/content/quiz-36.html";
      setBannerMsg("", false);
      if (typeof window.raiseHanlawModalLayer === "function") {
        window.raiseHanlawModalLayer(modal);
      }
      modal.hidden = false;
      modal.style.display = "";
    }

    function closeModal() {
      modal.hidden = true;
      modal.style.display = "none";
    }

    window.openPublicQuizBannerEditModal = openModal;

    if (btnClose) btnClose.addEventListener("click", closeModal);
    if (btnCancel) btnCancel.addEventListener("click", closeModal);
    if (btnSave) {
      btnSave.addEventListener("click", function () {
        setBannerMsg("저장 중…", false);
        window
          .savePublicQuizBanner({
            title: titleIn && titleIn.value,
            lead: leadIn && leadIn.value,
            href: hrefIn && hrefIn.value
          })
          .then(function () {
            setBannerMsg("저장했습니다.", false);
            closeModal();
            var panel = document.getElementById("panel-public");
            if (
              panel &&
              !panel.hidden &&
              panel.getAttribute("data-public-tab") === "quiz" &&
              window.HanlawPublicContentUI &&
              typeof window.HanlawPublicContentUI.setPanelTab === "function"
            ) {
              window.HanlawPublicContentUI.setPanelTab("quiz");
            }
          })
          .catch(function (err) {
            setBannerMsg((err && err.message) || "저장 실패", true);
          });
      });
    }
  }

  function bindPublicQaEditModal() {
    var modal = $("public-qa-edit-modal");
    if (!modal) return;
    var btnClose = $("public-qa-edit-close");
    var btnCancel = $("public-qa-edit-cancel");
    var btnSave = $("public-qa-edit-save");
    var idIn = $("public-qa-edit-id");
    var topicIn = $("public-qa-edit-topic");
    var stmtIn = $("public-qa-edit-statement");
    var qIn = $("public-qa-edit-question");
    var answerIn = $("public-qa-edit-answer");
    var msg = $("public-qa-edit-msg");
    var editBefore = null;

    function setQaMsg(text, isError) {
      if (!msg) return;
      msg.textContent = text || "";
      msg.hidden = !text;
      msg.classList.toggle("admin-msg--error", !!isError);
    }

    function openModal(item) {
      item = item || {};
      editBefore = JSON.parse(JSON.stringify(item));
      if (idIn) {
        idIn.value = item.id || "";
        idIn.readOnly = !!(item.id && String(item.id).trim());
      }
      if (topicIn) topicIn.value = item.quizTopic || "";
      if (stmtIn) stmtIn.value = item.quizStatement || "";
      if (qIn) qIn.value = item.questionMessage || "";
      if (answerIn) answerIn.value = item.answer || "";
      setQaMsg("", false);
      if (typeof window.raiseHanlawModalLayer === "function") {
        window.raiseHanlawModalLayer(modal);
      }
      modal.hidden = false;
      modal.style.display = "";
    }

    function closeModal() {
      modal.hidden = true;
      modal.style.display = "none";
      editBefore = null;
    }

    if (btnClose) btnClose.addEventListener("click", closeModal);
    if (btnCancel) btnCancel.addEventListener("click", closeModal);
    if (btnSave) {
      btnSave.addEventListener("click", function () {
        var next = {
          id: String((idIn && idIn.value) || "").trim(),
          quizTopic: String((topicIn && topicIn.value) || "").trim(),
          quizStatement: String((stmtIn && stmtIn.value) || "").trim(),
          questionMessage: String((qIn && qIn.value) || "").trim(),
          answer: String((answerIn && answerIn.value) || "").trim()
        };
        if (!next.id) {
          setQaMsg("ID(영문·숫자·하이픈)를 입력해 주세요.", true);
          return;
        }
        if (!next.questionMessage || !next.answer) {
          setQaMsg("회원 질문과 답변은 필수입니다.", true);
          return;
        }
        setQaMsg("저장 중…", false);
        window
          .savePublicQaItem({
            before: editBefore || { id: next.id },
            after: next
          })
          .then(function () {
            setQaMsg("저장했습니다.", false);
            closeModal();
            var panel = document.getElementById("panel-public");
            if (
              panel &&
              !panel.hidden &&
              panel.getAttribute("data-public-tab") === "qa" &&
              window.HanlawPublicContentUI &&
              typeof window.HanlawPublicContentUI.setPanelTab === "function"
            ) {
              window.HanlawPublicContentUI.setPanelTab("qa");
            }
          })
          .catch(function (err) {
            setQaMsg((err && err.message) || "저장 실패", true);
          });
      });
    }

    window.openPublicQaEditModal = openModal;

    var root = document.getElementById("public-content-root");
    if (root) {
      root.addEventListener("click", function (e) {
        var btn = e.target.closest("[data-admin-edit-public-qa]");
        if (!btn || !btn._qaItem) return;
        e.preventDefault();
        openModal(btn._qaItem);
      });
    }
  }

  window.savePublicQaItem = function (payload) {
    payload = payload || {};
    var before = payload.before || {};
    var after = payload.after || {};
    if (!after || typeof after !== "object") return Promise.resolve();
    return waitForAuthUser()
      .then(function () {
        var cfg = configForMerge();
        if (!Array.isArray(cfg.qa)) cfg.qa = [];
        var idx = matchPublicItem(cfg.qa, before);
        if (idx >= 0) cfg.qa[idx] = Object.assign({}, cfg.qa[idx], after);
        else cfg.qa.push(after);
        return callable("adminSavePublicContentConfig")({ config: JSON.stringify(cfg) });
      })
      .then(function () {
        if (typeof window.refreshHanlawPublicContentConfig === "function") {
          return window.refreshHanlawPublicContentConfig();
        }
      });
  };

  /** @deprecated Q&A 전용 — dict 동기화는 사용하지 않습니다 */
  window.syncPublicContentAfterDictEdit = function (kind, payload) {
    if (kind !== "qa") return Promise.resolve();
    return window.savePublicQaItem(payload);
  };

  function buildSampleFromStatic() {
    var idx = window.HANLAW_PUBLIC_CONTENT_INDEX || {};
    return {
      introLead:
        "로그인 없이 열람할 수 있는 핵심 자료입니다. 공개 퀴즈 5문항은 기본·상세 해설을 모두 공개합니다.",
      introDisclaimer:
        "아래는 앱 콘텐츠 구성을 반영한 공개 미리보기입니다. 용어·조문·판례·퀴즈는 앱 DB와 동일하며, Q&A·안내 문구만 이 설정에 저장됩니다.",
      quizBanner: {
        title: "공개 퀴즈 5문항",
        lead: "OX 5문항을 로그인 없이 풀고, 기본·상세 해설(법리·함정·판례)을 모두 확인할 수 있습니다.",
        href: "/content/quiz-36.html"
      },
      qa: idx.qa || []
    };
  }

  function loadEditor() {
    var ta = $("admin-public-content-json");
    if (!ta) return;
    setMsg("불러오는 중…", false);
    waitForAuthUser()
      .then(function () {
        return callable("adminGetPublicContentConfig")({});
      })
      .then(function (res) {
        var cfg = res && res.data ? res.data.config : null;
        if (!cfg) {
          cfg = buildSampleFromStatic();
          setMsg("저장된 공개 콘텐츠가 없습니다. 샘플 구조를 표시합니다. 수정 후 저장하세요.", false);
        } else {
          cfg = stripLegacyDictFields(cfg);
          setMsg("서버에서 불러왔습니다. (용어·조문·판례 필드는 표시하지 않습니다)", false);
        }
        ta.value = JSON.stringify(cfg, null, 2);
      })
      .catch(function (err) {
        ta.value = JSON.stringify(buildSampleFromStatic(), null, 2);
        setMsg((err && err.message) || "불러오기 실패. 샘플을 표시합니다.", true);
      });
  }

  function saveEditor() {
    var ta = $("admin-public-content-json");
    if (!ta) return;
    var raw = String(ta.value || "").trim();
    if (!raw) {
      setMsg("JSON이 비어 있습니다.", true);
      return;
    }
    try {
      JSON.parse(raw);
    } catch (e) {
      setMsg("JSON 형식 오류: " + e.message, true);
      return;
    }
    setMsg("저장 중…", false);
    waitForAuthUser()
      .then(function () {
        return callable("adminSavePublicContentConfig")({ config: raw });
      })
      .then(function () {
        setMsg("저장했습니다. 공개 화면을 새로고침해 반영을 확인하세요.", false);
        if (typeof window.refreshHanlawPublicContentConfig === "function") {
          return window.refreshHanlawPublicContentConfig();
        }
      })
      .catch(function (err) {
        setMsg((err && err.message) || "저장 실패", true);
      });
  }

  function resetPublished() {
    if (
      !window.confirm(
        "Firestore의 공개 설정을 초기화합니다.\n용어·조문·판례 복사본(terms/statutes/cases)을 삭제하고, 안내·배너·Q&A만 남깁니다.\n계속할까요?"
      )
    ) {
      return;
    }
    setMsg("초기화 중…", false);
    waitForAuthUser()
      .then(function () {
        return callable("adminResetPublicContentConfig")({});
      })
      .then(function () {
        setMsg("초기화했습니다. 공개 화면을 새로고침하세요.", false);
        if (typeof window.refreshHanlawPublicContentConfig === "function") {
          return window.refreshHanlawPublicContentConfig();
        }
      })
      .then(function () {
        loadEditor();
      })
      .catch(function (err) {
        setMsg((err && err.message) || "초기화 실패", true);
      });
  }

  function bind() {
    var btnLoad = $("admin-public-content-load");
    var btnSave = $("admin-public-content-save");
    var btnPreview = $("admin-public-content-preview");
    var btnReset = $("admin-public-content-reset");
    if (btnLoad) btnLoad.addEventListener("click", loadEditor);
    if (btnSave) btnSave.addEventListener("click", saveEditor);
    if (btnReset) btnReset.addEventListener("click", resetPublished);
    if (btnPreview) {
      btnPreview.addEventListener("click", function () {
        if (typeof window.goHanlawPublicHub === "function") {
          window.goHanlawPublicHub();
        } else if (typeof window.hanlawNavigateToPanel === "function") {
          window.hanlawNavigateToPanel("public", { syncUrl: true });
        }
      });
    }
  }

  window.loadAdminPublicContentPanel = loadEditor;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      bind();
      bindQuizBannerModal();
      bindPublicQaEditModal();
    });
  } else {
    bind();
    bindQuizBannerModal();
    bindPublicQaEditModal();
  }
})();
