// @jest-environment node
import { loadCoupangVendorId, loadNaverStoreSecret } from '../worker-secret'

const findManyCred = jest.fn()
const findFirstCoupang = jest.fn()
jest.mock('@/lib/prisma', () => ({
  prisma: {
    spaceCredential: { findMany: (...a: unknown[]) => findManyCred(...a) },
    coupangApiCredential: { findFirst: (...a: unknown[]) => findFirstCoupang(...a) },
  },
}))
const decrypt = jest.fn()
jest.mock('@/lib/crypto/field-crypto', () => ({ decryptField: (...a: unknown[]) => decrypt(...a) }))

beforeEach(() => {
  jest.clearAllMocks()
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

describe('loadNaverStoreSecret', () => {
  const row = { encryptedPayload: 'enc', iv: 'iv' }
  const payload = (stores: unknown) => JSON.stringify({ stores })

  it('Space 의 해당 storeKey 키만 돌려준다(다른 스토어 키는 안 섞인다)', async () => {
    findManyCred.mockResolvedValue([row])
    decrypt.mockReturnValue(
      payload({
        s1: { clientId: 'C1', clientSecret: 'S1' },
        s2: { clientId: 'C2', clientSecret: 'S2' },
      })
    )
    await expect(loadNaverStoreSecret('sp', 's1')).resolves.toEqual({
      clientId: 'C1',
      clientSecret: 'S1',
    })
    expect(findManyCred.mock.calls[0][0].where).toEqual({
      spaceId: 'sp',
      provider: 'naver-commerce',
    })
  })
  it('자격증명 없음 · storeKey 없음 · 스토어 없음 → null', async () => {
    findManyCred.mockResolvedValue([])
    await expect(loadNaverStoreSecret('sp', 's1')).resolves.toBeNull()
    await expect(loadNaverStoreSecret('sp', null)).resolves.toBeNull()
    findManyCred.mockResolvedValue([row])
    decrypt.mockReturnValue(payload({ other: { clientId: 'a', clientSecret: 'b' } }))
    await expect(loadNaverStoreSecret('sp', 's1')).resolves.toBeNull()
  })
  it('형태가 깨진 키 → null', async () => {
    findManyCred.mockResolvedValue([row])
    decrypt.mockReturnValue(payload({ s1: { clientId: 'a' } }))
    await expect(loadNaverStoreSecret('sp', 's1')).resolves.toBeNull()
  })
  it('복호화·파싱 실패 → null, 로그에 평문이 없다', async () => {
    findManyCred.mockResolvedValue([row])
    decrypt.mockReturnValue('{"stores":{"s1":{"clientSecret":"PLAIN-LEAK"')
    await expect(loadNaverStoreSecret('sp', 's1')).resolves.toBeNull()
    decrypt.mockImplementation(() => {
      throw new Error('bad key')
    })
    await expect(loadNaverStoreSecret('sp', 's1')).resolves.toBeNull()
    expect(JSON.stringify((console.error as jest.Mock).mock.calls)).not.toContain('PLAIN-LEAK')
  })
})

describe('loadCoupangVendorId', () => {
  it('그 Space 워크스페이스의 vendorId 만 조회하고 secretKey 는 select 하지 않는다', async () => {
    findFirstCoupang.mockResolvedValue({ vendorId: 'A00123' })
    await expect(loadCoupangVendorId('sp')).resolves.toBe('A00123')
    const arg = findFirstCoupang.mock.calls[0][0]
    expect(arg.where).toEqual({ workspace: { spaceId: 'sp' }, isActive: true })
    expect(arg.select).toEqual({ vendorId: true })
  })
  it('자격증명 없음·조회 실패 → null', async () => {
    findFirstCoupang.mockResolvedValue(null)
    await expect(loadCoupangVendorId('sp')).resolves.toBeNull()
    findFirstCoupang.mockRejectedValue(new Error('db'))
    await expect(loadCoupangVendorId('sp')).resolves.toBeNull()
  })
})
