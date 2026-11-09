// supabase-js 인증 요청엔 타임아웃이 없다 — 인증 서버가 멈추면(2026-11-09 운영 DB 정체) 폼이 영구히 로딩에 갇힌다.
export const AUTH_REQUEST_TIMEOUT_MS = 20_000
export const AUTH_TIMEOUT_MESSAGE = '서버 응답이 지연되고 있습니다. 잠시 후 다시 시도해주세요.'

/**
 * 제한 시간 안에 끝나지 않거나 예외를 던지면 null. 원래 요청은 취소되지 않는다.
 * updateUser·signOut·MFA 는 auth-js 잠금(10초)을 기다리다 오류를 반환이 아닌 throw 로 낸다 —
 * 무응답 요청 뒤 재시도하면 그렇게 되므로 예외도 「지연」으로 다룬다(안 그러면 폼이 다시 멈춘다).
 */
export function withAuthTimeout<T>(request: Promise<T>): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), AUTH_REQUEST_TIMEOUT_MS)
  })
  return Promise.race([request.catch(() => null), timeout]).finally(() => clearTimeout(timer))
}

/** 인증 서버 일시 장애(네트워크·5xx) 응답인지 — 사용자 입력 문제가 아니므로 지연 안내로 보여준다. */
export function isAuthServerError(error: { name?: string; status?: number } | null | undefined) {
  return (
    !!error && (error.name === 'AuthRetryableFetchError' || !error.status || error.status >= 500)
  )
}
