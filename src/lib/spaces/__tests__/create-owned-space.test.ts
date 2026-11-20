/** @jest-environment node */
jest.mock('@/lib/spaces/owner-space-lock', () => ({ lockOwnerSpaces: jest.fn() }))

import { createOwnedSpaceInTx, MAX_OWNED_SPACES } from '../create-owned-space'
import { lockOwnerSpaces } from '../owner-space-lock'

const tx = {
  spaceMember: { findMany: jest.fn(), count: jest.fn() },
  space: { create: jest.fn() },
  openingMigrationJob: { findMany: jest.fn(), updateMany: jest.fn(), findUnique: jest.fn() },
}
const run = (maxOwned?: number) =>
  createOwnedSpaceInTx(tx as never, { userId: 'u-1', name: '대성산업', maxOwned })
const owned = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ space: { id: `sp-${i}`, name: `공간${i}` } }))

beforeEach(() => {
  jest.resetAllMocks()
  tx.spaceMember.findMany.mockResolvedValue([])
  tx.spaceMember.count.mockResolvedValue(1)
  tx.space.create.mockResolvedValue({ id: 'sp-new', name: '대성산업' })
  tx.openingMigrationJob.findMany.mockResolvedValue([])
  tx.openingMigrationJob.updateMany.mockResolvedValue({ count: 1 })
})

it('상한 상수는 5', () => expect(MAX_OWNED_SPACES).toBe(5))

it('lock 후 OWNER 멤버십과 함께 만든다', async () => {
  expect(await run()).toEqual({ space: { id: 'sp-new', name: '대성산업' }, blockedJobs: 0 })
  expect(lockOwnerSpaces).toHaveBeenCalledWith(tx, 'u-1')
  expect(tx.space.create).toHaveBeenCalledWith({
    data: {
      name: '대성산업',
      type: 'PERSONAL',
      members: { create: { userId: 'u-1', role: 'OWNER' } },
    },
    select: { id: true, name: true },
  })
})

it('같은 이름(NFC)이 있으면 duplicateSpaceId, 만들지 않는다', async () => {
  tx.spaceMember.findMany.mockResolvedValue([{ space: { id: 'sp-old', name: ' 대성산업 ' } }])
  expect(await run(5)).toEqual({ duplicateSpaceId: 'sp-old' })
  expect(tx.space.create).not.toHaveBeenCalled()
})

it('maxOwned 에 도달하면 limitReached, 없으면 상한 없음', async () => {
  tx.spaceMember.findMany.mockResolvedValue(owned(5))
  expect(await run(5)).toEqual({ limitReached: true })
  expect(tx.space.create).not.toHaveBeenCalled()
  expect(await run()).toMatchObject({ space: { id: 'sp-new' } })
})

it('4개 소유면 5번째는 허용', async () => {
  tx.spaceMember.findMany.mockResolvedValue(owned(4))
  tx.spaceMember.count.mockResolvedValue(5)
  expect(await run(5)).toMatchObject({ space: { id: 'sp-new' } })
})

it('OWNER Space 가 2개 이상이면 진행 중 job 을 MULTIPLE_OWNER_SPACES 로 BLOCKED 한다', async () => {
  tx.spaceMember.count.mockResolvedValue(2)
  tx.openingMigrationJob.findMany.mockResolvedValue([
    { id: 'j1', status: 'APPROVED', blockReasons: [] },
    { id: 'j2', status: 'BLOCKED', blockReasons: ['NO_TARGET_SPACE'] },
  ])
  expect(await run()).toMatchObject({ blockedJobs: 2 })
  expect(tx.openingMigrationJob.updateMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { id: 'j1', status: 'APPROVED', blockReasons: { equals: [] } },
      data: expect.objectContaining({ status: 'BLOCKED', blockReasons: ['MULTIPLE_OWNER_SPACES'] }),
    })
  )
})

it('0건 update 는 다시 읽어 최대 3번 재시도한다', async () => {
  tx.spaceMember.count.mockResolvedValue(2)
  tx.openingMigrationJob.findMany.mockResolvedValue([
    { id: 'j1', status: 'MATCHED', blockReasons: [] },
  ])
  tx.openingMigrationJob.updateMany.mockResolvedValue({ count: 0 })
  tx.openingMigrationJob.findUnique.mockResolvedValue({
    id: 'j1',
    status: 'PLANNED',
    blockReasons: [],
  })
  expect(await run()).toMatchObject({ blockedJobs: 0 })
  expect(tx.openingMigrationJob.updateMany).toHaveBeenCalledTimes(3)
})

it('OWNER Space 가 1개뿐이면 job 을 건드리지 않는다', async () => {
  await run()
  expect(tx.openingMigrationJob.findMany).not.toHaveBeenCalled()
})
