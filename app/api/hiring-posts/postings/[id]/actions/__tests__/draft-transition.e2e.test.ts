/** @jest-environment node */
import { randomUUID } from 'node:crypto'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { POST } from '../route'

jest.mock('@/lib/api-helpers', () => ({
  resolveDeckContext: async () => ({ space: { id: process.env.QA_TRANSITION_SPACE } }),
  errorResponse: (message: string, status: number) => Response.json({ message }, { status }),
}))

const spaceId = `qa-transition-${randomUUID()}`
let created = false

beforeAll(async () => {
  if (
    new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').hostname !==
    'tumkfkfgzkmisguyaghn.supabase.co'
  )
    throw Error('DEV_PROJECT_REQUIRED')
  for (const name of ['DATABASE_URL', 'DIRECT_URL']) {
    const value = process.env[name]
    if (!value) continue
    const url = new URL(value)
    if (
      url.hostname !== 'db.tumkfkfgzkmisguyaghn.supabase.co' &&
      !(
        url.hostname.endsWith('.pooler.supabase.com') &&
        decodeURIComponent(url.username).endsWith('.tumkfkfgzkmisguyaghn')
      )
    )
      throw Error('DEV_DATABASE_REQUIRED')
  }
  if (!process.env.DATABASE_URL && !process.env.DIRECT_URL) throw Error('DEV_DATABASE_REQUIRED')
  process.env.QA_TRANSITION_SPACE = spaceId
  await prisma.space.create({ data: { id: spaceId, name: '[QA] 공고 상태 전이' } })
  created = true
})

afterAll(async () => {
  if (created) {
    await prisma.space.deleteMany({ where: { id: spaceId } })
    expect(await prisma.space.count({ where: { id: spaceId } })).toBe(0)
  }
  if (created) await prisma.$disconnect()
})

it.each(['close', 'archive'])('발행 이력이 없는 초안의 %s 요청은 차단한다', async (action) => {
  const posting = await prisma.hiringPosting.create({
    data: { spaceId, title: '[QA] 초안', status: 'DRAFT' },
  })
  const response = await POST(
    new NextRequest('http://localhost/actions', {
      method: 'POST',
      body: JSON.stringify({ action }),
    }),
    { params: Promise.resolve({ id: posting.id }) }
  )
  expect(response?.status).toBe(409)
  expect(
    await prisma.hiringPosting.findUniqueOrThrow({
      where: { id: posting.id },
      select: { status: true, publishedAt: true },
    })
  ).toEqual({ status: 'DRAFT', publishedAt: null })
})

it.each(['close', 'archive'])('발행 이력이 있는 이전 초안의 %s 동작을 유지한다', async (action) => {
  const posting = await prisma.hiringPosting.create({
    data: {
      spaceId,
      title: '[QA] 이전 초안',
      status: 'DRAFT',
      publishedAt: new Date('2023-01-01'),
    },
  })
  const response = await POST(
    new NextRequest('http://localhost/actions', {
      method: 'POST',
      body: JSON.stringify({ action }),
    }),
    { params: Promise.resolve({ id: posting.id }) }
  )
  expect(response?.status).toBe(200)
  expect((await prisma.hiringPosting.findUniqueOrThrow({ where: { id: posting.id } })).status).toBe(
    action === 'close' ? 'CLOSED' : 'ARCHIVED'
  )
})

it.each(['ACTIVE', 'CLOSED', 'ARCHIVED'] as const)(
  '기존 %s 공고의 마감과 보관을 유지한다',
  async (status) => {
    for (const action of ['close', 'archive']) {
      const posting = await prisma.hiringPosting.create({
        data: { spaceId, title: '[QA] 기존 상태', status },
      })
      const response = await POST(
        new NextRequest('http://localhost/actions', {
          method: 'POST',
          body: JSON.stringify({ action }),
        }),
        { params: Promise.resolve({ id: posting.id }) }
      )
      expect(response?.status).toBe(200)
      expect(await response?.json()).toEqual({
        posting: { id: posting.id, status: action === 'close' ? 'CLOSED' : 'ARCHIVED' },
      })
    }
  }
)

it.each(['close', 'archive'])(
  '조회 후 발행 이력 없는 초안으로 변경되면 %s 요청을 차단한다',
  async (action) => {
    const posting = await prisma.hiringPosting.create({
      data: { spaceId, title: '[QA] 경합', status: 'ACTIVE', publishedAt: new Date('2023-01-01') },
    })
    const req = new NextRequest('http://localhost/actions', {
      method: 'POST',
      body: JSON.stringify({ action }),
    })
    req.json = async () => {
      await prisma.hiringPosting.update({
        where: { id: posting.id },
        data: { status: 'DRAFT', publishedAt: null },
      })
      return { action }
    }
    const response = await POST(req, { params: Promise.resolve({ id: posting.id }) })
    expect(response?.status).toBe(409)
    expect(
      (await prisma.hiringPosting.findUniqueOrThrow({ where: { id: posting.id } })).status
    ).toBe('DRAFT')
  }
)
