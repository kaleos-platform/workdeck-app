import { redirect } from 'next/navigation'
import { getUser } from '@/hooks/use-user'
import { resolveDeckContext } from '@/lib/api-helpers'
import { Header } from '@/components/layout/header'
import { Sidebar } from '@/components/layout/sidebar'

export default async function DeliveryMgmtLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await getUser()

  if (!user) {
    redirect('/login')
  }

  const resolved = await resolveDeckContext('delivery-mgmt')
  if ('error' in resolved) {
    redirect('/my-deck')
  }

  const { space } = resolved

  return (
    <div className="flex h-screen flex-col">
      <Header variant="delivery-mgmt" />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar workspaceName={space.name} variant="delivery-mgmt" />
        <main className="flex-1 overflow-y-auto">
          <div className="p-8">{children}</div>
        </main>
      </div>
    </div>
  )
}
