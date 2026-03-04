import { redirect } from 'next/navigation'
import { getUser } from '@/hooks/use-user'
import { prisma } from '@/lib/prisma'
import { Header } from '@/components/layout/header'
import { Sidebar } from '@/components/layout/sidebar'

export default async function CoupangAdsLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser()

  if (!user) {
    redirect('/login')
  }

  const workspace = await prisma.workspace.findUnique({
    where: { ownerId: user.id },
    select: { id: true, name: true },
  })

  if (!workspace) {
    redirect('/workspace-setup')
  }

  return (
    <div className="flex h-screen flex-col">
      <Header variant="coupang-ads" />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar workspaceName={workspace.name} variant="coupang-ads" />
        <main className="flex-1 overflow-y-auto">
          <div className="p-8">{children}</div>
        </main>
      </div>
    </div>
  )
}
