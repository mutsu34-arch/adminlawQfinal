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
      try {
        if (
          typeof firebase !== "undefined" &&
          firebase.firestore &&
          v instanceof firebase.firestore.FieldValue
        ) {
          o[k] = v;
          return;
        }
      } catch (e) {}
      if (v !== null && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date)) {
        var inner = stripForFirestore(v);
        if (Object.keys(inner).length) o[k] = inner;
        return;
      }
      o[k] = v;
    });
    return o;
  }

  function normalizeDocId(raw, fallbackPrefix) {
    var s = String(raw || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "_")
      .replace(/[^a-z0-9_ㄱ-ㅎ가-힣-]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "");
    if (!s) s = (fallbackPrefix || "entry") + "_" + Date.now().toString(36);
    if (s.length > 180) s = s.slice(0, 180);
    return s;
  }

  /** 조문 정적 키(법령|조|…) → Firestore 문서 ID와 동일 규칙. dict 병합 시 사용 */
  window.normalizeHanlawStatuteDocId = function (statuteKey) {
    return normalizeDocId(statuteKey, "statute");
  };

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
        // 저장 직후 재조회 실패 시 원격 캐시를 비우면 방금 반영한 수정이 사라짐 → 기존 REMOTE 유지
        mergeBanks();
      });
  };

  /** 클라이언트 병합용: 방금 저장한 문항을 REMOTE에 넣어 정적 문항을 덮어씀(재조회 실패·지연 대비) */
  function cloneQuestionForLocalBank(q, opts) {
    opts = opts || {};
    var o = {};
    Object.keys(q || {}).forEach(function (k) {
      if (k === "createdAt" || k === "updatedAt") return;
      o[k] = q[k];
    });
    if (opts.clearDetail) {
      delete o.detail;
    }
    return o;
  }

  function upsertRemoteQuestionLocal(q, opts) {
    if (!q || q.id == null || String(q.id).trim() === "") return;
    var copy = cloneQuestionForLocalBank(q, opts);
    var list = window.QUESTION_BANK_REMOTE || [];
    window.QUESTION_BANK_REMOTE = list;
    var id = copy.id;
    var idx = -1;
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) {
        idx = i;
        break;
      }
    }
    if (idx >= 0) list[idx] = copy;
    else list.push(copy);
    mergeBanks();
  }

  window.saveQuestionToFirestore = function (question, opts) {
    opts = opts || {};
    var db = getDb();
    if (!db) return Promise.reject(new Error(ERR_NO_FIRESTORE));
    var fv = firebase.firestore.FieldValue;
    var payload = stripForFirestore(question);
    if (opts.clearDetail) {
      payload.detail = fv.delete();
    } else if (payload.detail && typeof payload.detail.body === "string" && payload.detail.body.trim()) {
      payload.detail = {
        body: String(payload.detail.body).replace(/\r\n/g, "\n"),
        legal: fv.delete(),
        trap: fv.delete(),
        precedent: fv.delete()
      };
    }
    return db
      .collection(COLLECTION)
      .doc(payload.id)
      .set(
        Object.assign({}, payload, {
          updatedAt: fv.serverTimestamp()
        }),
        { merge: true }
      )
      .then(function () {
        upsertRemoteQuestionLocal(question, opts);
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

  window.saveTermEntryToFirestore = function (entry, docId) {
    var db = getDb();
    if (!db) return Promise.reject(new Error(ERR_NO_FIRESTORE));
    var payload = {
      term: String(entry && entry.term ? entry.term : "").trim(),
      aliases: Array.isArray(entry && entry.aliases) ? entry.aliases : [],
      definition: String(entry && entry.definition ? entry.definition : "").trim(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    if (!payload.term || !payload.definition) {
      return Promise.reject(new Error("용어와 정의를 입력해 주세요."));
    }
    var id = String(docId || "").trim() || normalizeDocId(payload.term, "term");
    return db.collection("hanlaw_dict_terms").doc(id).set(payload, { merge: true });
  };

  window.saveCaseEntryToFirestore = function (entry, docId) {
    var db = getDb();
    if (!db) return Promise.reject(new Error(ERR_NO_FIRESTORE));
    var payload = {
      citation: String(entry && entry.citation ? entry.citation : "").trim(),
      title: String(entry && entry.title ? entry.title : "").trim(),
      facts: String(entry && entry.facts ? entry.facts : "").trim(),
      issues: String(entry && entry.issues ? entry.issues : "").trim(),
      judgment: String(entry && entry.judgment ? entry.judgment : "").trim(),
      searchKeys: Array.isArray(entry && entry.searchKeys) ? entry.searchKeys : [],
      topicKeywords: Array.isArray(entry && entry.topicKeywords) ? entry.topicKeywords : [],
      casenoteUrl: String(entry && entry.casenoteUrl ? entry.casenoteUrl : "").trim(),
      jisCntntsSrno: String(entry && entry.jisCntntsSrno ? entry.jisCntntsSrno : "").trim(),
      scourtPortalUrl: String(entry && entry.scourtPortalUrl ? entry.scourtPortalUrl : "").trim(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    if (!payload.citation) {
      return Promise.reject(new Error("판례 표기(citation)를 입력해 주세요."));
    }
    var id = String(docId || "").trim() || normalizeDocId(payload.citation, "case");
    return db.collection("hanlaw_dict_cases").doc(id).set(payload, { merge: true });
  };

  window.saveStatuteEntryToFirestore = function (entry, docId) {
    var db = getDb();
    if (!db) return Promise.reject(new Error(ERR_NO_FIRESTORE));
    var statuteKey = String(entry && entry.statuteKey ? entry.statuteKey : "").trim();
    if (!statuteKey) {
      return Promise.reject(new Error("조문 식별자(statuteKey)가 없습니다."));
    }
    var payload = {
      statuteKey: statuteKey,
      heading: String(entry && entry.heading != null ? entry.heading : "").trim(),
      body: String(entry && entry.body != null ? entry.body : "").trim(),
      sourceNote: String(entry && entry.sourceNote != null ? entry.sourceNote : "").trim(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    var id = String(docId || "").trim() || normalizeDocId(statuteKey, "statute");

    function finalizeStatuteRemoteCache(resolvedDocId) {
      if (typeof window.upsertLegalStatuteRemote !== "function") return;
      window.upsertLegalStatuteRemote({
        key: statuteKey,
        _docId: String(resolvedDocId || "").trim(),
        heading: payload.heading,
        body: payload.body,
        sourceNote: payload.sourceNote
      });
    }

    function directWrite() {
      return db
        .collection("hanlaw_dict_statutes")
        .doc(id)
        .set(payload, { merge: true })
        .then(function () {
          finalizeStatuteRemoteCache(id);
          return { ok: true, id: id };
        });
    }

    if (
      typeof firebase !== "undefined" &&
      firebase.apps &&
      firebase.apps.length &&
      firebase.functions
    ) {
      var region = window.FIREBASE_FUNCTIONS_REGION || "asia-northeast3";
      var fn = firebase.app().functions(region).httpsCallable("adminSaveDictStatute");
      return fn({
        entry: {
          statuteKey: statuteKey,
          heading: entry && entry.heading != null ? entry.heading : "",
          body: entry && entry.body != null ? entry.body : "",
          sourceNote: entry && entry.sourceNote != null ? entry.sourceNote : ""
        },
        docId: String(docId || "").trim()
      })
        .then(function (res) {
          var d = res && res.data;
          if (d && d.ok) {
            finalizeStatuteRemoteCache(d.id || id);
            return d;
          }
          return Promise.reject(new Error((d && d.message) || "조문 저장에 실패했습니다."));
        })
        .catch(function (err) {
          var code = err && err.code;
          var msg = String((err && err.message) || "");
          if (code === "functions/not-found" || /not\s*found|NOT_FOUND/i.test(msg)) {
            return directWrite();
          }
          return Promise.reject(err);
        });
    }
    return directWrite();
  };

  function getCallable(name) {
    if (typeof firebase === "undefined" || !firebase.functions) {
      throw new Error("Firebase Functions를 사용할 수 없습니다.");
    }
    return firebase.app().functions("asia-northeast3").httpsCallable(name);
  }

  window.adminStageQuizBatch = function (rows) {
    return getCallable("adminStageQuizBatch")({ rows: Array.isArray(rows) ? rows : [] }).then(function (r) {
      return r.data || {};
    });
  };
  window.adminListQuizStaging = function (status, limit) {
    return getCallable("adminListQuizStaging")({ status: status || "reviewing", limit: limit || 50 }).then(
      function (r) {
        return r.data || {};
      }
    );
  };
  window.adminGetQuizStaging = function (id) {
    return getCallable("adminGetQuizStaging")({ id: id }).then(function (r) {
      return r.data || {};
    });
  };
  window.adminUpdateQuizStaging = function (id, version, payload) {
    return getCallable("adminUpdateQuizStaging")({
      id: id,
      version: version,
      payload: payload
    }).then(function (r) {
      return r.data || {};
    });
  };
  window.adminApproveQuizStaging = function (id, version) {
    return getCallable("adminApproveQuizStaging")({ id: id, version: version }).then(function (r) {
      return r.data || {};
    });
  };
  window.adminRejectQuizStaging = function (id, version, reason) {
    return getCallable("adminRejectQuizStaging")({ id: id, version: version, reason: reason || "" }).then(
      function (r) {
        return r.data || {};
      }
    );
  };

  window.adminListDictStaging = function (entityType, status, limit) {
    return getCallable("adminListDictStaging")({
      entityType: entityType || "term",
      status: status || "reviewing",
      limit: limit || 50
    }).then(function (r) {
      return r.data || {};
    });
  };
  window.adminGetDictStaging = function (entityType, id) {
    return getCallable("adminGetDictStaging")({ entityType: entityType || "term", id: id }).then(function (r) {
      return r.data || {};
    });
  };
  window.adminUpdateDictStaging = function (entityType, id, version, payload) {
    return getCallable("adminUpdateDictStaging")({
      entityType: entityType || "term",
      id: id,
      version: version,
      payload: payload
    }).then(function (r) {
      return r.data || {};
    });
  };
  window.adminApproveDictStaging = function (entityType, id, version) {
    return getCallable("adminApproveDictStaging")({
      entityType: entityType || "term",
      id: id,
      version: version
    }).then(function (r) {
      return r.data || {};
    });
  };
  window.adminRejectDictStaging = function (entityType, id, version, reason) {
    return getCallable("adminRejectDictStaging")({
      entityType: entityType || "term",
      id: id,
      version: version,
      reason: reason || ""
    }).then(function (r) {
      return r.data || {};
    });
  };

  window.adminQuoteAddStaging = function (text) {
    return getCallable("adminQuoteAddStaging")({ text: text || "" }).then(function (r) {
      return r.data || {};
    });
  };
  window.adminQuoteGenerateAi = function (count) {
    return getCallable("adminQuoteGenerateAi")({ count: count || 8 }).then(function (r) {
      return r.data || {};
    });
  };
  window.adminQuoteListStaging = function () {
    return getCallable("adminQuoteListStaging")({}).then(function (r) {
      return r.data || {};
    });
  };
  window.adminQuoteApprove = function (id) {
    return getCallable("adminQuoteApprove")({ id: id }).then(function (r) {
      return r.data || {};
    });
  };
  window.adminQuoteReject = function (id) {
    return getCallable("adminQuoteReject")({ id: id }).then(function (r) {
      return r.data || {};
    });
  };
  window.adminQuoteGetPublished = function () {
    return getCallable("adminQuoteGetPublished")({}).then(function (r) {
      return r.data || {};
    });
  };
  window.adminQuoteReplacePublished = function (quotes) {
    return getCallable("adminQuoteReplacePublished")({ quotes: quotes }).then(function (r) {
      return r.data || {};
    });
  };

  function subscribePublishedHeaderQuotes() {
    var db = getDb();
    if (!db) return;
    try {
      window.HANLAW_REMOTE_QUOTES = window.HANLAW_REMOTE_QUOTES || [];
      db.doc("hanlaw_header_quotes/published").onSnapshot(
        function (snap) {
          var d = snap.data();
          var arr = d && Array.isArray(d.quotes) ? d.quotes : [];
          window.HANLAW_REMOTE_QUOTES = arr
            .map(function (x) {
              return String(x || "").trim();
            })
            .filter(Boolean)
            .slice(0, 200);
          try {
            window.dispatchEvent(new CustomEvent("hanlaw-remote-quotes-updated"));
          } catch (e) {}
        },
        function () {
          window.HANLAW_REMOTE_QUOTES = window.HANLAW_REMOTE_QUOTES || [];
        }
      );
    } catch (e) {
      console.warn("hanlaw_header_quotes 구독:", e);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", subscribePublishedHeaderQuotes);
  } else {
    subscribePublishedHeaderQuotes();
  }
})();
