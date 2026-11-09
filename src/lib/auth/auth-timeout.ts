// supabase-js 인증 요청엔 타임아웃이 없다 — 인증 서버가 멈추면(2026-11-09 운영 DB 정체) 폼이 영구히 로딩에 갇힌다.
export const AUTH_REQUEST_TIMEOUT_MS = 20_000
export const AUTH_TIMEOUT_MESSAGE = '서버 응답이 지연되고 있습니다. 잠시 후 다시 시도해주세요.'

/** 제한 시간 안에 끝나지 않으면 null. 원래 요청은 취소되지 않는다. */
export function withAuthTimeout<T>(request: Promise<T>): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), AUTH_REQUEST_TIMEOUT_MS)
  })
  return Promise.race([request, timeout]).finally(() => clearTimeout(timer))
}
