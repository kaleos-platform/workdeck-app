/** @jest-environment node */
import { StructureError, type Hooks, type OrderLine, type ScanLine } from '../common.js'
import {
  COUPANG_STATUSES,
  observeCoupang,
  parseCancelPage,
  parseSheet,
  scanCoupang,
  type CoupangGet,
} from '../coupang.js'

const sheet = (
  box: number,
  items: Record<string, unknown>[] = [{}],
  over: Record<string, unknown> = {}
) => ({
  shipmentBoxId: box,
  orderId: 9000 + box,
  orderedAt: '2026-11-24T09:00:00',
  paidAt: '2026-11-24T09:01:00',
  status: 'ACCEPT',
  deliveryCompanyName: 'CJ대한통운',
  invoiceNumber: '555',
  inTrasitDateTime: '2026-11-24 12:00:00',
  orderer: { name: '주문자B', safeNumber: '0504-111' },
  receiver: { name: '수령인C', addr1: '비밀로 1', postCode: '12345' },
  overseaShippingInfoDto: { personalCustomsClearanceCode: 'P123456789' },
  orderItems: items.map((it, i) => ({
    vendorItemId: 7000 + i,
    vendorItemName: '쿠팡 상품',
    sellerProductName: '셀러 상품',
    sellerProductItemName: '옵션1',
    shippingCount: 3,
    cancelCount: 0,
    canceled: false,
    estimatedShippingDate: '2026-11-26',
    ...it,
  })),
  ...over,
})
const W = [{ from: '2026-11-23T15:00:00.000Z', to: '2026-11-24T15:00:00.000Z' }]

function hooks<L>() {
  const pages: L[][] = []
  const state = { requested: 0 }
  const h: Hooks<L> = {
    request: () => void state.requested++,
    check: () => undefined,
    page: async (lines) => void pages.push(lines),
  }
  return { h, pages, state }
}

describe('쿠팡 행 변환', () => {
  it('숫자 id 를 문자열로, KST 문자열을 ISO 로, 개인정보는 담지 않는다', () => {
    const [row] = parseSheet(sheet(1))
    expect(row).toEqual({
      externalLineKey: '1:7000',
      externalOrderId: '9001',
      paidAt: '2026-11-24T00:01:00.000Z',
      productName: '쿠팡 상품',
      optionText: '옵션1',
      quantity: 3,
      channelStatus: 'ACCEPT',
      claimStatus: null,
      deliveryKind: 'NORMAL',
      shippingDueAt: '2026-11-25T15:00:00.000Z',
      carrierCode: 'CJ대한통운',
      trackingNumber: '555',
      dispatchedAt: '2026-11-24T03:00:00.000Z',
      sourceChangedAt: null,
    })
    const json = JSON.stringify(row)
    for (const pii of ['주문자B', '0504', '수령인C', '비밀로', 'P123456789'])
      expect(json).not.toContain(pii)
  })
  it('취소·부분취소 claimStatus, 송장 없으면 dispatchedAt null, paidAt 없으면 orderedAt', () => {
    const rows = parseSheet(
      sheet(2, [{ canceled: true }, { cancelCount: 1 }], { invoiceNumber: null, paidAt: undefined })
    )
    expect(rows.map((r) => r.claimStatus)).toEqual(['CANCEL', 'PARTIAL_CANCEL'])
    expect(rows[0].dispatchedAt).toBeNull()
    expect(rows[0].paidAt).toBe('2026-11-24T00:00:00.000Z')
    expect(rows[0].quantity).toBe(3) // shippingCount 원문 유지
  })
  it('필수 필드 누락 → StructureError', () => {
    expect(() => parseSheet(sheet(3, [{ vendorItemId: undefined }]))).toThrow(StructureError)
    expect(() =>
      parseSheet(sheet(3, [{ vendorItemName: undefined, sellerProductName: undefined }]))
    ).toThrow(StructureError)
    expect(() => parseSheet(sheet(3, [{ shippingCount: '3' }]))).toThrow(StructureError)
    expect(() => parseSheet(sheet(3, [{}], { orderItems: undefined }))).toThrow(StructureError)
    expect(() => parseSheet(sheet(3, [{}], { paidAt: undefined, orderedAt: undefined }))).toThrow(
      StructureError
    )
    expect(() => parseSheet(sheet(3, [{}], { status: undefined }))).toThrow(StructureError)
  })
  it('취소 목록: 문서 필드가 없으면 조용히 무시하지 않고 실패', () => {
    expect(parseCancelPage({ data: [] })).toEqual({ boxIds: [], next: null })
    expect(
      parseCancelPage({
        data: [{ orderId: 1, returnItems: [{ vendorItemId: 2, shipmentBoxId: 3 }] }],
      }).boxIds
    ).toEqual(['3'])
    expect(() =>
      parseCancelPage({ data: [{ orderId: 1, returnItems: [{ vendorItemId: 2 }] }] })
    ).toThrow(StructureError)
    expect(() => parseCancelPage({ data: [{ returnItems: [] }] })).toThrow(StructureError)
    expect(() => parseCancelPage({})).toThrow(StructureError)
  })
})

