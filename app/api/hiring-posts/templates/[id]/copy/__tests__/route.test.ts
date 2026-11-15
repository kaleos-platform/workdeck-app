/** @jest-environment node */
import { POST } from '../route'
import { prisma } from '@/lib/prisma'
import { templateAccessScope } from '@/lib/hiring/template-scope'
import type { NextRequest } from 'next/server'

jest.mock('@/lib/api-helpers', () => ({
  resolveDeckContext: jest.fn().mockResolvedValue({ space: { id: 'space' } }),
  errorResponse: (message: string, status: number) => Response.json({ message }, { status }),
}))
jest.mock('@/lib/prisma', () => ({
  prisma: { hiringDetailTemplate: { findFirst: jest.fn() }, $transaction: jest.fn() },
}))

const tx = {
  hiringDetailTemplate: { create: jest.fn() },
  hiringContent: { createMany: jest.fn() },
}
const contents = [
  { contentType: 'TEXT', title: 'a', data: { x: 1 }, imagePath: 'p/a.png', sortOrder: 0 },
  { contentType: 'IMAGE', title: null, data: null, imagePath: 'p/b.png', sortOrder: 1 },
]
const req = (body?: unknown) =>
  ({ text: async () => (body === undefined ? '' : JSON.stringify(body)) }) as unknown as NextRequest
const call = async (body?: unknown) =>
  (await POST(req(body), { params: Promise.resolve({ id: 'src' }) }))!

beforeEach(() => {
  jest.clearAllMocks()
  jest
    .mocked(prisma.$transaction)
    .mockImplementation(async (work: unknown) => (work as (a: typeof tx) => unknown)(tx))
  tx.hiringDetailTemplate.create.mockResolvedValue({
    id: 'new',
    name: '원본 (복사)',
    updatedAt: new Date('2026-11-15'),
  })
})

it('워크덱 제공 템플릿을 내 템플릿으로 복사하고 블록을 그대로 옮긴다', async () => {
  jest
    .mocked(prisma.hiringDetailTemplate.findFirst)
    .mockResolvedValue({ name: '원본', imagePath: 'p/a.png', contents } as never)
  const res = await call()
  expect(res.status).toBe(201)
  expect((await res.json()).template).toMatchObject({ id: 'new', blockCount: 2 })
  // 샘플 접근 범위(전역 샘플 포함)로 조회한다.
  expect(prisma.hiringDetailTemplate.findFirst).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { id: 'src', ...templateAccessScope('space') },
    })
  )
  expect(tx.hiringDetailTemplate.create).toHaveBeenCalledWith(
    expect.objectContaining({
      data: { spaceId: 'space', isSample: false, name: '원본 (복사)', imagePath: 'p/a.png' },
    })
  )
  const data = tx.hiringContent.createMany.mock.calls[0][0].data
  expect(data).toHaveLength(2)
  expect(data[0]).toMatchObject({
    spaceId: 'space',
    sourceType: 'DETAIL_TEMPLATE',
    templateId: 'new',
    imagePath: 'p/a.png',
    sortOrder: 0,
  })
})

it('이름을 지정하면 그대로 쓰고, 기본 이름은 200자를 넘지 않게 자른다', async () => {
  jest
    .mocked(prisma.hiringDetailTemplate.findFirst)
    .mockResolvedValue({ name: 'ㄱ'.repeat(200), imagePath: null, contents: [] } as never)
  await call()
  const defaultName = tx.hiringDetailTemplate.create.mock.calls[0][0].data.name as string
  expect(defaultName).toHaveLength(200)
  expect(defaultName.endsWith(' (복사)')).toBe(true)
  expect(tx.hiringContent.createMany).not.toHaveBeenCalled()

  await call({ name: '  내 이름  ' })
  expect(tx.hiringDetailTemplate.create.mock.calls[1][0].data.name).toBe('내 이름')
})

it('접근할 수 없는 템플릿(타 Space 등)은 404 이고 아무것도 만들지 않는다', async () => {
  jest.mocked(prisma.hiringDetailTemplate.findFirst).mockResolvedValue(null)
  const res = await call()
  expect(res.status).toBe(404)
  expect(prisma.$transaction).not.toHaveBeenCalled()
})

it('잘못된 본문은 400', async () => {
  expect((await call({ name: '' })).status).toBe(400)
  expect(prisma.hiringDetailTemplate.findFirst).not.toHaveBeenCalled()
})
