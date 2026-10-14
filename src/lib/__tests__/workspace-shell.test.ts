/** @jest-environment node */
jest.mock('@/lib/prisma', () => ({
  prisma: { workspace: { findUnique: jest.fn() }, spaceMember: { findFirst: jest.fn() } },
}))
import { prisma } from '@/lib/prisma'
import { loadShellContext } from '../workspace-shell'

const m = prisma as unknown as {
  workspace: { findUnique: jest.Mock }
  spaceMember: { findFirst: jest.Mock }
}
const membership = {
  spaceId: 'sp-1',
  role: 'ADMIN',
  space: { name: '조직 Space', deckInstances: [{ deckApp: { id: 'finance', name: '재무' } }] },
}

beforeEach(() => jest.clearAllMocks())

it('Workspace도 구성원도 없으면 null(→ /workspace-setup)', async () => {
  m.workspace.findUnique.mockResolvedValue(null)
  m.spaceMember.findFirst.mockResolvedValue(null)
  expect(await loadShellContext('u')).toBeNull()
})

it('구성원만 있으면 Space 이름으로 셸을 만든다', async () => {
  m.workspace.findUnique.mockResolvedValue(null)
  m.spaceMember.findFirst.mockResolvedValue(membership)
  expect(await loadShellContext('u')).toEqual({
    workspaceName: '조직 Space',
    isOwner: false,
    activeDecks: [{ id: 'finance', name: '재무' }],
  })
})

it('Workspace가 있으면 기존처럼 Workspace 이름', async () => {
  m.workspace.findUnique.mockResolvedValue({ id: 'w', name: '내 워크스페이스' })
  m.spaceMember.findFirst.mockResolvedValue({ ...membership, role: 'OWNER' })
  expect(await loadShellContext('u')).toMatchObject({
    workspaceName: '내 워크스페이스',
    isOwner: true,
  })
})
