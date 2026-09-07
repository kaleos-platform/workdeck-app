// 온보딩 문서 텍스트 추출 — v1은 PDF만 지원(unpdf, 서버리스 친화).
// docx/hwp 등은 "추출 미지원, 파일만 보관" 상태로 처리한다.

export const MAX_EXTRACT_CHARS = 20_000

export function isExtractableMime(mime: string): boolean {
  return mime === 'application/pdf' || mime === 'text/plain'
}

/** 추출 실패/미지원이면 null 반환 (호출부에서 상태 결정) */
export async function extractTextFromFile(data: Uint8Array, mimeType: string): Promise<string | null> {
  if (mimeType === 'text/plain') {
    const text = Buffer.from(data).toString('utf8').replace(/\s+/g, ' ').trim()
    return text ? text.slice(0, MAX_EXTRACT_CHARS) : null
  }
  if (mimeType !== 'application/pdf') return null
  const { extractText, getDocumentProxy } = await import('unpdf')
  const pdf = await getDocumentProxy(new Uint8Array(data))
  const { text } = await extractText(pdf, { mergePages: true })
  const cleaned = (text ?? '').replace(/\s+/g, ' ').trim()
  return cleaned ? cleaned.slice(0, MAX_EXTRACT_CHARS) : null
}
