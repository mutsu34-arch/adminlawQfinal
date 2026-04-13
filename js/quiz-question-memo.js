/**
 * 문항별 나의 메모 (텍스트 + 손글씨 이미지) — 계정별 localStorage
 */
(function () {
  var STORAGE_VER = "v1";
  var LS_PREFIX = "hanlaw_quiz_memos_";
  var MAX_TEXT = 8000;

  function normalizeId(id) {
    return String(id == null ? "" : id).trim();
  }

  function storageKey() {
    try {
      if (typeof window.getHanlawUser === "function") {
        var u = window.getHanlawUser();
        if (u) return LS_PREFIX + STORAGE_VER + "_" + u.uid;
      }
    } catch (e) {}
    return LS_PREFIX + STORAGE_VER + "_local";
  }

  function readRaw() {
    try {
      var s = localStorage.getItem(storageKey());
      if (!s) return { entries: {} };
      var o = JSON.parse(s);
      if (!o || typeof o.entries !== "object" || o.entries === null) return { entries: {} };
      return o;
    } catch (e) {
      return { entries: {} };
    }
  }

  function writeRaw(data) {
    try {
      localStorage.setItem(storageKey(), JSON.stringify(data));
    } catch (e) {}
    try {
      window.dispatchEvent(new CustomEvent("quiz-question-memo-updated"));
    } catch (e2) {}
  }

  function mergeMemoLocalIntoUid(uid) {
    var id = normalizeId(uid);
    if (!id) return;
    var keyLocal = LS_PREFIX + STORAGE_VER + "_local";
    var keyUid = LS_PREFIX + STORAGE_VER + "_" + id;
    try {
      var rawL = localStorage.getItem(keyLocal);
      if (!rawL) return;
      var oL = JSON.parse(rawL);
      if (!oL || !oL.entries || typeof oL.entries !== "object") return;

      var rawU = localStorage.getItem(keyUid);
      var oU = rawU ? JSON.parse(rawU) : { entries: {} };
      if (!oU || typeof oU.entries !== "object" || oU.entries === null) oU = { entries: {} };

      var merged = Object.assign({}, oU.entries);
      Object.keys(oL.entries).forEach(function (k) {
        var qid = normalizeId(k);
        if (!qid || merged[qid]) return;
        merged[qid] = oL.entries[k];
      });
      localStorage.setItem(keyUid, JSON.stringify({ entries: merged }));
      localStorage.removeItem(keyLocal);
    } catch (e) {}
  }

  function get(questionId) {
    var qid = normalizeId(questionId);
    if (!qid) return null;
    var d = readRaw();
    var e = d.entries[qid];
    if (!e || typeof e !== "object") return null;
    var text = e.text != null ? String(e.text) : "";
    var drawing = e.drawing != null ? String(e.drawing) : "";
    if (!text.trim() && !drawing) return null;
    return { text: text, drawing: drawing || "" };
  }

  function set(questionId, payload) {
    var qid = normalizeId(questionId);
    if (!qid) return;
    var text = payload && payload.text != null ? String(payload.text).trim().slice(0, MAX_TEXT) : "";
    var drawing = payload && payload.drawing != null ? String(payload.drawing).trim() : "";
    if (drawing.length > 1200000) {
      drawing = drawing.slice(0, 1200000);
    }
    var d = readRaw();
    if (!text && !drawing) {
      delete d.entries[qid];
    } else {
      d.entries[qid] = { text: text, drawing: drawing };
    }
    writeRaw(d);
  }

  function remove(questionId) {
    var qid = normalizeId(questionId);
    if (!qid) return;
    var d = readRaw();
    delete d.entries[qid];
    writeRaw(d);
  }

  /**
   * 오답노트·찜노트 카드 하단용 (읽기 전용)
   */
  function fillReadonlyPost(container, questionId) {
    if (!container) return;
    container.innerHTML = "";
    container.hidden = true;
    var m = get(questionId);
    if (!m) return;
    var hasT = m.text && String(m.text).trim();
    var hasD = m.drawing && m.drawing.indexOf("data:image") === 0;
    if (!hasT && !hasD) return;
    container.hidden = false;
    var lbl = document.createElement("p");
    lbl.className = "feedback__block-label";
    lbl.textContent = "나의 메모";
    container.appendChild(lbl);
    if (hasT) {
      var p = document.createElement("p");
      p.className = "note-card__memo-text feedback__block-body";
      p.textContent = m.text;
      container.appendChild(p);
    }
    if (hasD) {
      var im = document.createElement("img");
      im.className = "note-card__memo-img";
      im.alt = "손글씨 메모";
      im.loading = "lazy";
      im.decoding = "async";
      im.src = m.drawing;
      container.appendChild(im);
    }
  }

  /**
   * 캔버스에 필기 입력 (좌표는 캔버스 내부 픽셀 기준)
   */
  function attachDrawingCanvas(canvas, callbacks) {
    if (!canvas || !canvas.getContext) return null;
    var ctx = canvas.getContext("2d");
    if (!ctx) return null;
    var onChange = callbacks && typeof callbacks.onChange === "function" ? callbacks.onChange : function () {};

    var penColor = "#e8eaed";
    try {
      var doc = document.documentElement;
      var cs = getComputedStyle(doc);
      var fg = cs.getPropertyValue("--text").trim();
      if (fg) penColor = fg;
    } catch (e) {}

    var lineWidthPx = 4;
    var eraserMode = false;

    var drawing = false;
    var last = { x: 0, y: 0 };
    var hasInk = false;

    function applyStrokeStyle() {
      if (eraserMode) {
        ctx.globalCompositeOperation = "destination-out";
        ctx.strokeStyle = "rgba(0,0,0,1)";
        ctx.lineWidth = Math.max(6, lineWidthPx * 2);
      } else {
        ctx.globalCompositeOperation = "source-over";
        ctx.strokeStyle = penColor;
        ctx.lineWidth = lineWidthPx;
      }
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
    }

    function scalePoint(e) {
      var r = canvas.getBoundingClientRect();
      var scaleX = canvas.width / (r.width || canvas.width);
      var scaleY = canvas.height / (r.height || canvas.height);
      var cx;
      var cy;
      if (e.touches && e.touches[0]) {
        cx = e.touches[0].clientX - r.left;
        cy = e.touches[0].clientY - r.top;
      } else {
        cx = e.clientX - r.left;
        cy = e.clientY - r.top;
      }
      return { x: cx * scaleX, y: cy * scaleY };
    }

    function start(e) {
      if (e.type === "touchstart") e.preventDefault();
      drawing = true;
      var p = scalePoint(e);
      last = p;
    }

    function drawLine(e) {
      if (!drawing) return;
      if (e.type === "touchmove") e.preventDefault();
      var p = scalePoint(e);
      applyStrokeStyle();
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      ctx.globalCompositeOperation = "source-over";
      last = p;
      hasInk = true;
      onChange();
    }

    function end() {
      if (drawing) {
        drawing = false;
        onChange();
      }
    }

    canvas.addEventListener("mousedown", start);
    canvas.addEventListener("mousemove", drawLine);
    canvas.addEventListener("mouseup", end);
    canvas.addEventListener("mouseleave", end);
    canvas.addEventListener("touchstart", start, { passive: false });
    canvas.addEventListener("touchmove", drawLine, { passive: false });
    canvas.addEventListener("touchend", end);

    return {
      clear: function () {
        ctx.globalCompositeOperation = "source-over";
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        hasInk = false;
        onChange();
      },
      hasInk: function () {
        return hasInk;
      },
      setHasInk: function (v) {
        hasInk = !!v;
      },
      setPenColor: function (hex) {
        if (hex == null || String(hex).trim() === "") return;
        penColor = String(hex).trim();
      },
      getPenColor: function () {
        return penColor;
      },
      setLineWidth: function (w) {
        var n = parseFloat(w);
        if (!isFinite(n) || n < 1) return;
        lineWidthPx = Math.min(48, Math.max(1, n));
      },
      getLineWidth: function () {
        return lineWidthPx;
      },
      setEraser: function (on) {
        eraserMode = !!on;
      },
      isEraser: function () {
        return eraserMode;
      },
      loadDataUrl: function (url, done) {
        if (!url || String(url).indexOf("data:image") !== 0) {
          if (done) done(false);
          return;
        }
        var img = new Image();
        img.onload = function () {
          ctx.globalCompositeOperation = "source-over";
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          hasInk = true;
          if (done) done(true);
          onChange();
        };
        img.onerror = function () {
          if (done) done(false);
        };
        img.src = url;
      }
    };
  }

  window.QuizQuestionMemo = {
    get: get,
    set: set,
    remove: remove,
    fillReadonlyPost: fillReadonlyPost,
    attachDrawingCanvas: attachDrawingCanvas,
    mergeMemoLocalIntoUid: mergeMemoLocalIntoUid,
    normalizeId: normalizeId
  };

  window.addEventListener("app-auth", function (e) {
    var u = e && e.detail && e.detail.user;
    if (u && u.uid) mergeMemoLocalIntoUid(u.uid);
  });
  try {
    if (typeof firebase !== "undefined" && firebase.auth) {
      firebase.auth().onAuthStateChanged(function (user) {
        if (user && user.uid) mergeMemoLocalIntoUid(user.uid);
      });
    }
  } catch (err) {}
})();
