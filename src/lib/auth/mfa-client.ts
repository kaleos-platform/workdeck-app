import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { mfaStepUpPath } from './mfa-policy'

export type MfaStepUpResult = 'verified' | 'cancelled' | 'enroll' | 'unavailable'
type MfaDeps = { stepUp: () => Promise<MfaStepUpResult> }

const CANCELLED_MESSAGE = '2단계 인증을 취소해 저장하지 않았습니다'
const RETRY_FAILED_MESSAGE = '인증은 완료됐지만 저장하지 못했습니다. 다시 시도해 주세요'
const UNAVAILABLE_MESSAGE = '2단계 인증 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요'

// Response.json 정적 메서드는 구형 Safari 에 없다.
function mfaError(message: string, code: string) {
  return new Response(JSON.stringify({ message, code }), {
    status: 403,
    headers: { 'Content-Type': 'application/json' },
  })
}

// 다이얼로그 모듈은 필요할 때만 불러와 mfa-client 를 가볍게 둔다.
const defaultDeps: MfaDeps = {
  stepUp: async () => (await import('@/components/auth/mfa-step-up-dialog')).requestMfaStepUp(),
}

// 단계 인증은 한 번에 하나만 — 동시에 MFA_REQUIRED 를 받은 요청들이 같은 Promise 를 공유한다.
let stepUpInFlight: Promise<MfaStepUpResult> | null = null
// 인증 뒤 재전송은 MFA_REQUIRED 를 받은 순서대로 직렬 실행한다(연속 클릭 시 마지막 클릭이 마지막에 반영).
let resendChain: Promise<void> = Promise.resolve()

async function isMfaRequired(res: Response): Promise<boolean> {
  if (res.status !== 403) return false
  const body = (await res
    .clone()
    .json()
    .catch(() => null)) as { code?: string } | null
  return body?.code === 'MFA_REQUIRED'
}

/**
 * fetch + 제자리 단계 인증. 403 MFA_REQUIRED 면 현재 화면 위 다이얼로그로 TOTP 를 받고, 성공하면 같은 요청을 1회 재전송한다.
 * 인증 기기가 없으면(enroll) 원 응답을 그대로 돌려 호출부의 redirectIfMfaRequired 가 등록 페이지로 보낸다.
 * body 는 문자열/FormData 만 써야 재전송할 수 있다.
 */
export async function fetchWithMfa(
  input: RequestInfo | URL,
  init?: RequestInit,
  deps: MfaDeps = defaultDeps
): Promise<Response> {
  const res = await fetch(input, init)
  if (!(await isMfaRequired(res))) return res

  // 재전송 순번은 MFA_REQUIRED 를 받은 시점에 동기적으로 확정한다.
  const prev = resendChain
  let release!: () => void
  resendChain = new Promise<void>((resolve) => (release = resolve))
  try {
    stepUpInFlight ??= deps.stepUp().finally(() => {
      stepUpInFlight = null
    })
    const result = await stepUpInFlight
    if (result === 'enroll') return res
    if (result === 'cancelled') {
      toast.error(CANCELLED_MESSAGE)
      return mfaError(CANCELLED_MESSAGE, 'MFA_CANCELLED')
    }
    if (result === 'unavailable') {
      toast.error(UNAVAILABLE_MESSAGE)
      return mfaError(UNAVAILABLE_MESSAGE, 'MFA_UNAVAILABLE')
    }
    // ponytail: 앞선 재전송이 응답 없이 멈추면 뒤 순번도 기다린다 — 필요해지면 prev 대기에 시간 제한
    await prev
    // 인증으로 갱신된 세션이 저장소(쿠키)에 반영되도록 한 번 읽고 재전송한다.
    await createClient().auth.getSession()
    const retried = await fetch(input, init)
    if (await isMfaRequired(retried)) {
      toast.error(RETRY_FAILED_MESSAGE)
      return mfaError(RETRY_FAILED_MESSAGE, 'MFA_RETRY_FAILED')
    }
    return retried
  } finally {
    // 앞선 재전송이 끝난 뒤에만 다음 순번을 풀어 준다.
    void prev.then(release)
  }
}

type MfaNav = { currentPath: () => string; go: (url: string) => void }

const browserNav: MfaNav = {
  currentPath: () => window.location.pathname + window.location.search,
  go: (url) => window.location.assign(url),
}

/**
 * 자격증명 저장 API 가 403 MFA_REQUIRED 를 주면 단계 인증 페이지로 보낸다(돌아올 경로 포함).
 * 이동했으면 true — 호출부는 이후 오류 토스트를 띄우지 않는다. 본문은 clone 으로 읽어 호출부가 다시 읽을 수 있다.
 */
export async function redirectIfMfaRequired(
  res: Response,
  nav: MfaNav = browserNav
): Promise<boolean> {
  if (res.status !== 403) return false
  const body = (await res
    .clone()
    .json()
    .catch(() => null)) as { code?: string } | null
  if (body?.code !== 'MFA_REQUIRED') return false
  nav.go(mfaStepUpPath(nav.currentPath()))
  return true
}
