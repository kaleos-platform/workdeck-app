import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { getUser } from '@/hooks/use-user'
import { MfaStepUp } from '@/components/auth/mfa-step-up'

export default async function MfaPage() {
  const user = await getUser()
  if (!user) redirect('/login?redirectTo=/auth/mfa')
  return (
    <Suspense>
      <MfaStepUp />
    </Suspense>
  )
}
