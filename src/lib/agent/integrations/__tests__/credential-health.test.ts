/** @jest-environment node */
jest.mock('@/lib/prisma', () => ({
  prisma: { spaceCredential: { findMany: jest.fn(), update: jest.fn() } },
}))
jest.mock('@/lib/slack/send-notification', () => ({ sendSpaceNotification: jest.fn() }))
jest.mock('@/lib/agent/integrations/meta-ads', () => ({
  PROVIDER: 'meta-ads',
  loadMetaCred: jest.fn(),
  fetchAdAccountCurrencies: jest.fn(),
}))
jest.mock('@/lib/agent/integrations/google-marketing', () => ({
  PROVIDER: 'google-marketing',
  loadGoogleCred: jest.fn(),
  verifyGoogleBrands: jest.fn(),
}))

jest.mock('@/lib/cafe24/store', () => ({ readCafe24: jest.fn(), writeCafe24If: jest.fn() }))
jest.mock('@/lib/integrations/google-marketing-store', () => ({
  readGoogle: jest.fn(),
  writeGoogleIf: jest.fn(),
}))
jest.mock('@/lib/cafe24/client', () => ({
  ...jest.requireActual('@/lib/cafe24/client'),
  getAccessToken: jest.fn(),
  probeOrders: jest.fn(),
}))

import { prisma } from '@/lib/prisma'
import {
  CAFE24_REAUTH_MESSAGE,
  Cafe24Error,
  getAccessToken,
  probeOrders,
} from '@/lib/cafe24/client'
import { readCafe24, writeCafe24If } from '@/lib/cafe24/store'
import { readGoogle, writeGoogleIf } from '@/lib/integrations/google-marketing-store'
import { sendSpaceNotification } from '@/lib/slack/send-notification'
import { fetchAdAccountCurrencies, loadMetaCred } from '@/lib/agent/integrations/meta-ads'
import { loadGoogleCred, verifyGoogleBrands } from '@/lib/agent/integrations/google-marketing'
import { checkCredentialHealth } from '../credential-health'

const findMany = prisma.spaceCredential.findMany as jest.Mock
const update = prisma.spaceCredential.update as jest.Mock
const notify = sendSpaceNotification as jest.Mock
const base = { lastError: null, healthError: null, healthAlertedAt: null }
const meta = (o = {}) => ({ id: 'c1', spaceId: 'sp1', provider: 'meta-ads', ...base, ...o })
const google = (o = {}) => ({
  id: 'c2',
  spaceId: 'sp2',
  provider: 'google-marketing',
  ...base,
  ...o,
})
const googleCred = (config = {}, secret = {}) => ({
  id: 'c2',
  secret: { clientId: 'cid', clientSecret: 'cs', refreshToken: 'RT', ...secret },
  config: { brands: { a: { ga4_property_id: '1' } }, status: 'connected', ...config },
})
const dataOf = (id: string) => update.mock.calls.find((c) => c[0].where.id === id)![0].data

beforeEach(() => {
  jest.clearAllMocks()
  ;(loadMetaCred as jest.Mock).mockImplementation(async (_s: string, audit: string[]) => {
    audit.push('c1')
    return { secret: {}, config: {} }
  })
  ;(fetchAdAccountCurrencies as jest.Mock).mockResolvedValue({ act_1: 'KRW' })
  ;(loadGoogleCred as jest.Mock).mockResolvedValue(googleCred())
  ;(verifyGoogleBrands as jest.Mock).mockResolvedValue(undefined)
  notify.mockResolvedValue(true)
  update.mockResolvedValue({})
})

it('정상이면 lastVerifiedAt 갱신·알림 없음, 복호화 id 를 결과에 남긴다', async () => {
  findMany.mockResolvedValue([meta(), google()])
  const r = await checkCredentialHealth()
  expect(r).toMatchObject({ checked: 2, failed: 0, notified: 0, errors: 0 })
  expect(r.decryptedCredentialIds).toEqual(['c1'])
  expect(dataOf('c1')).toMatchObject({
    healthError: null,
    healthAlertedAt: null,
    lastVerifiedAt: expect.any(Date),
  })
  expect(notify).not.toHaveBeenCalled()
})

