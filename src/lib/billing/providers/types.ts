// PG provider 추상화 — 도메인 로직(구독 상태머신·entitlement)은 provider를 모른다.
// Phase 1: toss. 추후 stripe 어댑터 추가 시 이 인터페이스만 구현하면 된다.

export interface IssueBillingKeyResult {
  billingKey: string
  cardSummary: string | null // "신한 ****1234" 표시용
}

export interface ChargeParams {
  billingKey: string
  customerKey: string
  orderId: string // 멱등키 — provider에도 그대로 전달
  orderName: string
  amount: number // VAT 포함 최종 결제액
  customerEmail?: string
}

export interface ChargeResult {
  ok: boolean
  paymentKey: string | null
  failReason: string | null
}

export interface CancelParams {
  paymentKey: string
  reason: string
}

export interface BillingProvider {
  readonly id: string // "toss"
  issueBillingKey(authKey: string, customerKey: string): Promise<IssueBillingKeyResult>
  charge(params: ChargeParams): Promise<ChargeResult>
  cancel(params: CancelParams): Promise<void>
  // 웹훅 페이로드에서 (orderId, status) 추출. 위조 방지는 상태를 신뢰하지 않고
  // paymentKey로 원 결제를 재조회(fetchPayment)해 검증하는 방식을 병행한다.
  parseWebhook(body: unknown): {
    eventType: string
    orderId: string | null
    paymentKey: string | null
  }
  fetchPaymentStatus(paymentKey: string): Promise<{ orderId: string; status: string }>
}
