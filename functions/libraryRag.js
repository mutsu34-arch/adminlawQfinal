"use strict";

/**
 * 자료실 PDF·Excel(xlsx) → 청크 → Gemini 임베딩 → Pinecone
 * 환경변수: GEMINI_API_KEY, PINECONE_API_KEY, PINECONE_INDEX_NAME
 * 선택: PINECONE_HOST (서버리스 인덱스 URL), PINECONE_NAMESPACE (기본 hanlaw-library)
 * 임베딩: gemini-embedding-001 (차원은 outputDimensionality로 조정)
 */

const pdfParse = require("pdf-parse");
const XLSX = require("xlsx");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { Pinecone } = require("@pinecone-database/pinecone");
const vision = require("@google-cloud/vision");
const { getStorage } = require("firebase-admin/storage");

const CHUNK_SIZE = 1000;
const CHUNK_OVERLAP = 150;
// 런타임 설정 혼선 방지: 임베딩 모델은 서버에서 고정 사용
const EMBED_MODEL = "gemini-embedding-001";
// Pinecone index(adminlawq, 1024차원)와 강제 일치
const EMBED_DIM = 1024;
const PINECONE_NS_DEFAULT = "hanlaw-library";
const RAG_MAX_CHARS = 7000;

let geminiClient = null;
let pineconeIndex = null;
let visionClient = null;

function getGemini() {
  const key = process.env.GEMINI_API_KEY || "";
  if (!key) return null;
  if (!geminiClient) geminiClient = new GoogleGenerativeAI(key);
  return geminiClient;
}

function getPineconeIndex() {
  const apiKey = process.env.PINECONE_API_KEY || "";
  const indexName = process.env.PINECONE_INDEX_NAME || "";
  if (!apiKey || !indexName) return null;
  if (pineconeIndex) return pineconeIndex;
  const pc = new Pinecone({ apiKey });
  const host = process.env.PINECONE_HOST || "";
  pineconeIndex = host ? pc.index(indexName, host) : pc.index(indexName);
  return pineconeIndex;
}

function getNamespace() {
  return process.env.PINECONE_NAMESPACE || PINECONE_NS_DEFAULT;
}

function getVisionClient() {
  if (!visionClient) visionClient = new vision.ImageAnnotatorClient();
  return visionClient;
}

function chunkTextByLength(raw, numPages, emptyMessage) {
  const text = String(raw || "")
    .replace(/\s+/g, " ")
    .trim();
  const pages = Math.max(1, parseInt(numPages, 10) || 1);
  if (text.length < 5) {
    throw new Error(
      emptyMessage ||
        "PDF에서 추출한 텍스트가 거의 없습니다. 스캔 PDF는 OCR이 필요할 수 있습니다."
    );
  }
  const chunks = [];
  let offset = 0;
  let chunkIndex = 0;
  while (offset < text.length) {
    const end = Math.min(offset + CHUNK_SIZE, text.length);
    const piece = text.slice(offset, end);
    const ratio = text.length > 0 ? offset / text.length : 0;
    const page = Math.min(pages, Math.max(1, Math.floor(ratio * pages) + 1));
    chunks.push({ text: piece, page, chunkIndex });
    chunkIndex++;
    offset = end - CHUNK_OVERLAP;
    if (end >= text.length) break;
  }
  return { chunks, numPages: pages };
}

/**
 * PDF 버퍼 → 페이지 수 기준 근사 페이지 번호가 붙은 청크
 */
async function extractChunksFromPdf(buffer) {
  const data = await pdfParse(buffer);
  return chunkTextByLength(data.text || "", data.numpages);
}

/**
 * Excel .xlsx 버퍼 → 시트별 CSV 형태로 이어붙인 뒤 청크 (page 메타는 시트 구간 근사)
 */
function extractChunksFromXlsx(buffer) {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const names = wb.SheetNames || [];
  if (!names.length) {
    throw new Error("엑셀 파일에 시트가 없습니다.");
  }
  const parts = [];
  for (let i = 0; i < names.length; i++) {
    const sn = names[i];
    const ws = wb.Sheets[sn];
    if (!ws) continue;
    const csv = XLSX.utils.sheet_to_csv(ws, { FS: "\t", blankrows: false });
    parts.push("=== 시트: " + sn + " ===\n" + csv);
  }
  const merged = parts.join("\n\n");
  const sheetCount = names.length;
  return chunkTextByLength(
    merged,
    sheetCount,
    "엑셀에서 추출한 텍스트가 거의 없습니다. 빈 파일이거나 읽을 수 있는 셀이 없을 수 있습니다."
  );
}

/**
 * 스캔 PDF OCR fallback (Vision API asyncBatchAnnotateFiles)
 * 입력: gs:// 버킷 내 PDF 객체
 */
