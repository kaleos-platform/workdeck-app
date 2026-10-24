/**
 * 네이버 커머스API 호출 — N배송 상품주문 조회.
 * IP 가 등록된 워커에서만 호출한다. 앱 src/ 는 import 할 수 없어 타입을 로컬에 복사했다
 * (원본: src/lib/naver-commerce/client.ts, ingest 검증 스키마와 같은 모양을 유지).
 * ⚠️ 에러 메시지에 clientSecret/토큰을 넣지 않는다 — 응답 본문은 300자로 자른다.
 */
import bcrypt from 'bcryptjs'

const BASE = 'https://api.commerce.naver.com/external/v1'
const RATE_LIMIT_WAIT_MS = 1500
const MAX_429_RETRIES = 3
const MAX_PAGES = 100

export type NaverCommerceStoreSecret = { clientId: string; clientSecret: string }
export type NaverSkuMapping = { nsBarcode: string; pickingQuantityPerOrder: number }
export type NaverProductOrder = {
  orderId: string
  productOrderId: string
  paymentDate: string
  productName: string
  quantity: number
  remainQuantity: number
  totalPaymentAmount: number
  remainPaymentAmount: number
  productOrderStatus: string
  claimType: string | null
  deliveryAttributeType: string | null
  logisticsCompanyId: string | null
  skuMappings: NaverSkuMapping[]
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
export const RATE_LIMIT_MS = RATE_LIMIT_WAIT_MS

// clientSecret 자체가 bcrypt salt
export function signClientSecret(
  clientId: string,
  clientSecret: string,
  timestampMs: number
): string {
  const hashed = bcrypt.hashSync(`${clientId}_${timestampMs}`, clientSecret)
  return Buffer.from(hashed).toString('base64')
}

export async function issueToken(secret: NaverCommerceStoreSecret): Promise<string> {
  const timestamp = Date.now() - 3000
  const res = await fetch(`${BASE}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: secret.clientId,
      timestamp: String(timestamp),
      client_secret_sign: signClientSecret(secret.clientId, secret.clientSecret, timestamp),
      grant_type: 'client_credentials',
      type: 'SELF',
    }).toString(),
  })
  const text = await res.text()
  let token: unknown
  try {
    token = (JSON.parse(text) as { access_token?: unknown }).access_token
  } catch {
    token = undefined
  }
  if (!res.ok || typeof token !== 'string' || !token) {
    throw new Error(`naver-commerce token ${res.status}: ${text.slice(0, 300)}`)
  }
  return token
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

export function toProductOrder(raw: unknown): NaverProductOrder {
  const c = (
    raw as { content?: { order?: Record<string, unknown>; productOrder?: Record<string, unknown> } }
  )?.content
  const o = c?.order ?? {}
  const p = c?.productOrder ?? {}
  const skus = Array.isArray(p.skuMappings) ? (p.skuMappings as Record<string, unknown>[]) : []
  return {
    orderId: str(o.orderId) ?? '',
    productOrderId:
      str(p.productOrderId) ?? str((raw as { productOrderId?: unknown })?.productOrderId) ?? '',
    paymentDate: str(o.paymentDate) ?? '',
    productName: str(p.productName) ?? '',
    quantity: num(p.quantity),
    remainQuantity: num(p.remainQuantity),
    totalPaymentAmount: num(p.totalPaymentAmount),
    remainPaymentAmount: num(p.remainPaymentAmount),
    productOrderStatus: str(p.productOrderStatus) ?? '',
    claimType: str(p.claimType),
    deliveryAttributeType: str(p.deliveryAttributeType),
    logisticsCompanyId: str(p.logisticsCompanyId),
    skuMappings: skus.map((s) => ({
      nsBarcode: str(s.nsBarcode) ?? '',
      pickingQuantityPerOrder: num(s.pickingQuantityPerOrder),
    })),
  }
}

async function getPage(token: string, dayKst: string, page: number, waitMs: number) {
  const qs = new URLSearchParams({
    from: `${dayKst}T00:00:00.000+09:00`,
    to: `${dayKst}T23:59:59.999+09:00`,
    rangeType: 'PAYED_DATETIME',
    page: String(page),
  })
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${BASE}/pay-order/seller/product-orders?${qs}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (res.status === 429 && attempt < MAX_429_RETRIES) {
      await sleep(waitMs)
      continue
    }
    const text = await res.text()
    if (!res.ok) throw new Error(`naver-commerce orders ${res.status}: ${text.slice(0, 300)}`)
    try {
      return JSON.parse(text) as {
        data?: { contents?: unknown[]; pagination?: { hasNext?: boolean } }
      }
    } catch {
      throw new Error('naver-commerce orders parse error')
    }
  }
}

export async function fetchPaidProductOrders(
  token: string,
  dayKst: string,
  opts?: { delayMs?: number }
): Promise<NaverProductOrder[]> {
  const delayMs = opts?.delayMs ?? RATE_LIMIT_WAIT_MS
  const out: NaverProductOrder[] = []
  let dropped = 0
  for (let page = 1; ; page++) {
    if (page > MAX_PAGES)
      throw new Error(`naver-commerce orders page limit exceeded (${MAX_PAGES})`)
    if (page > 1) await sleep(delayMs)
    const body = (await getPage(token, dayKst, page, delayMs)).data
    for (const raw of body?.contents ?? []) {
      const o = toProductOrder(raw)
      if (o.orderId && o.paymentDate) out.push(o)
      else dropped++
    }
    if (!body?.pagination?.hasNext) break
  }
  if (dropped > 0)
    console.warn(`[naver-commerce] ${dayKst} orderId/paymentDate 없는 행 ${dropped}건 제외`)
  return out
}
