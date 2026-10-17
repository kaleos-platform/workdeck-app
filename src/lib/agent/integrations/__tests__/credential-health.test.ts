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
  verifyGoogleCred: jest.fn(),
}))

import { prisma } from '@/lib/prisma'
import { sendSpaceNotification } from '@/lib/slack/send-notification'
import { fetchAdAccountCurrencies, loadMetaCred } from '@/lib/agent/integrations/meta-ads'
import { loadGoogleCred, verifyGoogleCred } from '@/lib/agent/integrations/google-marketing'
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
const dataOf = (id: string) => update.mock.calls.find((c) => c[0].where.id === id)![0].data

beforeEach(() => {
  jest.clearAllMocks()
  ;(loadMetaCred as jest.Mock).mockImplementation(async (_s: string, audit: string[]) => {
    audit.push('c1')
    return { secret: {}, config: {} }
  })
  ;(fetchAdAccountCurrencies as jest.Mock).mockResolvedValue({ act_1: 'KRW' })
  ;(loadGoogleCred as jest.Mock).mockResolvedValue({})
  ;(verifyGoogleCred as jest.Mock).mockResolvedValue(undefined)
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
  ;(verifyGoogleCred as jest.Mock).mockRejectedValue(new Error('invalid_grant'))
  expect((await checkCredentialHealth()).notified).toBe(1)
})

it('이미 알렸으면 다시 알리지 않는다', async () => {
  findMany.mockResolvedValue([google({ healthError: 'x', healthAlertedAt: new Date() })])
  ;(verifyGoogleCred as jest.Mock).mockRejectedValue(new Error('invalid_grant'))
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
  expect(verifyGoogleCred).toHaveBeenCalled()
})
