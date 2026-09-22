import { redirect } from 'next/navigation'
import { getUser } from '@/hooks/use-user'
import { resolveDeckContext } from '@/lib/api-helpers'
import { SETTINGS_BILLING_PATH } from '@/lib/deck-routes'
import { canUseDeck } from './entitlement'

/**
 * deck 레이아웃 공통 진입 가드.
 *
 * 기존 레이아웃은 로그인·워크스페이스·deck 설치만 확인해서, 구독이 만료(LOCKED)된
 * 뒤에도 URL 로 직접 들어가면 그대로 쓸 수 있었다. 여기서 entitlement 까지 본다.
 *
 * 막힌 경우 구독 관리 화면으로 보내되 `?subscribe=` 를 실어 해당 업무의 구독 확인
 * 모달이 바로 열리게 한다 — 사용자가 왜 막혔는지 알고 곧장 해결할 수 있다.
 */
export async function requireDeckAccess(deckAppId: string): Promise<{ spaceName: string }> {
  const user = await getUser()
  if (!user) redirect('/login')

  const resolved = await resolveDeckContext(deckAppId)
  if ('error' in resolved) redirect('/my-deck')

  if (!(await canUseDeck(resolved.space.id, deckAppId))) {
    redirect(`${SETTINGS_BILLING_PATH}?subscribe=${encodeURIComponent(deckAppId)}`)
  }

  return { spaceName: resolved.space.name }
}
