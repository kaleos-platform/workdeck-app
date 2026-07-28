// 토스페이먼츠 빌링(자동결제) 어댑터.
// 흐름: SDK requestBillingAuth → successUrl(authKey) → issueBillingKey → 이후 charge 반복.
// 주의: 토스는 정기결제 스케줄링을 제공하지 않는다 — 매월 결제 트리거는 앱 cron 책임.
// 승인 API 응답이 최대 60초 걸릴 수 있어 호출부 라우트는 maxDuration 여유 필수.
import type {
  BillingProvider,
  ChargeParams,
  ChargeResult,
  CancelParams,
  IssueBillingKeyResult,
} from './types'

const API_BASE = 'https://api.tosspayments.com'

function authHeader(): string {
  const secretKey = process.env.TOSS_SECRET_KEY
  if (!secretKey) throw new Error('TOSS_SECRET_KEY 환경변수가 설정되지 않았습니다')
  return `Basic ${Buffer.from(`${secretKey}:`).toString('base64')}`
}

interface TossErrorBody {
  code?: string
  message?: string
}

async function tossFetch(path: string, body?: Record<string, unknown>): Promise<Response> {
  return fetch(`${API_BASE}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Authorization: authHeader(),
      'Content-Type': 'application/json',
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
}

interface TossBillingResponse {
  billingKey: string
  card?: { issuerCode?: string; number?: string; cardCompany?: string }
  cardCompany?: string
  cardNumber?: string
}

interface TossPaymentResponse {
  paymentKey: string
  orderId: string
  status: string
}

export const tossProvider: BillingProvider = {
  id: 'toss',

  async issueBillingKey(authKey: string, customerKey: string): Promise<IssueBillingKeyResult> {
    const res = await tossFetch('/v1/billing/authorizations/issue', { authKey, customerKey })
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as TossErrorBody
      throw new Error(`토스 빌링키 발급 실패: ${err.code ?? res.status} ${err.message ?? ''}`)
    }
    const data = (await res.json()) as TossBillingResponse
    const company = data.card?.cardCompany ?? data.cardCompany ?? null
    const number = data.card?.number ?? data.cardNumber ?? null
    const masked = number ? `****${number.replace(/\D/g, '').slice(-4)}` : null
    const cardSummary = company || masked ? [company, masked].filter(Boolean).join(' ') : null
    return { billingKey: data.billingKey, cardSummary }
  },

  async charge(params: ChargeParams): Promise<ChargeResult> {
    const { billingKey, ...body } = params
    const res = await tossFetch(`/v1/billing/${encodeURIComponent(billingKey)}`, {
      customerKey: body.customerKey,
      orderId: body.orderId,
      orderName: body.orderName,
      amount: body.amount,
      ...(body.customerEmail ? { customerEmail: body.customerEmail } : {}),
    })
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as TossErrorBody
      return {
        ok: false,
        paymentKey: null,
        failReason: `${err.code ?? res.status}: ${err.message ?? '결제 승인 실패'}`,
      }
    }
    const data = (await res.json()) as TossPaymentResponse
    return { ok: true, paymentKey: data.paymentKey, failReason: null }
  },

  async cancel(params: CancelParams): Promise<void> {
    const res = await tossFetch(`/v1/payments/${encodeURIComponent(params.paymentKey)}/cancel`, {
      cancelReason: params.reason,
    })
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as TossErrorBody
      throw new Error(`토스 결제 취소 실패: ${err.code ?? res.status} ${err.message ?? ''}`)
    }
  },

  parseWebhook(body: unknown) {
    const b = body as {
      eventType?: string
      data?: { orderId?: string; paymentKey?: string; status?: string }
    }
    return {
      eventType: b?.eventType ?? 'UNKNOWN',
      orderId: b?.data?.orderId ?? null,
      paymentKey: b?.data?.paymentKey ?? null,
    }
  },

  async fetchPaymentStatus(paymentKey: string) {
    const res = await tossFetch(`/v1/payments/${encodeURIComponent(paymentKey)}`)
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as TossErrorBody
      throw new Error(`토스 결제 조회 실패: ${err.code ?? res.status} ${err.message ?? ''}`)
    }
    const data = (await res.json()) as TossPaymentResponse
    return { orderId: data.orderId, status: data.status }
  },
}

export function getBillingProvider(): BillingProvider {
  return tossProvider
}
