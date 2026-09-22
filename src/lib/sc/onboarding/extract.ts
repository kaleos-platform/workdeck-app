// 온보딩 문서 텍스트 추출 — PDF·Markdown·텍스트를 지원한다.
// docx/hwp 등은 "추출 미지원, 파일만 보관" 상태로 처리한다.

export const MAX_EXTRACT_CHARS = 20_000
export const EXTRACT_TRUNCATION_MARKER = '[자료 길이 제한으로 이후 내용 미분석]'

function limitExtractedText(text: string): string | null {
  if (!text) return null
  return text.length > MAX_EXTRACT_CHARS
    ? `${text.slice(0, MAX_EXTRACT_CHARS)}\n\n${EXTRACT_TRUNCATION_MARKER}`
    : text
}

export function isExtractableMime(mime: string): boolean {
  return ['application/pdf', 'text/plain', 'text/markdown', 'text/x-markdown'].includes(mime)
}

export function resourceMimeType(mime: string, fileName: string): string {
  return /\.(md|markdown)$/i.test(fileName) &&
    ['', 'application/octet-stream', 'text/plain', 'text/markdown', 'text/x-markdown'].includes(
      mime
    )
    ? 'text/markdown'
    : mime
}

/** 추출 실패/미지원이면 null 반환 (호출부에서 상태 결정) */
export async function extractTextFromFile(
  data: Uint8Array,
  mimeType: string
): Promise<string | null> {
  if (['text/plain', 'text/markdown', 'text/x-markdown'].includes(mimeType)) {
    const text = Buffer.from(data).toString('utf8').replace(/\r\n/g, '\n').trim()
    return limitExtractedText(text)
  }
  if (mimeType !== 'application/pdf') return null
  const { extractText, getDocumentProxy } = await import('unpdf')
  const pdf = await getDocumentProxy(new Uint8Array(data))
  const { text } = await extractText(pdf, { mergePages: true })
  const cleaned = (text ?? '').replace(/\s+/g, ' ').trim()
  return limitExtractedText(cleaned)
}
