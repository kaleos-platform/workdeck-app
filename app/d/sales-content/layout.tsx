import { redirect } from 'next/navigation'
import { getUser } from '@/hooks/use-user'
import { resolveDeckContext } from '@/lib/api-helpers'
import { Header } from '@/components/layout/header'
import { Sidebar } from '@/components/layout/sidebar'
import './sales-content.css'

export default async function SalesContentLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser()
  if (!user) redirect('/login')

  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) redirect('/my-deck')

  return (
    <div className="flex h-screen flex-col" data-deck="sales-content">
      <Header variant="sales-content" />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar workspaceName={resolved.space.name} variant="sales-content" />
        <main className="flex-1 overflow-y-auto">
          <div className="p-8">{children}</div>
        </main>
      </div>
    </div>
  )
}
