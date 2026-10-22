/** @jest-environment node */
jest.mock('@/lib/prisma', () => ({
  prisma: { spaceCredential: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) } },
}))
jest.mock('@/lib/crypto/field-crypto', () => ({
  decryptField: jest.fn((_p: string, v: string) => v),
}))

import crypto from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { assertDownloadUrl, parseTsv, resolveCustomer, sign } from '../naver-searchad'
import { naverAdsTools } from '@/lib/agent/tools/naver-ads-tools'
import { toolDefinitions } from '@/lib/agent/tools'
import type { McpToolContext } from '@/lib/agent/tools/types'

const CONFIG = {
  defaultBrand: 'ameaning',
  managerCustomerId: '1000',
  customers: { ameaning: '2630153', creamd: '2526287' },
}
const SECRET = { apiKey: 'api-key-0123456789', secretKey: 'secret-key-0123456789' }
const ctx = (): McpToolContext => ({
  spaceId: 'sp1',
  actor: { type: 'agent', id: 'agent-1' },
  scopes: ['naver:read'],
  workId: 'wk',
  requesterUserId: null,
  requesterSlackUserId: null,
  decryptedCredentialIds: [],
})
const tool = (n: string) => naverAdsTools.find((t) => t.name === n)!
const fetchMock = jest.fn()

beforeEach(() => {
  jest.clearAllMocks()
  global.fetch = fetchMock as unknown as typeof fetch
  ;(prisma.spaceCredential.findUnique as jest.Mock).mockResolvedValue({
    id: 'ncred',
    encryptedPayload: JSON.stringify(SECRET),
    iv: 'iv',
    config: CONFIG,
  })
})

const ok = (body: unknown) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: 200 })
const call = (i = 0) => {
  const [url, init] = fetchMock.mock.calls[i] as [URL, RequestInit]
  return { url: new URL(String(url)), init, h: init.headers as Record<string, string> }
}

describe('서명', () => {
  it('HMAC-SHA256(secret, "{ts}.{METHOD}.{path}") base64 — 공식 샘플과 같은 값', () => {
    const expected = crypto
      .createHmac('sha256', 'sk')
      .update('1700000000000.GET./ncc/campaigns')
      .digest('base64')
    expect(sign('sk', '1700000000000', 'GET', '/ncc/campaigns')).toBe(expected)
  })

  it('쿼리스트링은 서명 원문에 넣지 않고, X-Customer 는 브랜드 매핑 값이다', async () => {
    fetchMock.mockResolvedValueOnce(ok([]))
    await tool('naver_ads_list_campaigns').execute(ctx(), {
      brand: 'creamd',
      campaign_type: 'SHOPPING',
    })
    const { url, h } = call()
    expect(url.origin + url.pathname).toBe('https://api.searchad.naver.com/ncc/campaigns')
    expect(url.searchParams.get('campaignType')).toBe('SHOPPING')
    expect(h['X-Customer']).toBe('2526287')
    expect(h['X-API-KEY']).toBe(SECRET.apiKey)
    expect(h['X-Signature']).toBe(sign(SECRET.secretKey, h['X-Timestamp'], 'GET', '/ncc/campaigns'))
    expect(h['X-Timestamp']).toMatch(/^\d{13}$/)
  })
})

describe('대상 계정', () => {
  it('매핑에 없는 브랜드는 거부한다(임의 customerId 우회 금지)', () => {
    expect(() => resolveCustomer(CONFIG, '9999999')).toThrow('알 수 없는 네이버 광고 브랜드')
    expect(resolveCustomer(CONFIG)).toBe('2630153')
  })

  it('복호화한 자격증명 id 를 감사 배열에 남긴다', async () => {
    fetchMock.mockResolvedValueOnce(ok([]))
    const c = ctx()
    await tool('naver_ads_list_campaigns').execute(c, {})
    expect(c.decryptedCredentialIds).toEqual(['ncred'])
  })
})

