(function () {
  var COLLECTION = "hanlaw_questions";
  var ERR_NO_FIRESTORE =
    "Firestore를 사용할 수 없습니다. file:// 대신 http://localhost 등으로 여세요. firebase-config.js·네트워크·광고 차단(gstatic)을 확인하세요.";

  function getDb() {
    if (typeof firebase === "undefined") return null;
    if (typeof window.ensureHanlawFirebaseApp === "function") {
      if (!window.ensureHanlawFirebaseApp()) return null;
    } else if (!firebase.apps || !firebase.apps.length) {
      return null;
    }
    try {
      return firebase.firestore();
    } catch (e) {
      console.warn("firebase.firestore():", e);
      return null;
    }
  }

  function mergeBanks() {
    var staticList = window.QUESTION_BANK_STATIC || [];
    var remote = window.QUESTION_BANK_REMOTE || [];
    var merged = staticList.slice();
    remote.forEach(function (r) {
      if (!r || !r.id) return;
      var idx = -1;
      for (var i = 0; i < merged.length; i++) {
        if (merged[i].id === r.id) {
          idx = i;
          break;
        }
      }
      if (idx >= 0) merged[idx] = r;
      else merged.push(r);
    });
    window.QUESTION_BANK = merged;
    window.dispatchEvent(new CustomEvent("question-bank-updated"));
  }

  function docToQuestion(doc) {
    var d = doc.data();
    var q = {};
    Object.keys(d).forEach(function (k) {
      if (k === "createdAt" || k === "updatedAt") return;
      q[k] = d[k];
    });
    if (!q.id) q.id = doc.id;
    if (q.examId != null && q.examId !== "") {
      q.examId = String(q.examId).trim().toLowerCase();
    }
    if (q.year != null && q.year !== "") {
      var yn =
        typeof q.year === "number" && isFinite(q.year)
          ? Math.floor(q.year)
          : parseInt(String(q.year).trim(), 10);
      q.year = isNaN(yn) ? null : yn;
    }
    if (typeof q.answer === "string") {
      var s = q.answer.trim().toLowerCase();
      if (s === "true" || s === "o" || s === "1" || s === "참") q.answer = true;
      else if (s === "false" || s === "x" || s === "0" || s === "거짓") q.answer = false;
    }
    return q;
  }

  function stripForFirestore(obj) {
    var o = {};
    Object.keys(obj).forEach(function (k) {
      var v = obj[k];
      if (v === undefined) return;
      if (v !== null && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date)) {
        var inner = stripForFirestore(v);
        if (Object.keys(inner).length) o[k] = inner;
        return;
      }
      o[k] = v;
    });
    return o;
  }

  window.loadRemoteQuestions = function () {
    var db = getDb();
    if (!db) {
      window.QUESTION_BANK_REMOTE = [];
      mergeBanks();
      return Promise.resolve();
    }
    return db
      .collection(COLLECTION)
      .get()
      .then(function (snap) {
        window.QUESTION_BANK_REMOTE = snap.docs.map(docToQuestion);
        mergeBanks();
      })
      .catch(function (err) {
        console.warn("Firestore 문항 로드 실패:", err);
        window.QUESTION_BANK_REMOTE = [];
        mergeBanks();
      });
  };

  window.saveQuestionToFirestore = function (question) {
    var db = getDb();
    if (!db) return Promise.reject(new Error(ERR_NO_FIRESTORE));
    var payload = stripForFirestore(question);
    return db
      .collection(COLLECTION)
      .doc(payload.id)
      .set(
        Object.assign({}, payload, {
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }),
        { merge: true }
      )
      .then(function () {
        return window.loadRemoteQuestions();
      });
  };

  function commitBatch(db, chunk) {
    var batch = db.batch();
    chunk.forEach(function (q) {
      var payload = stripForFirestore(q);
      var ref = db.collection(COLLECTION).doc(payload.id);
      batch.set(
        ref,
        Object.assign({}, payload, {
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }),
        { merge: true }
      );
    });
    return batch.commit();
  }

  window.saveQuestionsBatchToFirestore = function (questions) {
    var db = getDb();
    if (!db) return Promise.reject(new Error(ERR_NO_FIRESTORE));
    var size = 400;
    var chunks = [];
    for (var i = 0; i < questions.length; i += size) {
      chunks.push(questions.slice(i, i + size));
    }
    var chain = Promise.resolve();
    chunks.forEach(function (chunk) {
      chain = chain.then(function () {
        return commitBatch(db, chunk);
      });
    });
    return chain.then(function () {
      return window.loadRemoteQuestions();
    });
  };

  window.deleteQuestionFromFirestore = function (docId) {
    var db = getDb();
    if (!db) return Promise.reject(new Error(ERR_NO_FIRESTORE));
    return db
      .collection(COLLECTION)
      .doc(docId)
      .delete()
      .then(function () {
        return window.loadRemoteQuestions();
      });
  };
})();
