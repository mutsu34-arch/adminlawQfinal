(function () {
  var unsubT = null;
  var unsubC = null;

  window.LEGAL_TERMS_REMOTE = [];
  window.LEGAL_CASES_REMOTE = [];

  function mapTermDoc(doc) {
    var d = doc.data();
    return {
      term: d.term || doc.id,
      aliases: Array.isArray(d.aliases) ? d.aliases : [],
      definition: d.definition || ""
    };
  }

  function mapCaseDoc(doc) {
    var d = doc.data();
    return {
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
      scourtPortalUrl: d.scourtPortalUrl || ""
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
  }

  function applyDictUser(user) {
    try {
      if (typeof firebase === "undefined" || !firebase.firestore) return;
      if (!firebase.apps || !firebase.apps.length) return;
      clearSubs();
      window.LEGAL_TERMS_REMOTE = [];
      window.LEGAL_CASES_REMOTE = [];
      window.dispatchEvent(new CustomEvent("dict-remote-updated"));
      if (!user) return;

      var tref = firebase.firestore().collection("hanlaw_dict_terms");
      var cref = firebase.firestore().collection("hanlaw_dict_cases");

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
