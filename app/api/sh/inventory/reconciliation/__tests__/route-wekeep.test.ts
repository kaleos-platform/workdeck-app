/** @jest-environment node */
import { NextRequest } from 'next/server'
import { POST } from '../route'
import { getWekeepInventoryRows, WekeepSourceError } from '@/lib/inv/reconciliation-sources'
import { runReconciliationMatch } from '@/lib/inv/reconciliation-core'
import { WekeepError } from '@/lib/inv/wekeep-client'

jest.mock('@/lib/api-helpers', () => ({
  resolveDeckContext: jest.fn(async () => ({ space: { id: 'sp' }, user: { id: 'u' } })),
  errorResponse: (message: string, status: number, extra?: object) =>
    Response.json({ message, ...extra }, { status }),
}))
jest.mock('@/lib/prisma', () => ({ prisma: {} }))
jest.mock('@/lib/inv/resolve-coupang-workspace', () => ({}))
jest.mock('@/lib/inv/coupang-channel-pairing', () => ({}))
jest.mock('@/lib/inv/reconciliation-sources', () => {
  class WekeepSourceError extends Error {}
  return {
    getCoupangInventoryRows: jest.fn(),
    getWekeepInventoryRows: jest.fn(),
    WekeepSourceError,
  }
})
jest.mock('@/lib/inv/reconciliation-core', () => ({
  runReconciliationMatch: jest.fn(),
  ReconciliationCoreError: class extends Error {},
}))

const post = async (body: object) =>
  (await POST(
    new NextRequest('http://x/api/sh/inventory/reconciliation', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  )) as Response
const getRows = getWekeepInventoryRows as jest.Mock

describe('POST reconciliation source=wekeep', () => {
  beforeEach(() => jest.clearAllMocks())

  it('행을 대조 코어에 넘기고 쿠팡 연동과 같은 응답 형태를 돌려준다', async () => {
    const parsed = { format: 'inventory_list', rows: [{ externalCode: 'A', quantity: 1 }] }
    getRows.mockResolvedValue(parsed)
    ;(runReconciliationMatch as jest.Mock).mockResolvedValue({
      reconciliationId: 'r1',
      format: 'inventory_list',
      snapshotDate: null,
      matchResult: { totalItems: 1, matchedItems: 1, entries: [] },
    })
    const res = await post({ source: 'wekeep', locationId: 'loc' })
    expect(res.status).toBe(200)
    expect(getRows).toHaveBeenCalledWith('sp', 'loc')
    const arg = (runReconciliationMatch as jest.Mock).mock.calls[0][0]
    expect(arg).toMatchObject({ spaceId: 'sp', parsed, locationId: 'loc' })
    expect(arg.fileName).toMatch(/^위킵 재고 \(연동 \d{4}-\d{2}-\d{2} \d{2}:\d{2} KST\)$/)
    expect((await res.json()).id).toBe('r1')
  })

  it('locationId 없으면 400', async () => {
    expect((await post({ source: 'wekeep' })).status).toBe(400)
  })

  it('연동 안 된 위치는 400', async () => {
    getRows.mockRejectedValue(new WekeepSourceError('위킵 연동이 설정된 활성 위치가 아닙니다.'))
    const res = await post({ source: 'wekeep', locationId: 'loc' })
    expect(res.status).toBe(400)
    expect(runReconciliationMatch).not.toHaveBeenCalled()
  })

  it('WekeepError 매핑: LOGIN_FAILED 400, 그 외 502, 비밀번호 미노출', async () => {
    getRows.mockRejectedValueOnce(new WekeepError('LOGIN_FAILED'))
    const a = await post({ source: 'wekeep', locationId: 'loc' })
    expect(a.status).toBe(400)
    getRows.mockRejectedValueOnce(new WekeepError('BLOCKED'))
    const b = await post({ source: 'wekeep', locationId: 'loc' })
    expect(b.status).toBe(502)
    expect(JSON.stringify(await b.json())).not.toMatch(/password|pw/i)
  })
})
