/** @jest-environment node */
jest.mock('@/lib/prisma', () => ({
  prisma: { workspace: { findUnique: jest.fn() }, deckInstance: { findMany: jest.fn() } },
}))
jest.mock('@/lib/spaces/current-space', () => ({ resolveCurrentMembership: jest.fn() }))
import { prisma } from '@/lib/prisma'
import { resolveCurrentMembership } from '@/lib/spaces/current-space'
import { loadShellContext } from '../workspace-shell'

const m = prisma as unknown as {
  workspace: { findUnique: jest.Mock }
  deckInstance: { findMany: jest.Mock }
}
const resolve = resolveCurrentMembership as jest.Mock

beforeEach(() => jest.clearAllMocks())

it('Workspace도 멤버십도 없으면 null(→ /workspace-setup)', async () => {
  m.workspace.findUnique.mockResolvedValue(null)
  resolve.mockResolvedValue(null)
  expect(await loadShellContext('u')).toBeNull()
})

it('현재 Space 이름·역할·deck 으로 셸을 만든다', async () => {
  m.workspace.findUnique.mockResolvedValue({ id: 'w', name: '내 워크스페이스' })
  resolve.mockResolvedValue({ role: 'ADMIN', space: { id: 'sp-b', name: 'Space B' } })
  m.deckInstance.findMany.mockResolvedValue([{ deckApp: { id: 'finance', name: '재무' } }])
  expect(await loadShellContext('u')).toEqual({
    workspaceName: 'Space B',
    isOwner: false,
    role: 'ADMIN',
    spaceId: 'sp-b',
    activeDecks: [{ id: 'finance', name: '재무' }],
  })
  expect(m.deckInstance.findMany.mock.calls[0][0].where).toEqual({
    spaceId: 'sp-b',
    isActive: true,
  })
})

it('멤버십 없이 Workspace만 있는 레거시 계정은 OWNER', async () => {
  m.workspace.findUnique.mockResolvedValue({ id: 'w', name: '내 워크스페이스' })
  resolve.mockResolvedValue(null)
  expect(await loadShellContext('u')).toEqual({
    workspaceName: '내 워크스페이스',
    isOwner: false,
    role: 'OWNER',
    spaceId: null,
    activeDecks: [],
  })
})
