/** @jest-environment node */
import { randomUUID } from 'node:crypto'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import {
  DELETE,
  PATCH,
} from '../../../../app/api/hiring-posts/postings/[id]/contents/[contentId]/route'
import {
  POST as addContent,
  PUT,
} from '../../../../app/api/hiring-posts/postings/[id]/contents/route'
import { POST as applyTemplate } from '../../../../app/api/hiring-posts/postings/[id]/apply-template/route'

jest.mock('@/lib/api-helpers', () => ({
  resolveDeckContext: async () => ({ space: { id: process.env.REPRO_SPACE_ID } }),
  errorResponse: (message: string, status: number) => Response.json({ message }, { status }),
}))

const spaceId = `qa-race-${randomUUID()}`
let postingId = ''
let contentId = ''
let createdSpace = false

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
  process.env.REPRO_SPACE_ID = spaceId
  await prisma.space.create({ data: { id: spaceId, name: '[QA] 동시 편집 합성 검증' } })
  createdSpace = true
  const posting = await prisma.hiringPosting.create({
    data: { spaceId, title: '[QA] 합성 공고', status: 'DRAFT' },
  })
  postingId = posting.id
  const content = await prisma.hiringContent.create({
    data: {
      spaceId,
      postingId,
      sourceType: 'POSTING_DETAIL',
      contentType: 'text',
      data: { type: 'doc', content: [] },
    },
  })
  contentId = content.id
})

afterAll(async () => {
  if (!createdSpace) return
  if (spaceId.startsWith('qa-race-')) await prisma.space.deleteMany({ where: { id: spaceId } })
  const remaining = await prisma.space.count({ where: { id: spaceId } })
  expect(remaining).toBe(0)
  await prisma.$disconnect()
})

it('같은 초기 내용을 읽은 두 편집자 중 늦게 저장한 요청은 충돌로 거부한다', async () => {
  const initial = await prisma.hiringContent.findUniqueOrThrow({ where: { id: contentId } })
  const userA = { ...initial }
  const userB = { ...initial }
  expect(userA.updatedAt).toEqual(userB.updatedAt)
  const send = (text: string) =>
    PATCH(
      new NextRequest('http://localhost/content', {
        method: 'PATCH',
        body: JSON.stringify({
          expectedUpdatedAt: userA.updatedAt.toISOString(),
          data: {
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
          },
        }),
      }),
      { params: Promise.resolve({ id: postingId, contentId }) }
    )
  const first = await send('편집자 A의 내용')
  const second = await send('편집자 B의 내용')
  expect(first?.status).toBe(200)
  expect(second?.status).toBe(409)
  const result = await prisma.hiringContent.findUniqueOrThrow({ where: { id: contentId } })
  expect(JSON.stringify(result.data)).toContain('편집자 A의 내용')
  expect(JSON.stringify(result.data)).not.toContain('편집자 B의 내용')
})

it('버전 없는 이전 클라이언트는 기존 내용을 덮어쓰지 못한다', async () => {
  const before = await prisma.hiringContent.findUniqueOrThrow({ where: { id: contentId } })
  const response = await PATCH(
    new NextRequest('http://localhost/content', {
      method: 'PATCH',
      body: JSON.stringify({ data: { type: 'doc', content: [] } }),
    }),
    { params: Promise.resolve({ id: postingId, contentId }) }
  )
  expect(response?.status).toBe(428)
  const after = await prisma.hiringContent.findUniqueOrThrow({ where: { id: contentId } })
  expect(after.data).toEqual(before.data)
})

it('같은 버전의 요청이 동시에 도착하면 한 요청만 저장된다', async () => {
  const before = await prisma.hiringContent.findUniqueOrThrow({ where: { id: contentId } })
  const send = (title: string) =>
    PATCH(
      new NextRequest('http://localhost/content', {
        method: 'PATCH',
        body: JSON.stringify({ expectedUpdatedAt: before.updatedAt.toISOString(), title }),
      }),
      { params: Promise.resolve({ id: postingId, contentId }) }
    )
  const responses = await Promise.all([send('동시 요청 A'), send('동시 요청 B')])
  expect(responses.map((response) => response?.status).sort()).toEqual([200, 409])
  const after = await prisma.hiringContent.findUniqueOrThrow({ where: { id: contentId } })
  expect(['동시 요청 A', '동시 요청 B']).toContain(after.title)
})

