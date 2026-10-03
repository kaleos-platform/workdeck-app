/** @jest-environment node */
import { randomUUID } from 'node:crypto'
import {
  importOpeningPosting,
  planOpeningPosting,
  type OpeningPostingPacket,
} from '../posting-import'
import { importMigrationRecord } from '../ledger'
import type { PrismaClient } from '@/generated/prisma/client'
jest.mock('../ledger', () => ({ importMigrationRecord: jest.fn() }))
const now = '2026-10-03T00:00:00Z'
function packet(): OpeningPostingPacket {
  return {
    sourceSpaceId: '1',
    sourcePostingId: '9007199254740993',
    sourceMemberId: '2',
    sourceSnapshotAt: now,
    posting: {
      uuid: randomUUID(),
      title: '합성 공고',
      status: 1,
      createdAt: now,
      updatedAt: now,
      closingDate: null,
      publishedAt: now,
      managerName: '합성 담당자',
      managerPhone: '01000000000',
      applicationEntries: [
        { key: 'name', type: 'string', label: '이름', required: true },
        { key: 'phone', type: 'phone', label: '연락처', required: true },
      ],
    },
    positions: [
      {
        sourceId: '9007199254740994',
        fields: { name: '합성 직무' },
        createdAt: now,
        updatedAt: now,
      },
    ],
    storeIds: ['store'],
    rawSnapshot: { synthetic: true },
    content: {
      detail: [
        { type: 'posting_title', enabled: true },
        { type: 'posting_positions', enabled: true },
      ],
      postingTitle: '공개 합성 제목',
      positionsVerified: true,
      originalApplyUrl: 'https://opening.work/qa',
      resources: {},
      images: {},
    },
  }
}
const target = {
  sourceSpaceId: '1',
  spaceId: 'space',
  author: { sourceMemberId: '2', userId: 'user' },
}
const tx = {
  space: { findUnique: jest.fn() },
  spaceMember: { findUnique: jest.fn() },
  hiringStore: { count: jest.fn() },
  hiringPosition: { count: jest.fn() },
  hiringPosting: { create: jest.fn() },
  hiringMigrationRecord: { update: jest.fn() },
}
const transaction = jest.fn(async (fn) => fn(tx))
const db = { $transaction: transaction } as unknown as Pick<PrismaClient, '$transaction'>
beforeEach(() => {
  jest.resetAllMocks()
  process.env.ENCRYPTION_KEY = 'ab'.repeat(32)
  transaction.mockImplementation(async (fn) => fn(tx))
  tx.space.findUnique.mockResolvedValue({ id: 'space' })
  tx.spaceMember.findUnique.mockResolvedValue({ id: 'member' })
  tx.hiringStore.count.mockResolvedValue(1)
  tx.hiringPosting.create.mockImplementation(async ({ data }) => ({ id: 'post', ...data }))
  tx.hiringMigrationRecord.update.mockResolvedValue({ id: 'record' })
  ;(importMigrationRecord as jest.Mock).mockImplementation(async (t, _input, adapter) => ({
    status: 'created',
    target: await adapter.create(t),
    record: { id: 'record' },
  }))
})
it('공고와 관계를 DRAFT·알림 false로 한 트랜잭션에 적재한다', async () => {
  const result = await importOpeningPosting(db, packet(), target)
  expect(result.status).toBe('created')
  expect(transaction).toHaveBeenCalledTimes(1)
  const data = tx.hiringPosting.create.mock.calls[0][0].data
  expect(data).toMatchObject({
    status: 'DRAFT',
    notificationEnabled: false,
    authorUserId: 'user',
    spaceId: 'space',
  })
  expect(data.managerNameEnc).not.toContain('합성 담당자')
  expect(data.positions.create).toHaveLength(1)
  expect(data.contents.create).toHaveLength(2)
  expect(
    tx.hiringMigrationRecord.update.mock.calls[0][0].data.metadata.positionMap[0].sourceId
  ).toBe('9007199254740994')
})
it.each(['source', 'author', 'deleted', 'form', 'asset'])(
  '%s 계획 오류에서는 DB를 쓰지 않는다',
  async (kind) => {
    const input = packet()
    if (kind === 'source') input.sourceSpaceId = '9'
    if (kind === 'author') input.sourceMemberId = '8'
    if (kind === 'deleted') input.posting.status = 0
    if (kind === 'form')
      input.posting.applicationEntries = [{ key: 'bad', label: '오류', type: 'unknown' }]
    if (kind === 'asset') {
      input.content.detail = [{ type: 'image', enabled: true }]
      input.content.images = { 'index:0': { copiedImagePath: 'foreign/image.png', verified: true } }
    }
    await expect(importOpeningPosting(db, input, target)).rejects.toThrow()
    expect(transaction).not.toHaveBeenCalled()
  }
)
it.each(['author', 'store', 'position'])(
  '%s가 다른 Space이면 대상 생성 전에 차단한다',
  async (kind) => {
    const input = packet()
    if (kind === 'author') tx.spaceMember.findUnique.mockResolvedValue(null)
    if (kind === 'store') tx.hiringStore.count.mockResolvedValue(0)
    if (kind === 'position') {
      input.positions[0].fields.positionId = 'position-other'
      tx.hiringPosition.count.mockResolvedValue(0)
    }
    await expect(importOpeningPosting(db, input, target)).rejects.toThrow('outside space')
    expect(tx.hiringPosting.create).not.toHaveBeenCalled()
  }
)
it('검증 계획은 원본 상태를 유지하고 쓰기를 수행하지 않는다', () => {
  const plan = planOpeningPosting(packet(), target)
  expect(plan.packet.posting.status).toBe(1)
  expect(plan.content.blocks).toHaveLength(2)
  expect(transaction).not.toHaveBeenCalled()
})

