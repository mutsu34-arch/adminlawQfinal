/**
 * 범위 설정 즐겨찾기: 시험·연도·주제·문항 수·순서를 묶어 저장하고, 버튼 한 번에 적용 후 퀴즈 시작
 * 저장소는 로그인 사용자별 localStorage 키로 분리 (quiz-favorites.js 와 동일 패턴).
 */
(function () {
  var STORAGE_VER = "v1";
  var LS_PREFIX = "hanlaw_scope_favorites_";
  /** 구버전 전역 키 — 1회 마이그레이션 후 제거 */
  var LEGACY_KEY = "hanlaw_scope_favorites_v1";
  var MAX_ITEMS = 15;
  var ALL_TOPIC = "전체";

  function normalizeId(id) {
    return String(id == null ? "" : id).trim();
  }

  function getCurrentUid() {
    try {
      if (typeof window.getHanlawUser === "function") {
        var u = window.getHanlawUser();
        if (u && u.uid) return normalizeId(u.uid);
      }
    } catch (e) {}
    try {
      if (typeof firebase !== "undefined" && firebase.auth && firebase.auth().currentUser) {
        var cu = firebase.auth().currentUser;
        if (cu && cu.uid) return normalizeId(cu.uid);
      }
    } catch (e2) {}
    return "";
  }

  function isLoggedIn() {
    return !!getCurrentUid();
  }

  function storageKey() {
    var uid = getCurrentUid();
    if (!uid) return "";
    return LS_PREFIX + STORAGE_VER + "_" + uid;
  }

  /** 예전 단일 키 데이터를 비로그인용 키로 옮긴 뒤 레거시 삭제 */
  function migrateLegacyOnce() {
    try {
      var raw = localStorage.getItem(LEGACY_KEY);
      if (!raw) return;
      var leg = JSON.parse(raw);
      if (!leg || !Array.isArray(leg.items) || !leg.items.length) {
        localStorage.removeItem(LEGACY_KEY);
        return;
      }
      var keyLocal = LS_PREFIX + STORAGE_VER + "_local";
      var rawL = localStorage.getItem(keyLocal);
      var oL = rawL ? JSON.parse(rawL) : { v: 1, items: [] };
      if (!oL || !Array.isArray(oL.items)) oL = { v: 1, items: [] };
      var seen = {};
      oL.items.forEach(function (x) {
        if (x && x.id) seen[String(x.id)] = true;
      });
      leg.items.forEach(function (x) {
        if (!x || !x.id) return;
        var sid = String(x.id);
        if (seen[sid]) return;
        seen[sid] = true;
        oL.items.push(x);
      });
      if (oL.items.length > MAX_ITEMS) oL.items = oL.items.slice(0, MAX_ITEMS);
      oL.v = 1;
      localStorage.setItem(keyLocal, JSON.stringify(oL));
      localStorage.removeItem(LEGACY_KEY);
    } catch (e) {
      try {
        localStorage.removeItem(LEGACY_KEY);
      } catch (e2) {}
    }
  }

  /** 비로그인에서 저장한 목록을 로그인 시 해당 계정 키로 합침 (찜하기와 동일) */
  function mergeScopeFavLocalIntoUid(uid) {
    var id = normalizeId(uid);
    if (!id) return;
    var keyLocal = LS_PREFIX + STORAGE_VER + "_local";
    var keyUid = LS_PREFIX + STORAGE_VER + "_" + id;
    try {
      var rawL = localStorage.getItem(keyLocal);
      if (!rawL) return;
      var oL = JSON.parse(rawL);
      if (!oL || !Array.isArray(oL.items) || !oL.items.length) return;

      var rawU = localStorage.getItem(keyUid);
      var oU = rawU ? JSON.parse(rawU) : { v: 1, items: [] };
      if (!oU || !Array.isArray(oU.items)) oU = { v: 1, items: [] };

      var seen = {};
      var merged = [];
      function pushItem(it) {
        if (!it || !it.id) return;
        var sid = String(it.id);
        if (seen[sid]) return;
        seen[sid] = true;
        merged.push(it);
      }
      oL.items.forEach(pushItem);
      oU.items.forEach(pushItem);
      if (merged.length > MAX_ITEMS) merged = merged.slice(0, MAX_ITEMS);

      oU.v = 1;
      oU.items = merged;
      localStorage.setItem(keyUid, JSON.stringify(oU));
      localStorage.removeItem(keyLocal);
    } catch (e) {}
  }

  migrateLegacyOnce();

  function loadStore() {
    var key = storageKey();
    if (!key) return { v: 1, items: [] };
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return { v: 1, items: [] };
      var o = JSON.parse(raw);
      if (!o || !Array.isArray(o.items)) return { v: 1, items: [] };
      return o;
    } catch (e) {
      return { v: 1, items: [] };
    }
  }

  function saveStore(store) {
    var key = storageKey();
    if (!key) return;
    try {
      localStorage.setItem(key, JSON.stringify(store));
    } catch (e) {}
  }

  function captureCurrent() {
    var examIds = window.APP_SCOPE && Array.isArray(window.APP_SCOPE.examIds)
      ? window.APP_SCOPE.examIds.slice()
      : [];
    var years = window.APP_SCOPE && Array.isArray(window.APP_SCOPE.years)
      ? window.APP_SCOPE.years.map(Number)
      : [];
    var ft = document.getElementById("filter-topic");
    var ft1 = document.getElementById("filter-topic-l1");
    var ft2 = document.getElementById("filter-topic-l2");
    var fts = document.getElementById("filter-topic-search");
    var qc = document.getElementById("question-count");
    var qcCustom = document.getElementById("question-count-custom");
    var seq = document.querySelector('input[name="opt-sequence"]:checked');
    var nw = document.getElementById("scope-note-wrong");
    var nf = document.getElementById("scope-note-fav");
    var nm = document.getElementById("scope-note-master");
    return {
      examIds: examIds,
      years: years,
      questionSource:
        typeof window.getStudyQuestionSource === "function"
          ? window.getStudyQuestionSource()
          : "past_only",
      filterTopicL1: ft1 ? String(ft1.value || ALL_TOPIC) : ALL_TOPIC,
      filterTopicL2: ft2 ? String(ft2.value || ALL_TOPIC) : ALL_TOPIC,
      filterTopic: ft ? String(ft.value || ALL_TOPIC) : ALL_TOPIC,
      filterTopicSearch: fts ? String(fts.value || "") : "",
      questionCount: qc ? String(qc.value || "0") : "0",
      questionCountCustom: qcCustom ? String(qcCustom.value || "").trim() : "",
      sequenceMode: seq && seq.value ? String(seq.value) : "random",
      notebookScope: {
        wrong: !!(nw && nw.checked),
        fav: !!(nf && nf.checked),
        master: !!(nm && nm.checked)
      }
    };
  }

  function applyFormFields(preset) {
    var ft1 = document.getElementById("filter-topic-l1");
    if (ft1) {
      ft1.value = preset.filterTopicL1 != null ? String(preset.filterTopicL1) : ALL_TOPIC;
    }
    var ft2 = document.getElementById("filter-topic-l2");
    if (ft2) {
      ft2.value = preset.filterTopicL2 != null ? String(preset.filterTopicL2) : ALL_TOPIC;
    }
    if (typeof window.initHanlawQuizFilters === "function") {
      window.initHanlawQuizFilters();
    }
    var ft = document.getElementById("filter-topic");
    if (ft) {
      var want = preset.filterTopic != null ? String(preset.filterTopic) : ALL_TOPIC;
      var ok = false;
      for (var i = 0; i < ft.options.length; i++) {
        if (ft.options[i].value === want) {
          ok = true;
          break;
        }
      }
      if (ok || want === ALL_TOPIC) {
        ft.value = want;
      } else if (typeof window.ensureHanlawFilterTopicOption === "function") {
        window.ensureHanlawFilterTopicOption(want);
        ft.value = want;
      } else {
        ft.value = ALL_TOPIC;
      }
    }
    var fts = document.getElementById("filter-topic-search");
    if (fts) {
      fts.value =
        preset.filterTopicSearch != null ? String(preset.filterTopicSearch) : "";
    }
    var qc = document.getElementById("question-count");
    if (qc) {
      var c = String(preset.questionCount != null ? preset.questionCount : "0");
      var hasC = false;
      var j;
      for (j = 0; j < qc.options.length; j++) {
        if (qc.options[j].value === c) {
          hasC = true;
          break;
        }
      }
      if (hasC) qc.value = c;
    }
    var qcCustom = document.getElementById("question-count-custom");
    if (qcCustom) {
      qcCustom.value =
        preset.questionCountCustom != null ? String(preset.questionCountCustom).trim() : "";
    }
    var seqMode = String(
      preset.sequenceMode != null
        ? preset.sequenceMode
        : preset.orderMode === "progress"
          ? "progress"
          : "random"
    );
    var seqRadio = document.querySelector('input[name="opt-sequence"][value="' + seqMode + '"]');
    if (seqRadio) seqRadio.checked = true;
    else {
      var seqFallback = document.querySelector('input[name="opt-sequence"][value="random"]');
      if (seqFallback) seqFallback.checked = true;
    }
    var nw = document.getElementById("scope-note-wrong");
    var nf = document.getElementById("scope-note-fav");
    var nm = document.getElementById("scope-note-master");
    var nb = preset.notebookScope;
    if (nb && typeof nb === "object") {
      if (nw) nw.checked = !!nb.wrong;
      if (nf) nf.checked = !!nb.fav;
      if (nm) nm.checked = !!nb.master;
    } else {
      if (nw) nw.checked = false;
      if (nf) nf.checked = false;
      if (nm) nm.checked = false;
    }
    if (typeof window.initHanlawQuizFilters === "function") {
      window.initHanlawQuizFilters();
    }
  }

  function applyPresetAndStart(preset) {
    if (!preset) return;
    if (typeof window.applyStudyScopeFromObject !== "function") return;
    window.applyStudyScopeFromObject({
      examIds: preset.examIds,
      years: preset.years,
      questionSource: preset.questionSource
    });
    setTimeout(function () {
      applyFormFields(preset);
      if (typeof window.startHanlawQuizFromSetup === "function") {
        window.startHanlawQuizFromSetup();
      }
    }, 0);
  }

  function addFavorite(name) {
    if (!isLoggedIn()) {
      alert("범위 즐겨찾기는 로그인 후 이용할 수 있습니다.");
      return;
    }
    var label = String(name || "").trim();
    if (!label) {
      alert("즐겨찾기 이름을 입력하세요.");
      return;
    }
    if (label.length > 40) {
      alert("이름은 40자 이하로 입력하세요.");
      return;
    }
    var st = loadStore();
    if (st.items.length >= MAX_ITEMS) {
      alert("즐겨찾기는 최대 " + MAX_ITEMS + "개까지 저장할 수 있습니다.");
      return;
    }
    var cur = captureCurrent();
    if (!cur.examIds.length || !cur.years.length) {
      alert("시험과 연도를 왼쪽에서 선택한 뒤 저장하세요.");
      return;
    }
    st.items.push({
      id: "fav_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8),
      name: label,
      examIds: cur.examIds,
      years: cur.years,
      questionSource: cur.questionSource,
      filterTopicL1: cur.filterTopicL1,
      filterTopicL2: cur.filterTopicL2,
      filterTopic: cur.filterTopic,
      filterTopicSearch: cur.filterTopicSearch,
      questionCount: cur.questionCount,
      questionCountCustom: cur.questionCountCustom,
      sequenceMode: cur.sequenceMode,
      notebookScope: cur.notebookScope
    });
    saveStore(st);
    renderList();
    alert("저장되었습니다.");
    var inp = document.getElementById("scope-favorite-name");
    if (inp) inp.value = "";
  }

  function removeFavorite(id) {
    var st = loadStore();
    st.items = st.items.filter(function (x) {
      return x.id !== id;
    });
    saveStore(st);
    renderList();
  }

  function renderList() {
    var host = document.getElementById("scope-favorites-list");
    if (!host) return;
    host.innerHTML = "";
    if (!isLoggedIn()) {
      var locked = document.createElement("p");
      locked.className = "scope-favorites__empty";
      locked.textContent = "로그인 후 내 범위 즐겨찾기를 확인할 수 있습니다.";
      host.appendChild(locked);
      return;
    }
    var st = loadStore();
    if (!st.items.length) {
      var empty = document.createElement("p");
      empty.className = "scope-favorites__empty";
      empty.textContent = "저장된 즐겨찾기가 없습니다.";
      host.appendChild(empty);
      return;
    }
    st.items.forEach(function (item) {
      var row = document.createElement("div");
      row.className = "scope-favorites__row";
      row.setAttribute("role", "listitem");
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn--secondary scope-favorites__go";
      btn.textContent = item.name;
      btn.setAttribute("aria-label", item.name + " 범위로 퀴즈 시작");
      btn.setAttribute("data-favorite-id", item.id);
      btn.addEventListener("click", function () {
        applyPresetAndStart(item);
      });
      var del = document.createElement("button");
      del.type = "button";
      del.className = "scope-favorites__del";
      del.setAttribute("aria-label", item.name + " 즐겨찾기 삭제");
      del.innerHTML =
        '<svg class="scope-favorites__trash-icon" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>';
      del.addEventListener("click", function (e) {
        e.stopPropagation();
        if (window.confirm("「" + item.name + "」 즐겨찾기를 삭제할까요?")) {
          removeFavorite(item.id);
        }
      });
      row.appendChild(btn);
      row.appendChild(del);
      host.appendChild(row);
    });
  }

  function syncLoginUi() {
    var loggedIn = isLoggedIn();
    var btnSave = document.getElementById("btn-scope-favorite-save");
    var inp = document.getElementById("scope-favorite-name");
    if (btnSave) btnSave.disabled = !loggedIn;
    if (inp) {
      inp.disabled = !loggedIn;
      if (!loggedIn) inp.value = "";
      inp.placeholder = loggedIn
        ? "예: 9급 최근 3개년 랜덤"
        : "로그인 후 범위 즐겨찾기를 저장할 수 있습니다";
    }
  }

  function bind() {
    var btnSave = document.getElementById("btn-scope-favorite-save");
    var inp = document.getElementById("scope-favorite-name");
    if (btnSave) {
      btnSave.addEventListener("click", function () {
        addFavorite(inp ? inp.value : "");
      });
    }
    if (inp) {
      inp.addEventListener("keydown", function (e) {
        if (e.key === "Enter") {
          e.preventDefault();
          addFavorite(inp.value);
        }
      });
    }

    window.addEventListener("app-auth", function (e) {
      var u = e && e.detail && e.detail.user;
      if (u && u.uid) mergeScopeFavLocalIntoUid(u.uid);
      syncLoginUi();
      renderList();
    });
    try {
      if (typeof firebase !== "undefined" && firebase.auth) {
        firebase.auth().onAuthStateChanged(function (user) {
          if (user && user.uid) mergeScopeFavLocalIntoUid(user.uid);
          syncLoginUi();
          renderList();
        });
      }
    } catch (e) {}

    syncLoginUi();
    renderList();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }
})();
