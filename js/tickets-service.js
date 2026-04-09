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

  window.createSupportTicket = function (opts) {
    var user = typeof window.getHanlawUser === "function" ? window.getHanlawUser() : null;
    if (!user) return Promise.reject(new Error("로그인 후 이용할 수 있습니다."));
    var d = db();
    if (!d) return Promise.reject(new Error("Firestore를 사용할 수 없습니다."));
    var msg = (opts.message || "").trim();
    if (!msg) return Promise.reject(new Error("내용을 입력하세요."));
    if (msg.length > 8000) return Promise.reject(new Error("내용은 8000자 이하로 입력하세요."));
    var type = "report";
    if (opts.type === "question") type = "question";
    if (opts.type === "promotion") type = "promotion";
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
      .uploadTicketImages(user.uid, ticketId, files)
      .then(function (urls) {
        return ticketRef.set({
          id: ticketId,
          userId: user.uid,
          userEmail: user.email || "",
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
        });
      })
      .then(function () {
        window.dispatchEvent(
          new CustomEvent("support-ticket-created", { detail: { ticketId: ticketId } })
        );
        return ticketId;
      });
  };

  window.fetchAIDraftForTicket = function (ticket) {
    var url = (window.AI_DRAFT_ENDPOINT || "").trim();
    if (!url) {
      var ctx = ticket.quizContext || {};
      var head =
        ticket.type === "report"
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
        "\n\n실서비스에서는 서버에서 Google Gemini를 호출하고, js/ai-config.js 의 AI_DRAFT_ENDPOINT 에 그 HTTPS URL을 넣으세요.\n\n";
      return Promise.resolve(head + body + "— " + (ticket.message || "").slice(0, 500));
    }
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ticketId: ticket.id,
        type: ticket.type,
        message: ticket.message,
        imageUrls: ticket.imageUrls,
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
      return tref
        .update({
          adminReply: reply,
          status: "approved",
          reviewedBy: adminEmail || "",
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        })
        .then(function () {
          return d.collection(NOTIFS).add({
            userId: t.userId,
            ticketId: ticketId,
            type:
              t.type === "report"
                ? "신고 처리"
                : t.type === "promotion"
                  ? "홍보 인증 신청"
                  : "질문 답변",
            title:
              t.type === "report"
                ? "오류 신고에 대한 답변이 등록되었습니다"
                : t.type === "promotion"
                  ? "홍보 인증 신청 결과가 등록되었습니다"
                  : "질문에 대한 답변이 등록되었습니다",
            body: reply,
            read: false,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
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
      .orderBy("createdAt", "desc")
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
        function () {
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
})();