it('처음 실패하면 알리고 healthAlertedAt 을 남긴다(토큰은 가린다)', async () => {
  findMany.mockResolvedValue([meta()])
  ;(fetchAdAccountCurrencies as jest.Mock).mockRejectedValue(
    new Error('Error validating access token: https://x?access_token=EAAsecret <!channel>')
  )
  const r = await checkCredentialHealth()
  expect(r).toMatchObject({ failed: 1, notified: 1 })
  const d = dataOf('c1')
  expect(d.healthAlertedAt).toEqual(expect.any(Date))
  expect(d.healthError).not.toMatch(/EAAsecret/)
  expect(notify.mock.calls[0][0].text).not.toMatch(/EAAsecret|<!channel>/)
})

it('다른 경로가 lastError 를 이미 남겼어도 점검 첫 실패는 알린다(알림 누락 방지)', async () => {
  findMany.mockResolvedValue([google({ lastError: 'invalid_grant (MCP 조회)' })])
  ;(verifyGoogleBrands as jest.Mock).mockRejectedValue(new Error('invalid_grant'))
  expect((await checkCredentialHealth()).notified).toBe(1)
})

it('이미 알렸으면 다시 알리지 않는다', async () => {
  findMany.mockResolvedValue([google({ healthError: 'x', healthAlertedAt: new Date() })])
  ;(verifyGoogleBrands as jest.Mock).mockRejectedValue(new Error('invalid_grant'))
  expect(await checkCredentialHealth()).toMatchObject({ failed: 1, notified: 0 })
  expect(notify).not.toHaveBeenCalled()
})

it('알림 발송에 실패하면 healthAlertedAt 을 남기지 않아 다음 날 다시 시도한다', async () => {
  findMany.mockResolvedValue([meta()])
  ;(fetchAdAccountCurrencies as jest.Mock).mockRejectedValue(new Error('expired'))
  notify.mockResolvedValue(false)
  await checkCredentialHealth()
  expect(dataOf('c1').healthAlertedAt).toBeNull()
})

it('알렸던 장애가 풀리면 복구를 알리고, 점검이 남긴 lastError 만 지운다', async () => {
  findMany.mockResolvedValue([
    google({ healthError: 'e', lastError: 'e', healthAlertedAt: new Date() }),
  ])
  expect((await checkCredentialHealth()).notified).toBe(1)
  expect(notify.mock.calls[0][0].text).toMatch(/Google 마케팅 연동이 복구/)
  expect(dataOf('c2')).toMatchObject({ lastError: null, healthAlertedAt: null })
})

it('토큰과 무관한 다른 경로 오류만 있으면 성공해도 복구 알림을 보내지 않고 lastError 를 남긴다', async () => {
  findMany.mockResolvedValue([meta({ lastError: 'Invalid parameter' })])
  expect((await checkCredentialHealth()).notified).toBe(0)
  expect(dataOf('c1')).not.toHaveProperty('lastError')
})

it('한 행의 DB 실패가 다른 Space 점검을 막지 않는다', async () => {
  findMany.mockResolvedValue([meta(), google()])
  update.mockImplementation(async (a: { where: { id: string } }) => {
    if (a.where.id === 'c1') throw new Error('db down')
    return {}
  })
  const r = await checkCredentialHealth()
  expect(r.errors).toBe(1)
  expect(verifyGoogleBrands).toHaveBeenCalled()
})

