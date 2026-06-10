"use strict";

/**
 * 자료실: Firestore 메타데이터 + Storage 업로드 → 청크·임베딩·Pinecone
 * Callable: createLibraryDocument, deleteLibraryDocument, adminRetryLibraryIngest (관리자만)
 * Storage: hanlaw_library/{libraryId}/{파일명}.pdf | .xlsx
 */

const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");
const { onObjectFinalized } = require("firebase-functions/v2/storage");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const {
  extractChunksFromPdf,
  extractChunksFromPdfByOcr,
  extractChunksFromXlsx,
  upsertChunksToPinecone,
  deleteVectorsByFileId,
  friendlyGeminiError
} = require("./libraryRag");

const COLLECTION = "hanlaw_library_files";
const db = getFirestore();

/** Storage 트리거용 버킷(로컬·테스트에서도 모듈 로드되도록 명시). firebase-config storageBucket 과 동일하게 맞추세요. */
const LIBRARY_STORAGE_BUCKET =
  process.env.HANLAW_STORAGE_BUCKET || "adminlawq-b9dad.firebasestorage.app";

const INGEST_MEMORY = "4GiB";
const INGEST_TIMEOUT_SEC = 540;

function isAdminEmail(email) {
  const raw = process.env.ADMIN_EMAILS || "mutsu34@gmail.com";
  const list = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(String(email || "").toLowerCase());
}

function requireAdmin(request) {
  if (!request.auth || !request.auth.token.email) {
    throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
  }
  if (!isAdminEmail(request.auth.token.email)) {
    throw new HttpsError("permission-denied", "관리자만 사용할 수 있습니다.");
  }
}

function sanitizeFileName(name) {
  const base = String(name || "document.pdf").replace(/[^\w.\-가-힣]/g, "_");
  let s = base.slice(0, 120);
  const low = s.toLowerCase();
  // 예전 버그·클라이언트 조합으로 생긴 *.xlsx.pdf → *.xlsx 로 정리
  if (/\.xlsx\.pdf$/i.test(s)) {
    s = s.slice(0, -4);
  }
  const low2 = s.toLowerCase();
  if (low2.endsWith(".pdf") || low2.endsWith(".xlsx")) return s;
  return s + ".pdf";
}

/** Storage 경로가 .pdf로 끝나도 실제 바이트가 엑셀(OOXML=ZIP)인 경우 */
function shouldUseXlsxPipeline(fileName, buffer) {
  if (!buffer || buffer.length < 2) return false;
  const n = String(fileName || "").toLowerCase();
  if (n.endsWith(".xlsx") || n.endsWith(".xlsx.pdf")) return true;
  const isPdfMagic =
    buffer.length >= 4 &&
    buffer[0] === 0x25 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x44 &&
    buffer[3] === 0x46;
  if (isPdfMagic) return false;
  const isZipMagic = buffer[0] === 0x50 && buffer[1] === 0x4b;
  if (n.endsWith(".pdf") && isZipMagic) return true;
  return false;
}

function isLibraryStoragePath(name) {
  const low = String(name || "").toLowerCase();
  return (
    low.startsWith("hanlaw_library/") && (low.endsWith(".pdf") || low.endsWith(".xlsx"))
  );
}

function libraryIdFromStoragePath(name) {
  const parts = String(name || "").split("/");
  if (parts.length < 3) return "";
  return parts[1];
}