describe('naver_ads_get_stats', () => {
  it('fields·timeRange 를 JSON 문자열로, 일별은 timeIncrement=1 로 보낸다', async () => {
    fetchMock.mockResolvedValueOnce(ok({ data: [] }))
    await tool('naver_ads_get_stats').execute(ctx(), {
      ids: ['cmp-a001-01-000000000000001'],
      time_range: { since: '2026-10-01', until: '2026-10-21' },
      time_increment: '1',
    })
    const { url, h } = call()
    expect(url.pathname).toBe('/stats')
    expect(JSON.parse(url.searchParams.get('fields')!)).toContain('purchaseConvAmt')
    expect(JSON.parse(url.searchParams.get('timeRange')!)).toEqual({
      since: '2026-10-01',
      until: '2026-10-21',
    })
    expect(url.searchParams.get('timeIncrement')).toBe('1')
    expect(url.searchParams.has('datePreset')).toBe(false)
    expect(h['X-Signature']).toBe(sign(SECRET.secretKey, h['X-Timestamp'], 'GET', '/stats'))
  })

  it('92일 초과·뒤집힌 기간·preset 동시 지정은 호출 전에 거부한다', async () => {
    const run = (p: object) => tool('naver_ads_get_stats').execute(ctx(), { ids: ['cmp-1'], ...p })
    await expect(run({ time_range: { since: '2026-01-01', until: '2026-04-30' } })).rejects.toThrow(
      '최대 92일'
    )
    await expect(
      run({ time_range: { since: '2026-10-21', until: '2026-10-01' } })
    ).rejects.toThrow()
    await expect(
      run({ time_range: { since: '2026-10-01', until: '2026-10-02' }, date_preset: 'yesterday' })
    ).rejects.toThrow('함께 쓸 수 없습니다')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('429 는 재시도하고, 실패는 자격증명 lastError 에 마스킹해 남긴다', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('', { status: 429 }))
      .mockResolvedValueOnce(ok({ data: [] }))
    await tool('naver_ads_get_stats').execute(ctx(), { ids: ['cmp-1'] })
    expect(fetchMock).toHaveBeenCalledTimes(2)

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ title: 'Forbidden', detail: 'secret=abc 권한 없음' }), {
        status: 403,
      })
    )
    await expect(tool('naver_ads_get_stats').execute(ctx(), { ids: ['cmp-1'] })).rejects.toThrow(
      '(403)'
    )
    const data = (prisma.spaceCredential.update as jest.Mock).mock.calls.at(-1)![0].data
    expect(data.lastError).toContain('secret=[redacted]')
  })
})

describe('naver_ads_get_stat_report', () => {
  it('생성 → BUILT → /report-download 서명으로 TSV 를 받아 행으로 돌려준다', async () => {
    fetchMock
      .mockResolvedValueOnce(
        ok({
          reportJobId: 77,
          status: 'BUILT',
          reportTp: 'SHOPPINGKEYWORD_DETAIL',
          downloadUrl: 'https://api.searchad.naver.com/report-download?authtoken=xyz',
        })
      )
      .mockResolvedValueOnce(ok('20261021\t2630153\tcmp-1\ta\n20261021\t2630153\tcmp-1\tb\n'))
    const out = (await tool('naver_ads_get_stat_report').execute(ctx(), {
      report_type: 'SHOPPINGKEYWORD_DETAIL',
      stat_date: '2026-10-21',
      limit: 1,
    })) as { rows: string[][]; totalRows: number; truncated: boolean }
    expect(JSON.parse(call(0).init.body as string)).toEqual({
      reportTp: 'SHOPPINGKEYWORD_DETAIL',
      statDt: '20261021',
    })
    const dl = call(1)
    expect(dl.url.searchParams.get('authtoken')).toBe('xyz')
    expect(dl.h['X-Signature']).toBe(
      sign(SECRET.secretKey, dl.h['X-Timestamp'], 'GET', '/report-download')
    )
    expect(out).toMatchObject({
      totalRows: 2,
      truncated: true,
      rows: [['20261021', '2630153', 'cmp-1', 'a']],
    })
  })

  it('네이버가 아닌 다운로드 주소에는 서명 헤더를 보내지 않는다', () => {
    expect(() => assertDownloadUrl('https://evil.example/report-download')).toThrow()
    expect(() => assertDownloadUrl('http://api.searchad.naver.com/x')).toThrow()
    expect(() => assertDownloadUrl('https://naver.com.evil.example/x')).toThrow()
    expect(assertDownloadUrl('https://api.searchad.naver.com/report-download?a=1')).toContain(
      'naver.com'
    )
  })

  it('parseTsv 는 빈 줄을 버린다', () => {
    expect(parseTsv('a\tb\r\n\nc\td\n')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ])
  })
})

it('모든 네이버 도구는 read·naver:read 이고 레지스트리에 등록된다', () => {
  for (const t of naverAdsTools) {
    expect(t.mode).toBe('read')
    expect(t.scope).toBe('naver:read')
    expect(toolDefinitions).toContain(t)
  }
})