describe('구글 마케팅', () => {
  it('승인 전(needs_auth) 행은 건너뛴다 — 점검 오류·알림 없음', async () => {
    findMany.mockResolvedValue([google()])
    ;(loadGoogleCred as jest.Mock).mockResolvedValue(
      googleCred({ status: 'needs_auth' }, { refreshToken: undefined })
    )
    const r = await checkCredentialHealth()
    expect(r).toMatchObject({ checked: 1, failed: 0, notified: 0 })
    expect(verifyGoogleBrands).not.toHaveBeenCalled()
    expect(notify).not.toHaveBeenCalled()
    expect(dataOf('c2').healthError).toBeNull()
  })

  it('범위 부족으로 needs_auth 인 행(토큰은 있음)도 건너뛴다', async () => {
    findMany.mockResolvedValue([google()])
    ;(loadGoogleCred as jest.Mock).mockResolvedValue(googleCred({ status: 'needs_auth' }))
    expect(await checkCredentialHealth()).toMatchObject({ failed: 0, notified: 0 })
    expect(verifyGoogleBrands).not.toHaveBeenCalled()
  })

  it('속성 접근 실패는 health 성공으로 숨기지 않고 오류로 알린다', async () => {
    findMany.mockResolvedValue([google()])
    ;(verifyGoogleBrands as jest.Mock).mockRejectedValue(
      new Error('Google 속성 확인 실패 (HTTP 403): forbidden')
    )
    const r = await checkCredentialHealth()
    expect(r).toMatchObject({ failed: 1, notified: 1 })
    expect(dataOf('c2').healthError).toMatch(/속성 확인 실패 \(HTTP 403\)/)
  })

  it('status 가 없는 기존 행은 점검만 하고 상태를 만들지 않는다', async () => {
    findMany.mockResolvedValue([google()])
    ;(loadGoogleCred as jest.Mock).mockResolvedValue(googleCred({ status: undefined }))
    await checkCredentialHealth()
    expect(verifyGoogleBrands).toHaveBeenCalled()
    expect(writeGoogleIf).not.toHaveBeenCalled()
  })

  it('needs_check + 속성 확인 성공이면 조건부 쓰기로 connected 로 올린다', async () => {
    findMany.mockResolvedValue([google()])
    ;(loadGoogleCred as jest.Mock).mockResolvedValue(googleCred({ status: 'needs_check' }))
    const cur = { ...googleCred({ status: 'needs_check', credVersion: 2 }) }
    ;(readGoogle as jest.Mock).mockResolvedValue(cur)
    await checkCredentialHealth()
    expect(writeGoogleIf).toHaveBeenCalledWith(
      cur,
      cur.secret,
      expect.objectContaining({ status: 'connected', connectedAt: expect.any(String) }),
      true
    )
  })

  it('확인 사이에 토큰·브랜드가 바뀌었으면 승격하지 않는다', async () => {
    findMany.mockResolvedValue([google()])
    ;(loadGoogleCred as jest.Mock).mockResolvedValue(googleCred({ status: 'needs_check' }))
    ;(readGoogle as jest.Mock).mockResolvedValue(
      googleCred({ status: 'needs_check', brands: { a: { ga4_property_id: '9' } } })
    )
    await checkCredentialHealth()
    expect(writeGoogleIf).not.toHaveBeenCalled()
  })

  it('승격 쓰기가 실패해도 점검은 성공으로 끝난다', async () => {
    findMany.mockResolvedValue([google()])
    ;(loadGoogleCred as jest.Mock).mockResolvedValue(googleCred({ status: 'needs_check' }))
    ;(readGoogle as jest.Mock).mockRejectedValue(new Error('db'))
    expect(await checkCredentialHealth()).toMatchObject({ failed: 0, errors: 0 })
  })
})

