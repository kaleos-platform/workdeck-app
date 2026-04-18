import { redirect } from 'next/navigation'
import { getUser } from '@/hooks/use-user'
import { resolveDeckContext } from '@/lib/api-helpers'
import { DeliveryMgmtShell } from '@/components/layout/delivery-mgmt-shell'

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

  return <DeliveryMgmtShell workspaceName={space.name}>{children}</DeliveryMgmtShell>
}
