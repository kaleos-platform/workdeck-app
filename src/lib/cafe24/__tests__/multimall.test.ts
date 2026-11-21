/** @jest-environment node */
import { fakeDb } from './fake-db'

jest.mock('@/lib/prisma', () => ({ prisma: jest.requireActual('./fake-db').fakePrisma }))
jest.mock('@/lib/crypto/field-crypto', () => ({
  encryptField: (_p: string, s: string) => ({ encrypted: s, iv: 'v1' }),
  decryptField: (_p: string, e: string) => e,
}))

import { getAccessToken } from '../client'
import { listCafe24Malls, readCafe24, readLegacyCafe24, writeCafe24If } from '../store'

const SP = 'sp1'
const hours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString()
const seed = (mallId: string, provider: string, access = 'AT0') =>
  fakeDb.seed(
    SP,
    {
      clientId: 'cid-1234567',
      clientSecret: 'CSECRET-xyz',
      accessToken: access,
      refreshToken: 'RT0',
    },
    { mallId, credVersion: 1, status: 'connected', accessExpiresAt: hours(0.05) },
    provider
  )
const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })

const fetchMock = jest.fn()
beforeEach(() => {
  fakeDb.reset()
  fetchMock.mockReset()
  global.fetch = fetchMock as unknown as typeof fetch
})

describe('쇼핑몰 행 읽기·목록', () => {
  it('cafe24:<mallId> 행을 우선하고, 없으면 레거시 행 중 mallId 가 같은 것만 읽는다', async () => {
    seed('legacy-shop', 'cafe24')
    seed('shop-a', 'cafe24:shop-a')
    expect((await readCafe24(SP, 'shop-a'))?.provider).toBe('cafe24:shop-a')
    expect((await readCafe24(SP, 'legacy-shop'))?.provider).toBe('cafe24')
    expect(await readCafe24(SP, 'other-shop')).toBeNull()
    expect((await readCafe24(SP, null))?.config.mallId).toBe('legacy-shop') // null = 레거시
    expect((await readLegacyCafe24(SP))?.provider).toBe('cafe24')
  })

  it('목록은 레거시 행을 포함하고 mallId 오름차순, 다른 Space·시크릿은 제외한다', async () => {
    seed('shop-b', 'cafe24:shop-b')
    seed('legacy-shop', 'cafe24')
    fakeDb.seed('other-space', {}, { mallId: 'zzz-shop', credVersion: 1 }, 'cafe24:zzz-shop')
    const malls = await listCafe24Malls(SP)
    expect(malls.map((m) => m.mallId)).toEqual(['legacy-shop', 'shop-b'])
    expect(JSON.stringify(malls)).not.toContain('CSECRET')
  })

  it('조건부 쓰기는 읽은 행의 provider 를 유지한다(레거시 행이 새 provider 로 바뀌지 않는다)', async () => {
    seed('legacy-shop', 'cafe24')
    const cur = (await readCafe24(SP, 'legacy-shop'))!
    expect(await writeCafe24If(cur, cur.secret, cur.config)).toBe(true)
    expect(fakeDb.rows).toHaveLength(1)
    expect(fakeDb.row.provider).toBe('cafe24')
    expect(fakeDb.row.config.credVersion).toBe(2)
  })
})

describe('몰 2개 독립 갱신', () => {
  it('한 몰이 갱신 중(lease)이어도 다른 몰은 막히지 않고 각자 자기 행만 갱신한다', async () => {
    seed('shop-a', 'cafe24:shop-a', 'A0')
    seed('shop-b', 'cafe24:shop-b', 'B0')
    fetchMock.mockImplementation(async (url: string) => {
      await new Promise((r) => setTimeout(r, 100))
      const mall = new URL(url).host.split('.')[0]
      return json({
        access_token: `new-${mall}`,
        refresh_token: `RT-${mall}`,
        expires_at: null,
        mall_id: mall,
        scopes: ['mall.read_order', 'mall.write_order'],
      })
    })
    const [a, b] = await Promise.all([getAccessToken(SP, 'shop-a'), getAccessToken(SP, 'shop-b')])
    expect([a.accessToken, b.accessToken]).toEqual(['new-shop-a', 'new-shop-b'])
    expect(fetchMock).toHaveBeenCalledTimes(2) // 몰마다 1회 — 서로 lease 를 기다리지 않았다
    expect(JSON.parse(fakeDb.rows[0].encryptedPayload).refreshToken).toBe('RT-shop-a')
    expect(JSON.parse(fakeDb.rows[1].encryptedPayload).refreshToken).toBe('RT-shop-b')
  })
})
