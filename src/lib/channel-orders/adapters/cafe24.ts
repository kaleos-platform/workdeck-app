/**
 * 카페24 주문 어댑터(앱 서버, 읽기 전용) — GET /api/v2/admin/orders 만 호출한다.
 * 개인정보(수령인·연락처·주소·구매자)는 읽지도 저장하지도 않는다: 필요한 필드만 골라 담는다.
 * 응답 구조가 기대와 다르면 빈 목록으로 넘기지 않고 Cafe24StructureError 로 실패시킨다.
 */
import { Cafe24Error, cafe24Get } from '@/lib/cafe24/client'
import { prisma } from '@/lib/prisma'
import { ingestLines, ingestScanLines } from '../ingest'
import { finishFullScan, finishObserve, startFullScan, startObserve } from '../operations'
import {
  ChannelOrderError,
  MAX_INGEST_LINES,
  type OrderLineInput,
  type ScanLineInput,
} from '../types'

const PAGE = 100
const MAX_OFFSET = 15000
const KST = 9 * 3_600_000

export class Cafe24StructureError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'Cafe24StructureError'
  }
}

export const kstDay = (d: Date) => new Date(d.getTime() + KST).toISOString().slice(0, 10)

const rec = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
const text = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)
/** ingest 스키마 한도(types.ts)에 맞춰 자른다 — 길다고 페이지 전체가 invalid 로 실패하지 않게. 키·ID 는 자르지 않는다(충돌 방지). */
const clip = (v: unknown, max: number): string | null => text(v)?.slice(0, max) ?? null
function iso(v: unknown): string | null {
  const s = text(v)
  if (!s) return null
  const t = Date.parse(/(Z|[+-]\d\d:?\d\d)$/.test(s) ? s : `${s.replace(' ', 'T')}+09:00`)
  return Number.isFinite(t) ? new Date(t).toISOString() : null
}

export type Cafe24Row = { line: OrderLineInput; scan: ScanLineInput }

/** 응답 한 페이지 → 행. orders/items 구조·필수 필드가 없으면 던진다. */
export function parseOrdersPage(body: unknown): { rows: Cafe24Row[]; orderCount: number } {
  const orders = rec(body)?.orders
  if (!Array.isArray(orders)) throw new Cafe24StructureError('orders 없음')
  const rows: Cafe24Row[] = []
  for (const o of orders) {
    const order = rec(o)
    const orderId = text(order?.order_id)
    const paidAt = iso(order?.payment_date) ?? iso(order?.order_date)
    if (!order || !orderId || !paidAt) throw new Cafe24StructureError('order_id/결제일 없음')
    if (!Array.isArray(order.items)) throw new Cafe24StructureError('items 없음')
    const canceled = order.canceled === 'T'
    for (const it of order.items) {
      const item = rec(it)
      const key = text(item?.order_item_code)
      const status = clip(item?.order_status, 300)
      const qty = Number(item?.quantity)
      if (!item || !key || !status || !Number.isInteger(qty)) {
        throw new Cafe24StructureError('order_item_code/상태/수량 없음')
      }
      const cancelledItem = canceled || /^C/i.test(status)
      const shippedAt = iso(item.shipped_date) ?? iso(order.shipped_date)
      const tracking = clip(item.tracking_no, 100)
      const changed = [iso(order.cancel_date), shippedAt].filter(Boolean).sort().pop() ?? null
      rows.push({
        line: {
          externalLineKey: key,
          externalOrderId: orderId,
          paidAt,
          productName: clip(item.product_name, 500) ?? '',
          // 개인정보 방지: 구매자가 입력한 텍스트(additional_option_value)는 읽지도 저장하지도 않는다. option_value 만.
          optionText: clip(item.option_value, 500),
          quantity: qty,
          channelStatus: status,
          claimStatus: cancelledItem ? 'CANCEL' : null,
          // ponytail: 판매자배송 구분 필드를 문서로 확인하지 못해 전부 NORMAL — 확인되면 여기서 분기
          deliveryKind: 'NORMAL',
          shippingDueAt: null,
          carrierCode: clip(item.shipping_company_code, 100),
          trackingNumber: tracking,
          dispatchedAt: tracking ? shippedAt : null,
          sourceChangedAt: changed,
        },
        scan: {
          externalLineKey: key,
          externalOrderId: orderId,
          quantity: qty,
          channelStatus: status,
          paidAt,
        },
      })
    }
  }
  return { rows, orderCount: orders.length }
}

/** 한 번에 보낼 수 있는 행 수(MAX_INGEST_LINES)로 나눈다. 빈 페이지도 ingest 호출 1번으로 센다. */
function chunks<T>(rows: T[]): T[][] {
  const out: T[][] = []
  for (let i = 0; i < rows.length; i += MAX_INGEST_LINES)
    out.push(rows.slice(i, i + MAX_INGEST_LINES))
  return out.length ? out : [[]]
}

