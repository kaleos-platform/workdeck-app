/** @jest-environment node */
import { NextRequest } from 'next/server'
import { POST } from '../route'
import { prisma } from '@/lib/prisma'
import { notifyEmail, notifySlack } from '@/lib/marketing/lead-notify'

jest.mock('@/lib/prisma', () => ({
  prisma: { marketingLead: { findFirst: jest.fn(), create: jest.fn(), count: jest.fn() } },
}))
jest.mock('@/lib/hiring/applications', () => ({ checkRateLimit: () => true }))
jest.mock('@/lib/hiring/public-request', () => ({ publicRequestKey: () => 'k' }))
jest.mock('@/lib/del/encryption', () => ({
  encryptPii: () => ({ encrypted: 'ENC', iv: 'v1' }),
}))
jest.mock('@/lib/marketing/lead-notify', () => ({
  notifySlack: jest.fn(async () => undefined),
  notifyEmail: jest.fn(async () => undefined),
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
  ;(prisma.marketingLead.count as jest.Mock).mockResolvedValue(0)
})

it('허니팟이 채워지면 저장·알림 없이 200', async () => {
  const res = await post({ ...valid, hp_extra: 'http://spam' })
  expect(res.status).toBe(200)
  expect(create).not.toHaveBeenCalled()
  expect(notifySlack).not.toHaveBeenCalled()
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
