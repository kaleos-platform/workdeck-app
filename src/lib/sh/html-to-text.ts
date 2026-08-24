/**
 * 상품 상세페이지 HTML → 평문 변환 유틸
 *
 * 수집한 상세페이지 HTML을 AI 모델 입력용 텍스트로 바꾼다(사람이 읽을 문서가 아님).
 * 정밀한 본문 추출이 목표가 아니라 중요한 정보를 누락하지 않는 것이 목표.
 *
 * 파이프라인:
 *   1. script/style/noscript/svg/iframe/template/head/주석 블록을 통째로 제거
 *      (제거 전 원본 head에서 메타데이터, JSON-LD 구조화 데이터, 이미지 URL 먼저 추출)
 *   2. title/og:title/og:description/description 메타 + JSON-LD Product를
 *      상단에 "제목:"/"요약:"/구조화 요약 으로 프리펜드
 *   3. select(배송국가 등 대용량 노이즈)·nav/header/footer/aside 블록 제거
 *   4. img alt 텍스트를 인라인으로 승격 (이미지에만 문구가 있는 상세페이지 대응)
 *   5. 블록 태그 종료를 줄바꿈으로, li는 "- " 로 변환
 *   6. 나머지 태그 전부 제거
 *   7. 소수 엔티티 디코딩
 *   8. 공백 정규화(연속 공백/개행 축소, 각 줄 trim)
 *   9. maxChars 초과 시 절삭 + truncated 플래그
 *
 * 카페24 등 한국 쇼핑몰 상세페이지는 (a) 전역 네비/약관/배송국가 목록이 본문보다
 * 훨씬 크고 (b) 소재·사이즈 등 핵심 정보가 지연로딩 이미지(ec-data-src 등) 안에만
 * 있는 경우가 많다. JSON-LD Product 블록이 있으면 가장 신뢰도 높은 신호이므로
 * 최우선으로 뽑아 맨 앞에 배치하고, 상세 이미지 URL도 별도로 수집해 반환한다
 * (다운로드는 이 함수의 책임이 아니다).
 */

export const HTML_TEXT_MAX_CHARS = 30000

/** 반환하는 상세 이미지 URL 최대 개수 (다운로드 측 12MB 한도를 고려한 상한) */
export const MAX_IMAGE_URLS = 12

export interface ProductOffer {
  name: string | null
  price: number | null
  priceCurrency: string | null
  availability: string | null
}

export interface ProductStructuredData {
  name: string | null
  description: string | null
  brand: string | null
  offers: ProductOffer[]
  images: string[]
}

export interface HtmlToTextResult {
  title: string | null
  text: string
  truncated: boolean
  /** JSON-LD Product 블록에서 뽑은 구조화 데이터. 없으면 null */
  structured: ProductStructuredData | null
  /** 상세페이지 이미지 절대 URL (상세 컨테이너 우선, 아이콘/배너/썸네일 제외) */
  imageUrls: string[]
}

export interface HtmlToTextOptions {
  /** 상대 경로·프로토콜 상대 URL을 절대 URL로 만들 때 쓰는 기준 URL */
  baseUrl?: string
}

/** script/style 등 내용까지 통째로 제거해야 하는 태그 목록 */
const STRIPPED_BLOCK_TAGS = [
  'script',
  'style',
  'noscript',
  'svg',
  'iframe',
  'template',
  'head',
  'select',
  'nav',
  'header',
  'footer',
  'aside',
]

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

/** 상품과 무관한 아이콘/배너/썸네일로 판단해 이미지 URL에서 제외할 패턴 */
const NOISE_IMAGE_URL_PATTERN = /icon|logo|banner|btn|bg_|sns|common|\/small\/|\/tiny\//i

