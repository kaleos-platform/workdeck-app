/**
 * 네이버 스마트스토어 주문 관측 수집기(읽기 전용).
 * - OBSERVE: last-changed-statuses(페이지 = 응답 1장) → 그 장의 productOrderId 를 300개씩 query → 행.
 * - FULL_SCAN: 결제일 목록(PAYED_DATETIME) 페이지 순회 → ScanLine.
 * 기존 fetchPaidProductOrders/toProductOrder 는 쓰지 않는다 — 빈 응답·필수 필드 누락을 조용히 넘기기 때문.
 * 응답에는 수령인·주소·주문자가 들어 있다 — 화이트리스트 필드만 꺼내고 나머지는 읽지도 않는다.
 * 응답 규칙(실사): HTTP 200 + traceId 있음 + data 없음 = 0건(정상). data 가 있는데 형태가 다르거나
 * data·traceId 둘 다 없으면 StructureError.
 */
import { BASE, MAX_429_RETRIES, RATE_LIMIT_MS, sleep } from '../naver-commerce.js'
import {
  HttpError,
  StructureError,
  clip,
  iso,
  kstOffset,
  rec,
  text,
  type Hooks,
  type OrderLine,
  type ScanLine,
  type TimeWindow,
} from './common.js'

export type NaverHttp = (
  method: 'GET' | 'POST',
  path: string,
  params?: Record<string, string>,
  body?: unknown,
  timeoutMs?: number
) => Promise<unknown>

const QUERY_CHUNK = 300
const MAX_PAGES = 100

