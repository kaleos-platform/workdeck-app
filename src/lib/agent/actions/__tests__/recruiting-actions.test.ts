/** @jest-environment node */
const tx = {
  hiringPosting: { updateMany: jest.fn() },
  hiringPostingPosition: { create: jest.fn(), deleteMany: jest.fn(), findMany: jest.fn() },
}
jest.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
    hiringPosting: { findFirst: jest.fn() },
    hiringMigrationRecord: { findFirst: jest.fn() },
  },
}))
jest.mock('@/lib/mcp/context', () => ({ requireDeck: jest.fn() }))
jest.mock('@/lib/hiring/postings', () => ({
  createDraftPosting: jest.fn(async () => ({ id: 'new', uuid: 'u', title: 't', status: 'DRAFT' })),
}))

import { prisma } from '@/lib/prisma'
import { createDraftPosting } from '@/lib/hiring/postings'
import { getActionDefinition } from '../registry'
import type { ActionExecContext } from '../types'

const db = prisma as unknown as Record<string, Record<string, jest.Mock>>
const ctx: ActionExecContext = {
  spaceId: 'sp-1',
  actor: { type: 'agent', id: 'ag-1' },
  requesterUserId: null,
  workId: 'wk',
  deciderId: 'admin-1',
  decryptedCredentialIds: [],
}
const create = getActionDefinition('recruiting.posting.create_draft')!
const update = getActionDefinition('recruiting.posting.update_draft')!

beforeEach(() => {
  jest.clearAllMocks()
  db.hiringPosting.findFirst.mockResolvedValue({ status: 'DRAFT', publishedAt: null })
  db.hiringMigrationRecord.findFirst.mockResolvedValue(null)
  tx.hiringPosting.updateMany.mockResolvedValue({ count: 1 })
  tx.hiringPostingPosition.findMany.mockResolvedValue([])
})

it('승인 시 DRAFT 공고로 만들고 작성자는 승인한 구성원', async () => {
  const params = create.paramsSchema.parse({
    title: '홀 매니저',
    closingDate: null,
    positions: [{ name: '홀', workDays: [0, 6] }],
  })
  const r = await create.execute(ctx, params)
  expect(createDraftPosting).toHaveBeenCalledWith(tx, {
    spaceId: 'sp-1',
    authorUserId: 'admin-1',
    title: '홀 매니저',
    closingDate: null,
  })
  expect(tx.hiringPostingPosition.create).toHaveBeenCalledWith({
    data: { spaceId: 'sp-1', postingId: 'new', name: '홀', workDays: [0, 6] },
  })
  expect(r).toMatchObject({ postingId: 'new', status: 'DRAFT' })
})

it('직무 기준정보(positionId) 연결은 파라미터로 받지 않는다', () => {
  const parsed = create.paramsSchema.parse({
    title: 't',
    positions: [{ name: '홀', positionId: 'other-space-position' }],
  }) as { positions: Record<string, unknown>[] }
  expect(parsed.positions[0]).not.toHaveProperty('positionId')
})

it('지난 마감일은 제안 단계에서 거부', async () => {
  await expect(
    create.validateCreate!(
      ctx,
      create.paramsSchema.parse({ title: 't', closingDate: '2020-01-01' })
    )
  ).rejects.toThrow('오늘 이후')
})

it('발행된 적 있는 공고는 수정 제안 불가', async () => {
  db.hiringPosting.findFirst.mockResolvedValue({ status: 'DRAFT', publishedAt: new Date() })
  const params = update.paramsSchema.parse({ postingId: 'p1', title: '새 제목' })
  await expect(update.validateCreate!(ctx, params)).rejects.toThrow('발행된 적 있는')
  db.hiringPosting.findFirst.mockResolvedValue({ status: 'ACTIVE', publishedAt: null })
  await expect(update.validateCreate!(ctx, params)).rejects.toThrow('발행된 적 있는')
})

it('이관 중인 공고는 수정 제안 불가', async () => {
  db.hiringMigrationRecord.findFirst.mockResolvedValue({ id: 'm1' })
  await expect(
    update.validateCreate!(ctx, update.paramsSchema.parse({ postingId: 'p1', title: 'x' }))
  ).rejects.toThrow('이관')
})

it('다른 Space 공고는 찾을 수 없다', async () => {
  db.hiringPosting.findFirst.mockResolvedValue(null)
  await expect(
    update.validateCreate!(ctx, update.paramsSchema.parse({ postingId: 'p1', title: 'x' }))
  ).rejects.toThrow('찾을 수 없습니다')
  expect(db.hiringPosting.findFirst.mock.calls[0][0].where).toEqual({ id: 'p1', spaceId: 'sp-1' })
})

it('승인 사이에 발행됐으면 반영하지 않는다', async () => {
  tx.hiringPosting.updateMany.mockResolvedValue({ count: 0 })
  const params = update.paramsSchema.parse({ postingId: 'p1', positions: [{ name: '주방' }] })
  await expect(update.execute(ctx, params)).rejects.toThrow('이미 발행')
  expect(tx.hiringPostingPosition.deleteMany).not.toHaveBeenCalled()
})

it('직무 목록을 주면 DRAFT 를 유지한 채 통째로 교체', async () => {
  const params = update.paramsSchema.parse({ postingId: 'p1', positions: [{ name: '주방' }] })
  const r = await update.execute(ctx, params)
  expect(tx.hiringPosting.updateMany.mock.calls[0][0].where).toEqual({
    id: 'p1',
    spaceId: 'sp-1',
    status: 'DRAFT',
    publishedAt: null,
  })
  expect(tx.hiringPostingPosition.deleteMany).toHaveBeenCalledWith({
    where: { postingId: 'p1', spaceId: 'sp-1' },
  })
  expect(r).toMatchObject({ status: 'DRAFT' })
})

it('직무만 바꿔도 공고 행 UPDATE 로 잠근다(빈 data 금지)', async () => {
  await update.execute(ctx, update.paramsSchema.parse({ postingId: 'p1', positions: [] }))
  expect(tx.hiringPosting.updateMany.mock.calls[0][0].data).toEqual({ publishedAt: null })
})

it('직무 교체 시 같은 이름의 웹 기준정보 연결을 유지하고 순서대로 만든다', async () => {
  tx.hiringPostingPosition.findMany.mockResolvedValue([{ name: '홀', positionId: 'pos-hall' }])
  await update.execute(
    ctx,
    update.paramsSchema.parse({ postingId: 'p1', positions: [{ name: '주방' }, { name: '홀' }] })
  )
  const created = tx.hiringPostingPosition.create.mock.calls.map((c) => c[0].data)
  expect(created.map((d) => d.name)).toEqual(['주방', '홀'])
  expect(created[0]).not.toHaveProperty('positionId')
  expect(created[1].positionId).toBe('pos-hall')
})
