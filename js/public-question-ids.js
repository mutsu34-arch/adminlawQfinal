/**

 * 행정법Q 공개 퀴즈 문항 ID (5문항) — questions.js·Firestore hanlaw_questions 와 동일 경로로 편집

 */

(function () {

  window.HANLAW_PUBLIC_QUESTION_IDS = [

    "q-ex-defendant-transfer",

    "q1",

    "q2",

    "q3",

    "q4"

  ];



  var idSet = null;

  function set() {

    if (!idSet) {

      idSet = {};

      (window.HANLAW_PUBLIC_QUESTION_IDS || []).forEach(function (id) {

        idSet[String(id)] = true;

      });

    }

    return idSet;

  }



  window.isHanlawPublicContentQuestion = function (q) {

    if (!q) return false;

    if (q.publicContent === true) return true;

    var id = q.id != null ? String(q.id).trim() : "";

    return !!(id && set()[id]);

  };



  function cloneShallow(q) {

    if (!q || typeof q !== "object") return q;

    var o = {};

    Object.keys(q).forEach(function (k) {

      o[k] = q[k];

    });

    return o;

  }



  window.getHanlawPublicQuestionBank = function () {

    var ids = window.HANLAW_PUBLIC_QUESTION_IDS || [];

    var staticList = window.QUESTION_BANK_STATIC || [];

    var mergedList = window.QUESTION_BANK || [];

    var staticById = {};

    var mergedById = {};



    staticList.forEach(function (q) {

      if (q && q.id) staticById[String(q.id)] = q;

    });

    mergedList.forEach(function (q) {

      if (q && q.id) mergedById[String(q.id)] = q;

    });



    var out = [];

    ids.forEach(function (id) {

      var key = String(id);

      var remote = mergedById[key];

      var st = staticById[key];

      var q = null;

      if (remote && remote.hidden !== true) q = remote;

      else if (st) q = st;

      else if (remote) q = st || remote;

      if (q) {

        q = cloneShallow(q);

        if (typeof window.isHanlawPublicContentQuestion === "function" && window.isHanlawPublicContentQuestion(q)) {

          q.publicContent = true;

        }

        out.push(q);

      }

    });

    return out;

  };

})();

