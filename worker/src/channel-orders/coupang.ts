/**
 * 쿠팡 주문 관측 수집기(읽기 전용) — ordersheets(상태 6종 × 창 × nextToken 페이지) + OBSERVE 취소 목록.
 * 수령인·주문자·해외배송 정보(receiver/orderer/overseaShippingInfoDto)는 읽지도 저장하지도 않는다.
 * 숫자 id 는 문자열로, paidAt/orderedAt 은 오프셋 없는 KST 문자열이라 ISO 로 바꾼다.
 */
import {
  StructureError,
  clip,
  iso,
  kstDay,
  rec,
  text,
  type Hooks,
  type OrderLine,
  type ScanLine,
  type TimeWindow,
} from './common.js'

export type CoupangGet = (
  path: string,
  query?: Record<string, string | number | undefined>,
  timeoutMs?: number
) => Promise<unknown>

export const COUPANG_STATUSES = [
  'ACCEPT',
  'INSTRUCT',
  'DEPARTURE',
  'DELIVERING',
  'FINAL_DELIVERY',
  'NONE_TRACKING',
] as const
const API = '/v2/providers/openapi/apis/api'
const MAX_PAGES = 200

const reqText = (v: unknown, what: string): string => {
  const s = text(v)
  if (!s) throw new StructureError(`${what} 없음`)
  return s
}

/** ordersheets 응답의 주문서(box) 하나 → 행들. 필수 필드 누락은 던진다. */
export function parseSheet(raw: unknown): OrderLine[] {
  const s = rec(raw)
  if (!s) throw new StructureError('주문서가 객체가 아닙니다')
  const shipmentBoxId = reqText(s.shipmentBoxId, 'shipmentBoxId')
  const orderId = reqText(s.orderId, 'orderId')
  const paidAt = iso(s.paidAt) ?? iso(s.orderedAt)
  if (!paidAt) throw new StructureError('paidAt/orderedAt 없음')
  const status = reqText(s.status, 'status').slice(0, 300)
  if (!Array.isArray(s.orderItems) || s.orderItems.length === 0)
    throw new StructureError('orderItems 없음')
  const tracking = clip(s.invoiceNumber, 100)
  return s.orderItems.map((it) => {
    const item = rec(it)
    const vendorItemId = reqText(item?.vendorItemId, 'vendorItemId')
    const productName = text(item?.vendorItemName) ?? text(item?.sellerProductName)
    if (!productName) throw new StructureError('vendorItemName/sellerProductName 없음')
    const qty = item?.shippingCount
    if (typeof qty !== 'number' || !Number.isInteger(qty) || qty < 0)
      throw new StructureError('shippingCount 이상')
    const cancelCount = typeof item?.cancelCount === 'number' ? item.cancelCount : 0
    return {
      externalLineKey: `${shipmentBoxId}:${vendorItemId}`,
      externalOrderId: orderId,
      paidAt,
      productName: productName.slice(0, 500),
      optionText: clip(item?.sellerProductItemName, 500),
      quantity: qty,
      channelStatus: status,
      claimStatus: item?.canceled === true ? 'CANCEL' : cancelCount > 0 ? 'PARTIAL_CANCEL' : null,
      deliveryKind: 'NORMAL',
      shippingDueAt: iso(item?.estimatedShippingDate),
      carrierCode: clip(s.deliveryCompanyName, 100),
      trackingNumber: tracking,
      dispatchedAt: tracking ? iso(s.inTrasitDateTime) : null,
      sourceChangedAt: null,
    }
  })
}

const toScan = (l: OrderLine): ScanLine => ({
  externalLineKey: l.externalLineKey,
  externalOrderId: l.externalOrderId,
  quantity: l.quantity,
  channelStatus: l.channelStatus,
  paidAt: l.paidAt,
})

/** `{ data: [...] , nextToken }` 한 장. data 가 배열이 아니면 구조 오류. */
function listPage(body: unknown): { data: unknown[]; next: string | null } {
  const b = rec(body)
  if (!b || !Array.isArray(b.data)) throw new StructureError('data 가 배열이 아닙니다')
  return { data: b.data, next: text(b.nextToken) }
}

/** 창 × 상태 6종 순회. 페이지(응답 1장)마다 page 훅. */
async function eachSheetPage(
  get: CoupangGet,
  vendorId: string,
  windows: TimeWindow[],
  hooks: Pick<Hooks<unknown>, 'request' | 'timeoutMs'>,
  onRows: (rows: OrderLine[]) => Promise<void>
) {
  for (const w of windows) {
    const createdAtFrom = kstDay(w.from)
    const createdAtTo = kstDay(Date.parse(w.to) - 1) // 자정에 끝나는 창이 다음 날까지 읽지 않게
    for (const status of COUPANG_STATUSES) {
      let token: string | null = null
      for (let pages = 0; ; pages++) {
        if (pages >= MAX_PAGES) throw new StructureError('nextToken 이 끝나지 않습니다')
        hooks.request()
        const { data, next } = listPage(
          await get(
            `${API}/v4/vendors/${vendorId}/ordersheets`,
            {
              createdAtFrom,
              createdAtTo,
              status,
              maxPerPage: 50,
              nextToken: token ?? undefined,
            },
            hooks.timeoutMs?.()
          )
        )
        await onRows(data.flatMap(parseSheet))
        if (!next) break
        token = next
      }
    }
  }
}

