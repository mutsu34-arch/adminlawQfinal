(function () {
  var unsubT = null;
  var unsubC = null;
  var unsubS = null;

  window.LEGAL_TERMS_REMOTE = [];
  window.LEGAL_CASES_REMOTE = [];
  window.LEGAL_STATUTES_REMOTE = [];

  function mapTermDoc(doc) {
    var d = doc.data();
    return {
      _docId: doc.id,
      term: d.term || doc.id,
      aliases: Array.isArray(d.aliases) ? d.aliases : [],
      definition: d.definition || "",
      source: d.source || ""
    };
  }

  function mapStatuteDoc(doc) {
    var d = doc.data();
    var key = String(d.statuteKey || doc.id || "").trim();
    return {
      _docId: doc.id,
      key: key,
      heading: d.heading != null ? d.heading : "",
      body: d.body != null ? d.body : "",
      sourceNote: d.sourceNote != null ? d.sourceNote : ""
    };
  }

  /**
   * 조문 저장 직후 onSnapshot보다 먼저 목록을 갱신할 때 사용.
   * 정적 키(statuteKey) 또는 문서 ID로 기존 항목을 덮어쓴다.
   */
  window.upsertLegalStatuteRemote = function (mapped) {
    if (!mapped) return;
    if (!Array.isArray(window.LEGAL_STATUTES_REMOTE)) {
      window.LEGAL_STATUTES_REMOTE = [];
    }
    var k = String(mapped.key || "").trim();
    var id = String(mapped._docId || "").trim();
    var arr = window.LEGAL_STATUTES_REMOTE;
    var replaced = false;
    var i;
    for (i = 0; i < arr.length; i++) {
      var x = arr[i];
      if (!x) continue;
      if (id && String(x._docId || "") === id) {
        arr[i] = mapped;
        replaced = true;
        break;
      }
      if (k && String(x.key || "").trim() === k) {
        arr[i] = mapped;
        replaced = true;
        break;
      }
    }
    if (!replaced) {
      arr.push(mapped);
    }
    window.dispatchEvent(new CustomEvent("dict-remote-updated"));
  };

  function mapCaseDoc(doc) {
    var d = doc.data();
    return {
      _docId: doc.id,
      citation: d.citation || "",
      title: d.title || "",
      facts: d.facts || "",
      issues: d.issues || "",
      judgment: d.judgment || "",
      searchKeys: Array.isArray(d.searchKeys) ? d.searchKeys : [],
      topicKeywords: Array.isArray(d.topicKeywords)
        ? d.topicKeywords
        : Array.isArray(d.keywords)
          ? d.keywords
          : [],
      casenoteUrl: d.casenoteUrl || "",
      jisCntntsSrno: d.jisCntntsSrno || "",
      scourtPortalUrl: d.scourtPortalUrl || "",
      createdAt: d.createdAt || null,
      updatedAt: d.updatedAt || null
    };
  }

  function clearSubs() {
    if (unsubT) {
      unsubT();
      unsubT = null;
    }
    if (unsubC) {
      unsubC();
      unsubC = null;
    }
    if (unsubS) {
      unsubS();
      unsubS = null;
    }
  }

  function applyDictUser(user) {
    try {
      if (typeof firebase === "undefined" || !firebase.firestore) return;
      if (!firebase.apps || !firebase.apps.length) return;
      clearSubs();
      window.LEGAL_TERMS_REMOTE = [];
      window.LEGAL_CASES_REMOTE = [];
      window.LEGAL_STATUTES_REMOTE = [];
      window.dispatchEvent(new CustomEvent("dict-remote-updated"));
      if (!user) return;

      var tref = firebase.firestore().collection("hanlaw_dict_terms");
      var cref = firebase.firestore().collection("hanlaw_dict_cases");
      var sref = firebase.firestore().collection("hanlaw_dict_statutes");

      unsubT = tref.onSnapshot(
        function (snap) {
          window.LEGAL_TERMS_REMOTE = snap.docs.map(mapTermDoc);
          window.dispatchEvent(new CustomEvent("dict-remote-updated"));
        },
        function () {
          window.LEGAL_TERMS_REMOTE = [];
          window.dispatchEvent(new CustomEvent("dict-remote-updated"));
        }
      );

      unsubC = cref.onSnapshot(
        function (snap) {
          window.LEGAL_CASES_REMOTE = snap.docs.map(mapCaseDoc);
          window.dispatchEvent(new CustomEvent("dict-remote-updated"));
        },
        function () {
          window.LEGAL_CASES_REMOTE = [];
          window.dispatchEvent(new CustomEvent("dict-remote-updated"));
        }
      );

      unsubS = sref.onSnapshot(
        function (snap) {
          window.LEGAL_STATUTES_REMOTE = snap.docs.map(mapStatuteDoc);
          window.dispatchEvent(new CustomEvent("dict-remote-updated"));
        },
        function () {
          window.LEGAL_STATUTES_REMOTE = [];
          window.dispatchEvent(new CustomEvent("dict-remote-updated"));
        }
      );
    } catch (e) {}
  }

  function bindAuth() {
    window.addEventListener("app-auth", function (e) {
      applyDictUser(e.detail ? e.detail.user : null);
    });
    try {
      if (typeof firebase === "undefined" || !firebase.auth || !firebase.firestore) return;
      if (!firebase.apps || !firebase.apps.length) return;
      firebase.auth().onAuthStateChanged(function () {
        applyDictUser(typeof window.getHanlawUser === "function" ? window.getHanlawUser() : null);
      });
      applyDictUser(typeof window.getHanlawUser === "function" ? window.getHanlawUser() : null);
    } catch (e) {}
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindAuth);
  } else {
    bindAuth();
  }
})();
