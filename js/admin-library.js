(function () {
  var listUnsub = null;
  var selectedFiles = [];

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

  function clearSelectedFiles() {
    selectedFiles = [];
  }

  function getSafeTitleFromFileName(name) {
    var base = String(name || "").replace(/\.[^.]+$/, "").trim();
    return base || "자료";
  }

  function setSelectedFiles(files) {
    clearSelectedFiles();
    if (!files || !files.length) return;
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      var isPdf =
        !!f &&
        (f.type === "application/pdf" || /\.pdf$/i.test(String((f && f.name) || "")));
      if (isPdf) selectedFiles.push(f);
    }
    // 파일을 고르면 제목 입력란에 첫 파일명을 기본값으로 채운다.
    var titleEl = document.getElementById("admin-lib-title");
    if (titleEl && selectedFiles.length > 0) {
      titleEl.value = getSafeTitleFromFileName(selectedFiles[0].name);
    }
  }

  var catLabel = {
    textbook: "교과서",
    past_exam: "기출·해설",
    revision: "법령 개정",
    precedent: "판례·실무",
    other: "기타"
  };

  function statusLabel(s) {
    var map = {
      pending: "대기(업로드 직후)",
      processing: "학습 중",
      complete: "완료",
      error: "오류"
    };
    return map[s] || s || "—";
  }

  function renderList(snap) {
    var el = document.getElementById("admin-library-list");
    if (!el) return;
    el.innerHTML = "";
    if (!snap || snap.empty) {
      el.innerHTML = "";
      var p = document.createElement("p");
      p.className = "admin-library-empty";
      p.textContent = "등록된 자료가 없습니다.";
      el.appendChild(p);
      return;
    }
    snap.docs.forEach(function (d) {
      var x = d.data();
      var row = document.createElement("div");
      row.className = "admin-library-row";
      var title = document.createElement("div");
      title.className = "admin-library-row__title";
      title.textContent = x.title || d.id;
      var meta = document.createElement("div");
      meta.className = "admin-library-row__meta";
      var parts = [];
      parts.push(catLabel[x.category] || x.category || "");
      parts.push(statusLabel(x.status));
      if (x.chunkCount != null) parts.push("청크 " + x.chunkCount + "개");
      if (x.numPages != null) parts.push("약 " + x.numPages + "페이지");
      meta.textContent = parts.filter(Boolean).join(" · ");
      var err = document.createElement("div");
      if (x.status === "error" && x.errorMessage) {
        err.className = "admin-library-row__err";
        err.textContent = String(x.errorMessage).slice(0, 240);
      }
      var del = document.createElement("button");
      del.type = "button";
      del.className = "btn btn--ghost btn--small";
      del.textContent = "삭제";
      del.setAttribute("data-library-id", d.id);
      row.appendChild(title);
      row.appendChild(del);
      row.appendChild(meta);
      if (err.textContent) row.appendChild(err);
      el.appendChild(row);
    });
  }

  function subscribeList() {
    var user = typeof window.getHanlawUser === "function" ? window.getHanlawUser() : null;
    if (!user || !isAdminUser(user)) return;
    if (listUnsub) {
      listUnsub();
      listUnsub = null;
    }
    if (typeof firebase === "undefined" || !firebase.firestore) return;
    var q = firebase
      .firestore()
      .collection("hanlaw_library_files")
      .orderBy("uploadedAt", "desc")
      .limit(80);
    listUnsub = q.onSnapshot(
      function (snap) {
        renderList(snap);
      },
      function () {
        var el = document.getElementById("admin-library-list");
        if (el) el.textContent = "목록을 불러오지 못했습니다.";
      }
    );
  }

  function deleteLibrary(libraryId) {
    if (!libraryId || !window.confirm("이 자료와 벡터 데이터를 삭제할까요?")) return;
    var region = window.FIREBASE_FUNCTIONS_REGION || "asia-northeast3";
    if (typeof firebase === "undefined" || !firebase.functions) return;
    var fn = firebase.app().functions(region).httpsCallable("deleteLibraryDocument");
    fn({ libraryId: libraryId })
      .then(function () {
        subscribeList();
      })
      .catch(function (e) {
        window.alert((e && e.message) || "삭제 실패");
      });
  }

  function buildUploadTitle(baseTitle, file, index, total) {
    var cleanBase = String(baseTitle || "").trim();
    if (!cleanBase) return getSafeTitleFromFileName(file && file.name);
    if (total <= 1) return cleanBase;
    return cleanBase + " (" + (index + 1) + ")";
  }

  function uploadSingleFile(createFn, category, description, file, title) {
    return createFn({
      title: title,
      category: category,
      description: description,
      fileName: file.name
    }).then(function (res) {
      var data = res && res.data;
      if (!data || !data.storagePath) throw new Error("서버 응답이 올바르지 않습니다.");
      var ref = firebase.storage().ref(data.storagePath);
      return ref.put(file, { contentType: "application/pdf" });
    });
  }

  function upload() {
    var msgEl = document.getElementById("admin-msg-library");
    var user = typeof window.getHanlawUser === "function" ? window.getHanlawUser() : null;
    if (!isAdminUser(user)) {
      setMsg(msgEl, "관리자만 업로드할 수 있습니다.", true);
      return;
    }
    var titleEl = document.getElementById("admin-lib-title");
    var catEl = document.getElementById("admin-lib-category");
    var descEl = document.getElementById("admin-lib-desc");
    var fileEl = document.getElementById("admin-lib-file");
    var title = titleEl ? titleEl.value.trim() : "";
    var category = catEl ? catEl.value : "other";
    var description = descEl ? descEl.value.trim() : "";
    var files = selectedFiles.slice();
    if (!files.length && fileEl && fileEl.files && fileEl.files.length) {
      setSelectedFiles(fileEl.files);
      files = selectedFiles.slice();
    }
    if (!files.length) {
      setMsg(msgEl, "PDF 파일을 1개 이상 선택하세요.", true);
      return;
    }
    if (typeof firebase === "undefined" || !firebase.functions || !firebase.storage) {
      setMsg(msgEl, "Firebase Functions·Storage를 사용할 수 없습니다.", true);
      return;
    }
    setMsg(msgEl, "등록 중…", false);
    var region = window.FIREBASE_FUNCTIONS_REGION || "asia-northeast3";
    var createFn = firebase.app().functions(region).httpsCallable("createLibraryDocument");
    var chain = Promise.resolve();
    var successCount = 0;
    for (var i = 0; i < files.length; i++) {
      (function (idx) {
        chain = chain.then(function () {
          var f = files[idx];
          var itemTitle = buildUploadTitle(title, f, idx, files.length);
          setMsg(msgEl, "등록 중… (" + (idx + 1) + "/" + files.length + ")", false);
          return uploadSingleFile(createFn, category, description, f, itemTitle).then(function () {
            successCount++;
          });
        });
      })(i);
    }

    chain
      .then(function () {
        setMsg(
          msgEl,
          "총 " + successCount + "개 업로드 완료. 잠시 후 목록에서 상태가 '학습 중' → '완료'로 바뀌는지 확인하세요.",
          false
        );
        if (fileEl) fileEl.value = "";
        clearSelectedFiles();
        subscribeList();
      })
      .catch(function (e) {
        var code = e && e.code;
        var m = (e && e.message) || String(e);
        if (code === "functions/unauthenticated") m = "로그인이 필요합니다.";
        if (code === "functions/permission-denied") m = "관리자만 업로드할 수 있습니다.";
        setMsg(msgEl, m, true);
      });
  }

  function bind() {
    var btn = document.getElementById("admin-btn-library-upload");
    if (btn) btn.addEventListener("click", upload);
    var fileEl = document.getElementById("admin-lib-file");
    if (fileEl) {
      fileEl.addEventListener("change", function () {
        setSelectedFiles(fileEl.files || []);
      });
    }
    var dz = document.getElementById("admin-library-dropzone");
    if (dz && fileEl) {
      ["dragenter", "dragover"].forEach(function (evt) {
        dz.addEventListener(evt, function (e) {
          e.preventDefault();
          e.stopPropagation();
          dz.classList.add("admin-excel-dropzone--active");
        });
      });
      ["dragleave", "drop"].forEach(function (evt) {
        dz.addEventListener(evt, function (e) {
          e.preventDefault();
          e.stopPropagation();
          dz.classList.remove("admin-excel-dropzone--active");
        });
      });
      dz.addEventListener("drop", function (e) {
        var files = (e.dataTransfer && e.dataTransfer.files) || [];
        setSelectedFiles(files);
        try {
          fileEl.files = files;
        } catch (_) {}
      });
      dz.addEventListener("click", function () {
        fileEl.click();
      });
      dz.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          fileEl.click();
        }
      });
    }
    var listEl = document.getElementById("admin-library-list");
    if (listEl) {
      listEl.addEventListener("click", function (e) {
        var b = e.target.closest("[data-library-id]");
        if (!b) return;
        deleteLibrary(b.getAttribute("data-library-id"));
      });
    }
  }

  window.loadAdminLibraryList = function () {
    subscribeList();
  };

  document.addEventListener("DOMContentLoaded", function () {
    bind();
  });

  window.addEventListener("app-auth", function () {
    subscribeList();
  });
})();
