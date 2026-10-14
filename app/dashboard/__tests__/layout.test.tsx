/** @jest-environment node */
jest.mock('@/hooks/use-user', () => ({ getUser: jest.fn() }))
jest.mock('@/lib/prisma', () => ({
  prisma: { workspace: { findUnique: jest.fn() }, spaceMember: { findFirst: jest.fn() } },
}))
jest.mock('@/components/layout/deck-shell', () => ({ DeckShell: () => null }))
jest.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`)
  },
}))
import { getUser } from '@/hooks/use-user'
import { prisma } from '@/lib/prisma'
import DashboardLayout from '../layout'

beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(getUser).mockResolvedValue({ id: 'u' } as never)
  jest.mocked(prisma.workspace.findUnique).mockResolvedValue(null)
})

it('Workspace 없이 Space 구성원이면 /my-deck', async () => {
  jest.mocked(prisma.spaceMember.findFirst).mockResolvedValue({ id: 'm' } as never)
  await expect(DashboardLayout({ children: null })).rejects.toThrow('redirect:/my-deck')
})

it('Workspace도 구성원도 없으면 /workspace-setup', async () => {
  jest.mocked(prisma.spaceMember.findFirst).mockResolvedValue(null)
  await expect(DashboardLayout({ children: null })).rejects.toThrow('redirect:/workspace-setup')
})
