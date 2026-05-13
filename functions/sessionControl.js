"use strict";

const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");

const ALLOWED_DEVICE_TYPES = new Set(["phone", "tablet", "pc"]);
const MAX_ID_LEN = 128;

function normId(v) {
  return String(v == null ? "" : v).trim();
}

function validId(v) {
  if (!v || v.length > MAX_ID_LEN) return false;
  return /^[a-zA-Z0-9._:-]+$/.test(v);
}

/**
 * 계정별 세션 정책:
 * - 디바이스 타입은 phone/tablet/pc 각 1개만 등록 유지
 * - 마지막 로그인(sessionId)이 activeSessionId가 되어 다른 접속은 클라이언트에서 강제 로그아웃
 */
const registerUserSession = onCall({ region: "asia-northeast3" }, async (request) => {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
  }
  const uid = request.auth.uid;
  const data = request.data || {};

  const sessionId = normId(data.sessionId);
  const deviceId = normId(data.deviceId);
  const deviceType = normId(data.deviceType).toLowerCase();

  if (!validId(sessionId)) {
    throw new HttpsError("invalid-argument", "sessionId 형식이 올바르지 않습니다.");
  }
  if (!validId(deviceId)) {
    throw new HttpsError("invalid-argument", "deviceId 형식이 올바르지 않습니다.");
  }
  if (!ALLOWED_DEVICE_TYPES.has(deviceType)) {
    throw new HttpsError("invalid-argument", "deviceType은 phone/tablet/pc만 허용됩니다.");
  }

  const ref = getFirestore().collection("hanlaw_user_sessions").doc(uid);
  const out = await getFirestore().runTransaction(async (t) => {
    const snap = await t.get(ref);
    const cur = snap.exists ? snap.data() || {} : {};
    const prevDevices = cur.devices && typeof cur.devices === "object" ? cur.devices : {};
    const prevOfType = prevDevices[deviceType] || null;

    const nextDevices = Object.assign({}, prevDevices);
    nextDevices[deviceType] = {
      deviceId,
      sessionId,
      updatedAt: FieldValue.serverTimestamp()
    };

    t.set(
      ref,
      {
        devices: nextDevices,
        activeSessionId: sessionId,
        activeDeviceId: deviceId,
        activeDeviceType: deviceType,
        updatedAt: FieldValue.serverTimestamp()
      },
      { merge: true }
    );

    return {
      replacedByType: !!(prevOfType && prevOfType.deviceId && prevOfType.deviceId !== deviceId),
      previousDeviceId: prevOfType && prevOfType.deviceId ? String(prevOfType.deviceId) : null
    };
  });

  return {
    ok: true,
    sessionId,
    deviceId,
    deviceType,
    replacedByType: !!out.replacedByType,
    previousDeviceId: out.previousDeviceId
  };
});

module.exports = { registerUserSession };