/** 토큰 1개로 호출하는 HTTP. 호출 사이 1.5초, 429 는 3회 재시도. 오류 메시지에 토큰·본문 전체를 넣지 않는다. */
export function createNaverHttp(
  token: string,
  deps: { fetch?: typeof fetch; sleep?: (ms: number) => Promise<void> } = {}
): NaverHttp {
  const doFetch = deps.fetch ?? fetch
  const wait = deps.sleep ?? sleep
  let first = true
  return async (method, path, params, body, timeoutMs = 60_000) => {
    if (!first) await wait(RATE_LIMIT_MS)
    first = false
    const qs = params ? `?${new URLSearchParams(params)}` : ''
    for (let attempt = 0; ; attempt++) {
      const res = await doFetch(`${BASE}${path}${qs}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (res.status === 429 && attempt < MAX_429_RETRIES) {
        await res.body?.cancel()
        await wait(RATE_LIMIT_MS)
        continue
      }
      const raw = await res.text()
      if (!res.ok) throw new HttpError(res.status, `naver-commerce ${res.status}: ${path}`)
      try {
        return JSON.parse(raw) as unknown
      } catch {
        throw new StructureError('naver-commerce 응답이 JSON 이 아닙니다')
      }
    }
  }
}

/** 응답 body → data 객체. 0건 규칙: data 없음 + traceId 있음 → null. */
function dataOf(body: unknown): Record<string, unknown> | null {
  const b = rec(body)
  if (!b) throw new StructureError('응답이 객체가 아닙니다')
  if (!('data' in b)) {
    if (typeof b.traceId === 'string' && b.traceId) return null
    throw new StructureError('data 도 traceId 도 없습니다')
  }
  const d = rec(b.data)
  if (!d) throw new StructureError('data 형태가 올바르지 않습니다')
  return d
}

const reqText = (v: unknown, what: string): string => {
  const s = text(v)
  if (!s) throw new StructureError(`${what} 없음`)
  return s
}
const reqIso = (v: unknown, what: string): string => {
  const s = iso(v)
  if (!s) throw new StructureError(`${what} 없음/해석 불가`)
  return s
}
const reqQty = (v: unknown): number => {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0)
    throw new StructureError('quantity 이상')
  return v
}

type StatusItem = { productOrderId: string; lastChangedDate: string | null }

/** last-changed-statuses 한 장 → 항목들 + 이어받기 커서. */
export function parseStatusPage(body: unknown): {
  items: StatusItem[]
  more: { moreFrom: string; moreSequence: string } | null
} {
  const d = dataOf(body)
  if (!d) return { items: [], more: null }
  const list = d.lastChangeStatuses
  if (!Array.isArray(list)) throw new StructureError('lastChangeStatuses 가 배열이 아닙니다')
  const items = list.map((raw) => {
    const r = rec(raw)
    return {
      productOrderId: reqText(r?.productOrderId, 'productOrderId'),
      lastChangedDate: iso(r?.lastChangedDate),
    }
  })
  let more: { moreFrom: string; moreSequence: string } | null = null
  if (d.more !== undefined && d.more !== null) {
    const m = rec(d.more)
    more = {
      moreFrom: reqText(m?.moreFrom, 'more.moreFrom'),
      moreSequence: reqText(m?.moreSequence, 'more.moreSequence'),
    }
  }
  return { items, more }
}

/** query 응답 → 관측 행(화이트리스트). */
export function parseQueryRows(body: unknown, changed: Map<string, string | null>): OrderLine[] {
  const b = rec(body)
  if (!b || !Array.isArray(b.data)) throw new StructureError('query data 가 배열이 아닙니다')
  return b.data.map((raw) => {
    const r = rec(raw)
    const order = rec(r?.order)
    const po = rec(r?.productOrder)
    if (!order || !po) throw new StructureError('order/productOrder 없음')
    const delivery = rec(r?.delivery)
    const key = reqText(po.productOrderId, 'productOrderId')
    return {
      externalLineKey: key,
      externalOrderId: reqText(order.orderId, 'orderId'),
      paidAt: reqIso(order.paymentDate, 'paymentDate'),
      productName: reqText(po.productName, 'productName').slice(0, 500),
      optionText: clip(po.productOption, 500),
      quantity: reqQty(po.quantity),
      channelStatus: reqText(po.productOrderStatus, 'productOrderStatus').slice(0, 300),
      claimStatus: clip(po.claimStatus ?? po.claimType, 100),
      deliveryKind: clip(po.deliveryAttributeType, 300) ?? 'NORMAL',
      shippingDueAt: iso(po.shippingDueDate),
      carrierCode: clip(delivery?.deliveryCompany, 100),
      trackingNumber: clip(delivery?.trackingNumber, 100),
      dispatchedAt: iso(delivery?.sendDate),
      sourceChangedAt: changed.get(key) ?? null,
    }
  })
}

/** 결제일 목록 한 장 → ScanLine + 다음 장 여부. */
export function parseScanPage(body: unknown): { lines: ScanLine[]; hasNext: boolean } {
  const d = dataOf(body)
  if (!d) return { lines: [], hasNext: false }
  if (!Array.isArray(d.contents)) throw new StructureError('contents 가 배열이 아닙니다')
  const p = rec(d.pagination)
  if (!p || typeof p.hasNext !== 'boolean') throw new StructureError('pagination 형태 이상')
  const lines = d.contents.map((raw) => {
    const c = rec(rec(raw)?.content)
    const order = rec(c?.order)
    const po = rec(c?.productOrder)
    if (!order || !po) throw new StructureError('content.order/productOrder 없음')
    return {
      externalLineKey: reqText(po.productOrderId ?? rec(raw)?.productOrderId, 'productOrderId'),
      externalOrderId: reqText(order.orderId, 'orderId'),
      quantity: reqQty(po.quantity),
      channelStatus: reqText(po.productOrderStatus, 'productOrderStatus').slice(0, 300),
      paidAt: reqIso(order.paymentDate, 'paymentDate'),
    }
  })
  return { lines, hasNext: p.hasNext }
}

/** OBSERVE — 창마다 변경 목록을 이어받으며 페이지(응답 1장)별로 query → page 훅. */
export async function observeNaver(
  http: NaverHttp,
  windows: TimeWindow[],
  hooks: Hooks<OrderLine>
) {
  for (const w of windows) {
    let params: Record<string, string> = {
      lastChangedFrom: kstOffset(w.from),
      lastChangedTo: kstOffset(w.to),
    }
    for (let pages = 0; ; pages++) {
      if (pages >= MAX_PAGES) throw new HttpError(0, '변경 목록 페이지 상한 초과')
      hooks.request()
      const { items, more } = parseStatusPage(
        await http(
          'GET',
          '/pay-order/seller/product-orders/last-changed-statuses',
          params,
          undefined,
          hooks.timeoutMs?.()
        )
      )
      const changed = new Map<string, string | null>()
      for (const it of items) changed.set(it.productOrderId, it.lastChangedDate)
      const ids = [...changed.keys()] // 한 장 안의 같은 주문 중복 변경은 1건으로
      const rows: OrderLine[] = []
      for (let i = 0; i < ids.length; i += QUERY_CHUNK) {
        hooks.check()
        const chunk = ids.slice(i, i + QUERY_CHUNK)
        const got = parseQueryRows(
          await http(
            'POST',
            '/pay-order/seller/product-orders/query',
            undefined,
            { productOrderIds: chunk },
            hooks.timeoutMs?.()
          ),
          changed
        )
        // 건수 비교는 중복 행이 누락을 가린다 — 요청 id 집합과 응답 키 집합이 정확히 같아야 한다.
        const asked = new Set(chunk)
        const gotKeys = new Set(got.map((r) => r.externalLineKey))
        const missing = chunk.filter((id) => !gotKeys.has(id)).length
        const extra = got.filter((r) => !asked.has(r.externalLineKey)).length
        if (missing > 0 || extra > 0)
          throw new StructureError(`query 응답 불일치(누락 ${missing}건, 요청 외 ${extra}건)`)
        rows.push(...got)
      }
      await hooks.page(rows)
      if (!more) break
      params = {
        lastChangedFrom: more.moreFrom,
        lastChangedTo: kstOffset(w.to),
        moreSequence: more.moreSequence,
      }
    }
  }
}

/** FULL_SCAN — 창(KST 일자)마다 결제일 목록 전 페이지. */
export async function scanNaver(http: NaverHttp, windows: TimeWindow[], hooks: Hooks<ScanLine>) {
  for (const w of windows) {
    for (let page = 1; ; page++) {
      if (page > MAX_PAGES) throw new HttpError(0, '결제일 목록 페이지 상한 초과')
      hooks.request()
      const { lines, hasNext } = parseScanPage(
        await http(
          'GET',
          '/pay-order/seller/product-orders',
          {
            from: kstOffset(w.from),
            to: kstOffset(w.to),
            rangeType: 'PAYED_DATETIME',
            page: String(page),
          },
          undefined,
          hooks.timeoutMs?.()
        )
      )
      await hooks.page(lines)
      if (!hasNext) break
    }
  }
}