/** 한 창(KST 일자 범위)의 모든 페이지를 차례로 읽는다. onPage 는 페이지마다 호출. */
export async function fetchWindow(
  spaceId: string,
  mallId: string | null, // null = 레거시 `cafe24` 행(storeKey 없는 옛 설정)
  from: Date,
  to: Date,
  onPage: (rows: Cafe24Row[]) => Promise<void>,
  stats: { requested: number; received: number }
) {
  for (let offset = 0; offset <= MAX_OFFSET; offset += PAGE) {
    stats.requested++
    const body = await cafe24Get(spaceId, mallId, '/admin/orders', {
      // 결제일 기준(apidocs get-orders date_type=pay_date). 기본값(주문일)이면 입금 전 주문이 섞인다.
      date_type: 'pay_date',
      start_date: kstDay(from),
      end_date: kstDay(to),
      limit: PAGE,
      offset,
      embed: 'items',
    })
    const { rows, orderCount } = parseOrdersPage(body)
    stats.received++
    await onPage(rows)
    if (orderCount < PAGE) return
  }
  throw new Cafe24Error('api', 'server_error') // 조회 상한 초과 — 완료로 치지 않는다
}

export function errorCodeOf(err: unknown): string {
  if (err instanceof ChannelOrderError) return err.code // lease_lost 등으로 뭉개지 않고 그대로 기록
  if (err instanceof Cafe24StructureError) return 'structure_invalid'
  if (err instanceof Cafe24Error) {
    return [
      'not_configured',
      'not_authorized',
      'reauth_required',
      'invalid_grant',
      'unauthorized',
      'forbidden',
    ].includes(err.code)
      ? 'auth_error'
      : 'api_error'
  }
  return 'unknown'
}

/** 증분 관측 1회: lease → 창별 조회·ingest → 전체 성공일 때만 finish 로 커서 전진. */
export async function runCafe24Observe(channelId: string, now = new Date()) {
  let started
  try {
    started = await startObserve(channelId, now)
  } catch (err) {
    if (err instanceof ChannelOrderError) return { channelId, skipped: err.code }
    throw err
  }
  const windows = started.windows // 서버가 start 에서 계획·저장한 창
  const stats = { requested: 0, received: 0 }
  let rows = 0
  let ingested = 0
  try {
    for (const w of windows) {
      await fetchWindow(
        started.spaceId,
        started.storeKey,
        w.from,
        w.to,
        async (page) => {
          for (const part of chunks(page.map((r) => r.line))) {
            await ingestLines(started.operationId, part)
          }
          rows += page.length
          ingested++
        },
        stats
      )
    }
    const fin = await finishObserve(
      {
        operationId: started.operationId,
        success: windows.length > 0,
        through: windows.at(-1)?.to.toISOString(),
        pagesRequested: stats.requested,
        pagesIngested: ingested,
        rows,
      },
      new Date()
    )
    return { channelId, status: fin.status, rows, windows: windows.length }
  } catch (err) {
    const code = errorCodeOf(err)
    await finishObserve(
      {
        operationId: started.operationId,
        success: false,
        pagesRequested: stats.requested,
        pagesIngested: ingested,
        rows,
        errorCode: code,
      },
      new Date()
    ).catch(() => null)
    return { channelId, status: 'FAILED', error: code }
  }
}

/**
 * 일일 전수 조회: 서버가 계획한 KST 자정 정렬 일자 창(7일 전 00:00 ~ 시작 시각)을 겹침 없이 읽어
 * ScanLine 으로 저장한다(관측 테이블엔 쓰지 않는다). 같은 행은 ingest 에서 (operationId, 행 키)로 중복 제거.
 */
export async function runCafe24FullScan(channelId: string, now = new Date()) {
  let started
  try {
    started = await startFullScan(channelId, now)
  } catch (err) {
    if (err instanceof ChannelOrderError) return { channelId, skipped: err.code }
    throw err
  }
  const stats = { requested: 0, received: 0 }
  let structureOk = true
  let success = true
  let errorCode: string | undefined
  try {
    for (const w of started.windows) {
      await fetchWindow(
        started.spaceId,
        started.storeKey,
        w.from,
        w.to,
        async (page) => {
          for (const part of chunks(page.map((r) => r.scan))) {
            await ingestScanLines(started.operationId, part)
          }
        },
        stats
      )
    }
  } catch (err) {
    success = false
    errorCode = errorCodeOf(err)
    structureOk = !(err instanceof Cafe24StructureError)
  }
  const fin = await finishFullScan(
    {
      operationId: started.operationId,
      success,
      periodFrom: started.windows[0].from.toISOString(),
      periodTo: now.toISOString(),
      pagesRequested: stats.requested,
      pagesReceived: stats.received,
      structureOk,
      errorCode,
    },
    new Date()
  )
  return { channelId, status: fin.status }
}

/** 대사 직전 일일 실행: 증분 관측을 먼저 끝내(같은 lease 규칙) 관측 상태를 최신으로 만든 뒤 전수 조회한다. */
export async function runCafe24Daily(channelId: string) {
  const observe = await runCafe24Observe(channelId)
  const scan = await runCafe24FullScan(channelId, new Date())
  return { channelId, observe, scan }
}

export const listCafe24Channels = () =>
  prisma.channelFulfillmentSetting.findMany({
    where: { adapter: 'cafe24', observeEnabled: true },
    select: { channelId: true },
  })
