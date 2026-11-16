/** @jest-environment node */
import { NextRequest } from 'next/server'
import { GET, POST } from '../route'
import { PATCH, DELETE } from '../[id]/route'
import { prisma } from '@/lib/prisma'
import { resolveDeckContext, canWriteDeck } from '@/lib/api-helpers'
import { assertDeckWritable } from '@/lib/billing/entitlement'

jest.mock('@/lib/api-helpers', () => ({
  resolveDeckContext: jest.fn(),
  canWriteDeck: jest.fn(() => true),
  errorResponse: (message: string, status: number) => Response.json({ message }, { status }),
}))
jest.mock('@/lib/billing/entitlement', () => ({ assertDeckWritable: jest.fn() }))
const tx = {
  $executeRaw: jest.fn(),
  hiringMessageSeed: { findUnique: jest.fn(), create: jest.fn(), upsert: jest.fn() },
  hiringMessageTemplate: { count: jest.fn(), createMany: jest.fn(), create: jest.fn() },
}
jest.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: jest.fn((fn: (t: unknown) => unknown) => fn(tx)),
    hiringMessageSeed: { findUnique: jest.fn() },
    hiringMessageTemplate: {
      findMany: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
    },
  },
}))

const ok = { space: { id: 'space-qa' }, user: { id: 'u' }, role: 'MEMBER' }
const denied = { error: Response.json({ message: 'no' }, { status: 403 }) }
const req = (body?: unknown) =>
  new NextRequest('http://localhost/api/x', { method: 'POST', body: JSON.stringify(body) })
const params = { params: Promise.resolve({ id: 'tpl-1' }) }

beforeEach(() => {
  jest.clearAllMocks()
  ;(resolveDeckContext as jest.Mock).mockResolvedValue(ok)
  ;(canWriteDeck as jest.Mock).mockReturnValue(true)
  ;(assertDeckWritable as jest.Mock).mockResolvedValue(null)
  ;(prisma.hiringMessageSeed.findUnique as jest.Mock).mockResolvedValue({ spaceId: 'space-qa' })
  tx.hiringMessageSeed.findUnique.mockResolvedValue(null)
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
  tx.hiringMessageTemplate.create.mockResolvedValue({ id: 'n' })
  const res = await POST(req({ title: '제목', content: '내용' }))
  expect(res!.status).toBe(201)
  expect(tx.hiringMessageSeed.upsert).toHaveBeenCalledWith({
    where: { spaceId: 'space-qa' },
    create: { spaceId: 'space-qa' },
    update: {},
  })
  expect(tx.hiringMessageTemplate.create).toHaveBeenCalledWith(
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

describe('GET seed', () => {
  const noSeed = () => (prisma.hiringMessageSeed.findUnique as jest.Mock).mockResolvedValue(null)
  beforeEach(() => {
    ;(prisma.hiringMessageTemplate.findMany as jest.Mock).mockResolvedValue([])
  })

  it('seed 행이 없고 비어 있으면 seed 행 + 예시 3개를 만든다', async () => {
    noSeed()
    tx.hiringMessageTemplate.count.mockResolvedValue(0)
    await GET()
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1)
    expect(tx.hiringMessageSeed.create).toHaveBeenCalledWith({ data: { spaceId: 'space-qa' } })
    expect(tx.hiringMessageTemplate.createMany.mock.calls[0][0].data).toHaveLength(3)
  })

  it('이미 메시지가 있으면 seed 행만 기록하고 예시는 넣지 않는다', async () => {
    noSeed()
    tx.hiringMessageTemplate.count.mockResolvedValue(2)
    await GET()
    expect(tx.hiringMessageSeed.create).toHaveBeenCalled()
    expect(tx.hiringMessageTemplate.createMany).not.toHaveBeenCalled()
  })

  it('seed 행이 있으면(삭제 후 포함) 다시 만들지 않는다', async () => {
    await GET()
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('lock 안에서 seed 행이 이미 있으면 생략한다', async () => {
    noSeed()
    tx.hiringMessageSeed.findUnique.mockResolvedValue({ spaceId: 'space-qa' })
    await GET()
    expect(tx.hiringMessageSeed.create).not.toHaveBeenCalled()
    expect(tx.hiringMessageTemplate.createMany).not.toHaveBeenCalled()
  })

  it('쓰기 역할이 없거나 구독 만료면 seed 하지 않는다', async () => {
    noSeed()
    ;(canWriteDeck as jest.Mock).mockReturnValue(false)
    await GET()
    ;(canWriteDeck as jest.Mock).mockReturnValue(true)
    ;(assertDeckWritable as jest.Mock).mockResolvedValue('만료')
    await GET()
    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(prisma.hiringMessageTemplate.findMany).toHaveBeenCalledTimes(2)
  })

  it('seed가 실패해도 목록을 반환한다', async () => {
    noSeed()
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {})
    ;(prisma.$transaction as jest.Mock).mockRejectedValueOnce(new Error('boom'))
    const res = await GET()
    expect(res!.status).toBe(200)
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})