/** 상세 설명이 담긴 컨테이너로 우선 취급할 후보 (id 또는 class) */
const DETAIL_CONTAINER_PATTERNS = [
  /id=["']prdDetail["']/i,
  /class=["'][^"']*xans-product-detail[^"']*["']/i,
  /itemprop=["']description["']/i,
  /id=["']contents["']/i,
]

/** img 태그에서 이미지 URL 후보를 뽑을 때 확인하는 속성 순서(우선순위 높은 것부터) */
const IMAGE_SRC_ATTRS = ['ec-data-src', 'data-src', 'data-original', 'data-lazy', 'src', 'srcset']

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

/** unknown 값이 plain object인지 좁힌다 (배열/null 제외) */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

/** JSON-LD 노드에서 `@type`이 지정한 타입을 포함하는지 확인한다 (문자열/배열 모두 지원) */
function hasType(node: Record<string, unknown>, type: string): boolean {
  const t = node['@type']
  if (typeof t === 'string') return t === type
  if (Array.isArray(t)) return t.some((v) => v === type)
  return false
}

/** JSON-LD 파싱 결과(단일 객체/배열/@graph)에서 최상위 노드 목록을 평탄화한다 */
function flattenJsonLdNodes(parsed: unknown): Record<string, unknown>[] {
  const nodes: Record<string, unknown>[] = []
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item)
      return
    }
    if (!isRecord(value)) return
    nodes.push(value)
    if (Array.isArray(value['@graph'])) {
      for (const item of value['@graph']) visit(item)
    }
  }
  visit(parsed)
  return nodes
}

/** offers 필드(단일 객체 또는 배열)를 ProductOffer[]로 정규화한다 */
function normalizeOffers(offers: unknown): ProductOffer[] {
  const list = Array.isArray(offers) ? offers : offers ? [offers] : []
  return list.filter(isRecord).map((offer) => ({
    name: asString(offer.name),
    price: asNumber(offer.price),
    priceCurrency: asString(offer.priceCurrency),
    availability: asString(offer.availability),
  }))
}

/** image 필드(문자열/배열/ImageObject)를 문자열 URL 배열로 정규화한다 */
function normalizeImages(image: unknown): string[] {
  const list = Array.isArray(image) ? image : image ? [image] : []
  const urls: string[] = []
  for (const item of list) {
    if (typeof item === 'string' && item.trim()) {
      urls.push(item.trim())
    } else if (isRecord(item)) {
      const url = asString(item.url)
      if (url) urls.push(url)
    }
  }
  return urls
}

/**
 * `<script type="application/ld+json">` 블록을 모두 찾아 `@type: "Product"` 노드를 추출한다.
 * 사이트마다 깨진 JSON-LD가 흔하므로 개별 블록 파싱 실패는 조용히 건너뛴다.
 */
function extractStructuredData(html: string): ProductStructuredData | null {
  const blockPattern = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  let match: RegExpExecArray | null
  while ((match = blockPattern.exec(html)) !== null) {
    let parsed: unknown
    try {
      parsed = JSON.parse(match[1])
    } catch {
      continue
    }
    const productNode = flattenJsonLdNodes(parsed).find((node) => hasType(node, 'Product'))
    if (!productNode) continue

    const brandNode = productNode.brand
    const brand = isRecord(brandNode) ? asString(brandNode.name) : asString(brandNode)

    return {
      name: asString(productNode.name),
      description: asString(productNode.description),
      brand,
      offers: normalizeOffers(productNode.offers),
      images: normalizeImages(productNode.image),
    }
  }
  return null
}

/** 구조화 데이터를 사람이 읽는 요약 텍스트로 렌더링한다 */
function renderStructuredSummary(data: ProductStructuredData): string {
  const lines: string[] = ['[상품 구조화 정보]']
  if (data.name) lines.push(`상품명: ${data.name}`)
  if (data.brand) lines.push(`브랜드: ${data.brand}`)
  if (data.description) lines.push(`설명: ${data.description}`)
  if (data.offers.length > 0) {
    lines.push('옵션:')
    for (const offer of data.offers) {
      const parts: string[] = []
      if (offer.name) parts.push(offer.name)
      if (offer.price !== null) {
        parts.push(`${offer.price}${offer.priceCurrency ?? ''}`)
      }
      if (offer.availability) parts.push(offer.availability)
      if (parts.length > 0) lines.push(`- ${parts.join(' / ')}`)
    }
  }
  return lines.join('\n')
}

/** 프로토콜 상대/상대 경로 URL을 절대 URL로 만든다. 실패하면 null. */
function resolveUrl(candidate: string, baseUrl?: string): string | null {
  const trimmed = candidate.trim()
  if (!trimmed) return null
  try {
    if (trimmed.startsWith('//')) return `https:${trimmed}`
    if (/^https?:\/\//i.test(trimmed)) return trimmed
    if (baseUrl) return new URL(trimmed, baseUrl).toString()
    return null // base 없이는 상대경로를 절대화할 수 없음
  } catch {
    return null
  }
}

/** srcset 값에서 첫 번째 후보 URL만 취한다 (`url 1x, url2 2x` → `url`) */
function firstSrcsetCandidate(value: string): string {
  return value.split(',')[0]?.trim().split(/\s+/)[0] ?? ''
}

/** 노이즈(아이콘/배너/썸네일 등) 이미지 URL인지 판단한다 */
function isNoiseImageUrl(url: string): boolean {
  return NOISE_IMAGE_URL_PATTERN.test(url)
}

/**
 * 주어진 HTML 조각(전체 문서 또는 특정 컨테이너)에서 `<img>` 태그의 이미지 URL 후보를 모두 뽑는다.
 * ec-data-src(지연로딩) > data-src/data-original/data-lazy > src > srcset 순으로 태그당 하나만 채택한다.
 */
function collectImageCandidates(htmlFragment: string, baseUrl: string | undefined): string[] {
  const urls: string[] = []
  const imgTagPattern = /<img\b[^>]*>/gi
  let match: RegExpExecArray | null
  while ((match = imgTagPattern.exec(htmlFragment)) !== null) {
    const tag = match[0]
    for (const attr of IMAGE_SRC_ATTRS) {
      const attrPattern = new RegExp(`${attr}=["']([^"']*)["']`, 'i')
      const attrMatch = tag.match(attrPattern)
      if (!attrMatch || !attrMatch[1].trim()) continue
      const raw = attr === 'srcset' ? firstSrcsetCandidate(attrMatch[1]) : attrMatch[1]
      const resolved = resolveUrl(raw, baseUrl)
      if (resolved && !isNoiseImageUrl(resolved)) {
        urls.push(resolved)
      }
      break // 태그당 가장 우선순위 높은 속성 하나만 채택
    }
  }
  return urls
}

/**
 * 상세 설명 컨테이너(#prdDetail 등)로 보이는 첫 블록의 시작 인덱스를 찾아 태그 깊이를 세며
 * 대응하는 닫는 태그까지의 범위를 반환한다. 중첩 구조를 안전하게 다루기 위해 정규식 대신
 * 단순 깊이 카운팅을 쓴다. 못 찾으면 null.
 */
function extractFirstDetailContainer(html: string): string | null {
  // DETAIL_CONTAINER_PATTERNS는 구체적인 컨테이너(#prdDetail)부터 넓은 폴백(#contents) 순으로
  // 정렬돼 있다. 문서상 위치가 아니라 목록 순서로 우선순위를 매겨야 #contents 같은 큰 래퍼가
  // 더 구체적인 컨테이너를 무력화하지 않는다.
  let openIdx = -1
  for (const pattern of DETAIL_CONTAINER_PATTERNS) {
    const attrMatch = html.match(pattern)
    if (!attrMatch || attrMatch.index === undefined) continue
    const tagStart = html.lastIndexOf('<', attrMatch.index)
    if (tagStart === -1) continue
    openIdx = tagStart
    break
  }
  if (openIdx === -1) return null

  const tagNameMatch = html.slice(openIdx).match(/^<([a-z0-9]+)/i)
  if (!tagNameMatch) return null
  const tagName = tagNameMatch[1]

  const tagPattern = new RegExp(`<(/?)${tagName}\\b[^>]*?(/?)>`, 'gi')
  tagPattern.lastIndex = openIdx
  let depth = 0
  let m: RegExpExecArray | null
  while ((m = tagPattern.exec(html)) !== null) {
    if (m[1] === '/') {
      depth -= 1
      if (depth === 0) return html.slice(openIdx, tagPattern.lastIndex)
    } else if (!m[2]) {
      depth += 1
    }
  }
  return null // 닫는 태그를 못 찾으면(깨진 HTML) 포기 — 전체 문서 스캔으로 폴백
}

/**
 * 상세 이미지 URL을 우선순위대로 수집한다: 상세 컨테이너 내부 → JSON-LD image → 나머지.
 * 중복 제거 후 MAX_IMAGE_URLS 개까지만 반환한다.
 */
function extractImageUrls(
  html: string,
  structured: ProductStructuredData | null,
  baseUrl: string | undefined
): string[] {
  const seen = new Set<string>()
  const ordered: string[] = []
  const add = (url: string) => {
    if (seen.has(url)) return
    seen.add(url)
    ordered.push(url)
  }

  const container = extractFirstDetailContainer(html)
  if (container) {
    for (const url of collectImageCandidates(container, baseUrl)) add(url)
  }

  if (structured) {
    for (const raw of structured.images) {
      const resolved = resolveUrl(raw, baseUrl)
      if (resolved && !isNoiseImageUrl(resolved)) add(resolved)
    }
  }

  for (const url of collectImageCandidates(html, baseUrl)) add(url)

  return ordered.slice(0, MAX_IMAGE_URLS)
}

export function htmlToText(
  html: string,
  maxChars: number = HTML_TEXT_MAX_CHARS,
  options: HtmlToTextOptions = {}
): HtmlToTextResult {
  // 1. 메타데이터/구조화 데이터/이미지는 원본(태그 제거 전) HTML에서 먼저 추출
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

  const structured = extractStructuredData(html)
  const imageUrls = extractImageUrls(html, structured, options.baseUrl)

  // 2. 주석 및 내용까지 제거해야 하는 블록 태그 제거
  //    (select=배송국가 등 대용량 노이즈, nav/header/footer/aside=전역 UI)
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

  // 메타데이터/구조화 데이터 프리펜드 — 모델이 가장 먼저 보는 자리에 가장 신뢰도 높은 정보를 배치
  const metaLines: string[] = []
  if (title) metaLines.push(`제목: ${title}`)
  if (summary) metaLines.push(`요약: ${summary}`)
  if (structured) metaLines.push(renderStructuredSummary(structured))
  if (metaLines.length > 0) {
    work = `${metaLines.join('\n\n')}\n\n${work}`
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

  return { title, text: work, truncated, structured, imageUrls }
}
