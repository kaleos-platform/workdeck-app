/** @jest-environment node */
import { NextRequest } from 'next/server'
import { POST } from '../route'
import { prisma } from '@/lib/prisma'
import { getReleasedDeckIds } from '@/lib/billing/deck-release'
import { notifyApplicant, notifyEmail, notifySlack } from '@/lib/marketing/lead-notify'

jest.mock('@/lib/prisma', () => ({
  prisma: { marketingLead: { findFirst: jest.fn(), create: jest.fn(), count: jest.fn() } },
}))
jest.mock('@/lib/marketing/lead-signup', () => ({
  leadSignupUrl: (id: string) => `https://app.test/signup?lead=${id}.signed`,
}))
jest.mock('@/lib/hiring/applications', () => ({ checkRateLimit: () => true }))
jest.mock('@/lib/hiring/public-request', () => ({ publicRequestKey: () => 'k' }))
jest.mock('@/lib/del/encryption', () => ({
  encryptPii: () => ({ encrypted: 'ENC', iv: 'v1' }),
}))
jest.mock('@/lib/marketing/lead-notify', () => ({
  notifySlack: jest.fn(async () => undefined),
  notifyEmail: jest.fn(async () => undefined),
  notifyApplicant: jest.fn(async () => undefined),
}))
jest.mock('@/lib/billing/deck-release', () => ({
  getReleasedDeckIds: jest.fn(async () => ['recruiting']),
}))

const valid = {
  deck: 'recruiting',
  name: '테스트',
  phone: '01012345678',
  email: 'lead-test@example.com',
  companyName: '테스트회사',
  position: '대표',
  employeeCount: '5-9',
  consent: true,
}
const post = (body: unknown) =>
  POST(
    new NextRequest('http://localhost/api/public/leads', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  )
const create = prisma.marketingLead.create as jest.Mock
const findFirst = prisma.marketingLead.findFirst as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  findFirst.mockResolvedValue(null)
  create.mockResolvedValue({ id: 'new-lead' })
  ;(prisma.marketingLead.count as jest.Mock).mockResolvedValue(0)
})

it('허니팟이 채워지면 저장·알림 없이 200', async () => {
  const res = await post({ ...valid, hp_extra: 'http://spam' })
  expect(res.status).toBe(200)
  expect(create).not.toHaveBeenCalled()
  expect(notifySlack).not.toHaveBeenCalled()
  expect(notifyApplicant).not.toHaveBeenCalled()
})

it('검증 실패는 400', async () => {
  const res = await post({ ...valid, phone: '123' })
  expect(res.status).toBe(400)
  expect(create).not.toHaveBeenCalled()
})

it('10분 내 같은 이메일은 저장·알림 없이 duplicate', async () => {
  findFirst.mockResolvedValue({ id: 'x' })
  const res = await post(valid)
  expect(res.status).toBe(201)
  expect(create).not.toHaveBeenCalled()
  expect(notifyEmail).not.toHaveBeenCalled()
})

it('연락처는 암호문으로 저장하고, 알림이 실패해도 201', async () => {
  ;(notifySlack as jest.Mock).mockRejectedValueOnce(new Error('boom'))
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
  const res = await post(valid)
  expect(res.status).toBe(201)
  const data = create.mock.calls[0][0].data
  expect(data.phoneEnc).toBe('ENC')
  expect(JSON.stringify(data)).not.toContain('01012345678')
})

it('JSON 이 아니면 415', async () => {
  const res = await POST(
    new NextRequest('http://localhost/api/public/leads', { method: 'POST', body: 'x' })
  )
  expect(res.status).toBe(415)
})

it('최근 1시간 접수가 30건을 넘으면 저장은 하고 알림은 생략', async () => {
  ;(prisma.marketingLead.count as jest.Mock).mockResolvedValue(31)
  jest.spyOn(console, 'warn').mockImplementation(() => undefined)
  const res = await post(valid)
  expect(res.status).toBe(201)
  expect(create).toHaveBeenCalled()
  expect(notifySlack).not.toHaveBeenCalled()
})

it('JSON 이 아니면 415', async () => {
  const res = await POST(
    new NextRequest('http://localhost/api/public/leads', { method: 'POST', body: 'x' })
  )
  expect(res.status).toBe(415)
})

