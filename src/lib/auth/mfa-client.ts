import { mfaStepUpPath } from './mfa-policy'

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
