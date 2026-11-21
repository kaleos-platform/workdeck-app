import type { Breadcrumb, ErrorEvent, EventHint } from '@sentry/nextjs'

export const IGNORE_ERRORS = [
  'Failed to fetch',
  'Load failed',
  'NetworkError when attempting to fetch resource',
  'ResizeObserver loop',
  'AbortError',
]

const R = '[redacted]'
// 순서 중요: 토큰·JWT 먼저, 그다음 긴 숫자열(카드·계좌) → 주민/사업자/전화
const PATTERNS: RegExp[] = [
  /eyJ[\w-]+\.[\w-]+\.[\w-]+/g,
  /Bearer\s+[\w.~+/=-]+/gi,
  /\b(?:sk_|sntrys_|sntryu_|wdk_)[\w-]+/g,
  /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g,
  /\b\d{3}-\d{2}-\d{5}\b/g,
  /\b\d{6}-?[1-4]\d{6}\b/g,
  /\b\d(?:[ -]?\d){12,18}\b/g,
  /(?:\+82[\s-]?)?0?1[016789][\s-]?\d{3,4}[\s-]?\d{4}\b/g,
  /\d{10,}/g,
  // 따옴표 안 한글 — 이름·주소가 주로 이 형태로 섞인다
  /(["'`])[^"'`\n]*[가-힣][^"'`\n]*\1/g,
  // 주소: "서울시 강남구", "테헤란로 1", "역삼동 12-3"
  /[가-힣]+(?:시|도)\s+[가-힣]+(?:구|군|시)/g,
  /[가-힣0-9]+(?:로|길|동|읍|면|리)\s*\d+(?:-\d+)?/g,
]

export function scrubText(s: string): string {
  // JSON 문자열 값은 키만 남긴다(구형 Safari 때문에 lookbehind 대신 캡처 그룹)
  let out = s.replace(/("[\w-]+"\s*:\s*)"(?:[^"\\]|\\.)*"/g, `$1${R}`)
  for (const p of PATTERNS) out = out.replace(p, R)
  return out.slice(0, 300)
}

const KEEP_TAGS = ['environment', 'runtime', 'release', 'transaction']
const KEEP_CONTEXTS = ['os', 'browser', 'runtime', 'trace', 'react', 'nextjs', 'cloud_resource']

function pick<T extends object>(obj: T | undefined, keys: string[]): Partial<T> | undefined {
  if (!obj) return obj
  return Object.fromEntries(Object.entries(obj).filter(([k]) => keys.includes(k))) as Partial<T>
}

export function scrubBreadcrumb(b: Breadcrumb): Breadcrumb {
  // console 브레드크럼 message 는 모든 인자를 이어붙인 값 → 첫 인자(라벨)만 남긴다
  let message = b.message
  if (b.category === 'console') {
    const first = (b.data as { arguments?: unknown[] } | undefined)?.arguments?.[0]
    message = typeof first === 'string' ? first : (message ?? '').split(/[\n{]/)[0]
  }
  const rest = { ...b, message: message ? scrubText(message) : message }
  delete rest.data
  return rest
}

export function scrubEvent<T extends ErrorEvent>(event: T, _hint?: EventHint): T {
  void _hint
  const hasException = Boolean(event.exception?.values?.length)

  if (event.logger === 'console' && !hasException) {
    // captureConsole 은 모든 인자를 이어붙여 message 로 보낸다 → 첫 인자(라벨)만 남긴다
    const first = (event.extra as { arguments?: unknown[] } | undefined)?.arguments?.[0]
    const label = typeof first === 'string' ? first : (event.message ?? '').split(/[\n{]/)[0]
    event.message = label
    if (event.logentry) event.logentry = { message: label }
  }

  if (event.message) event.message = scrubText(event.message)
  if (event.logentry?.message) event.logentry.message = scrubText(event.logentry.message)

  for (const ex of event.exception?.values ?? []) {
    if (ex.value) ex.value = scrubText(ex.value)
    for (const f of ex.stacktrace?.frames ?? []) delete f.vars
  }

  event.tags = pick(event.tags, KEEP_TAGS) as typeof event.tags
  event.contexts = pick(event.contexts, KEEP_CONTEXTS) as typeof event.contexts
  event.user = event.user?.id ? { id: event.user.id } : undefined
  delete event.request
  delete event.extra
  event.breadcrumbs = event.breadcrumbs?.map(scrubBreadcrumb)
  return event
}