/** 취소 목록 한 장 → 다시 읽을 orderId 들(+ 그 항목 원문). orderId 가 없으면 구조 오류(조용히 무시하지 않는다). */
export function parseCancelPage(body: unknown): {
  orderIds: string[]
  receipts: Map<string, Record<string, unknown>[]>
  next: string | null
} {
  const { data, next } = listPage(body)
  const receipts = new Map<string, Record<string, unknown>[]>()
  for (const raw of data) {
    const id = reqText(rec(raw)?.orderId, 'cancel.orderId')
    receipts.set(id, [...(receipts.get(id) ?? []), rec(raw) as Record<string, unknown>])
  }
  return { orderIds: [...receipts.keys()], receipts, next }
}

/** 쿠팡은 전량 취소된 주문의 주문서 재조회를 400 「해당 주문이 취소 또는 반품 되었습니다」로 거부한다. */
export function isCancelledRefetchError(e: unknown): boolean {
  const err = e as { status?: unknown; body?: unknown } | null
  return err?.status === 400 && typeof err.body === 'string' && /취소 또는 반품/.test(err.body)
}

/**
 * 재조회가 막힌 전량 취소 주문 → 취소 목록 항목(returnItems)으로 취소 행을 만든다.
 * 키는 주문서와 같은 shipmentBoxId:vendorItemId. 수령인 등 개인정보 필드는 읽지 않는다.
 */
export function cancelReceiptLines(orderId: string, receipts: Record<string, unknown>[]): OrderLine[] {
  const lines: OrderLine[] = []
  for (const r of receipts) {
    // ponytail: 취소 목록엔 결제 시각이 없어 접수 시각으로 대신한다(전량 취소는 보통 결제 직후). 판정 창 소속만 쓰임.
    const paidAt = iso(r.createdAt)
    if (!paidAt) throw new StructureError('cancel.createdAt 없음')
    if (!Array.isArray(r.returnItems) || r.returnItems.length === 0)
      throw new StructureError('cancel.returnItems 없음')
    for (const it of r.returnItems) {
      const item = rec(it)
      const productName = text(item?.vendorItemName) ?? text(item?.sellerProductName)
      if (!productName) throw new StructureError('cancel.vendorItemName 없음')
      const qty = item?.purchaseCount
      if (typeof qty !== 'number' || !Number.isInteger(qty) || qty < 0)
        throw new StructureError('cancel.purchaseCount 이상')
      lines.push({
        externalLineKey: `${reqText(item?.shipmentBoxId, 'cancel.shipmentBoxId')}:${reqText(item?.vendorItemId, 'cancel.vendorItemId')}`,
        externalOrderId: orderId,
        paidAt,
        productName: productName.slice(0, 500),
        optionText: null,
        quantity: qty,
        channelStatus: `CANCEL:${text(r.receiptStatus) ?? 'UNKNOWN'}`.slice(0, 300),
        claimStatus: 'CANCEL',
        deliveryKind: 'NORMAL',
        shippingDueAt: null,
        carrierCode: null,
        trackingNumber: null,
        dispatchedAt: null,
        sourceChangedAt: iso(r.modifiedAt),
      })
    }
  }
  return lines
}

export async function observeCoupang(
  get: CoupangGet,
  vendorId: string,
  windows: TimeWindow[],
  hooks: Hooks<OrderLine>
) {
  await eachSheetPage(get, vendorId, windows, hooks, (rows) => hooks.page(rows))
  // 취소: 목록 한 장 = 1페이지. 그 장의 주문 재조회·ingest 가 끝나야 적재 1로 센다.
  for (const w of windows) {
    let token: string | null = null
    for (let pages = 0; ; pages++) {
      if (pages >= MAX_PAGES) throw new StructureError('취소 목록 nextToken 이 끝나지 않습니다')
      hooks.request()
      const { orderIds, receipts, next } = parseCancelPage(
        await get(
          `${API}/v6/vendors/${vendorId}/returnRequests`,
          {
            searchType: 'timeFrame',
            createdAtFrom: `${kstDay(w.from)}T00:00`,
            createdAtTo: `${kstDay(Date.parse(w.to) - 1)}T23:59`,
            cancelType: 'CANCEL',
            nextToken: token ?? undefined,
          },
          hooks.timeoutMs?.()
        )
      )
      const rows: OrderLine[] = []
      for (const orderId of orderIds) {
        hooks.check()
        // 이 경로는 shipmentBoxId 가 아니라 orderId 를 받고, data 는 그 주문의 주문서 배열이다.
        let fetched: unknown
        try {
          fetched = await get(
            `${API}/v4/vendors/${vendorId}/${orderId}/ordersheets`,
            undefined,
            hooks.timeoutMs?.()
          )
        } catch (e) {
          if (!isCancelledRefetchError(e)) throw e
          rows.push(...cancelReceiptLines(orderId, receipts.get(orderId) ?? []))
          continue
        }
        const body = rec(fetched)
        if (!body || !Array.isArray(body.data))
          throw new StructureError('주문 재조회 data 형태 이상')
        if (body.data.length === 0) throw new StructureError('취소 주문 재조회 결과 없음')
        rows.push(...body.data.flatMap(parseSheet))
      }
      await hooks.page(rows)
      if (!next) break
      token = next
    }
  }
}

export async function scanCoupang(
  get: CoupangGet,
  vendorId: string,
  windows: TimeWindow[],
  hooks: Hooks<ScanLine>
) {
  await eachSheetPage(get, vendorId, windows, hooks, (rows) => hooks.page(rows.map(toScan)))
}
