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
      if (r.hidden === true) {
        for (var j = merged.length - 1; j >= 0; j--) {
          if (merged[j] && merged[j].id === r.id) merged.splice(j, 1);
        }
        return;
      }
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
    if (typeof window.refreshExamCatalogFromQuestionBank === "function") {
      window.refreshExamCatalogFromQuestionBank();
    }
    if (typeof window.revalidateStudyScopeAgainstCatalog === "function") {
      window.revalidateStudyScopeAgainstCatalog();
    }
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

  /** 용어 표제어 → hanlaw_dict_terms 문서 ID(saveTermEntryToFirestore와 동일) */
  window.normalizeHanlawTermDocId = function (raw) {
    return normalizeDocId(raw, "term");
  };

  var GUEST_STRIP_KEYS = [
    "explanation",
    "explanationBasic",
    "detail",
    "tags",
    "explainVerBasic",
    "explainVerDetail"
  ];

  function stripGuestExplainFields(q) {
    if (!q || typeof q !== "object") return q;
    var o = {};
    Object.keys(q).forEach(function (k) {
      if (GUEST_STRIP_KEYS.indexOf(k) >= 0) return;
      o[k] = q[k];
    });
    return o;
  }

  function stripGuestExplainFromBank() {
    var bank = window.QUESTION_BANK || [];
    window.QUESTION_BANK = bank.map(stripGuestExplainFields);
    if (typeof window.refreshExamCatalogFromQuestionBank === "function") {
      window.refreshExamCatalogFromQuestionBank();
    }
    if (typeof window.revalidateStudyScopeAgainstCatalog === "function") {
      window.revalidateStudyScopeAgainstCatalog();
    }
    window.dispatchEvent(new CustomEvent("question-bank-updated"));
  }

  // 마지막으로 로드한 모드: null(미로드) | "paid"(직접 read·detail 포함) | "member"(Callable·detail 제거)
  var lastLoadedQuestionMode = null;

  function isPaidViewer() {
    var m = window.APP_MEMBERSHIP;
    return !!(m && (m.tier === "paid" || m.isAdmin));
  }

  /** 유료·관리자: hanlaw_questions 직접 read(상세해설 detail 포함) */
  function loadPaidQuestionsDirect(db) {
    return db
      .collection(COLLECTION)
      .get()
      .then(function (snap) {
        window.QUESTION_BANK_REMOTE = snap.docs.map(docToQuestion);
        lastLoadedQuestionMode = "paid";
        mergeBanks();
      })
      .catch(function (err) {
        console.warn("Firestore 문항 로드 실패:", err);
        // 저장 직후 재조회 실패 시 원격 캐시를 비우면 방금 반영한 수정이 사라짐 → 기존 REMOTE 유지
        mergeBanks();
      });
  }

  /** 무료(로그인) 회원: getMemberQuestionBank Callable(기본 해설 포함, 상세해설 detail 제거) */
  function loadMemberQuestionsCallable() {
    if (typeof firebase === "undefined" || !firebase.app) {
      window.QUESTION_BANK_REMOTE = [];
      lastLoadedQuestionMode = "member";
      mergeBanks();
      return Promise.resolve();
    }
    var region = (window.FIREBASE_CONFIG && window.FIREBASE_CONFIG.functionsRegion) || "asia-northeast3";
    var fn = firebase.app().functions(region).httpsCallable("getMemberQuestionBank");
    return fn({})
      .then(function (res) {
        var list = res && res.data && Array.isArray(res.data.questions) ? res.data.questions : [];
        window.QUESTION_BANK_REMOTE = list;
        lastLoadedQuestionMode = "member";
        mergeBanks();
      })
      .catch(function (err) {
        console.warn("회원 문항 로드 실패:", err);
        mergeBanks();
      });
  }

  window.loadRemoteQuestions = function () {
    var db = getDb();
    if (!db) {
      window.QUESTION_BANK_REMOTE = [];
      mergeBanks();
      return Promise.resolve();
    }
    if (isPaidViewer()) {
      return loadPaidQuestionsDirect(db);
    }
    return loadMemberQuestionsCallable();
  };

  // 로그인 직후엔 멤버십이 아직 확정되지 않아 무료 경로로 로드될 수 있다.
  // 유료/관리자 권한이 확정되면 상세해설 포함 본을 다시 받아온다(권한 강등 시도 반대).
  window.addEventListener("membership-updated", function () {
    // 실제 로그인 계정에서만 동작(게스트/익명·로그아웃 시에는 게스트 흐름이 별도 처리)
    var u = typeof window.getHanlawUser === "function" ? window.getHanlawUser() : null;
    if (!(u && u.email)) {
      lastLoadedQuestionMode = null;
      return;
    }
    if (lastLoadedQuestionMode == null) return; // 아직 최초 로드 전 → showApp 흐름이 처리
    var wantPaid = isPaidViewer();
    if (wantPaid && lastLoadedQuestionMode !== "paid") {
      window.loadRemoteQuestions();
    } else if (!wantPaid && lastLoadedQuestionMode === "paid") {
      window.loadRemoteQuestions();
    }
  });

  /** 비회원: Cloud Function으로 전체 문항(정답만, 해설 제외) 로드 */
  window.loadGuestQuestions = function () {
    if (typeof firebase === "undefined" || !firebase.app) {
      window.QUESTION_BANK_REMOTE = [];
      mergeBanks();
      stripGuestExplainFromBank();
      return Promise.resolve();
    }
    var region = (window.FIREBASE_CONFIG && window.FIREBASE_CONFIG.functionsRegion) || "asia-northeast3";
    var fn = firebase.app().functions(region).httpsCallable("getGuestQuestionBank");
    return fn({})
      .then(function (res) {
        var list = res && res.data && Array.isArray(res.data.questions) ? res.data.questions : [];
        window.QUESTION_BANK_REMOTE = list.map(stripGuestExplainFields);
        mergeBanks();
        stripGuestExplainFromBank();
      })
      .catch(function (err) {
        console.warn("게스트 문항 로드 실패:", err);
        mergeBanks();
        stripGuestExplainFromBank();
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

  function normalizeExplainFingerprintText(s) {
    return String(s || "")
      .replace(/\r\n/g, "\n")
      .replace(/\s+/g, " ")
      .trim();
  }

  function basicExplainForFingerprint(q) {
    if (!q) return "";
    if (q.explanationBasic != null && String(q.explanationBasic).trim() !== "") {
      return q.explanationBasic;
    }
    return q.explanation != null ? q.explanation : "";
  }

  function detailExplainFingerprint(q) {
    if (!q) return "";
    var parts = [];
    var exp = normalizeExplainFingerprintText(q.explanation);
    var bas = normalizeExplainFingerprintText(q.explanationBasic);
    if (exp && (!bas || exp !== bas)) parts.push(exp);
    var d = q.detail;
    if (!d) return parts.join("\n");
    if (typeof d === "string") {
      parts.push(normalizeExplainFingerprintText(d));
      return parts.join("\n");
    }
    if (d.body != null && String(d.body).trim()) {
      parts.push(normalizeExplainFingerprintText(d.body));
    } else {
      ["legal", "trap", "precedent", "memoTip"].forEach(function (k) {
        if (d[k] != null && String(d[k]).trim()) {
          parts.push(normalizeExplainFingerprintText(d[k]));
        }
      });
    }
    return parts.join("\n");
  }

  function readExplainVersion(q, field) {
    var v = q && q[field];
    return typeof v === "number" && isFinite(v) && v >= 1 ? Math.floor(v) : 1;
  }

  function findQuestionInBank(id) {
    var want = String(id == null ? "" : id).trim();
    if (!want) return null;
    var bank = window.QUESTION_BANK || [];
    for (var i = 0; i < bank.length; i++) {
      if (bank[i] && String(bank[i].id).trim() === want) return bank[i];
    }
    return null;
  }

  /** 해설 본문 변경 시 explainVerBasic / explainVerDetail 을 올립니다. */
  function applyExplainVersionsOnSave(next, prev) {
    var out = Object.assign({}, next);
    var verBasic = 1;
    var verDetail = 1;
    if (prev) {
      verBasic = readExplainVersion(prev, "explainVerBasic");
      verDetail = readExplainVersion(prev, "explainVerDetail");
      if (
        normalizeExplainFingerprintText(basicExplainForFingerprint(prev)) !==
        normalizeExplainFingerprintText(basicExplainForFingerprint(out))
      ) {
        verBasic += 1;
      }
      if (detailExplainFingerprint(prev) !== detailExplainFingerprint(out)) {
        verDetail += 1;
      }
    }
    out.explainVerBasic = verBasic;
    out.explainVerDetail = verDetail;
    return out;
  }

  window.getHanlawExplainVersions = function (q) {
    return {
      basic: readExplainVersion(q, "explainVerBasic"),
      detail: readExplainVersion(q, "explainVerDetail")
    };
  };

  window.saveQuestionToFirestore = function (question, opts) {
    opts = opts || {};
    var db = getDb();
    if (!db) return Promise.reject(new Error(ERR_NO_FIRESTORE));
    var fv = firebase.firestore.FieldValue;
    var prev = findQuestionInBank(question && question.id);
    var versioned = applyExplainVersionsOnSave(question, prev);
    var payload = stripForFirestore(versioned);
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
        upsertRemoteQuestionLocal(versioned, opts);
        return window.loadRemoteQuestions();
      });
  };

  function commitBatch(db, chunk) {
    var batch = db.batch();
    chunk.forEach(function (q) {
      var prev = findQuestionInBank(q && q.id);
      var versioned = applyExplainVersionsOnSave(q, prev);
      var payload = stripForFirestore(versioned);
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

  window.softHideBundledQuestion = function (questionId) {
    var db = getDb();
    if (!db) return Promise.reject(new Error(ERR_NO_FIRESTORE));
    var qid = String(questionId || "").trim();
    if (!qid) return Promise.reject(new Error("숨김 처리할 퀴즈 ID가 없습니다."));
    var fv = firebase.firestore.FieldValue;
    return db
      .collection(COLLECTION)
      .doc(qid)
      .set(
        {
          id: qid,
          hidden: true,
          bundledShadow: true,
          updatedAt: fv.serverTimestamp()
        },
        { merge: true }
      )
      .then(function () {
        return window.loadRemoteQuestions();
      });
  };

  window.restoreHiddenBundledQuestions = function () {
    var db = getDb();
    if (!db) return Promise.reject(new Error(ERR_NO_FIRESTORE));
    return db
      .collection(COLLECTION)
      .where("bundledShadow", "==", true)
      .get()
      .then(function (snap) {
        if (!snap || snap.empty) return { total: 0, restored: 0, failed: 0 };
        var refs = snap.docs
          .filter(function (d) {
            var x = d.data() || {};
            return x.hidden === true;
          })
          .map(function (d) {
            return d.ref;
          });
        if (!refs.length) return { total: 0, restored: 0, failed: 0 };
        var restored = 0;
        var failed = 0;
        var chain = Promise.resolve();
        refs.forEach(function (ref) {
          chain = chain.then(function () {
            return ref
              .delete()
              .then(function () {
                restored += 1;
              })
              .catch(function () {
                failed += 1;
                return null;
              });
          });
        });
        return chain.then(function () {
          return window.loadRemoteQuestions().then(function () {
            return { total: refs.length, restored: restored, failed: failed };
          });
        });
      });
  };

  window.restoreBundledQuestion = function (questionId) {
    var db = getDb();
    if (!db) return Promise.reject(new Error(ERR_NO_FIRESTORE));
    var qid = String(questionId || "").trim();
    if (!qid) return Promise.reject(new Error("복구할 퀴즈 ID가 없습니다."));
    return db
      .collection(COLLECTION)
      .doc(qid)
      .get()
      .then(function (snap) {
        if (!snap.exists) return { restored: 0 };
        var d = snap.data() || {};
        if (!(d.bundledShadow === true && d.hidden === true)) return { restored: 0 };
        return snap.ref.delete().then(function () {
          return { restored: 1 };
        });
      })
      .then(function (res) {
        return window.loadRemoteQuestions().then(function () {
          return res;
        });
      });
  };

  window.saveTermEntryToFirestore = function (entry, docId) {
    var db = getDb();
    if (!db) return Promise.reject(new Error(ERR_NO_FIRESTORE));
    function normalizeOxAnswer(v) {
      if (v === true || v === false) return v;
      var s = String(v == null ? "" : v).trim().toLowerCase();
      if (s === "o" || s === "true" || s === "참" || s === "1") return true;
      if (s === "x" || s === "false" || s === "거짓" || s === "0") return false;
      return null;
    }
    function sanitizeOxQuizzesBasic(input, maxItems) {
      var cap = typeof maxItems === "number" && maxItems > 0 ? Math.min(10, maxItems) : 3;
      if (!Array.isArray(input)) return [];
      var out = [];
      for (var i = 0; i < input.length; i++) {
        var row = input[i] || {};
        var statement = String(row.statement || "").trim().slice(0, 600);
        var answer = normalizeOxAnswer(row.answer);
        var explanation = String(row.explanation || "").trim().slice(0, 2000);
        var explanationBasic = String(
          row.explanationBasic == null ? explanation : row.explanationBasic
        )
          .trim()
          .slice(0, 2000);
        if (!statement || answer == null || !explanation) continue;
        out.push({
          statement: statement,
          answer: answer,
          explanation: explanation,
          explanationBasic: explanationBasic || explanation
        });
        if (out.length >= cap) break;
      }
      return out;
    }
    var payload = {
      term: String(entry && entry.term ? entry.term : "").trim(),
      aliases: Array.isArray(entry && entry.aliases) ? entry.aliases : [],
      definition: String(entry && entry.definition ? entry.definition : "").trim(),
      oxQuizzes: sanitizeOxQuizzesBasic(entry && entry.oxQuizzes, 3),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    if (!payload.term || !payload.definition) {
      return Promise.reject(new Error("용어와 정의를 입력해 주세요."));
    }
    var id = String(docId || "").trim() || normalizeDocId(payload.term, "term");
    return db.collection("hanlaw_dict_terms").doc(id).set(payload, { merge: true });
  };

  window.deleteTermEntryFromFirestore = function (docIdOrTerm, options) {
    var db = getDb();
    if (!db) return Promise.reject(new Error(ERR_NO_FIRESTORE));
    var id = String(docIdOrTerm || "").trim();
    if (!id) return Promise.reject(new Error("삭제할 용어 식별자가 없습니다."));
    if (id.indexOf("/") >= 0) return Promise.reject(new Error("잘못된 문서 ID입니다."));
    var opt = options && typeof options === "object" ? options : {};
    var resolvedId = opt.rawDocId ? id : normalizeDocId(id, "term");
    return db
      .collection("hanlaw_dict_terms")
      .doc(resolvedId)
      .delete()
      .then(function () {
        return window.loadRemoteQuestions();
      });
  };

  window.saveCaseEntryToFirestore = function (entry, docId) {
    var db = getDb();
    if (!db) return Promise.reject(new Error(ERR_NO_FIRESTORE));
    function normalizeOxAnswer(v) {
      if (v === true || v === false) return v;
      var s = String(v == null ? "" : v).trim().toLowerCase();
      if (s === "o" || s === "true" || s === "참" || s === "1") return true;
      if (s === "x" || s === "false" || s === "거짓" || s === "0") return false;
      return null;
    }
    function sanitizeOxQuizzes(input) {
      if (!Array.isArray(input)) return [];
      var out = [];
      for (var i = 0; i < input.length; i++) {
        var row = input[i] || {};
        var statement = String(row.statement || "").trim().slice(0, 600);
        var answer = normalizeOxAnswer(row.answer);
        var explanation = String(row.explanation || "").trim().slice(0, 2000);
        var explanationBasic = String(
          row.explanationBasic == null ? explanation : row.explanationBasic
        )
          .trim()
          .slice(0, 2000);
        if (!statement || answer == null || !explanation) continue;
        out.push({
          statement: statement,
          answer: answer,
          explanation: explanation,
          explanationBasic: explanationBasic || explanation
        });
        if (out.length >= 5) break;
      }
      return out;
    }
    var rawFacts = String(entry && entry.facts ? entry.facts : "").trim();
    var rawIssues = String(entry && entry.issues ? entry.issues : "").trim();
    var rawJudgment = String(entry && entry.judgment ? entry.judgment : "").trim();
    if (typeof window.normalizeCaseProseText === "function") {
      rawFacts = window.normalizeCaseProseText(rawFacts);
      rawIssues = window.normalizeCaseProseText(rawIssues, { preserveIssueList: true });
      rawJudgment = window.normalizeCaseProseText(rawJudgment);
    }
    var payload = {
      citation: String(entry && entry.citation ? entry.citation : "").trim(),
      title: String(entry && entry.title ? entry.title : "").trim(),
      facts: rawFacts,
      issues: rawIssues,
      judgment: rawJudgment,
      caseFullText: String(entry && entry.caseFullText ? entry.caseFullText : "").trim(),
      oxQuizzes: sanitizeOxQuizzes(entry && entry.oxQuizzes),
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

  window.deleteCaseEntryFromFirestore = function (docIdOrCitation, options) {
    var db = getDb();
    if (!db) return Promise.reject(new Error(ERR_NO_FIRESTORE));
    var id = String(docIdOrCitation || "").trim();
    if (!id) return Promise.reject(new Error("삭제할 판례 식별자가 없습니다."));
    if (id.indexOf("/") >= 0) return Promise.reject(new Error("잘못된 문서 ID입니다."));
    var opt = options && typeof options === "object" ? options : {};
    var resolvedId = opt.rawDocId ? id : normalizeDocId(id, "case");
    return db.collection("hanlaw_dict_cases").doc(resolvedId).delete();
  };

  window.softHideBundledCaseEntry = function (citation) {
    var db = getDb();
    if (!db) return Promise.reject(new Error(ERR_NO_FIRESTORE));
    var cit = String(citation || "").trim();
    if (!cit) return Promise.reject(new Error("숨김 처리할 판례 표기(citation)가 없습니다."));
    var id = normalizeDocId(cit, "case");
    return db
      .collection("hanlaw_dict_cases")
      .doc(id)
      .set(
        {
          citation: cit,
          hidden: true,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        },
        { merge: true }
      );
  };

  window.restoreHiddenBundledCases = function () {
    var db = getDb();
    if (!db) return Promise.reject(new Error(ERR_NO_FIRESTORE));
    return db
      .collection("hanlaw_dict_cases")
      .where("hidden", "==", true)
      .get()
      .then(function (snap) {
        if (!snap || snap.empty) return { total: 0, restored: 0, failed: 0 };
        var refs = snap.docs.map(function (d) {
          return d.ref;
        });
        var restored = 0;
        var failed = 0;
        var chain = Promise.resolve();
        refs.forEach(function (ref) {
          chain = chain.then(function () {
            return ref
              .set(
                {
                  hidden: false,
                  updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                },
                { merge: true }
              )
              .then(function () {
                restored += 1;
              })
              .catch(function () {
                failed += 1;
                return null;
              });
          });
        });
        return chain.then(function () {
          return { total: refs.length, restored: restored, failed: failed };
        });
      });
  };

  window.saveStatuteEntryToFirestore = function (entry, docId) {
    var db = getDb();
    if (!db) return Promise.reject(new Error(ERR_NO_FIRESTORE));
    var statuteKey = String(entry && entry.statuteKey ? entry.statuteKey : "").trim();
    if (!statuteKey) {
      return Promise.reject(new Error("조문 식별자(statuteKey)가 없습니다."));
    }
    function normalizeOxAnswerSt(v) {
      if (v === true || v === false) return v;
      var s = String(v == null ? "" : v).trim().toLowerCase();
      if (s === "o" || s === "true" || s === "참" || s === "1") return true;
      if (s === "x" || s === "false" || s === "거짓" || s === "0") return false;
      return null;
    }
    function sanitizeOxQuizzesStat(input, maxItems) {
      var cap = typeof maxItems === "number" && maxItems > 0 ? Math.min(10, maxItems) : 3;
      if (!Array.isArray(input)) return [];
      var out = [];
      for (var i = 0; i < input.length; i++) {
        var row = input[i] || {};
        var statement = String(row.statement || "").trim().slice(0, 600);
        var answer = normalizeOxAnswerSt(row.answer);
        var explanation = String(row.explanation || "").trim().slice(0, 2000);
        var explanationBasic = String(
          row.explanationBasic == null ? explanation : row.explanationBasic
        )
          .trim()
          .slice(0, 2000);
        if (!statement || answer == null || !explanation) continue;
        out.push({
          statement: statement,
          answer: answer,
          explanation: explanation,
          explanationBasic: explanationBasic || explanation
        });
        if (out.length >= cap) break;
      }
      return out;
    }
    var payload = {
      statuteKey: statuteKey,
      heading: String(entry && entry.heading != null ? entry.heading : "").trim(),
      body: String(entry && entry.body != null ? entry.body : "").trim(),
      appliedRules: String(entry && entry.appliedRules != null ? entry.appliedRules : "").trim(),
      subordinateRules: String(entry && entry.subordinateRules != null ? entry.subordinateRules : "").trim(),
      examPoint: String(entry && entry.examPoint != null ? entry.examPoint : "").trim(),
      sourceNote: String(entry && entry.sourceNote != null ? entry.sourceNote : "").trim(),
      oxQuizzes: sanitizeOxQuizzesStat(entry && entry.oxQuizzes, 3),
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
        appliedRules: payload.appliedRules,
        subordinateRules: payload.subordinateRules,
        examPoint: payload.examPoint,
        sourceNote: payload.sourceNote,
        oxQuizzes: payload.oxQuizzes
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
          appliedRules: entry && entry.appliedRules != null ? entry.appliedRules : "",
          subordinateRules: entry && entry.subordinateRules != null ? entry.subordinateRules : "",
          examPoint: entry && entry.examPoint != null ? entry.examPoint : "",
          sourceNote: entry && entry.sourceNote != null ? entry.sourceNote : "",
          oxQuizzes: entry && entry.oxQuizzes != null ? entry.oxQuizzes : []
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

  window.deleteStatuteEntryFromFirestore = function (docIdOrKey, options) {
    var db = getDb();
    if (!db) return Promise.reject(new Error(ERR_NO_FIRESTORE));
    var id = String(docIdOrKey || "").trim();
    if (!id) return Promise.reject(new Error("삭제할 조문 식별자가 없습니다."));
    if (id.indexOf("/") >= 0) return Promise.reject(new Error("잘못된 문서 ID입니다."));
    var opt = options && typeof options === "object" ? options : {};
    var resolvedId = opt.rawDocId ? id : normalizeDocId(id, "statute");
    return db.collection("hanlaw_dict_statutes").doc(resolvedId).delete();
  };

  function getCallable(name) {
    if (typeof firebase === "undefined" || !firebase.functions) {
      throw new Error("Firebase Functions를 사용할 수 없습니다.");
    }
    return firebase.app().functions("asia-northeast3").httpsCallable(name);
  }

  /** 관리자 전용: 조문 본문 기반 OX 퀴즈 1~3개 초안 (Gemini) */
  window.generateDictStatuteOxQuizzes = function (opts) {
    opts = opts || {};
    return getCallable("generateDictStatuteOxQuizzes")({
      statuteKey: opts.statuteKey,
      heading: opts.heading,
      body: opts.body
    }).then(function (r) {
      return r.data || {};
    });
  };

  /** 관리자 전용: 국가법령 Open API에서 판결문 전문 가져오기 */
  window.adminFetchCasePrecedentOpenApi = function (opts) {
    opts = opts || {};
    return getCallable("adminFetchCasePrecedentOpenApi")({
      citation: opts.citation
    }).then(function (r) {
      return r.data || {};
    });
  };

  /** 관리자 전용: Open API 판결 전문 → Gemini 요약 → 판례사전 검수 대기 */
  window.adminGenerateCaseDictFromOpenApi = function (opts) {
    opts = opts || {};
    return getCallable("adminGenerateCaseDictFromOpenApi")({
      citation: opts.citation || opts.tag,
      caseFullText: opts.caseFullText,
      forceRegenerate: opts.forceRegenerate === true
    }).then(function (r) {
      return r.data || {};
    });
  };

  /** 관리자 전용: 국가법령 Open API에서 조문 원문만 가져오기 */
  window.adminFetchStatuteArticleOpenApi = function (opts) {
    opts = opts || {};
    return getCallable("adminFetchStatuteArticleOpenApi")({
      statuteKey: opts.statuteKey
    }).then(function (r) {
      return r.data || {};
    });
  };

  /** 관리자 전용: law.go.kr Open API 연결 확인 */
  window.adminVerifyLawGoKrApi = function () {
    return getCallable("adminVerifyLawGoKrApi")({}).then(function (r) {
      return r.data || {};
    });
  };

  /** 로그인 회원: 국가법령 Open API에서 조문 원문 가져오기(비회원·관리자 전용 API와 분리) */
  window.fetchStatuteArticleForUser = function (opts) {
    opts = opts || {};
    return getCallable("fetchStatuteArticleForUser")({
      statuteKey: opts.statuteKey
    }).then(function (r) {
      return r.data || {};
    });
  };

  /** 로그인 회원: 검색어로 법령·조문 후보 유추(국가법령 Open API) */
  window.suggestStatuteArticlesForUser = function (opts) {
    opts = opts || {};
    return getCallable("suggestStatuteArticlesForUser")({
      query: opts.query,
      maxResults: opts.maxResults
    }).then(function (r) {
      return r.data || {};
    });
  };

  /** 관리자 전용: 조문 키를 기준으로 조문 본문·준용·하위법령 설명 초안 생성 */
  window.generateDictStatuteFromWeb = function (opts) {
    opts = opts || {};
    return getCallable("generateDictStatuteFromWeb")({
      statuteKey: opts.statuteKey,
      headingHint: opts.headingHint,
      bodyHint: opts.bodyHint
    }).then(function (r) {
      return r.data || {};
    });
  };

  window.adminStageQuizBatch = function (rows, opts) {
    opts = opts || {};
    return getCallable("adminStageQuizBatch")({
      rows: Array.isArray(rows) ? rows : [],
      enrichWhenIncomplete: opts.enrichWhenIncomplete === true,
      enrichPrompt: String(opts.enrichPrompt || "").trim()
    }).then(function (r) {
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

  window.adminStageDictBatch = function (entityType, rows) {
    return getCallable("adminStageDictBatch")({
      entityType: entityType || "term",
      rows: Array.isArray(rows) ? rows : []
    }).then(function (r) {
      return r.data || {};
    });
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
  window.adminQuoteApproveAllPending = function () {
    return getCallable("adminQuoteApproveAllPending")({}).then(function (r) {
      return r.data || {};
    });
  };
  window.adminQuoteReject = function (id) {
    return getCallable("adminQuoteReject")({ id: id }).then(function (r) {
      return r.data || {};
    });
  };
  window.adminQuoteUpdateStaging = function (id, text) {
    return getCallable("adminQuoteUpdateStaging")({ id: id, text: text || "" }).then(function (r) {
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