async function ingestLibraryObject(bucketName, objectName) {
  const name = String(objectName || "").trim();
  if (!isLibraryStoragePath(name)) {
    throw new HttpsError("invalid-argument", "자료실 Storage 경로가 아닙니다.");
  }
  const libraryId = libraryIdFromStoragePath(name);
  const fileLabel = name.split("/").slice(2).join("/");
  const docRef = db.collection(COLLECTION).doc(libraryId);
  const snap = await docRef.get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "Firestore 자료 메타데이터를 찾을 수 없습니다.");
  }

  await docRef.set(
    {
      status: "processing",
      errorMessage: null,
      ingestPhase: "download",
      ingestProgress: 0,
      processedAt: FieldValue.serverTimestamp()
    },
    { merge: true }
  );

  try {
    const bucket = getStorage().bucket(bucketName);
    const file = bucket.file(name);
    const [exists] = await file.exists();
    if (!exists) {
      throw new Error(
        "Storage에 파일이 없습니다. 업로드가 끝나지 않았거나 삭제되었을 수 있습니다. 삭제 후 다시 올려 주세요."
      );
    }

    const [buffer] = await file.download();
    const fileBytes = buffer.length;

    let chunksInfo;
    let resolvedKind = "pdf";
    if (shouldUseXlsxPipeline(name, buffer)) {
      chunksInfo = extractChunksFromXlsx(buffer);
      resolvedKind = "xlsx";
    } else {
      try {
        chunksInfo = await extractChunksFromPdf(buffer);
      } catch (e) {
        const msg = String((e && e.message) || e || "");
        if (msg.indexOf("OCR") >= 0 || msg.indexOf("텍스트가 거의 없습니다") >= 0) {
          await docRef.set({ ingestPhase: "ocr", ingestProgress: 0 }, { merge: true });
          chunksInfo = await extractChunksFromPdfByOcr(bucketName, name, libraryId);
          await docRef.set({ ocrUsed: true }, { merge: true });
        } else if (
          /invalid pdf|pdf structure/i.test(msg) &&
          buffer.length >= 2 &&
          buffer[0] === 0x50 &&
          buffer[1] === 0x4b
        ) {
          chunksInfo = extractChunksFromXlsx(buffer);
          resolvedKind = "xlsx";
        } else {
          throw e;
        }
      }
    }

    const { chunks, numPages } = chunksInfo;
    if (!chunks.length) {
      throw new Error("청크를 만들 수 없습니다.");
    }

    const d = snap.data() || {};
    const displayName = d.fileName || fileLabel;

    let resumeFrom = 0;
    const prevDone = Number(d.ingestProgress) || 0;
    const prevTotal = Number(d.chunkTotal) || 0;
    if (
      (d.status === "error" || d.status === "processing") &&
      d.ingestPhase === "embedding" &&
      prevTotal === chunks.length &&
      prevDone > 0 &&
      prevDone < chunks.length
    ) {
      resumeFrom = prevDone;
    }

    await docRef.set(
      {
        ingestPhase: "embedding",
        ingestProgress: resumeFrom,
        chunkTotal: chunks.length,
        bytes: fileBytes
      },
      { merge: true }
    );

    if (resumeFrom <= 0) {
      await deleteVectorsByFileId(libraryId);
    }
    await upsertChunksToPinecone(
      libraryId,
      displayName,
      chunks,
      async function (done, total) {
        await docRef.set(
          {
            ingestPhase: "embedding",
            ingestProgress: done,
            chunkTotal: total
          },
          { merge: true }
        );
      },
      resumeFrom
    );

    await docRef.set(
      {
        status: "complete",
        chunkCount: chunks.length,
        numPages: numPages,
        fileKind: resolvedKind,
        bytes: fileBytes,
        errorMessage: null,
        ingestPhase: FieldValue.delete(),
        ingestProgress: FieldValue.delete(),
        chunkTotal: FieldValue.delete(),
        completedAt: FieldValue.serverTimestamp()
      },
      { merge: true }
    );

    return { ok: true, libraryId, chunkCount: chunks.length };
  } catch (e) {
    console.error("libraryPipeline ingest", libraryId, e);
    const errMsg = friendlyGeminiError(e) || (e && e.message) || String(e);
    const failPatch = {
      status: "error",
      errorMessage: errMsg.slice(0, 500),
      completedAt: FieldValue.serverTimestamp()
    };
    await docRef.set(failPatch, { merge: true });
    throw e;
  }
}