it('최근 1시간 접수가 30건을 넘으면 저장은 하고 알림은 생략', async () => {
  ;(prisma.marketingLead.count as jest.Mock).mockResolvedValue(31)
  jest.spyOn(console, 'warn').mockImplementation(() => undefined)
  const res = await post(valid)
  expect(res.status).toBe(201)
  expect(create).toHaveBeenCalled()
  expect(notifySlack).not.toHaveBeenCalled()
})

it('정상 접수: 운영 알림과 함께 신청자 확인 메일(공개 여부 서버 판정)', async () => {
  const res = await post(valid)
  expect(res.status).toBe(201)
  expect(notifyApplicant).toHaveBeenCalledTimes(1)
  const [arg, opts] = (notifyApplicant as jest.Mock).mock.calls[0]
  expect(arg.email).toBe('lead-test@example.com')
  expect(opts).toEqual({
    released: true,
    signupUrl: 'https://app.test/signup?lead=new-lead.signed',
  })
})

it('신청자 메일이 실패해도 접수는 201', async () => {
  ;(notifyApplicant as jest.Mock).mockRejectedValueOnce(new Error('resend 500'))
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
  const res = await post(valid)
  expect(res.status).toBe(201)
  expect(create).toHaveBeenCalled()
})

it('중복·시간당 초과면 신청자 메일도 보내지 않는다', async () => {
  findFirst.mockResolvedValue({ id: 'x' })
  await post(valid)
  expect(notifyApplicant).not.toHaveBeenCalled()
  findFirst.mockResolvedValue(null)
  ;(prisma.marketingLead.count as jest.Mock).mockResolvedValue(31)
  jest.spyOn(console, 'warn').mockImplementation(() => undefined)
  await post(valid)
  expect(notifyApplicant).not.toHaveBeenCalled()
})

it('저장한 행과 10분 중복 행 모두 서명 가입 링크를 반환한다', async () => {
  expect(await (await post(valid)).json()).toMatchObject({
    signupUrl: 'https://app.test/signup?lead=new-lead.signed',
  })
  findFirst.mockResolvedValue({ id: 'existing-lead' })
  expect(await (await post(valid)).json()).toMatchObject({
    signupUrl: 'https://app.test/signup?lead=existing-lead.signed',
  })
})
it.each(['https://workdeck.work/a', 'https://app.workdeck.work/signup'])(
  '자기 도메인 referrer %s는 null로 저장한다',
  async (referrer) => {
    await post({ ...valid, referrer })
    expect(create.mock.calls[0][0].data.referrer).toBeNull()
  }
)
it('외부 referrer는 보존한다', async () => {
  await post({ ...valid, referrer: 'https://google.com/search' })
  expect(create.mock.calls[0][0].data.referrer).toBe('https://google.com/search')
})

it('10분 안에 다시 문의해도 종료 리드는 중복으로 쓰지 않고 새 문의를 만든다', async () => {
  findFirst.mockImplementation(async ({ where }: { where: { status?: { not?: string } } }) =>
    where.status?.not === 'DROPPED' ? null : { id: 'dropped-lead' }
  )
  const res = await post(valid)
  expect(create).toHaveBeenCalledTimes(1)
  expect(await res.json()).toMatchObject({
    signupUrl: 'https://app.test/signup?lead=new-lead.signed',
  })
})

it('준비중 업무 접수는 signupUrl 을 돌려주지 않는다', async () => {
  ;(getReleasedDeckIds as jest.Mock).mockResolvedValueOnce([])
  const body = await (await post(valid)).json()
  expect(body.signupUrl).toBeUndefined()
  expect((notifyApplicant as jest.Mock).mock.calls[0][1]).toEqual({
    released: false,
    signupUrl: undefined,
  })
})
it('공개 여부 조회가 실패하면 signupUrl 없이 접수한다(fail closed)', async () => {
  ;(getReleasedDeckIds as jest.Mock).mockRejectedValue(new Error('db'))
  const res = await post(valid)
  expect(res.status).toBe(201)
  expect((await res.json()).signupUrl).toBeUndefined()
  ;(getReleasedDeckIds as jest.Mock).mockImplementation(async () => ['recruiting'])
})
it('해석할 수 없는 referrer 는 null 로 저장한다', async () => {
  await post({ ...valid, referrer: 'not a url' })
  expect(create.mock.calls[0][0].data.referrer).toBeNull()
})