describe('observeCoupang / scanCoupang', () => {
  const route =
    (extra?: (path: string, q: Record<string, unknown>) => unknown | undefined): CoupangGet =>
    async (path, q = {}) => {
      const custom = extra?.(path, q)
      if (custom !== undefined) return custom
      if (path.endsWith('returnRequests')) return { data: [] }
      return { data: [], nextToken: '' }
    }

  it('상태 6종 × 창, nextToken 페이지마다 1페이지, 빈 취소 목록도 1페이지', async () => {
    const seen: string[] = []
    const get = route((path, q) => {
      if (!path.endsWith('ordersheets')) return undefined
      seen.push(`${q.status}:${q.createdAtFrom}~${q.createdAtTo}:${q.nextToken ?? ''}`)
      if (q.status === 'ACCEPT' && !q.nextToken) return { data: [sheet(1)], nextToken: 'T2' }
      if (q.status === 'ACCEPT') return { data: [sheet(2)], nextToken: '' }
      return undefined
    })
    const { h, pages, state } = hooks<OrderLine>()
    await observeCoupang(get, 'A001', W, h)
    // 시트 7장(ACCEPT 2장 + 5상태) + 취소 목록 1장
    expect(state.requested).toBe(COUPANG_STATUSES.length + 1 + 1)
    expect(pages).toHaveLength(COUPANG_STATUSES.length + 1 + 1)
    expect(seen[0]).toBe('ACCEPT:2026-11-24~2026-11-24:')
    expect(seen[1]).toBe('ACCEPT:2026-11-24~2026-11-24:T2')
  })
  it('취소 목록 → 주문서 단건 재조회 후 한 페이지로 ingest', async () => {
    const get = route((path) => {
      if (path.endsWith('returnRequests'))
        return { data: [{ orderId: 5, returnItems: [{ vendorItemId: 7000, shipmentBoxId: 55 }] }] }
      if (path.endsWith('/55/ordersheets')) return { data: [sheet(55, [{ canceled: true }])] }
      return undefined
    })
    const { h, pages } = hooks<OrderLine>()
    await observeCoupang(get, 'A001', W, h)
    const last = pages.at(-1)!
    expect(last.map((r) => [r.externalLineKey, r.claimStatus])).toEqual([['55:7000', 'CANCEL']])
  })
  it('취소 단건 결과 없음 → 실패(그 페이지는 적재 안 됨)', async () => {
    const get = route((path) => {
      if (path.endsWith('returnRequests'))
        return { data: [{ orderId: 5, returnItems: [{ vendorItemId: 7000, shipmentBoxId: 55 }] }] }
      if (path.endsWith('/55/ordersheets')) return { data: [] }
      return undefined
    })
    const { h, pages } = hooks<OrderLine>()
    await expect(observeCoupang(get, 'A001', W, h)).rejects.toThrow(StructureError)
    expect(pages).toHaveLength(COUPANG_STATUSES.length)
  })
  it('data 가 배열이 아니면 구조 오류', async () => {
    const { h } = hooks<OrderLine>()
    await expect(observeCoupang(async () => ({ nextToken: '' }), 'A001', W, h)).rejects.toThrow(
      StructureError
    )
  })
  it('FULL_SCAN 은 ordersheets 만 읽고 ScanLine 으로 낸다(취소 목록 호출 없음)', async () => {
    const paths: string[] = []
    const get: CoupangGet = async (path) => {
      paths.push(path)
      return { data: [sheet(1)], nextToken: '' }
    }
    const { h, pages } = hooks<ScanLine>()
    await scanCoupang(get, 'A001', W, h)
    expect(paths.every((p) => p.endsWith('/ordersheets'))).toBe(true)
    expect(pages[0][0]).toEqual({
      externalLineKey: '1:7000',
      externalOrderId: '9001',
      quantity: 3,
      channelStatus: 'ACCEPT',
      paidAt: '2026-11-24T00:01:00.000Z',
    })
  })
})
