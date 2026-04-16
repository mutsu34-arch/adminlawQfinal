"use strict";

/**
 * 자료실 RAG 발췌를 시스템 프롬프트에 붙일 때 사용.
 * 모델이 사용자(또는 회신 초안)에 파일명·원문 직접 인용을 넣지 않도록 고정 지침을 선행합니다.
 */
function appendLibraryRagBlockToSystemPrompt(systemSoFar, ragContext) {
  const raw = ragContext && String(ragContext).trim();
  if (!raw) return systemSoFar || "";
  const head = String(systemSoFar || "");
  return (
    head +
    "\n\n[자료실 내부 참고 발췌 — 아래는 모델 추론용이며, 최종 출력에는 이 형태로 드러나면 안 됩니다]\n" +
    "반드시 준수:\n" +
    "· 최종 답변·초안에 파일명·원문 제목·교재명·강의명·저자·확장자(.pdf 등)·특정 출판물을 식별할 수 있는 문자열을 넣지 마세요.\n" +
    "· 아래 발췌를 복사·직접 인용하거나, 문장 구조만 살짝 바꾼 수준의 유사 복제도 하지 마세요. 의미만 파악한 뒤, 완전히 다른 문장으로 재서술·요약하세요(저작권·부적절 인용 방지).\n" +
    "· '자료실'·'업로드한 문서'·'위 PDF'·'해설집에 따르면'처럼 내부 자료나 특정 서적을 가리키는 표현을 쓰지 마세요. 일반적인 설명처럼 자연스럽게만 쓰세요.\n" +
    "· 법령·조문이 필요하면 공식 조문을 길게 인용하기보다 요지를 풀어 설명하고, 교재·해설식 문장은 반드시 바꿔 쓰세요.\n\n" +
    raw
  );
}

module.exports = { appendLibraryRagBlockToSystemPrompt };
