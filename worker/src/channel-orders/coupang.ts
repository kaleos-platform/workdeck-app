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
  query?: Record<string, string | number | undefined>
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
  request: () => void,
  onRows: (rows: OrderLine[]) => Promise<void>
) {
  for (const w of windows) {
    const createdAtFrom = kstDay(w.from)
    const createdAtTo = kstDay(Date.parse(w.to) - 1) // 자정에 끝나는 창이 다음 날까지 읽지 않게
    for (const status of COUPANG_STATUSES) {
      let token: string | null = null
      for (let pages = 0; ; pages++) {
        if (pages >= MAX_PAGES) throw new StructureError('nextToken 이 끝나지 않습니다')
        request()
        const { data, next } = listPage(
          await get(`${API}/v4/vendors/${vendorId}/ordersheets`, {
            createdAtFrom,
            createdAtTo,
            status,
            maxPerPage: 50,
            nextToken: token ?? undefined,
          })
        )
        await onRows(data.flatMap(parseSheet))
        if (!next) break
        token = next
      }
    }
  }
}

/** 취소 목록 한 장 → 다시 읽을 shipmentBoxId 들. 문서 필드가 없으면 구조 오류(조용히 무시하지 않는다). */
export function parseCancelPage(body: unknown): { boxIds: string[]; next: string | null } {
  const { data, next } = listPage(body)
  const ids = new Set<string>()
  for (const raw of data) {
    const r = rec(raw)
    reqText(r?.orderId, 'cancel.orderId')
    if (!Array.isArray(r?.returnItems) || r.returnItems.length === 0)
      throw new StructureError('cancel.returnItems 없음')
    for (const it of r.returnItems) {
      const item = rec(it)
      reqText(item?.vendorItemId, 'cancel.vendorItemId')
      ids.add(reqText(item?.shipmentBoxId ?? r.shipmentBoxId, 'cancel.shipmentBoxId'))
    }
  }
  return { boxIds: [...ids], next }
}

export async function observeCoupang(
  get: CoupangGet,
  vendorId: string,
  windows: TimeWindow[],
  hooks: Hooks<OrderLine>
) {
  await eachSheetPage(get, vendorId, windows, hooks.request, (rows) => hooks.page(rows))
  // 취소: 목록 한 장 = 1페이지. 그 장의 주문서 단건 재조회·ingest 가 끝나야 적재 1로 센다.
  for (const w of windows) {
    let token: string | null = null
    for (let pages = 0; ; pages++) {
      if (pages >= MAX_PAGES) throw new StructureError('취소 목록 nextToken 이 끝나지 않습니다')
      hooks.request()
      const { boxIds, next } = parseCancelPage(
        await get(`${API}/v6/vendors/${vendorId}/returnRequests`, {
          searchType: 'timeFrame',
          createdAtFrom: `${kstDay(w.from)}T00:00`,
          createdAtTo: `${kstDay(Date.parse(w.to) - 1)}T23:59`,
          cancelType: 'CANCEL',
          nextToken: token ?? undefined,
        })
      )
      const rows: OrderLine[] = []
      for (const box of boxIds) {
        hooks.check()
        const body = rec(await get(`${API}/v4/vendors/${vendorId}/${box}/ordersheets`))
        // 단건 응답의 data 는 배열이거나 주문서 객체 하나다.
        const data = Array.isArray(body?.data)
          ? body.data
          : body && rec(body.data)
            ? [body.data]
            : null
        if (!data) throw new StructureError('단건 data 형태 이상')
        if (data.length === 0) throw new StructureError('취소 주문서 단건 조회 결과 없음')
        rows.push(...data.flatMap(parseSheet))
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
  await eachSheetPage(get, vendorId, windows, hooks.request, (rows) => hooks.page(rows.map(toScan)))
}
