/**
 * /api/sc/jobs/worker 응답의 credential 을 연다.
 * 서버는 암호문({ encryptedPayload, iv })만 보내고 워커가 channel-credential 용도 키로 복호화한다.
 * 전환 기간: 구버전 앱이 보내는 평문 { payload } 도 받는다 — 레거시 정리 PR(Task 7 Step 8-7)에서 이 분기를 함께 삭제한다.
 */
import { decryptSecret } from '../encryption.js'

export type SealedCredential = { encryptedPayload: string; iv: string; expiresAt?: string | null }

export function openCredential(raw: unknown): { payload: Record<string, unknown> } | null {
  if (!raw || typeof raw !== 'object') return null
  const c = raw as Partial<SealedCredential> & { payload?: Record<string, unknown> }
  if (c.payload && typeof c.payload === 'object') return { payload: c.payload }
  if (typeof c.encryptedPayload !== 'string' || typeof c.iv !== 'string') return null
  try {
    return { payload: JSON.parse(decryptSecret('channel-credential', c.encryptedPayload, c.iv)) }
  } catch (err) {
    // 원문·키를 로그에 남기지 않는다 — 원인 메시지만.
    console.error('[sc-credential] 복호화 실패:', err instanceof Error ? err.message : String(err))
    return null
  }
}
