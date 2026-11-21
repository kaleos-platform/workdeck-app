/**
 * 워커 Sentry 연동 — index.ts 의 첫 import 로 불러온다. SENTRY_DSN 이 없으면 아무것도 안 한다.
 * 마스킹 로직은 웹 `src/lib/sentry/scrub.ts` 복사본(워커는 별도 패키지). 한쪽을 고치면 다른 쪽도 맞춘다.
 */
import type { Breadcrumb, ErrorEvent } from '@sentry/node'

export const IGNORE_ERRORS = ['ExperimentalWarning', 'DeprecationWarning']

// 기존 Slack 알림 경로가 있는 반복 실패 — 이슈 1개로 묶어 노이즈를 줄인다(이벤트 수·쿼터는 그대로)
const GROUPS: [RegExp, string][] = [
  [/LoginError|로그인 실패/, 'worker-login-failure'],
  [/TimeoutError|Timeout \d+ms exceeded|ETIMEDOUT|ECONNRESET|net::ERR_/, 'worker-external-timeout'],
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
  // JSON 문자열 값은 키만 남긴다(웹과 같게 lookbehind 대신 캡처 그룹)
  let out = s.replace(/("[\w-]+"\s*:\s*)"(?:[^"\\]|\\.)*"/g, `$1${R}`)
  for (const p of PATTERNS) out = out.replace(p, R)
  return out.slice(0, 300)
}

const KEEP_TAGS = ['environment', 'runtime', 'service', 'release', 'transaction']
const KEEP_CONTEXTS = ['os', 'runtime', 'trace', 'cloud_resource']

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

export function scrubEvent<T extends ErrorEvent>(event: T): T {
  const hasException = Boolean(event.exception?.values?.length)

  if (event.logger === 'console') {
    const first = (event.extra as { arguments?: unknown[] } | undefined)?.arguments?.[0]
    if (!hasException) {
      // captureConsole 은 모든 인자를 이어붙여 message 로 보낸다 → 첫 인자(라벨)만 남긴다
      const label = typeof first === 'string' ? first : (event.message ?? '').split(/[\n{]/)[0]
      event.message = label
      if (event.logentry) event.logentry = { message: label }
    } else if (typeof first === 'string') {
      // console.error('[x] 실패:', err) 면 SDK 는 예외만 보낸다 → 어느 작업인지 첫 인자 라벨을 남긴다
      event.message = first
    }
  }

  // 그룹 판정은 마스킹 전 원문으로(숫자 마스킹이 'Timeout 30000ms' 를 지운다)
  const haystack = [
    event.message,
    ...(event.exception?.values ?? []).flatMap((ex) => [ex.type, ex.value]),
  ].join('\n')
  const group = GROUPS.find(([re]) => re.test(haystack))
  if (group) event.fingerprint = [group[1]]

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
  delete event.server_name // 맥미니 호스트명
  event.breadcrumbs = event.breadcrumbs?.map(scrubBreadcrumb)
  return event
}

// index.ts 의 unhandledRejection 핸들러가 남기는 console.error — SDK 가 같은 rejection 을 스택과 함께 이미 보낸다
function beforeSend(event: ErrorEvent): ErrorEvent | null {
  if (event.logger === 'console' && event.message?.startsWith('[worker] unhandledRejection'))
    return null
  return scrubEvent(event)
}

// 지연 import — 운영 체크아웃에서 npm install 을 빠뜨려도 DSN 을 넣기 전까진 부팅이 깨지지 않는다.
// index.ts 는 이걸 기다린 뒤 poller 를 시작한다(초기화 전 오류 누락 방지).
export const sentryReady: Promise<void> = !process.env.SENTRY_DSN
  ? Promise.resolve()
  : import('@sentry/node')
      .then((Sentry) => {
        Sentry.init({
          dsn: process.env.SENTRY_DSN,
          environment: process.env.SENTRY_ENVIRONMENT ?? 'production',
          // 'runtime' 태그는 Sentry 가 contexts.runtime(node vXX)으로 덮어쓴다 → 별도 키
          initialScope: { tags: { service: 'worker' } },
          tracesSampleRate: 0,
          sendDefaultPii: false,
          beforeSend,
          beforeBreadcrumb: scrubBreadcrumb,
          ignoreErrors: IGNORE_ERRORS,
          integrations: [Sentry.captureConsoleIntegration({ levels: ['error'] })],
        })

        // launchd/pm2 종료 시 전송 대기 이벤트를 비운 뒤 같은 신호로 다시 죽는다(기본 종료 동작 유지)
        for (const sig of ['SIGTERM', 'SIGINT'] as const) {
          process.once(sig, () => {
            void Sentry.close(2000).finally(() => process.kill(process.pid, sig))
          })
        }
      })
      .catch((e: unknown) => console.warn('[sentry] 비활성 — @sentry/node 로드 실패:', e))
