/**
 * 워커가 채널 주문 관측에 쓰는 자격 정보 조회(plan start 응답용).
 * - 네이버: 그 Space 의 naver-commerce 키(평문) — N배송 plan 이 같은 Space 토큰에 이미 내려주는 범위와 같다.
 * - 쿠팡: 비밀이 아닌 vendorId 만. 평문 secretKey 는 절대 싣지 않는다(워커가 api-credentials 암호문을 로컬 복호화).
 * 실패는 전부 null — 원문·평문 조각은 로그에 남기지 않는다.
 */
import { decryptField } from '@/lib/crypto/field-crypto'
import { prisma } from '@/lib/prisma'
import {
  NAVER_COMMERCE_PROVIDER,
  type NaverCommerceSecret,
  type NaverCommerceStoreSecret,
} from '@/lib/naver-commerce/client'

export async function loadNaverStoreSecret(
  spaceId: string,
  storeKey: string | null
): Promise<NaverCommerceStoreSecret | null> {
  if (!storeKey) return null
  try {
    const rows = await prisma.spaceCredential.findMany({
      where: { spaceId, provider: NAVER_COMMERCE_PROVIDER },
      select: { encryptedPayload: true, iv: true },
    })
    for (const r of rows) {
      const store = (
        JSON.parse(
          decryptField('space-credential', r.encryptedPayload, r.iv)
        ) as NaverCommerceSecret
      ).stores?.[storeKey]
      if (typeof store?.clientId === 'string' && typeof store.clientSecret === 'string') {
        return { clientId: store.clientId, clientSecret: store.clientSecret }
      }
    }
  } catch (err) {
    // JSON 파싱 오류 메시지는 평문 조각을 담을 수 있어 종류만 남긴다.
    console.error(
      '[channel-orders/worker-secret] 네이버 자격증명 복호화 실패',
      spaceId,
      err instanceof SyntaxError ? 'JSON 파싱 실패' : err instanceof Error ? err.message : 'unknown'
    )
  }
  return null
}

export async function loadCoupangVendorId(spaceId: string): Promise<string | null> {
  try {
    const cred = await prisma.coupangApiCredential.findFirst({
      where: { workspace: { spaceId }, isActive: true },
      select: { vendorId: true },
    })
    return cred?.vendorId ?? null
  } catch (err) {
    console.error(
      '[channel-orders/worker-secret] 쿠팡 vendorId 조회 실패',
      spaceId,
      err instanceof Error ? err.message : 'unknown'
    )
    return null
  }
}
