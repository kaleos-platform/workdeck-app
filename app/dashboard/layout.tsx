import { redirect } from 'next/navigation'
import { getUser } from '@/hooks/use-user'
import { prisma } from '@/lib/prisma'
import { hasSpaceAccess } from '@/lib/workspace-shell'
import { DeckShell } from '@/components/layout/deck-shell'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser()

  if (!user) {
    redirect('/login')
  }

  const workspace = await prisma.workspace.findUnique({
    where: { ownerId: user.id },
    select: { id: true, name: true },
  })

  if (!workspace) {
    redirect((await hasSpaceAccess(user.id)) ? '/my-deck' : '/workspace-setup')
  }

  return (
    <DeckShell workspaceName={workspace.name} variant="coupang-ads">
      {children}
    </DeckShell>
  )
}