it('편집기에서 선택할 수 없는 비활성 매장 연결을 허용하지 않는다', async () => {
  tx.hiringStore.count.mockResolvedValue(0)
  await expect(importOpeningPosting(db, packet(), target)).rejects.toThrow('inactive')
  expect(tx.hiringStore.count).toHaveBeenCalledWith({
    where: { id: { in: ['store'] }, spaceId: 'space', isActive: true },
  })
})

it('현재 편집기의 저장 용량을 초과하는 디자인은 적재 전에 보류한다', () => {
  const input = packet()
  input.content.detail = [{ type: 'content', enabled: true, resource_id: '1' }]
  input.content.resources = {
    '1': {
      hasSceneSource: true,
      scene: { elements: [], files: {} },
      copiedImagePath: 'space/image.png',
      verified: true,
      sizeBytes: 4 * 1024 * 1024,
    },
  }
  expect(() => planOpeningPosting(input, target)).toThrow('editable size')
})

it('원본 hashId 기반의 짧은 공개 URL 키를 보존한다', () => {
  const input = packet()
  input.posting.uuid = 'Qa7'
  expect(planOpeningPosting(input, target).packet.posting.uuid).toBe('Qa7')
})

it.each(['../posting', 'key/other', ' key', '', 'x'.repeat(37)])(
  '공개 URL 키 %s가 안전한 원본 범위를 벗어나면 차단한다',
  (uuid) => {
    const input = packet()
    input.posting.uuid = uuid
    expect(() => planOpeningPosting(input, target)).toThrow()
  }
)

it('명시한 과거 매장은 비활성 상태를 바꾸지 않고 같은 계정의 연결을 보존한다', async () => {
  const input = { ...packet(), historicalStoreIds: ['store'] }
  tx.hiringStore.count.mockImplementation(async ({ where }) =>
    where.spaceId === 'space' &&
    where.OR?.some((clause: { id?: { in: string[] } }) => clause.id?.in.includes('store'))
      ? 1
      : 0
  )
  const result = await importOpeningPosting(db, input, target)
  expect(result.status).toBe('created')
  expect(tx.hiringPosting.create.mock.calls[0][0].data.stores.create).toEqual([
    { storeId: 'store' },
  ])
  expect(tx.hiringStore.count).toHaveBeenCalledWith({
    where: {
      id: { in: ['store'] },
      spaceId: 'space',
      OR: [{ isActive: true }, { id: { in: ['store'] } }],
    },
  })
})

it('과거 매장 지정도 다른 계정의 연결은 거부한다', async () => {
  tx.hiringStore.count.mockResolvedValue(0)
  await expect(
    importOpeningPosting(db, { ...packet(), historicalStoreIds: ['store'] }, target)
  ).rejects.toThrow('outside space')
  expect(tx.hiringPosting.create).not.toHaveBeenCalled()
})

it('실제 연결 목록 밖의 과거 매장 지정은 계획 단계에서 거부한다', () => {
  expect(() => planOpeningPosting({ ...packet(), historicalStoreIds: ['other'] }, target)).toThrow(
    'historical store'
  )
})

it('명시한 반복 custom 폼 질문을 누락 없이 공고에 저장한다', () => {
  const input = packet()
  const field = {
    key: 'custom',
    type: 'multiselect',
    label: '선택',
    items: [{ label: 'A', value: 1 }],
  }
  input.posting.applicationEntries = [field, field]
  const result = planOpeningPosting({ ...input, preserveRepeatedCustomFields: true }, target)
  expect(result.form.fields).toHaveLength(2)
  expect(new Set(result.form.fields.map((field) => field.key)).size).toBe(2)
})