describe('카페24', () => {
  const cafe24 = (o = {}) => ({ id: 'c4', spaceId: 'sp4', provider: 'cafe24', ...base, ...o })

  it('정상이면 갱신·주문 조회 1건 후 복호화 id 를 남긴다', async () => {
    findMany.mockResolvedValue([cafe24()])
    ;(getAccessToken as jest.Mock).mockResolvedValue({
      credentialId: 'c4',
      accessToken: 'x',
      mallId: 'm',
    })
    ;(probeOrders as jest.Mock).mockResolvedValue(undefined)
    const r = await checkCredentialHealth()
    expect(r).toMatchObject({ checked: 1, failed: 0 })
    expect(r.decryptedCredentialIds).toEqual(['c4'])
    expect(probeOrders).toHaveBeenCalledWith('sp4', null) // config.mallId 없는 레거시 행
  })

  it('레거시 행(provider cafe24)도 config.mallId 로 점검하고 라벨에 몰 ID 를 넣는다', async () => {
    findMany.mockResolvedValue([cafe24({ config: { mallId: 'legacy-shop' } })])
    ;(getAccessToken as jest.Mock).mockRejectedValue(new Cafe24Error('token', 'reauth_required'))
    await checkCredentialHealth()
    expect(getAccessToken).toHaveBeenCalledWith('sp4', 'legacy-shop')
    expect(notify.mock.calls[0][0].text).toContain('카페24(legacy-shop)')
  })

  it('cafe24:<mallId> 행은 prefix 로 조회·디스패치하고 그 mallId 로 probe 한다', async () => {
    findMany.mockResolvedValue([
      cafe24({ id: 'c5', provider: 'cafe24:shop-a', config: { mallId: 'shop-a' } }),
      cafe24({ id: 'c6', provider: 'cafe24:shop-b', config: { mallId: 'shop-b' } }),
    ])
    ;(getAccessToken as jest.Mock).mockImplementation(async (_sp: string, mall: string) => ({
      credentialId: `cred-${mall}`,
      accessToken: 'x',
      mallId: mall,
    }))
    ;(probeOrders as jest.Mock).mockResolvedValue(undefined)
    const r = await checkCredentialHealth()
    expect(r).toMatchObject({ checked: 2, failed: 0 })
    expect(probeOrders).toHaveBeenCalledWith('sp4', 'shop-a')
    expect(probeOrders).toHaveBeenCalledWith('sp4', 'shop-b')
    const where = findMany.mock.calls[0][0].where
    expect(where.OR).toContainEqual({ provider: { startsWith: 'cafe24:' } })
  })

  it('승인 전(not_authorized)은 점검 대상이 아니라 실패·알림이 없다', async () => {
    findMany.mockResolvedValue([cafe24()])
    ;(getAccessToken as jest.Mock).mockRejectedValue(new Cafe24Error('token', 'not_authorized'))
    const r = await checkCredentialHealth()
    expect(r).toMatchObject({ failed: 0, notified: 0 })
  })

  it('갱신 토큰이 죽으면(reauth_required) 실패로 알린다', async () => {
    findMany.mockResolvedValue([cafe24()])
    ;(getAccessToken as jest.Mock).mockRejectedValue(new Cafe24Error('token', 'reauth_required'))
    const r = await checkCredentialHealth()
    expect(r).toMatchObject({ failed: 1, notified: 1 })
    expect(notify.mock.calls[0][0].text).toContain('카페24')
    expect(dataOf('c4').healthError).toBe(CAFE24_REAUTH_MESSAGE)
    expect(dataOf('c4').lastError).toBe(CAFE24_REAUTH_MESSAGE)
    expect(notify.mock.calls[0][0].text).toContain('다시 승인')
  })

  it('이미 재승인 대기이고 알렸다면 같은 문구로 처리하되 다시 알리지 않는다', async () => {
    findMany.mockResolvedValue([
      cafe24({ healthError: CAFE24_REAUTH_MESSAGE, healthAlertedAt: new Date() }),
    ])
    ;(getAccessToken as jest.Mock).mockRejectedValue(new Cafe24Error('token', 'reauth_required'))
    const r = await checkCredentialHealth()
    expect(r).toMatchObject({ failed: 1, notified: 0 })
    expect(probeOrders).not.toHaveBeenCalled()
    expect(dataOf('c4').healthError).toBe(CAFE24_REAUTH_MESSAGE)
  })

  describe('needs_auth 로 남은 행(콜백 확인 조회만 실패)', () => {
    const okProbe = () => {
      ;(getAccessToken as jest.Mock).mockResolvedValue({
        credentialId: 'c4',
        accessToken: 'x',
        mallId: 'm',
      })
      ;(probeOrders as jest.Mock).mockResolvedValue(undefined)
      findMany.mockResolvedValue([cafe24()])
    }
    const stored = (status: string) => ({
      id: 'c4',
      secret: { clientId: 'c', clientSecret: 's', refreshToken: 'R' },
      config: { mallId: 'm', credVersion: 3, status },
    })

    it('프로브가 성공하면 조건부 쓰기로 connected 로 올린다', async () => {
      okProbe()
      ;(readCafe24 as jest.Mock).mockResolvedValue(stored('needs_auth'))
      ;(writeCafe24If as jest.Mock).mockResolvedValue(true)
      await checkCredentialHealth()
      expect(writeCafe24If).toHaveBeenCalledWith(
        expect.objectContaining({ config: expect.objectContaining({ credVersion: 3 }) }),
        expect.anything(),
        expect.objectContaining({ status: 'connected' }),
        true
      )
    })

    it('이미 connected 면 쓰지 않고, 쓰기가 실패해도 점검은 성공으로 끝난다', async () => {
      okProbe()
      ;(readCafe24 as jest.Mock).mockResolvedValue(stored('connected'))
      expect((await checkCredentialHealth()).failed).toBe(0)
      expect(writeCafe24If).not.toHaveBeenCalled()
      ;(readCafe24 as jest.Mock).mockResolvedValue(stored('needs_auth'))
      ;(writeCafe24If as jest.Mock).mockRejectedValue(new Error('db down'))
      expect(await checkCredentialHealth()).toMatchObject({ failed: 0, errors: 0 })
    })
  })
})
