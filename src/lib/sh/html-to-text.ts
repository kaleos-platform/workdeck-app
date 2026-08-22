/**
 * 상품 상세페이지 HTML → 평문 변환 유틸
 *
 * 수집한 상세페이지 HTML을 AI 모델 입력용 텍스트로 바꾼다(사람이 읽을 문서가 아님).
 * 정밀한 본문 추출이 목표가 아니라 중요한 정보를 누락하지 않는 것이 목표.
 *
 * 파이프라인:
 *   1. script/style/noscript/svg/iframe/template/head/주석 블록을 통째로 제거
 *      (제거 전 원본 head에서 메타데이터 먼저 추출)
 *   2. title/og:title/og:description/description 메타 추출 → 상단에 "제목:"/"요약:" 로 프리펜드
 *   3. img alt 텍스트를 인라인으로 승격 (이미지에만 문구가 있는 상세페이지 대응)
 *   4. 블록 태그 종료를 줄바꿈으로, li는 "- " 로 변환
 *   5. 나머지 태그 전부 제거
 *   6. 소수 엔티티 디코딩
 *   7. 공백 정규화(연속 공백/개행 축소, 각 줄 trim)
 *   8. maxChars 초과 시 절삭 + truncated 플래그
 */

export const HTML_TEXT_MAX_CHARS = 30000

export interface HtmlToTextResult {
  title: string | null
  text: string
  truncated: boolean
}

/** script/style 등 내용까지 통째로 제거해야 하는 태그 목록 */
const STRIPPED_BLOCK_TAGS = ['script', 'style', 'noscript', 'svg', 'iframe', 'template', 'head']

/** 블록 종료 시 줄바꿈으로 치환할 닫는 태그 (h1~h6 포함) */
const NEWLINE_CLOSE_TAGS = [
  'p',
  'div',
  'li',
  'tr',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'section',
  'article',
]

/** alt 값 중 의미 없는 노이즈로 취급해 승격하지 않을 패턴 */
const NOISE_ALT_PATTERN = /^(이미지|image|img)$/i
const FILENAME_ALT_PATTERN = /\.(jpe?g|png|gif|webp|svg|bmp|avif)$/i

/**
 * `<meta ... content="..." property/name="...">` 형태에서 속성값을 찾는다.
 * content와 property/name의 등장 순서가 뒤바뀐 경우도 지원한다.
 */
function extractMetaContent(html: string, key: 'property' | 'name', value: string): string | null {
  // content가 먼저 오는 경우
  const contentFirst = new RegExp(
    `<meta[^>]*content=["']([^"']*)["'][^>]*${key}=["']${value}["'][^>]*>`,
    'i'
  )
  const matchA = html.match(contentFirst)
  if (matchA) return matchA[1]

  // property/name이 먼저 오는 경우
  const keyFirst = new RegExp(
    `<meta[^>]*${key}=["']${value}["'][^>]*content=["']([^"']*)["'][^>]*>`,
    'i'
  )
  const matchB = html.match(keyFirst)
  if (matchB) return matchB[1]

  return null
}

/** HTML 엔티티를 디코딩한다. &amp;는 이중 인코딩을 고려해 마지막에 처리한다. */
function decodeEntities(input: string): string {
  return input
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&(?:#39|apos);/gi, "'")
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
}

export function htmlToText(html: string, maxChars: number = HTML_TEXT_MAX_CHARS): HtmlToTextResult {
  // 1. 메타데이터는 원본(head 제거 전) HTML에서 먼저 추출
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  const rawTitleTag = titleMatch ? decodeEntities(titleMatch[1]).replace(/\s+/g, ' ').trim() : null

  const ogTitle = extractMetaContent(html, 'property', 'og:title')
  const ogDescription = extractMetaContent(html, 'property', 'og:description')
  const metaDescription = extractMetaContent(html, 'name', 'description')

  const decodedOgTitle = ogTitle ? decodeEntities(ogTitle).trim() : null
  const decodedOgDescription = ogDescription ? decodeEntities(ogDescription).trim() : null
  const decodedMetaDescription = metaDescription ? decodeEntities(metaDescription).trim() : null

  const title = decodedOgTitle || rawTitleTag || null
  const summary = decodedOgDescription || decodedMetaDescription || null

  // 2. 주석 및 내용까지 제거해야 하는 블록 태그 제거
  let work = html.replace(/<!--[\s\S]*?-->/g, '')
  for (const tag of STRIPPED_BLOCK_TAGS) {
    const blockPattern = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, 'gi')
    work = work.replace(blockPattern, '')
  }

  // 3. img alt 텍스트를 인라인으로 승격
  work = work.replace(/<img\b[^>]*\balt=["']([^"']*)["'][^>]*>/gi, (_, alt: string) => {
    const decoded = decodeEntities(alt).trim()
    if (!decoded) return ' '
    if (NOISE_ALT_PATTERN.test(decoded) || FILENAME_ALT_PATTERN.test(decoded)) return ' '
    return ` ${decoded} `
  })

  // 4. 블록 종료 태그 → 줄바꿈 (li는 "- " 접두)
  work = work.replace(/<br\s*\/?>/gi, '\n')
  work = work.replace(/<li\b[^>]*>/gi, '- ')
  const closeTagPattern = new RegExp(`<\\/(?:${NEWLINE_CLOSE_TAGS.join('|')})\\s*>`, 'gi')
  work = work.replace(closeTagPattern, '\n')

  // 5. 나머지 태그 전부 제거
  work = work.replace(/<[^>]+>/g, '')

  // 6. 엔티티 디코딩
  work = decodeEntities(work)

  // 메타데이터 프리펜드
  const metaLines: string[] = []
  if (title) metaLines.push(`제목: ${title}`)
  if (summary) metaLines.push(`요약: ${summary}`)
  if (metaLines.length > 0) {
    work = `${metaLines.join('\n')}\n\n${work}`
  }

  // 7. 공백 정규화
  work = work
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
  work = work.replace(/\n{3,}/g, '\n\n').trim()

  // 8. 길이 제한
  let truncated = false
  if (work.length > maxChars) {
    work = work.slice(0, maxChars)
    truncated = true
  }

  return { title, text: work, truncated }
}