it('다른 창에서 바뀐 카드는 이전 버전으로 삭제할 수 없다', async () => {
  const before = await prisma.hiringContent.findUniqueOrThrow({ where: { id: contentId } })
  await prisma.hiringContent.update({
    where: { id: contentId },
    data: { title: '다른 창의 변경', updatedAt: new Date(before.updatedAt.getTime() + 1) },
  })
  const response = await DELETE(
    new NextRequest('http://localhost/content', {
      method: 'DELETE',
      headers: { 'x-content-version': before.updatedAt.toISOString() },
    }),
    { params: Promise.resolve({ id: postingId, contentId }) }
  )
  expect(response?.status).toBe(409)
  expect((await prisma.hiringContent.findUniqueOrThrow({ where: { id: contentId } })).title).toBe(
    '다른 창의 변경'
  )
})

it('자신이 바꾼 카드 순서의 이전·이후 버전을 반환한다', async () => {
  const second = await prisma.hiringContent.create({
    data: {
      spaceId,
      postingId,
      sourceType: 'POSTING_DETAIL',
      contentType: 'text',
      data: { type: 'doc', content: [] },
      sortOrder: 1,
    },
  })
  const before = await prisma.hiringContent.findUniqueOrThrow({ where: { id: contentId } })
  const response = await PUT(
    new NextRequest('http://localhost/contents', {
      method: 'PUT',
      body: JSON.stringify({
        contentIds: [second.id, contentId],
        expectedContents: [
          { id: second.id, updatedAt: second.updatedAt.toISOString() },
          { id: contentId, updatedAt: before.updatedAt.toISOString() },
        ],
      }),
    }),
    { params: Promise.resolve({ id: postingId }) }
  )
  expect(response?.status).toBe(200)
  const result = await response!.json()
  const version = result.versions.find((item: { id: string }) => item.id === contentId)
  expect(version.previousUpdatedAt).toBe(before.updatedAt.toISOString())
  const after = await prisma.hiringContent.findUniqueOrThrow({ where: { id: contentId } })
  expect(version.updatedAt).toBe(after.updatedAt.toISOString())
})

it('오래된 카드 버전으로 순서를 다시 변경하면 거부한다', async () => {
  const before = await prisma.hiringContent.findMany({
    where: { postingId },
    orderBy: { sortOrder: 'asc' },
  })
  const ids = before.map((item) => item.id).reverse()
  const expectedContents = before.map((item) => ({
    id: item.id,
    updatedAt: item.updatedAt.toISOString(),
  }))
  const send = () =>
    PUT(
      new NextRequest('http://localhost/contents', {
        method: 'PUT',
        body: JSON.stringify({ contentIds: ids, expectedContents }),
      }),
      { params: Promise.resolve({ id: postingId }) }
    )
  expect((await send())?.status).toBe(200)
  expect((await send())?.status).toBe(409)
})

it('다른 창에서 변경된 카드가 있으면 템플릿 교체를 취소한다', async () => {
  const template = await prisma.hiringDetailTemplate.create({
    data: { spaceId, name: '[QA] 합성 템플릿' },
  })
  const before = await prisma.hiringContent.findMany({
    where: { postingId },
    select: { id: true, updatedAt: true },
  })
  await prisma.hiringContent.update({
    where: { id: contentId },
    data: {
      title: '보존할 변경',
      updatedAt: new Date(before.find((item) => item.id === contentId)!.updatedAt.getTime() + 1),
    },
  })
  const response = await applyTemplate(
    new NextRequest('http://localhost/template', {
      method: 'POST',
      body: JSON.stringify({
        templateId: template.id,
        mode: 'replace',
        expectedContents: before.map((item) => ({
          id: item.id,
          updatedAt: item.updatedAt.toISOString(),
        })),
      }),
    }),
    { params: Promise.resolve({ id: postingId }) }
  )
  expect(response?.status).toBe(409)
  expect((await prisma.hiringContent.findUniqueOrThrow({ where: { id: contentId } })).title).toBe(
    '보존할 변경'
  )
})

