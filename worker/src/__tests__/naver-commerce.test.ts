import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import bcrypt from 'bcryptjs'
import { fetchPaidProductOrders, issueToken, signClientSecret } from '../naver-commerce.js'

const fixtures = JSON.parse(
  readFileSync(
    join(process.cwd(), 'src/lib/naver-commerce/__tests__/fixtures/product-orders.json'),
    'utf8'
  )
) as { aml: { content: { order: { orderId: string } } }[] }

const mockFetch = jest.fn()
beforeEach(() => {
  mockFetch.mockReset()
  global.fetch = mockFetch as unknown as typeof fetch
})

const json = (status: number, body: unknown) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  }) as Response
const page = (contents: unknown[], hasNext: boolean) =>
  json(200, { data: { contents, pagination: { page: 1, size: 300, hasNext } } })

describe('signClientSecret', () => {
  it('base64(bcrypt) 가 id_ts 와 일치', () => {
    const secret = bcrypt.genSaltSync(4)
    const sign = signClientSecret('cid', secret, 1700000000000)
    const decoded = Buffer.from(sign, 'base64').toString()
    expect(bcrypt.compareSync('cid_1700000000000', decoded)).toBe(true)
  })
})

describe('issueToken', () => {
  const secret = { clientId: 'cid', clientSecret: bcrypt.genSaltSync(4) }
  it('토큰 반환 + 요청 본문', async () => {
    mockFetch.mockResolvedValue(json(200, { access_token: 'tok' }))
    await expect(issueToken(secret)).resolves.toBe('tok')
    const body = String(mockFetch.mock.calls[0][1].body)
    expect(body).toContain('type=SELF')
    expect(body).toContain('grant_type=client_credentials')
  })
  it('401 → 에러, 본문 300자 절단', async () => {
    mockFetch.mockResolvedValue(json(401, { message: 'x'.repeat(1000) }))
    const err = await issueToken(secret).catch((e: Error) => e)
    expect((err as Error).message).toMatch(/^naver-commerce token 401/)
    expect((err as Error).message.length).toBeLessThan(360)
  })
})

describe('fetchPaidProductOrders', () => {
  const run = () => fetchPaidProductOrders('t', '2026-10-22', { delayMs: 0 })

  it('전 페이지 수집 + 매핑', async () => {
    mockFetch.mockResolvedValueOnce(page(fixtures.aml, true)).mockResolvedValueOnce(page([], false))
    const r = await run()
    expect(r).toHaveLength(22)
    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(String(mockFetch.mock.calls[1][0])).toContain('page=2')
    const url = String(mockFetch.mock.calls[0][0])
    expect(url).toContain('rangeType=PAYED_DATETIME')
    expect(url).toContain('from=2026-10-22T00%3A00%3A00.000%2B09%3A00')
    expect(r[0].orderId).toBe(fixtures.aml[0].content.order.orderId)
  })
  it('429 후 재시도 성공 (2회 호출)', async () => {
    mockFetch
      .mockResolvedValueOnce(json(429, { code: 'GW.RATE_LIMIT' }))
      .mockResolvedValueOnce(page([], false))
    await expect(run()).resolves.toEqual([])
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })
  it('429 4회 → 실패', async () => {
    mockFetch.mockResolvedValue(json(429, { code: 'GW.RATE_LIMIT' }))
    await expect(run()).rejects.toThrow(/naver-commerce orders 429/)
    expect(mockFetch).toHaveBeenCalledTimes(4)
  })
  it('2xx 비-JSON → parse error', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200, text: async () => '<html>' } as Response)
    await expect(run()).rejects.toThrow('naver-commerce orders parse error')
  })
  it('orderId/paymentDate 빈 행은 버린다', async () => {
    const bad = [
      {
        content: {
          order: { orderId: '', paymentDate: '2026-10-22T01:00:00.000+09:00' },
          productOrder: {},
        },
      },
      { content: { order: { orderId: 'o1', paymentDate: '' }, productOrder: {} } },
    ]
    mockFetch.mockResolvedValueOnce(page([...bad, ...fixtures.aml.slice(0, 1)], false))
    const r = await run()
    expect(r).toHaveLength(1)
  })
  it('페이지 100 초과 → 에러', async () => {
    mockFetch.mockImplementation(async () => page([], true))
    await expect(run()).rejects.toThrow(/page/)
    expect(mockFetch).toHaveBeenCalledTimes(100)
  })
})
