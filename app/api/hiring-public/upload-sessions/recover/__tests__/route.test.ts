/** @jest-environment node */
import { NextRequest } from 'next/server'
import { POST } from '../route'
import { prisma } from '@/lib/prisma'

jest.mock('@/lib/prisma', () => ({
  prisma: {
    hiringUploadSession: { updateMany: jest.fn(), findFirst: jest.fn() },
    $transaction: jest.fn(),
  },
}))
jest.mock('@/lib/hiring/applications', () => ({ checkRateLimit: () => true }))
jest.mock('@/lib/hiring/public-request', () => ({ publicRequestKey: () => 'qa' }))
const id = '00000000-0000-4000-8000-000000000001'
const token = 'a'.repeat(64)
function req(cookie = `wd-recovery-${id}=${token}`) {
  return new NextRequest('http://localhost/api/hiring-public/upload-sessions/recover', {
    method: 'POST',
    headers: { origin: 'http://localhost', cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ uploadSessionId: id, postingUuid: 'post' }),
  })
}
beforeEach(() => {
  jest.resetAllMocks()
  ;(prisma.$transaction as jest.Mock).mockImplementation((fn) => fn(prisma))
})
it('쿠키가 없으면 세션을 변경하지 않는다', async () => {
  const res = await POST(req(''))
  expect(res.status).toBe(403)
  expect(prisma.hiringUploadSession.updateMany).not.toHaveBeenCalled()
})
it('미완료 세션을 원자적으로 취소하고 재작성하도록 알린다', async () => {
  ;(prisma.hiringUploadSession.updateMany as jest.Mock).mockResolvedValue({ count: 1 })
  const res = await POST(req())
  expect(await res.json()).toEqual({ status: 'cancelled' })
  expect(prisma.hiringUploadSession.updateMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({
        id,
        claimedAt: null,
        completedAt: null,
        posting: { uuid: 'post' },
      }),
    })
  )
})
it('선점하지 못했고 완료된 세션이면 접수 완료를 알린다', async () => {
  ;(prisma.hiringUploadSession.updateMany as jest.Mock).mockResolvedValue({ count: 0 })
  ;(prisma.hiringUploadSession.findFirst as jest.Mock).mockResolvedValue({
    completedAt: new Date(),
    applicationId: id,
  })
  const res = await POST(req())
  expect(await res.json()).toEqual({ status: 'completed' })
})
it('결과가 불명확하면 새 접수를 허용하지 않는다', async () => {
  ;(prisma.hiringUploadSession.updateMany as jest.Mock).mockResolvedValue({ count: 0 })
  ;(prisma.hiringUploadSession.findFirst as jest.Mock).mockResolvedValue(null)
  const res = await POST(req())
  expect(res.status).toBe(409)
})
it('취소 응답이 유실되어 다시 확인해도 취소 결과를 반환한다', async () => {
  ;(prisma.hiringUploadSession.updateMany as jest.Mock).mockResolvedValue({ count: 0 })
  ;(prisma.hiringUploadSession.findFirst as jest.Mock).mockResolvedValue({
    completedAt: null,
    applicationId: null,
    requestHash: 'recovery-cancelled-v1',
  })
  const res = await POST(req())
  expect(await res.json()).toEqual({ status: 'cancelled' })
})
it('다른 출처의 복구 요청을 거부한다', async () => {
  const request = new NextRequest('http://localhost/api/hiring-public/upload-sessions/recover', {
    method: 'POST',
    headers: { origin: 'https://other.example', cookie: `wd-recovery-${id}=${token}` },
    body: JSON.stringify({ uploadSessionId: id, postingUuid: 'post' }),
  })
  const res = await POST(request)
  expect(res.status).toBe(403)
  expect(prisma.hiringUploadSession.updateMany).not.toHaveBeenCalled()
})
