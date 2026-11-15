/** @jest-environment node */
import { NextRequest } from 'next/server'
import { GET, POST } from '../route'
import { PATCH, DELETE } from '../[id]/route'
import { prisma } from '@/lib/prisma'
import { resolveDeckContext } from '@/lib/api-helpers'

jest.mock('@/lib/api-helpers', () => ({
  resolveDeckContext: jest.fn(),
  errorResponse: (message: string, status: number) => Response.json({ message }, { status }),
}))
const tx = {
  $executeRaw: jest.fn(),
  hiringMessageTemplate: { count: jest.fn(), createMany: jest.fn(), findMany: jest.fn() },
}
jest.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: jest.fn((fn: (t: unknown) => unknown) => fn(tx)),
    hiringMessageTemplate: {
      findMany: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
    },
  },
}))

const ok = { space: { id: 'space-qa' }, user: { id: 'u' } }
const denied = { error: Response.json({ message: 'no' }, { status: 403 }) }
const req = (body?: unknown) =>
  new NextRequest('http://localhost/api/x', { method: 'POST', body: JSON.stringify(body) })
const params = { params: Promise.resolve({ id: 'tpl-1' }) }

beforeEach(() => {
  jest.clearAllMocks()
  ;(resolveDeckContext as jest.Mock).mockResolvedValue(ok)
})

it('GET은 자기 spaceId 메시지만 조회한다', async () => {
  ;(prisma.hiringMessageTemplate.findMany as jest.Mock).mockResolvedValue([])
  await GET()
  expect(prisma.hiringMessageTemplate.findMany).toHaveBeenCalledWith(
    expect.objectContaining({ where: { spaceId: 'space-qa' } })
  )
})

it('쓰기 API는 쓰기 권한이 없으면 막는다', async () => {
  ;(resolveDeckContext as jest.Mock).mockResolvedValue(denied)
  expect((await POST(req({ title: 'a', content: 'b' })))!.status).toBe(403)
  expect((await PATCH(req({ title: 'a', content: 'b' }), params))!.status).toBe(403)
  expect((await DELETE(req(), params))!.status).toBe(403)
  expect(resolveDeckContext).toHaveBeenCalledWith('recruiting', { write: true })
})

it('POST는 spaceId를 붙여 생성한다', async () => {
  ;(prisma.hiringMessageTemplate.create as jest.Mock).mockResolvedValue({ id: 'n' })
  const res = await POST(req({ title: '제목', content: '내용' }))
  expect(res!.status).toBe(201)
  expect(prisma.hiringMessageTemplate.create).toHaveBeenCalledWith(
    expect.objectContaining({ data: { spaceId: 'space-qa', title: '제목', content: '내용' } })
  )
})

it('PATCH·DELETE는 spaceId로 스코프하고 없으면 404', async () => {
  ;(prisma.hiringMessageTemplate.updateMany as jest.Mock).mockResolvedValue({ count: 0 })
  ;(prisma.hiringMessageTemplate.deleteMany as jest.Mock).mockResolvedValue({ count: 0 })
  expect((await PATCH(req({ title: 'a', content: 'b' }), params))!.status).toBe(404)
  expect((await DELETE(req(), params))!.status).toBe(404)
  expect(prisma.hiringMessageTemplate.updateMany).toHaveBeenCalledWith(
    expect.objectContaining({ where: { id: 'tpl-1', spaceId: 'space-qa' } })
  )
  expect(prisma.hiringMessageTemplate.deleteMany).toHaveBeenCalledWith({
    where: { id: 'tpl-1', spaceId: 'space-qa' },
  })
})

it('samples는 lock 후 비어 있으면 예시 3개를 만든다', async () => {
  tx.hiringMessageTemplate.count.mockResolvedValue(0)
  tx.hiringMessageTemplate.findMany.mockResolvedValue([])
  const res = await POST(req({ samples: true }))
  expect(res!.status).toBe(201)
  expect(tx.$executeRaw).toHaveBeenCalledTimes(1)
  expect(tx.hiringMessageTemplate.createMany.mock.calls[0][0].data).toHaveLength(3)
})

it('samples는 이미 메시지가 있으면 409', async () => {
  tx.hiringMessageTemplate.count.mockResolvedValue(1)
  const res = await POST(req({ samples: true }))
  expect(res!.status).toBe(409)
  expect(tx.hiringMessageTemplate.createMany).not.toHaveBeenCalled()
})
