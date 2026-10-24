/**
 * 스마트스토어 N배송 판매 수집 — 앱의 plan 을 받아 스토어별로 커머스API 를 조회하고 ingest/finish 로 보고한다.
 * 비밀값(clientSecret·토큰·암호문)은 로그·에러 메시지에 남기지 않는다.
 */
import {
  getNaverNbaesongPlan,
  postNaverNbaesongFinish,
  postNaverNbaesongIngest,
  type NaverNbaesongPlanItem,
} from './api-client.js'
import { decryptField } from './field-crypto.js'
import {
  fetchPaidProductOrders,
  issueToken,
  RATE_LIMIT_MS,
  sleep,
  type NaverCommerceStoreSecret,
  type NaverProductOrder,
} from './naver-commerce.js'

export type NbaesongDeps = {
  getPlan: () => Promise<{ items: NaverNbaesongPlanItem[] }>
  decrypt: (encrypted: string, iv: string) => string
  issueToken: (secret: NaverCommerceStoreSecret) => Promise<string>
  fetchOrders: (token: string, dayKst: string) => Promise<NaverProductOrder[]>
  ingest: (body: {
    spaceId: string
    storeKey: string
    dayKst: string
    orders: NaverProductOrder[]
  }) => Promise<void>
  finish: typeof postNaverNbaesongFinish
  delay: (ms: number) => Promise<void>
  log: (line: string) => void
}

const defaultDeps: NbaesongDeps = {
  getPlan: getNaverNbaesongPlan,
  decrypt: (enc, iv) => decryptField('space-credential', enc, iv),
  issueToken,
  fetchOrders: (token, day) => fetchPaidProductOrders(token, day),
  ingest: postNaverNbaesongIngest,
  finish: postNaverNbaesongFinish,
  delay: sleep,
  log: (line) => console.log(line),
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

export async function runNaverNbaesongSync(
  overrides?: Partial<NbaesongDeps>
): Promise<{ stores: number; days: number; failed: number }> {
  const d = { ...defaultDeps, ...overrides }
  const total = { stores: 0, days: 0, failed: 0 }
  let first = true

  for (const item of (await d.getPlan()).items) {
    let secrets: Record<string, NaverCommerceStoreSecret> | null = null
    let decryptError = ''
    try {
      secrets =
        (JSON.parse(d.decrypt(item.encryptedPayload, item.iv)) as { stores?: typeof secrets })
          .stores ?? {}
    } catch {
      // 복호화 오류 원문에는 암호문 조각이 섞일 수 있어 고정 문구만 쓴다.
      decryptError = '자격증명 복호화 실패'
    }

    for (const store of item.stores) {
      // 호출 한도는 앱 단위라 스토어 사이에도 간격을 둔다.
      if (!first) await d.delay(RATE_LIMIT_MS)
      first = false
      total.stores++
      total.days += store.days.length

      const ok: string[] = []
      let firstError = decryptError
      const secret = secrets?.[store.key]
      let token: string | null = null
      if (!firstError && !secret) firstError = '스토어 자격증명이 없습니다'
      if (!firstError && secret) {
        try {
          token = await d.issueToken(secret)
        } catch (e) {
          firstError = msg(e)
        }
      }

      if (token) {
        for (const [i, day] of store.days.entries()) {
          if (i > 0) await d.delay(RATE_LIMIT_MS)
          try {
            const orders = await d.fetchOrders(token, day)
            await d.ingest({ spaceId: item.spaceId, storeKey: store.key, dayKst: day, orders })
            ok.push(day)
          } catch (e) {
            firstError ||= msg(e)
          }
        }
      }

      total.failed += store.days.length - ok.length
      d.log(
        `[naver-nbaesong] space=${item.spaceId} store=${store.key} days=${store.days.length} ok=${ok.length}${firstError ? ' failed' : ''}`
      )
      try {
        await d.finish({
          spaceId: item.spaceId,
          storeKey: store.key,
          attempted: store.days,
          ok,
          ...(firstError ? { error: firstError } : {}),
        })
      } catch (e) {
        d.log(`[naver-nbaesong] finish 실패 store=${store.key}: ${msg(e)}`)
      }
    }
  }
  return total
}
