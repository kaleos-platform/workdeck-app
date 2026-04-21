import { redirect } from 'next/navigation'
import { getUser } from '@/hooks/use-user'
import { resolveDeckContext } from '@/lib/api-helpers'
import { Header } from '@/components/layout/header'
import { Sidebar } from '@/components/layout/sidebar'

export default async function SellerHubLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser()
  if (!user) redirect('/login')

  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) redirect('/my-deck')

  return (
    <div className="flex h-screen flex-col">
      <Header variant="seller-hub" />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar workspaceName={resolved.space.name} variant="seller-hub" />
        <main className="flex-1 overflow-y-auto">
          <div className="p-8">{children}</div>
        </main>
      </div>
    </div>
  )
}
