/** @jest-environment node */
import { prisma } from '@/lib/prisma'
import { slackGet } from '../client'
import { resolveSlackMember } from '../member-link'

jest.mock('@/lib/prisma', () => ({
  prisma: { spaceMember: { findUnique: jest.fn(), findFirst: jest.fn(), updateMany: jest.fn() } },
}))
jest.mock('../client', () => ({ slackGet: jest.fn() }))

const m = prisma.spaceMember as unknown as {
  findUnique: jest.Mock
  findFirst: jest.Mock
  updateMany: jest.Mock
}
const get = slackGet as jest.Mock
const input = { spaceId: 's1', teamId: 'T1', slackUserId: 'U123', getBotToken: () => 'xoxb' }
const slackUser = (over: Record<string, unknown> = {}) => ({
  ok: true,
  user: {
    deleted: false,
    is_bot: false,
    is_email_confirmed: true,
    team_id: 'T1',
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
  m.updateMany.mockResolvedValue({ count: 1 })
  await expect(resolveSlackMember(input)).resolves.toEqual({ userId: 'u1', role: 'MEMBER' })
  expect(m.findFirst.mock.calls[0][0].where).toEqual({
    spaceId: 's1',
    slackUserId: null,
    role: { not: 'OWNER' },
    user: { email: { equals: 'a@x.co', mode: 'insensitive' } },
  })
  // 조건부 갱신 — 조회 뒤 다른 요청이 연결했으면 덮어쓰지 않는다.
  expect(m.updateMany).toHaveBeenCalledWith({
    where: { id: 'm1', spaceId: 's1', slackUserId: null },
    data: { slackUserId: 'U123' },
  })
  expect(get.mock.calls[0][3]).toBeLessThanOrEqual(1500) // interactive 3초 데드라인
})

test('이메일이 Space 구성원이 아닌 사람과 일치 → 연결 안 함', async () => {
  m.findUnique.mockResolvedValue(null)
  get.mockResolvedValue(slackUser())
  m.findFirst.mockResolvedValue(null)
  await expect(resolveSlackMember(input)).resolves.toBeNull()
  expect(m.updateMany).not.toHaveBeenCalled()
})

test('OWNER 는 이메일이 일치해도 자동 연결하지 않는다(본인이 웹에서 연결)', async () => {
  m.findUnique.mockResolvedValue(null)
  get.mockResolvedValue(slackUser())
  // findFirst 가 role != OWNER 로 거르므로 OWNER 행은 돌아오지 않는다.
  m.findFirst.mockImplementation(async ({ where }) =>
    where.role?.not === 'OWNER' ? null : { id: 'm-owner', userId: 'u-owner', role: 'OWNER' }
  )
  await expect(resolveSlackMember(input)).resolves.toBeNull()
  expect(m.updateMany).not.toHaveBeenCalled()
})

test('같은 구성원을 두 Slack 사용자가 동시에 자동 연결 → 하나만 성공', async () => {
  m.findUnique.mockResolvedValue(null)
  get.mockResolvedValue(slackUser())
  m.findFirst.mockResolvedValue({ id: 'm1', userId: 'u1', role: 'ADMIN' })
  // DB 의 조건부 갱신을 흉내 — slackUserId 가 null 일 때만 한 번 갱신된다.
  let linkedTo: string | null = null
  m.updateMany.mockImplementation(async ({ where, data }) => {
    if (where.slackUserId !== null || linkedTo !== null) return { count: 0 }
    linkedTo = data.slackUserId
    return { count: 1 }
  })
  const results = await Promise.all([
    resolveSlackMember({ ...input, slackUserId: 'UAAAA1' }),
    resolveSlackMember({ ...input, slackUserId: 'UBBBB2' }),
  ])
  expect(results.filter((r) => r !== null)).toEqual([{ userId: 'u1', role: 'ADMIN' }])
  expect(linkedTo).toBe('UAAAA1')
})

test('조회 뒤 수동 연결이 끝났으면 덮어쓰지 않고 null', async () => {
  m.findUnique.mockResolvedValue(null)
  get.mockResolvedValue(slackUser())
  m.findFirst.mockResolvedValue({ id: 'm1', userId: 'u1', role: 'ADMIN' })
  m.updateMany.mockResolvedValue({ count: 0 }) // 그 사이 slackUserId 가 다른 값으로 바뀜
  await expect(resolveSlackMember(input)).resolves.toBeNull()
  // 경합 패배 후 이 Slack ID 의 연결을 다시 읽는다(1회 + 재조회 1회).
  expect(m.findUnique).toHaveBeenCalledTimes(2)
})

test('경합 패배 후 이 Slack ID 가 이미 연결됐으면 그 구성원', async () => {
  m.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ userId: 'u1', role: 'ADMIN' })
  get.mockResolvedValue(slackUser())
  m.findFirst.mockResolvedValue({ id: 'm1', userId: 'u1', role: 'ADMIN' })
  m.updateMany.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }))
  await expect(resolveSlackMember(input)).resolves.toEqual({ userId: 'u1', role: 'ADMIN' })
})

test('P2002 외 DB 오류는 그대로 던진다', async () => {
  m.findUnique.mockResolvedValue(null)
  get.mockResolvedValue(slackUser())
  m.findFirst.mockResolvedValue({ id: 'm1', userId: 'u1', role: 'ADMIN' })
  m.updateMany.mockRejectedValue(new Error('connection lost'))
  await expect(resolveSlackMember(input)).rejects.toThrow('connection lost')
})

test('다른 Slack workspace 사용자(Slack Connect 외부인) → 연결 안 함', async () => {
  m.findUnique.mockResolvedValue(null)
  get.mockResolvedValue(slackUser({ team_id: 'T_OTHER' }))
  await expect(resolveSlackMember(input)).resolves.toBeNull()
  expect(m.findFirst).not.toHaveBeenCalled()
})

test.each([
  ['이메일 미확인', { is_email_confirmed: false }],
  ['이메일 확인 필드 없음', { is_email_confirmed: undefined }],
  ['team_id 없음', { team_id: undefined }],
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