it('현재 카드 버전이 일치하면 템플릿으로 교체한다', async () => {
  const template = await prisma.hiringDetailTemplate.create({
    data: {
      spaceId,
      name: '[QA] 교체 템플릿',
      contents: {
        create: {
          spaceId,
          sourceType: 'DETAIL_TEMPLATE',
          contentType: 'text',
          title: '교체된 카드',
        },
      },
    },
  })
  const before = await prisma.hiringContent.findMany({
    where: { postingId },
    select: { id: true, updatedAt: true },
  })
  const response = await applyTemplate(
    new NextRequest('http://localhost/template', {
      method: 'POST',
      body: JSON.stringify({
        templateId: template.id,
        mode: 'replace',
        expectedContents: before.map((item) => ({
          id: item.id,
          updatedAt: item.updatedAt.toISOString(),
        })),
      }),
    }),
    { params: Promise.resolve({ id: postingId }) }
  )
  expect(response?.status).toBe(200)
  const after = await prisma.hiringContent.findMany({ where: { postingId } })
  expect(after.map((item) => item.title)).toEqual(['교체된 카드'])
})

it('빈 공고에 두 템플릿을 동시에 교체하면 한 템플릿만 적용된다', async () => {
  const posting = await prisma.hiringPosting.create({
    data: { spaceId, title: '[QA] 동시 교체', status: 'DRAFT' },
  })
  const template = await prisma.hiringDetailTemplate.create({
    data: {
      spaceId,
      name: '[QA] 동시 교체 템플릿',
      contents: {
        create: {
          spaceId,
          sourceType: 'DETAIL_TEMPLATE',
          contentType: 'text',
          title: '템플릿 카드',
        },
      },
    },
  })
  const send = () =>
    applyTemplate(
      new NextRequest('http://localhost/template', {
        method: 'POST',
        body: JSON.stringify({ templateId: template.id, mode: 'replace', expectedContents: [] }),
      }),
      { params: Promise.resolve({ id: posting.id }) }
    )
  const responses = await Promise.all([send(), send()])
  expect(responses.map((response) => response?.status).sort()).toEqual([200, 409])
  expect(await prisma.hiringContent.count({ where: { postingId: posting.id } })).toBe(1)
})

it('카드 추가와 템플릿 교체가 겹치면 추가한 카드를 보존한다', async () => {
  const posting = await prisma.hiringPosting.create({
    data: { spaceId, title: '[QA] 동시 추가', status: 'DRAFT' },
  })
  const template = await prisma.hiringDetailTemplate.create({
    data: {
      spaceId,
      name: '[QA] 동시 추가 템플릿',
      contents: {
        create: {
          spaceId,
          sourceType: 'DETAIL_TEMPLATE',
          contentType: 'text',
          title: '템플릿 카드',
        },
      },
    },
  })
  const [added, replaced] = await Promise.all([
    addContent(
      new NextRequest('http://localhost/contents', {
        method: 'POST',
        body: JSON.stringify({ contentType: 'text' }),
      }),
      { params: Promise.resolve({ id: posting.id }) }
    ),
    applyTemplate(
      new NextRequest('http://localhost/template', {
        method: 'POST',
        body: JSON.stringify({ templateId: template.id, mode: 'replace', expectedContents: [] }),
      }),
      { params: Promise.resolve({ id: posting.id }) }
    ),
  ])
  expect(added?.status).toBe(201)
  expect([200, 409]).toContain(replaced?.status)
  const addedId = (await added!.json()).content.id
  const contents = await prisma.hiringContent.findMany({ where: { postingId: posting.id } })
  expect(contents.some((item) => item.id === addedId)).toBe(true)
  expect(contents).toHaveLength(replaced?.status === 200 ? 2 : 1)
})
