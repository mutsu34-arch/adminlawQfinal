(function () {
  var TICKETS = "hanlaw_tickets";
  var NOTIFS = "hanlaw_notifications";

  function db() {
    try {
      return firebase.firestore();
    } catch (e) {
      return null;
    }
  }

  function storage() {
    try {
      return firebase.storage();
    } catch (e) {
      return null;
    }
  }

  function validateImageFile(file) {
    if (!file || !file.type || file.type.indexOf("image/") !== 0) return "이미지 파일만 첨부할 수 있습니다.";
    if (file.size > 3 * 1024 * 1024) return "이미지당 최대 3MB까지 허용됩니다: " + file.name;
    return null;
  }

  window.uploadTicketImages = function (userId, ticketId, files) {
    var st = storage();
    if (!st) return Promise.reject(new Error("Storage를 사용할 수 없습니다."));
    var list = [].slice.call(files || [], 0, 3);
    var tasks = [];
    for (var i = 0; i < list.length; i++) {
      var file = list[i];
      if (!file || !file.size) continue;
      var err = validateImageFile(file);
      if (err) return Promise.reject(new Error(err));
      var safe = String(file.name || "img").replace(/[^\w.-]/g, "_").slice(0, 80);
      var path = "ticket_images/" + userId + "/" + ticketId + "/" + i + "_" + safe;
      var ref = st.ref(path);
      tasks.push(
        ref.put(file, { contentType: file.type }).then(function (snap) {
          return snap.ref.getDownloadURL();
        })
      );
    }
    return Promise.all(tasks);
  };

  /**
   * 엘리(AI) 질문 첨부 이미지 업로드 — 홍보 인증 티켓과 동일 검증(이미지·최대 3장·각 3MB).
   * Storage 경로: quiz_ai_images/{userId}/{batchId}/...
   */
  window.uploadQuizAiAskImages = function (userId, batchId, files) {
    var st = storage();
    if (!st) return Promise.reject(new Error("Storage를 사용할 수 없습니다."));
    var list = [].slice.call(files || [], 0, 3);
    var tasks = [];
    for (var i = 0; i < list.length; i++) {
      var file = list[i];
      if (!file || !file.size) continue;
      var err = validateImageFile(file);
      if (err) return Promise.reject(new Error(err));
      var safe = String(file.name || "img").replace(/[^\w.-]/g, "_").slice(0, 80);
      var path = "quiz_ai_images/" + userId + "/" + batchId + "/" + i + "_" + safe;
      var ref = st.ref(path);
      tasks.push(
        ref.put(file, { contentType: file.type }).then(function (snap) {
          return snap.ref.getDownloadURL();
        })
      );
    }
    return Promise.all(tasks);
  };

  window.createSupportTicket = function (opts) {
    var user = typeof window.getHanlawUser === "function" ? window.getHanlawUser() : null;
    if (!user) return Promise.reject(new Error("로그인 후 이용할 수 있습니다."));
    var authUser = null;
    try {
      if (typeof firebase !== "undefined" && firebase.auth) {
        authUser = firebase.auth().currentUser;
      }
    } catch (e) {}
    if (!authUser) {
      return Promise.reject(
        new Error(
          "Firebase에 실제로 로그인된 상태가 아닙니다. 목업(테스트) 로그인만 사용 중이면 티켓을 저장할 수 없습니다. 이메일·Google 등으로 로그인한 뒤 다시 시도해 주세요."
        )
      );
    }
    if (authUser.uid !== user.uid) {
      user = authUser;
    }
    var d = db();
    if (!d) return Promise.reject(new Error("Firestore를 사용할 수 없습니다."));
    var msg = (opts.message || "").trim();
    if (!msg) return Promise.reject(new Error("내용을 입력하세요."));
    if (msg.length > 8000) return Promise.reject(new Error("내용은 8000자 이하로 입력하세요."));
    var type = "report";
    if (opts.type === "question") type = "question";
    if (opts.type === "promotion") type = "promotion";
    if (opts.type === "suggestion") type = "suggestion";
    var ticketRef = d.collection(TICKETS).doc();
    var ticketId = ticketRef.id;
    var files = opts.files || [];
    var links = Array.isArray(opts.links) ? opts.links : [];
    var linkUrls = links
      .map(function (u) { return String(u || "").trim(); })
      .filter(Boolean)
      .slice(0, 8);
    var qc = opts.quizContext;
    var quizContextClean = null;
    if (qc && typeof qc === "object") {
      quizContextClean = {};
      if (qc.questionId != null) quizContextClean.questionId = qc.questionId;
      if (qc.statement != null) quizContextClean.statement = qc.statement;
      if (qc.topic != null) quizContextClean.topic = qc.topic;
      if (qc.exam != null) quizContextClean.exam = qc.exam;
      if (qc.year != null) quizContextClean.year = qc.year;
      if (qc.meta != null) quizContextClean.meta = qc.meta;
      if (!Object.keys(quizContextClean).length) quizContextClean = null;
    }

    var userNickname =
      typeof window.getHanlawNickname === "function" ? String(window.getHanlawNickname() || "").trim() : "";

    return window
      .uploadTicketImages(authUser.uid, ticketId, files)
      .then(function (urls) {
        var doc = {
          id: ticketId,
          userId: authUser.uid,
          userEmail: authUser.email || "",
          userNickname: userNickname || null,
          type: type,
          message: msg,
          imageUrls: urls,
          linkUrls: linkUrls,
          quizContext: quizContextClean,
          status: "pending",
          aiDraft: null,
          adminReply: null,
          reviewedBy: null,
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };
        if (type === "question") {
          doc.qaAllowFutureCommunity = opts.qaAllowFutureCommunity === true;
        }
        return ticketRef.set(doc);
      })
      .then(function () {
        window.dispatchEvent(
          new CustomEvent("support-ticket-created", { detail: { ticketId: ticketId } })
        );
        return ticketId;
      });
  };

  /**
   * 홍보 티켓: AI 초안 전체(combined) + 사용자 발송용 승인/불승인 본문(레이블 없음).
   */
  function buildPromotionDraftParts(ticket) {
    var nick =
      ticket.userNickname && String(ticket.userNickname).trim()
        ? String(ticket.userNickname).trim()
        : "";
    var call = nick ? nick + "님" : "회원님";
    var msg = String(ticket.message || "").trim();
    var links = Array.isArray(ticket.linkUrls) ? ticket.linkUrls.filter(Boolean) : [];
    var linkBlock =
      links.length > 0
        ? links.map(function (u, i) {
            return (i + 1) + ") " + u;
          }).join("\n")
        : "(제출된 링크 없음)";
    var foot =
      "\n\n──────── 참고: 사용자 제출 ────────\n" +
      (msg || "(내용 없음)") +
      "\n\n제출 링크:\n" +
      linkBlock +
      "\n\n실서비스에서는 서버에서 Google Gemini를 호출하고, js/ai-config.js 의 AI_DRAFT_ENDPOINT 에 HTTPS URL을 넣으면 이 데모 대신 생성 초안을 받을 수 있습니다.";

    var approveLabeled =
      "【승인·감사 쪽 예시】 (공개 홍보 글이 분명하고 인증 기준을 충족할 때)\n\n" +
      call +
      ", 안녕하세요.\n\n" +
      "제출해 주신 홍보 활동을 확인했습니다. 앱을 알려 주시느라 시간과 노력을 들여 주셔서 진심으로 감사합니다.\n\n" +
      "앞으로도 열심히 학습하시어 목표하시는 결과를 이루시길 응원합니다.\n\n" +
      "— 행정법Q 드림";

    var rejectLabeled =
      "【보완·포인트 미지급 쪽 예시】 (기준 미달·확인 불가·허위 의심 등으로 이번에는 지급이 어려울 때)\n\n" +
      call +
      ", 안녕하세요.\n\n" +
      "홍보 인증을 검토한 결과, 안내드린 기준에 맞지 않아 이번에는 포인트 지급이 어렵습니다. " +
      "(이 줄 아래에 구체적 사유를 적어 주세요. 예: 공개 게시글 링크가 없거나 접속이 되지 않음, 앱 이름·서비스 소개가 드러나지 않음, 타인 글 도용 의심 등)\n\n" +
      "아래 사항을 보완하신 뒤 다시 신청해 주시면 재검토하겠습니다.\n" +
      "· (보완 요청 1)\n" +
      "· (보완 요청 2)\n\n" +
      "앞으로도 공부에 힘쓰시어 좋은 결과 얻으시길 바랍니다.\n\n" +
      "— 행정법Q 드림";

    var approveReply =
      call +
      ", 안녕하세요.\n\n" +
      "제출해 주신 홍보 활동을 확인했습니다. 앱을 알려 주시느라 시간과 노력을 들여 주셔서 진심으로 감사합니다.\n\n" +
      "앞으로도 열심히 학습하시어 목표하시는 결과를 이루시길 응원합니다.\n\n" +
      "— 행정법Q 드림";

    var rejectReply =
      call +
      ", 안녕하세요.\n\n" +
      "홍보 인증을 검토한 결과, 안내드린 기준에 맞지 않아 이번에는 포인트 지급이 어렵습니다. " +
      "(이 줄 아래에 구체적 사유를 적어 주세요. 예: 공개 게시글 링크가 없거나 접속이 되지 않음, 앱 이름·서비스 소개가 드러나지 않음, 타인 글 도용 의심 등)\n\n" +
      "아래 사항을 보완하신 뒤 다시 신청해 주시면 재검토하겠습니다.\n" +
      "· (보완 요청 1)\n" +
      "· (보완 요청 2)\n\n" +
      "앞으로도 공부에 힘쓰시어 좋은 결과 얻으시길 바랍니다.\n\n" +
      "— 행정법Q 드림";

    var combinedDraft =
      "[데모 초안] 홍보 인증 신청에 대한 관리자 회신 초안입니다. (질문 답변이 아니라, 인증 결과를 안내하는 톤입니다.)\n\n" +
      "아래 「승인」「불승인·보완」안을 참고하거나, 상단 버튼으로 최종 답변란에 바로 넣은 뒤 수정해 주세요.\n\n" +
      approveLabeled +
      "\n\n" +
      rejectLabeled +
      foot;

    return {
      approveReply: approveReply,
      rejectReply: rejectReply,
      combinedDraft: combinedDraft
    };
  }

  function buildPromotionDemoDraft(ticket) {
    return buildPromotionDraftParts(ticket).combinedDraft;
  }

  function normalizeTicketType(raw) {
    if (raw == null || raw === "") return "";
    return String(raw).trim().toLowerCase();
  }

  window.adminApproveSuggestionTicketCallable = function (ticketId, adminReply, adminEmail, adopted, points) {
    if (typeof firebase === "undefined" || !firebase.functions) {
      return Promise.reject(new Error("Cloud Functions를 사용할 수 없습니다."));
    }
    var region = window.FIREBASE_FUNCTIONS_REGION || "asia-northeast3";
    var fn = firebase.app().functions(region).httpsCallable("adminApproveSuggestionTicket");
    return fn({
      ticketId: String(ticketId || "").trim(),
      adminReply: String(adminReply || "").trim(),
      adminEmail: String(adminEmail || "").trim(),
      adopted: adopted === true,
      points: points
    }).then(function (res) {
      return res && res.data ? res.data : { ok: true };
    });
  };

  /**
   * type 필드 누락·대소문자·구버전 문서 대비.
   * 홍보 인증은 보통 quizContext(문항)가 비어 있고, 질문은 questionId/statement 등이 있는 경우가 많음.
   */
  function resolveTicketKindForDemo(ticket) {
    var t = normalizeTicketType(ticket && ticket.type);
    if (t === "promotion" || t === "report" || t === "question" || t === "suggestion") return t;
    var ctx = (ticket && ticket.quizContext) || {};
    var hasQuiz = !!(ctx.questionId || ctx.statement || ctx.topic || ctx.exam);
    if (hasQuiz) return "question";
    var links = ticket && Array.isArray(ticket.linkUrls) ? ticket.linkUrls.filter(Boolean).length : 0;
    if (links > 0) return "promotion";
    var msg = String((ticket && ticket.message) || "").trim();
    if (/홍보|인증|블로그|sns|게시|소개|앱\s*소개/i.test(msg) && !/오류\s*신고|버그|크래시/.test(msg)) {
      return "promotion";
    }
    return "report";
  }

  /**
   * 홍보 인증 티켓일 때만 { approveReply, rejectReply, combinedDraft }.
   * 관리자 화면에서 승인/불승인 본문을 최종 답변란에 넣을 때 사용합니다.
   */
  window.getPromotionDraftParts = function (ticket) {
    if (!ticket || resolveTicketKindForDemo(ticket) !== "promotion") return null;
    return buildPromotionDraftParts(ticket);
  };

  function getDemoDraftForTicket(ticket, kind) {
    if (kind === "promotion") {
      return buildPromotionDemoDraft(ticket);
    }
    if (kind === "suggestion") {
      var nickS =
        ticket.userNickname && String(ticket.userNickname).trim()
          ? "사용자 닉네임: " + String(ticket.userNickname).trim() + "\n\n"
          : "";
      return (
        "[데모 초안] 개선 의견에 감사드리며, 검토·반영 여부를 안내하는 톤으로 작성해 보세요.\n\n" +
        nickS +
        "제출 내용 요약: " +
        String(ticket.message || "").slice(0, 600) +
        "\n\nCloud Functions에 adminDraftTicketAi를 배포하고 GEMINI_API_KEY를 설정하면 실제 초안이 생성됩니다. (또는 js/ai-config.js 의 AI_DRAFT_ENDPOINT)"
      );
    }
    var ctx = ticket.quizContext || {};
    var head =
      kind === "report"
        ? "[데모 초안] 오류 신고에 대한 검토 안내입니다.\n\n"
        : "[데모 초안] 질문에 대한 답변 초안입니다.\n\n";
    var nickLine =
      ticket.userNickname && String(ticket.userNickname).trim()
        ? "사용자 닉네임: " + String(ticket.userNickname).trim() + " (답변 시 ○○님 등으로 호칭 가능)\n\n"
        : "";
    var body =
      nickLine +
      "문항 맥락: " +
      (ctx.questionId || "-") +
      " / " +
      (ctx.topic || "-") +
      "\n\nCloud Functions에 adminDraftTicketAi를 배포하고 GEMINI_API_KEY를 설정하거나, js/ai-config.js 의 AI_DRAFT_ENDPOINT 를 설정하세요.\n\n";
    return head + body + "— " + (ticket.message || "").slice(0, 500);
  }

  function draftCallableShouldReject(err) {
    var c = err && err.code;
    if (c === "functions/permission-denied" || c === "permission-denied") return true;
    if (c === "functions/unauthenticated" || c === "unauthenticated") return true;
    if (c === "functions/failed-precondition") return true;
    return false;
  }

  window.fetchAIDraftForTicket = function (ticket) {
    var url = (window.AI_DRAFT_ENDPOINT || "").trim();
    var kind = resolveTicketKindForDemo(ticket);

    function callAdminDraftCallable() {
      if (typeof firebase === "undefined" || !firebase.functions) {
        return Promise.reject(new Error("no-functions"));
      }
      if (!ticket || !ticket.id) {
        return Promise.reject(new Error("no-ticket-id"));
      }
      var region = window.FIREBASE_FUNCTIONS_REGION || "asia-northeast3";
      return firebase
        .app()
        .functions(region)
        .httpsCallable("adminDraftTicketAi")({ ticketId: ticket.id })
        .then(function (res) {
          var d = res && res.data;
          if (d && d.draft) return String(d.draft);
          if (d && d.text) return String(d.text);
          throw new Error("응답에 draft 필드가 없습니다.");
        });
    }

    function fetchCustomEndpoint() {
      return fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticketId: ticket.id,
          type: kind,
          message: ticket.message,
          imageUrls: ticket.imageUrls,
          linkUrls: ticket.linkUrls || [],
          quizContext: ticket.quizContext
        })
      })
        .then(function (res) {
          if (!res.ok) throw new Error("AI API 오류: " + res.status);
          return res.json();
        })
        .then(function (data) {
          if (data && data.draft) return String(data.draft);
          if (data && data.text) return String(data.text);
          throw new Error("응답에 draft 필드가 없습니다.");
        });
    }

    if (url) {
      return fetchCustomEndpoint().catch(function () {
        return callAdminDraftCallable().catch(function (err) {
          if (draftCallableShouldReject(err)) return Promise.reject(err);
          return getDemoDraftForTicket(ticket, kind);
        });
      });
    }

    return callAdminDraftCallable().catch(function (err) {
      if (draftCallableShouldReject(err)) return Promise.reject(err);
      return getDemoDraftForTicket(ticket, kind);
    });
  };

  window.adminUpdateTicketDraft = function (ticketId, aiDraft) {
    var d = db();
    if (!d) return Promise.reject(new Error("Firestore 오류"));
    return d
      .collection(TICKETS)
      .doc(ticketId)
      .update({
        aiDraft: aiDraft,
        status: "ai_drafted",
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
  };

  window.adminApproveTicket = function (ticketId, adminReply, adminEmail) {
    var d = db();
    if (!d) return Promise.reject(new Error("Firestore 오류"));
    var reply = (adminReply || "").trim();
    if (!reply) return Promise.reject(new Error("승인할 답변 내용을 입력하세요."));
    var tref = d.collection(TICKETS).doc(ticketId);
    return tref.get().then(function (snap) {
      if (!snap.exists) throw new Error("티켓을 찾을 수 없습니다.");
      var t = snap.data();
      if (t.type === "suggestion") {
        return Promise.reject(
          new Error("개선의견은 관리자 화면의 채택·포인트 옵션으로 승인하세요.")
        );
      }
      if (t.type === "promotion") {
        if (typeof firebase === "undefined" || !firebase.functions) {
          throw new Error("Cloud Functions를 사용할 수 없습니다.");
        }
        var region = window.FIREBASE_FUNCTIONS_REGION || "asia-northeast3";
        var fn = firebase.app().functions(region).httpsCallable("adminApprovePromotionTicket");
        return fn({
          ticketId: ticketId,
          adminReply: reply,
          adminEmail: adminEmail || ""
        }).then(function (res) {
          return res && res.data ? res.data : { ok: true };
        });
      }
      var approvePatch = {
        adminReply: reply,
        status: "approved",
        reviewedBy: adminEmail || "",
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      };
      if (t.type === "question") {
        approvePatch.qaCommunityPublished = false;
      }
      return tref
        .update(approvePatch)
        .then(function () {
          return d.collection(NOTIFS).add({
            userId: t.userId,
            ticketId: ticketId,
            type:
              t.type === "report"
                ? "신고 처리"
                : t.type === "promotion"
                  ? "홍보 인증 신청"
                  : t.type === "suggestion"
                    ? "개선 의견"
                    : "질문 답변",
            title:
              t.type === "report"
                ? "오류 신고에 대한 답변이 등록되었습니다"
                : t.type === "promotion"
                  ? "홍보 인증 신청 결과가 등록되었습니다"
                  : t.type === "suggestion"
                    ? "개선 의견에 대한 답변이 등록되었습니다"
                    : "답변이 도착했습니다",
            body: reply,
            read: false,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
          });
        })
        .then(function () {
          var ticketType = String(t.type || "")
            .trim()
            .toLowerCase();
          if (ticketType !== "question" || !t.userId) {
            return Promise.resolve();
          }
          if (t.qaAllowFutureCommunity === false) {
            return Promise.resolve();
          }
          var qmsg = String(t.message || "").trim();
          if (!qmsg) {
            return Promise.resolve();
          }
          var payload = {
            ticketId: ticketId,
            questionMessage: qmsg.slice(0, 8000),
            askerUserId: t.userId,
            publishedAt: firebase.firestore.FieldValue.serverTimestamp(),
            communityVisible: false
          };
          var qctx = t.quizContext && typeof t.quizContext === "object" ? t.quizContext : {};
          var qtopic = qctx.topic != null ? String(qctx.topic).trim() : "";
          var qstmt = qctx.statement != null ? String(qctx.statement).trim() : "";
          if (qtopic) payload.quizTopic = qtopic.slice(0, 500);
          if (qstmt) payload.quizStatement = qstmt.slice(0, 4000);
          var qaRef = d.collection("hanlaw_qa_public").doc(ticketId);

          function writeQaFromClient() {
            return qaRef.set(payload, { merge: true });
          }

          if (typeof firebase === "undefined" || !firebase.functions) {
            return writeQaFromClient().catch(function (e) {
              return Promise.reject(
                new Error(
                  "Q&A 공개 목록 반영 실패: " +
                    ((e && e.message) || String(e || "알 수 없음"))
                )
              );
            });
          }
          var regionQa = window.FIREBASE_FUNCTIONS_REGION || "asia-northeast3";
          return firebase
            .app()
            .functions(regionQa)
            .httpsCallable("publishLawyerQaPublic")({ ticketId: ticketId })
            .then(function (res) {
              return res && res.data ? res.data : { ok: true };
            })
            .catch(function (err) {
              console.warn("publishLawyerQaPublic failed, trying Firestore(admin) fallback", err);
              return writeQaFromClient().catch(function (e2) {
                var code = err && err.code ? String(err.code) : "";
                var base =
                  (err && err.message) ||
                  (err && err.details) ||
                  String(err || "알 수 없음");
                if (base === "internal") {
                  base =
                    "서버 내부 오류(internal). Functions 배포·로그를 확인하세요.";
                }
                var extra =
                  code.indexOf("not-found") >= 0 || code.indexOf("NOT_FOUND") >= 0
                    ? " 함수 미배포 가능."
                    : "";
                return Promise.reject(
                  new Error(
                    "Q&A 공개 목록 반영 실패(Functions·Firestore 모두). " +
                      base +
                      extra +
                      " / 폴백: " +
                      ((e2 && e2.message) || String(e2 || ""))
                  )
                );
              });
            });
        });
    });
  };

  window.markNotificationRead = function (notifId) {
    var d = db();
    if (!d) return Promise.resolve();
    return d.collection(NOTIFS).doc(notifId).update({ read: true });
  };

  window.subscribeUserNotifications = function (userId, callback) {
    var d = db();
    if (!d) return function () {};
    return d
      .collection(NOTIFS)
      .where("userId", "==", userId)
      .limit(30)
      .onSnapshot(
        function (snap) {
          var list = snap.docs.map(function (doc) {
            var x = doc.data();
            x._docId = doc.id;
            return x;
          });
          list.sort(function (a, b) {
            var ta =
              a.createdAt && a.createdAt.toMillis
                ? a.createdAt.toMillis()
                : 0;
            var tb =
              b.createdAt && b.createdAt.toMillis
                ? b.createdAt.toMillis()
                : 0;
            return tb - ta;
          });
          callback(list);
        },
        function (err) {
          try {
            console.warn("subscribeUserNotifications failed", err && (err.code || err.message || err));
          } catch (_) {}
          callback([]);
        }
      );
  };

  window.subscribePendingTicketCountForAdmin = function (callback) {
    var d = db();
    if (!d) return function () {};
    return d
      .collection(TICKETS)
      .where("status", "in", ["pending", "ai_drafted"])
      .onSnapshot(
        function (snap) {
          callback(snap.size);
        },
        function () {
          callback(0);
        }
      );
  };

  /**
   * 로그인 사용자 본인 티켓 목록(최신순). 복합 인덱스 없이 userId 단일 조건 + 클라이언트 정렬.
   */
  window.subscribeUserTickets = function (userId, callback) {
    var d = db();
    if (!d) return function () {};
    return d
      .collection(TICKETS)
      .where("userId", "==", userId)
      .limit(100)
      .onSnapshot(
        function (snap) {
          var list = snap.docs.map(function (doc) {
            var x = doc.data();
            x._docId = doc.id;
            return x;
          });
          list.sort(function (a, b) {
            var ta =
              a.createdAt && a.createdAt.toMillis
                ? a.createdAt.toMillis()
                : 0;
            var tb =
              b.createdAt && b.createdAt.toMillis
                ? b.createdAt.toMillis()
                : 0;
            return tb - ta;
          });
          callback(list);
        },
        function () {
          callback([]);
        }
      );
  };

  var ELLY_ASKS = "hanlaw_quiz_ai_asks";

  /**
   * 엘리(AI) 질문 성공 기록(Functions가 저장). 본인 문서만, userId 단일 조건 + 클라이언트 정렬.
   */
  window.subscribeUserEllyAsks = function (userId, callback) {
    var d = db();
    if (!d) return function () {};
    return d
      .collection(ELLY_ASKS)
      .where("userId", "==", userId)
      .limit(100)
      .onSnapshot(
        function (snap) {
          var list = snap.docs.map(function (doc) {
            var x = doc.data();
            x._docId = doc.id;
            return x;
          });
          list.sort(function (a, b) {
            var ta =
              a.createdAt && a.createdAt.toMillis
                ? a.createdAt.toMillis()
                : 0;
            var tb =
              b.createdAt && b.createdAt.toMillis
                ? b.createdAt.toMillis()
                : 0;
            return tb - ta;
          });
          callback(list);
        },
        function () {
          callback([]);
        }
      );
  };
})();