async function extractChunksFromPdfByOcr(bucketName, objectName, libraryId) {
  const client = getVisionClient();
  const outPrefix = `hanlaw_library_ocr/${libraryId}/${Date.now()}/`;
  const outputUri = `gs://${bucketName}/${outPrefix}`;
  const gcsSourceUri = `gs://${bucketName}/${objectName}`;

  const [operation] = await client.asyncBatchAnnotateFiles({
    requests: [
      {
        inputConfig: {
          gcsSource: { uri: gcsSourceUri },
          mimeType: "application/pdf"
        },
        features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
        outputConfig: {
          gcsDestination: { uri: outputUri },
          batchSize: 20
        }
      }
    ]
  });
  await operation.promise();

  const bucket = getStorage().bucket(bucketName);
  const [files] = await bucket.getFiles({ prefix: outPrefix });
  let merged = "";
  let approxPages = 0;
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    if (!String(f.name || "").toLowerCase().endsWith(".json")) continue;
    const [buf] = await f.download();
    const payload = JSON.parse(String(buf || "{}"));
    const resList = payload.responses || [];
    approxPages += resList.length;
    for (let r = 0; r < resList.length; r++) {
      const txt =
        (resList[r].fullTextAnnotation && resList[r].fullTextAnnotation.text) || "";
      if (txt) merged += "\n" + txt;
    }
  }
  if (!merged.trim()) {
    throw new Error("OCR 결과 텍스트가 비어 있습니다.");
  }
  return chunkTextByLength(merged, approxPages || 1);
}

async function embedTexts(texts) {
  const gemini = getGemini();
  if (!gemini) throw new Error("GEMINI_API_KEY 없음");
  const model = gemini.getGenerativeModel({ model: EMBED_MODEL });
  const out = [];
  for (let i = 0; i < texts.length; i++) {
    const req = {
      content: { parts: [{ text: String(texts[i] || "") }] },
      taskType: "RETRIEVAL_DOCUMENT"
    };
    if (EMBED_DIM > 0) req.outputDimensionality = EMBED_DIM;
    const res = await model.embedContent(req);
    const vec = res && res.embedding && res.embedding.values;
    if (!Array.isArray(vec) || !vec.length) {
      throw new Error("Gemini 임베딩 벡터가 비어 있습니다.");
    }
    out.push(vec);
  }
  return out;
}

/** 배치 임베딩 (한 번에 최대 64개) */
async function embedInBatches(texts, batchSize) {
  batchSize = batchSize || 64;
  const out = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const vecs = await embedTexts(batch);
    out.push(...vecs);
  }
  return out;
}

async function upsertChunksToPinecone(libraryId, fileName, chunks) {
  const index = getPineconeIndex();
  if (!index) throw new Error("PINECONE 설정 없음");
  const ns = index.namespace(getNamespace());
  const texts = chunks.map((c) => c.text);
  const vectors = await embedInBatches(texts);
  const records = [];
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    const id = `${libraryId}_c${c.chunkIndex}`;
    const metaText = c.text.length > 3500 ? c.text.slice(0, 3500) + "…" : c.text;
    records.push({
      id,
      values: vectors[i],
      metadata: {
        fileId: libraryId,
        fileName: String(fileName || "").slice(0, 256),
        page: c.page,
        chunkIndex: c.chunkIndex,
        text: metaText
      }
    });
  }
  const batchSize = 100;
  for (let i = 0; i < records.length; i += batchSize) {
    const slice = records.slice(i, i + batchSize);
    await ns.upsert(slice);
  }
}

async function deleteVectorsByFileId(libraryId) {
  const index = getPineconeIndex();
  if (!index) return;
  try {
    const ns = index.namespace(getNamespace());
    await ns.deleteMany({ fileId: { $eq: libraryId } });
  } catch (e) {
    console.warn("Pinecone deleteMany", libraryId, e && e.message);
  }
}

/**
 * 퀴즈 AI용: 질문·문항 맥락으로 유사 청크 검색 → 문자열
 */
async function retrieveLibraryContextForQuiz(userQuestion, quiz) {
  const gemini = getGemini();
  const index = getPineconeIndex();
  if (!gemini || !index) return "";

  const qParts = [
    String(userQuestion || "").slice(0, 1500),
    quiz && quiz.topic ? "주제: " + quiz.topic : "",
    quiz && quiz.statement ? "문항: " + String(quiz.statement).slice(0, 800) : ""
  ];
  const queryText = qParts.filter(Boolean).join("\n");
  if (!queryText.trim()) return "";

  try {
    const emb = await embedTexts([queryText]);
    const vec = emb[0];
    if (!vec || !vec.length) return "";
    const ns = index.namespace(getNamespace());
    const qr = await ns.query({
      vector: vec,
      topK: 6,
      includeMetadata: true
    });
    const matches = qr.matches || [];
    if (!matches.length) return "";
    const lines = matches.map((m, i) => {
      const meta = m.metadata || {};
      const fn = meta.fileName || "자료";
      const pg = meta.page != null ? meta.page : "?";
      const tx = meta.text || "";
      return `[${i + 1}] ${fn} (p.${pg})\n${tx}`;
    });
    let block = lines.join("\n\n");
    if (block.length > RAG_MAX_CHARS) block = block.slice(0, RAG_MAX_CHARS) + "\n…(생략)";
    return block;
  } catch (e) {
    console.warn("retrieveLibraryContextForQuiz", e && e.message);
    return "";
  }
}

module.exports = {
  extractChunksFromPdf,
  extractChunksFromPdfByOcr,
  extractChunksFromXlsx,
  upsertChunksToPinecone,
  deleteVectorsByFileId,
  retrieveLibraryContextForQuiz,
  EMBED_DIM,
  getGemini,
  getPineconeIndex
};
