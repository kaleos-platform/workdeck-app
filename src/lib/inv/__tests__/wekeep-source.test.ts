/** @jest-environment node */
import { getWekeepInventoryRows, WekeepSourceError } from '../reconciliation-sources'
import { fetchWekeepInventory } from '../wekeep-client'
import { loadLoginSecretForSystem } from '@/lib/agent/secrets/store'
import { prisma } from '@/lib/prisma'

jest.mock('@/lib/prisma', () => ({ prisma: { invStorageLocation: { findFirst: jest.fn() } } }))
jest.mock('../wekeep-client', () => ({ fetchWekeepInventory: jest.fn() }))
jest.mock('@/lib/agent/secrets/store', () => ({ loadLoginSecretForSystem: jest.fn() }))

const findFirst = prisma.invStorageLocation.findFirst as jest.Mock
const load = loadLoginSecretForSystem as jest.Mock
const fetchInv = fetchWekeepInventory as jest.Mock

describe('getWekeepInventoryRows', () => {
  beforeEach(() => jest.clearAllMocks())

  it('parseInventoryList 규칙으로 변환한다', async () => {
    findFirst.mockResolvedValue({ syncSecretName: 'wk' })
    load.mockResolvedValue({
      id: 's',
      loginUrl: 'https://www.wekeep.co.kr/login',
      username: 'u',
      password: 'pw',
    })
    fetchInv.mockResolvedValue([
      { skuNo: 'A', productName: '상품A', available: 3, reserve: 2, faulty: 1, damage: 1 },
      { skuNo: 'B', productName: '', available: 0, reserve: 0, faulty: 0, damage: 0 },
    ])
    const r = await getWekeepInventoryRows('sp', 'loc')
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'loc', spaceId: 'sp', isActive: true, syncProvider: 'wekeep' },
      })
    )
    expect(load).toHaveBeenCalledWith('sp', 'wk')
    expect(fetchInv).toHaveBeenCalledWith({ username: 'u', password: 'pw' })
    expect(r.format).toBe('inventory_list')
    expect(r.rows).toEqual([
      { externalCode: 'A', externalName: '상품A', quantity: 5, defectQuantity: 2 },
      { externalCode: 'B', externalName: undefined, quantity: 0 },
    ])
  })

  it('위치가 없거나 비밀값 이름이 없으면 WekeepSourceError', async () => {
    findFirst.mockResolvedValue(null)
    await expect(getWekeepInventoryRows('sp', 'loc')).rejects.toBeInstanceOf(WekeepSourceError)
    findFirst.mockResolvedValue({ syncSecretName: null })
    await expect(getWekeepInventoryRows('sp', 'loc')).rejects.toThrow('비밀값을 찾을 수 없습니다')
  })

  it('비밀값 로드 실패는 고정 문구로 치환', async () => {
    findFirst.mockResolvedValue({ syncSecretName: 'wk' })
    load.mockRejectedValue(new Error('detail'))
    await expect(getWekeepInventoryRows('sp', 'loc')).rejects.toThrow(
      '위치에 연결된 위킵 로그인 비밀값을 찾을 수 없습니다.'
    )
    expect(fetchInv).not.toHaveBeenCalled()
  })

  it('위킵 도메인이 아닌 loginUrl 은 거부하고 fetch 하지 않는다', async () => {
    findFirst.mockResolvedValue({ syncSecretName: 'wk' })
    for (const loginUrl of ['https://evil.com/login', 'https://wekeep.co.kr.evil.com/', 'x']) {
      load.mockResolvedValue({ id: 's', loginUrl, username: 'u', password: 'pw' })
      await expect(getWekeepInventoryRows('sp', 'loc')).rejects.toBeInstanceOf(WekeepSourceError)
    }
    expect(fetchInv).not.toHaveBeenCalled()
  })
})
