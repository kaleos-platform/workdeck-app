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
const meta = (lastError: string | null) => ({
  id: 'c1',
  spaceId: 'sp1',
  provider: 'meta-ads',
  lastError,
})
const google = (lastError: string | null) => ({
  id: 'c2',
  spaceId: 'sp2',
  provider: 'google-marketing',
  lastError,
})

beforeEach(() => {
  jest.clearAllMocks()
  ;(loadMetaCred as jest.Mock).mockResolvedValue({ secret: {}, config: {} })
  ;(fetchAdAccountCurrencies as jest.Mock).mockResolvedValue({ act_1: 'KRW' })
  ;(loadGoogleCred as jest.Mock).mockResolvedValue({})
  ;(verifyGoogleCred as jest.Mock).mockResolvedValue(undefined)
  notify.mockResolvedValue(true)
})

it('정상이면 lastVerifiedAt 갱신, 알림 없음', async () => {
  findMany.mockResolvedValue([meta(null), google(null)])
  expect(await checkCredentialHealth()).toEqual({ checked: 2, failed: 0, notified: 0 })
  expect(update).toHaveBeenCalledWith({
    where: { id: 'c1' },
    data: { lastError: null, lastVerifiedAt: expect.any(Date) },
  })
  expect(notify).not.toHaveBeenCalled()
})

it('정상→오류로 바뀌면 오류를 남기고 그 Space 에 한 번 알린다(토큰은 가린다)', async () => {
  findMany.mockResolvedValue([meta(null)])
  ;(fetchAdAccountCurrencies as jest.Mock).mockRejectedValue(
    new Error('Error validating access token: https://x?access_token=EAAsecret')
  )
  const r = await checkCredentialHealth()
  expect(r).toEqual({ checked: 1, failed: 1, notified: 1 })
  const saved = update.mock.calls[0][0].data.lastError as string
  expect(saved).not.toMatch(/EAAsecret/)
  expect(notify).toHaveBeenCalledWith(
    expect.objectContaining({
      spaceId: 'sp1',
      text: expect.stringMatching(/Meta 광고 연동 점검 실패/),
    })
  )
  expect(notify.mock.calls[0][0].text).not.toMatch(/EAAsecret/)
})

it('이미 오류였으면 다시 알리지 않는다(매일 반복 알림 방지)', async () => {
  findMany.mockResolvedValue([google('old')])
  ;(verifyGoogleCred as jest.Mock).mockRejectedValue(new Error('invalid_grant'))
  expect(await checkCredentialHealth()).toEqual({ checked: 1, failed: 1, notified: 0 })
  expect(notify).not.toHaveBeenCalled()
})

it('오류→정상이면 복구 알림을 한 번 보낸다', async () => {
  findMany.mockResolvedValue([google('old')])
  expect(await checkCredentialHealth()).toEqual({ checked: 1, failed: 0, notified: 1 })
  expect(notify.mock.calls[0][0].text).toMatch(/Google 마케팅 연동이 복구/)
})

it('한 Space 실패가 다른 Space 점검을 막지 않는다', async () => {
  findMany.mockResolvedValue([meta(null), google(null)])
  ;(loadMetaCred as jest.Mock).mockRejectedValue(new Error('decrypt failed'))
  const r = await checkCredentialHealth()
  expect(r.checked).toBe(2)
  expect(r.failed).toBe(1)
  expect(verifyGoogleCred).toHaveBeenCalled()
})

it('점검 대상은 meta-ads·google-marketing 만', async () => {
  findMany.mockResolvedValue([])
  await checkCredentialHealth()
  expect(findMany.mock.calls[0][0].where).toEqual({
    provider: { in: ['meta-ads', 'google-marketing'] },
  })
})
