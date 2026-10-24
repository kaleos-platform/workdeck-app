import bcrypt from 'bcryptjs'
import fixtures from './fixtures/product-orders.json'
import { fetchPaidProductOrders, issueToken, signClientSecret } from '../client'

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
  it('401 → 에러', async () => {
    mockFetch.mockResolvedValue(json(401, { message: 'bad' }))
    await expect(issueToken(secret)).rejects.toThrow(/^naver-commerce token 401/)
  })
})

describe('fetchPaidProductOrders', () => {
  it('전 페이지 수집 + 매핑', async () => {
    mockFetch.mockResolvedValueOnce(page(fixtures.aml, true)).mockResolvedValueOnce(page([], false))
    const r = await fetchPaidProductOrders('t', '2026-10-22', { delayMs: 0 })
    expect(r).toHaveLength(22)
    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(String(mockFetch.mock.calls[1][0])).toContain('page=2')
    const url = String(mockFetch.mock.calls[0][0])
    expect(url).toContain('rangeType=PAYED_DATETIME')
    expect(url).toContain('from=2026-10-22T00%3A00%3A00.000%2B09%3A00')
    expect(typeof r[0].skuMappings[0].pickingQuantityPerOrder).toBe('number')
    expect(r[0].orderId).toBe(fixtures.aml[0].content.order.orderId)
  })
  it('429 후 재시도 성공', async () => {
    mockFetch
      .mockResolvedValueOnce(json(429, { code: 'GW.RATE_LIMIT' }))
      .mockResolvedValueOnce(page([], false))
    await expect(fetchPaidProductOrders('t', '2026-10-22', { delayMs: 0 })).resolves.toEqual([])
  })
  it('429 4회 → 실패', async () => {
    mockFetch.mockResolvedValue(json(429, { code: 'GW.RATE_LIMIT' }))
    await expect(fetchPaidProductOrders('t', '2026-10-22', { delayMs: 0 })).rejects.toThrow()
  })
})