const createLibraryDocument = onCall({ region: "asia-northeast3" }, async (request) => {
  requireAdmin(request);
  const data = request.data || {};
  const title = String(data.title || "").trim().slice(0, 200);
  const category = String(data.category || "other").trim();
  const description = String(data.description || "").trim().slice(0, 2000);
  const originalName = String(data.fileName || "document.pdf").trim();
  const safeName = sanitizeFileName(originalName);

  const allowed = ["textbook", "past_exam", "revision", "precedent", "other"];
  const cat = allowed.includes(category) ? category : "other";

  if (!title) {
    throw new HttpsError("invalid-argument", "자료 제목을 입력하세요.");
  }

  const docRef = db.collection(COLLECTION).doc();
  const libraryId = docRef.id;
  const storagePath = `hanlaw_library/${libraryId}/${safeName}`;

  await docRef.set({
    title,
    category: cat,
    description: description || null,
    fileName: safeName,
    storagePath,
    status: "pending",
    chunkCount: null,
    bytes: null,
    errorMessage: null,
    uploadedAt: FieldValue.serverTimestamp(),
    uploadedByUid: request.auth.uid,
    uploadedByEmail: request.auth.token.email
  });

  return { ok: true, libraryId, storagePath };
});

const deleteLibraryDocument = onCall({ region: "asia-northeast3" }, async (request) => {
  requireAdmin(request);
  const libraryId = String((request.data && request.data.libraryId) || "").trim();
  if (!libraryId) {
    throw new HttpsError("invalid-argument", "libraryId가 없습니다.");
  }

  const ref = db.collection(COLLECTION).doc(libraryId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "문서를 찾을 수 없습니다.");
  }
  const d = snap.data();
  const path = d.storagePath;

  await deleteVectorsByFileId(libraryId);

  if (path) {
    try {
      await getStorage().bucket().file(path).delete({ ignoreNotFound: true });
    } catch (e) {
      console.warn("Storage delete", e && e.message);
    }
  }

  await ref.delete();
  return { ok: true };
});

/** 멈춘 항목(대기·학습 중·오류)을 Storage 파일 기준으로 다시 학습 */
const adminRetryLibraryIngest = onCall(
  { region: "asia-northeast3", memory: INGEST_MEMORY, timeoutSeconds: INGEST_TIMEOUT_SEC, cpu: 2 },
  async (request) => {
    requireAdmin(request);
    const libraryId = String((request.data && request.data.libraryId) || "").trim();
    if (!libraryId) {
      throw new HttpsError("invalid-argument", "libraryId가 없습니다.");
    }
    const snap = await db.collection(COLLECTION).doc(libraryId).get();
    if (!snap.exists) {
      throw new HttpsError("not-found", "문서를 찾을 수 없습니다.");
    }
    const path = String((snap.data() && snap.data().storagePath) || "").trim();
    if (!path) {
      throw new HttpsError("failed-precondition", "Storage 경로가 없습니다.");
    }
    const bucketName = LIBRARY_STORAGE_BUCKET;
    try {
      const result = await ingestLibraryObject(bucketName, path);
      return result;
    } catch (e) {
      if (e instanceof HttpsError) throw e;
      throw new HttpsError("internal", (e && e.message) || "학습 재시도에 실패했습니다.");
    }
  }
);

const onLibraryPdfUploaded = onObjectFinalized(
  {
    region: "asia-northeast3",
    memory: INGEST_MEMORY,
    cpu: 2,
    timeoutSeconds: INGEST_TIMEOUT_SEC,
    bucket: LIBRARY_STORAGE_BUCKET,
    maxInstances: 2
  },
  async (event) => {
    const name = event.data.name || "";
    if (!isLibraryStoragePath(name)) return;
    const bucketName = event.data.bucket || LIBRARY_STORAGE_BUCKET;
    try {
      await ingestLibraryObject(bucketName, name);
    } catch (e) {
      console.error("onLibraryPdfUploaded", name, e && e.message);
    }
  }
);

module.exports = {
  createLibraryDocument,
  deleteLibraryDocument,
  adminRetryLibraryIngest,
  onLibraryPdfUploaded,
  ingestLibraryObject,
  LIBRARY_STORAGE_BUCKET
};
