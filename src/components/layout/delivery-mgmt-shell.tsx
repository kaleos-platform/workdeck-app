'use client'

import { usePathname } from 'next/navigation'
import { Header } from '@/components/layout/header'
import { Sidebar } from '@/components/layout/sidebar'

type Props = {
  workspaceName: string
  children: React.ReactNode
}

export function DeliveryMgmtShell({ workspaceName, children }: Props) {
  const pathname = usePathname()
  const fullWidth = pathname?.endsWith('/registration/upload') ?? false

  return (
    <div className="flex h-screen flex-col">
      <Header variant="delivery-mgmt" />
      <div className="flex flex-1 overflow-hidden">
        {!fullWidth && <Sidebar workspaceName={workspaceName} variant="delivery-mgmt" />}
        <main className="flex-1 overflow-y-auto">
          {fullWidth ? children : <div className="p-8">{children}</div>}
        </main>
      </div>
    </div>
  )
}
