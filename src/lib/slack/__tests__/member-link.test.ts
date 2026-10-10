/** @jest-environment node */
import { prisma } from '@/lib/prisma'
import { slackGet } from '../client'
import { resolveSlackMember } from '../member-link'

jest.mock('@/lib/prisma', () => ({
  prisma: { spaceMember: { findUnique: jest.fn(), findFirst: jest.fn(), update: jest.fn() } },
}))
jest.mock('../client', () => ({ slackGet: jest.fn() }))

const m = prisma.spaceMember as unknown as {
  findUnique: jest.Mock
  findFirst: jest.Mock
  update: jest.Mock
}
const get = slackGet as jest.Mock
const input = { spaceId: 's1', slackUserId: 'U123', getBotToken: () => 'xoxb' }
const slackUser = (over: Record<string, unknown> = {}) => ({
  ok: true,
  user: {
    deleted: false,
    is_bot: false,
    is_email_confirmed: true,
    profile: { email: 'a@x.co' },
    ...over,
  },
})

beforeEach(() => jest.clearAllMocks())

test('이미 연결된 구성원은 Slack API 를 부르지 않는다', async () => {
  m.findUnique.mockResolvedValue({ userId: 'u1', role: 'ADMIN' })
  await expect(resolveSlackMember(input)).resolves.toEqual({ userId: 'u1', role: 'ADMIN' })
  expect(get).not.toHaveBeenCalled()
})

test('이메일이 같은 Space 구성원과 일치하면 자동 연결', async () => {
  m.findUnique.mockResolvedValue(null)
  get.mockResolvedValue(slackUser())
  m.findFirst.mockResolvedValue({ id: 'm1', userId: 'u1', role: 'MEMBER' })
  m.update.mockResolvedValue({})
  await expect(resolveSlackMember(input)).resolves.toEqual({ userId: 'u1', role: 'MEMBER' })
  expect(m.findFirst.mock.calls[0][0].where).toEqual({
    spaceId: 's1',
    slackUserId: null,
    user: { email: { equals: 'a@x.co', mode: 'insensitive' } },
  })
  expect(m.update).toHaveBeenCalledWith({ where: { id: 'm1' }, data: { slackUserId: 'U123' } })
  expect(get.mock.calls[0][3]).toBeLessThanOrEqual(1500) // interactive 3초 데드라인
})

test('이메일이 Space 구성원이 아닌 사람과 일치 → 연결 안 함', async () => {
  m.findUnique.mockResolvedValue(null)
  get.mockResolvedValue(slackUser())
  m.findFirst.mockResolvedValue(null)
  await expect(resolveSlackMember(input)).resolves.toBeNull()
  expect(m.update).not.toHaveBeenCalled()
})

test.each([
  ['이메일 미확인', { is_email_confirmed: false }],
  ['봇', { is_bot: true }],
  ['삭제된 사용자', { deleted: true }],
  ['이메일 없음', { profile: {} }],
])('%s → null', async (_n, over) => {
  m.findUnique.mockResolvedValue(null)
  get.mockResolvedValue(slackUser(over))
  await expect(resolveSlackMember(input)).resolves.toBeNull()
  expect(m.findFirst).not.toHaveBeenCalled()
})

test('봇 토큰 복호화 실패 → null(throw 아님)', async () => {
  m.findUnique.mockResolvedValue(null)
  const broken = {
    ...input,
    getBotToken: () => {
      throw new Error('ENCRYPTION_KEY_V1 환경변수가 설정되지 않았습니다')
    },
  }
  await expect(resolveSlackMember(broken)).resolves.toBeNull()
})

test('scope 부족·타임아웃 등 Slack 오류 → null', async () => {
  m.findUnique.mockResolvedValue(null)
  get.mockResolvedValueOnce({ ok: false, error: 'missing_scope' })
  await expect(resolveSlackMember(input)).resolves.toBeNull()
  get.mockRejectedValueOnce(new Error('aborted'))
  await expect(resolveSlackMember(input)).resolves.toBeNull()
})
