/** @jest-environment node */
import { NextRequest } from 'next/server'
import { PUT } from '../route'
import { prisma } from '@/lib/prisma'
import { resolveDeckContext } from '@/lib/api-helpers'

jest.mock('@/lib/api-helpers', () => ({
  resolveDeckContext: jest.fn(),
  errorResponse: (message: string, status: number) => Response.json({ message }, { status }),
}))
jest.mock('@/lib/prisma', () => ({
  prisma: {
    hiringPosting: { findFirst: jest.fn(), update: jest.fn(), findUniqueOrThrow: jest.fn() },
    hiringPostingMailSetting: { upsert: jest.fn() },
  },
}))

const call = async (body: unknown) =>
  (await PUT(new NextRequest('http://x/api', { method: 'PUT', body: JSON.stringify(body) }), {
    params: Promise.resolve({ id: 'p1' }),
  })) as Response

beforeEach(() => {
  jest.resetAllMocks()
  ;(resolveDeckContext as jest.Mock).mockResolvedValue({ space: { id: 's1' } })
  ;(prisma.hiringPosting.findFirst as jest.Mock).mockResolvedValue({ id: 'p1' })
  ;(prisma.hiringPosting.findUniqueOrThrow as jest.Mock).mockResolvedValue({
    notificationEnabled: false,
    mailSetting: null,
  })
})

it('다른 Space 공고는 404', async () => {
  ;(prisma.hiringPosting.findFirst as jest.Mock).mockResolvedValue(null)
  expect((await call({ notificationEnabled: true })).status).toBe(404)
  expect((prisma.hiringPosting.findFirst as jest.Mock).mock.calls[0][0].where).toEqual({
    id: 'p1',
    spaceId: 's1',
  })
})

it('두 토글 모두 설정 테이블에만 쓰고 공고 행은 건드리지 않는다(이관 해시 보호)', async () => {
  await call({ applicantReceiptEmail: false, notificationEnabled: true })
  expect(prisma.hiringPosting.update).not.toHaveBeenCalled()
  expect(prisma.hiringPostingMailSetting.upsert).toHaveBeenCalledWith({
    where: { postingId: 'p1' },
    create: { postingId: 'p1', applicantReceiptEmail: false, dailyDigestEmail: true },
    update: { applicantReceiptEmail: false, dailyDigestEmail: true },
  })
})

it('설정 행이 없으면 기존 공고 notificationEnabled 와 접수 메일 켜짐을 돌려준다', async () => {
  const res = await call({})
  expect(await res.json()).toEqual({ notificationEnabled: false, applicantReceiptEmail: true })
})

it('설정 행 값이 기존 공고 값보다 우선한다', async () => {
  ;(prisma.hiringPosting.findUniqueOrThrow as jest.Mock).mockResolvedValue({
    notificationEnabled: false,
    mailSetting: { applicantReceiptEmail: false, dailyDigestEmail: true },
  })
  const res = await call({ notificationEnabled: true })
  expect(await res.json()).toEqual({ notificationEnabled: true, applicantReceiptEmail: false })
})

it('알 수 없는 필드는 400', async () => {
  expect((await call({ title: 'x' })).status).toBe(400)
})
