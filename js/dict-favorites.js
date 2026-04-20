/**
 * 용어·조문·판례 사전 찜하기 — 계정별 localStorage (퀴즈 찜과 동일 패턴)
 * 종류별 최대 1000개 저장, 노출 한도는 HanlawNoteQuizUi.getDisplayLimit()와 동일(무료 100 / 유료 1000)
 */
(function () {
  var STORAGE_VER = "v1";
  var LS_PREFIX = "hanlaw_dict_favorites_";
  var MAX_STORE = 1000;
  var KINDS = ["term", "statute", "case"];

  function normPart(s) {
    return String(s || "")
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, 200);
  }

  function storageKey() {
    try {
      if (typeof window.getHanlawUser === "function") {
        var u = window.getHanlawUser();
        if (u && u.uid) return LS_PREFIX + STORAGE_VER + "_" + u.uid;
      }
    } catch (e) {}
    return LS_PREFIX + STORAGE_VER + "_local";
  }

  function emptyBucket() {
    return { order: [], items: {} };
  }

  function ensureShape(o) {
    var out = o && typeof o === "object" ? o : {};
    KINDS.forEach(function (k) {
      if (!out[k] || !Array.isArray(out[k].order)) out[k] = emptyBucket();
      if (!out[k].items || typeof out[k].items !== "object") out[k].items = {};
    });
    return out;
  }

  function readAll() {
    try {
      var s = localStorage.getItem(storageKey());
      if (!s) {
        var base = {};
        KINDS.forEach(function (k) {
          base[k] = emptyBucket();
        });
        return base;
      }
      return ensureShape(JSON.parse(s));
    } catch (e) {
      var fb = {};
      KINDS.forEach(function (k) {
        fb[k] = emptyBucket();
      });
      return fb;
    }
  }

  function writeAll(data) {
    try {
      localStorage.setItem(storageKey(), JSON.stringify(data));
    } catch (e) {}
    try {
      window.dispatchEvent(new CustomEvent("dict-favorites-updated"));
    } catch (e2) {}
  }

  function mergeLocalIntoUid(uid) {
    var id = String(uid || "").trim();
    if (!id) return;
    var keyLocal = LS_PREFIX + STORAGE_VER + "_local";
    var keyUid = LS_PREFIX + STORAGE_VER + "_" + id;
    try {
      var rawL = localStorage.getItem(keyLocal);
      if (!rawL) return;
      var oL = JSON.parse(rawL);
      if (!oL || typeof oL !== "object") return;

      var rawU = localStorage.getItem(keyUid);
      var oU = rawU ? JSON.parse(rawU) : null;
      oU = ensureShape(oU || {});

      KINDS.forEach(function (kind) {
        var bL = oL[kind] && Array.isArray(oL[kind].order) ? oL[kind] : emptyBucket();
        var itemsL = (bL.items && typeof bL.items === "object") ? bL.items : {};
        var bU = oU[kind];
        var seen = {};
        var mergedOrder = [];
        function pushId(id0) {
          var x = String(id0 || "").trim();
          if (!x || seen[x]) return;
          seen[x] = true;
          mergedOrder.push(x);
        }
        bL.order.forEach(pushId);
        bU.order.forEach(pushId);
        if (mergedOrder.length > MAX_STORE) mergedOrder = mergedOrder.slice(0, MAX_STORE);
        var itemsOut = {};
        mergedOrder.forEach(function (fid) {
          var it = itemsL[fid] || (bU.items && bU.items[fid]);
          if (it && typeof it === "object") itemsOut[fid] = it;
        });
        oU[kind] = { order: mergedOrder, items: itemsOut };
      });

      localStorage.setItem(keyUid, JSON.stringify(oU));
      localStorage.removeItem(keyLocal);
    } catch (e) {}
    try {
      window.dispatchEvent(new CustomEvent("dict-favorites-updated"));
    } catch (e2) {}
  }

  function makeId(kind, keyPart) {
    var k = String(kind || "").trim();
    return k + ":" + normPart(keyPart);
  }

  window.DictFavorites = {
    MAX_STORE: MAX_STORE,
    norm: normPart,
    makeId: makeId,

    has: function (kind, id) {
      var kid = String(kind || "").trim();
      var fid = String(id || "").trim();
      if (!kid || !fid) return false;
      var d = readAll();
      var b = d[kid];
      if (!b || !Array.isArray(b.order)) return false;
      for (var i = 0; i < b.order.length; i++) {
        if (String(b.order[i]) === fid) return true;
      }
      return false;
    },

    /**
     * @param {string} kind term|statute|case
     * @param {{ id: string, title: string, sub?: string, searchText: string }} payload
     */
    toggle: function (kind, payload) {
      var kid = String(kind || "").trim();
      var fid = String((payload && payload.id) || "").trim();
      if (!kid || !fid) return false;
      var title = String((payload && payload.title) || "").trim() || "(제목 없음)";
      var sub = payload && payload.sub != null ? String(payload.sub).trim() : "";
      var searchText =
        payload && payload.searchText != null ? String(payload.searchText).trim() : title;

      var d = readAll();
      var b = d[kid] || emptyBucket();
      if (!Array.isArray(b.order)) b.order = [];
      if (!b.items) b.items = {};

      var idx = -1;
      for (var j = 0; j < b.order.length; j++) {
        if (String(b.order[j]) === fid) {
          idx = j;
          break;
        }
      }
      if (idx >= 0) {
        b.order.splice(idx, 1);
        delete b.items[fid];
        d[kid] = b;
        writeAll(d);
        return false;
      }
      b.order.unshift(fid);
      if (b.order.length > MAX_STORE) b.order.length = MAX_STORE;
      b.items[fid] = {
        id: fid,
        kind: kid,
        title: title.slice(0, 400),
        sub: sub.slice(0, 600),
        searchText: searchText.slice(0, 500),
        savedAt: Date.now()
      };
      var seen = {};
      b.order = b.order.filter(function (x) {
        var u = String(x || "").trim();
        if (!u || seen[u]) return false;
        seen[u] = true;
        return true;
      });
      d[kid] = b;
      writeAll(d);
      return true;
    },

    remove: function (kind, id) {
      var kid = String(kind || "").trim();
      var fid = String(id || "").trim();
      if (!kid || !fid) return;
      var d = readAll();
      var b = d[kid];
      if (!b || !Array.isArray(b.order)) return;
      b.order = b.order.filter(function (x) {
        return String(x) !== fid;
      });
      if (b.items && b.items[fid]) delete b.items[fid];
      d[kid] = b;
      writeAll(d);
    },

    clearKind: function (kind) {
      var kid = String(kind || "").trim();
      if (!kid) return;
      var d = readAll();
      d[kid] = emptyBucket();
      writeAll(d);
    },

    getOrderedItems: function (kind) {
      var kid = String(kind || "").trim();
      if (!kid) return [];
      var d = readAll();
      var b = d[kid];
      if (!b || !Array.isArray(b.order)) return [];
      var out = [];
      for (var i = 0; i < b.order.length; i++) {
        var fid = String(b.order[i] || "").trim();
        if (!fid) continue;
        var it = b.items && b.items[fid];
        if (it && typeof it === "object") out.push(it);
      }
      return out;
    }
  };

  window.addEventListener("app-auth", function (e) {
    var u = e && e.detail && e.detail.user;
    if (u && u.uid) mergeLocalIntoUid(u.uid);
  });

  try {
    if (typeof firebase !== "undefined" && firebase.auth) {
      firebase.auth().onAuthStateChanged(function (user) {
        if (user && user.uid) mergeLocalIntoUid(user.uid);
      });
    }
  } catch (e) {}
})();
