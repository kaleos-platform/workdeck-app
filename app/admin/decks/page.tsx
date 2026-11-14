import { notFound, redirect } from 'next/navigation'
import { requireOperator } from '@/lib/admin/auth'
import { mfaStepUpPath } from '@/lib/auth/mfa-policy'
import { DeckManagement } from '@/components/admin/deck-management'

export default async function AdminDecksPage() {
  const auth = await requireOperator()
  if (!auth.ok && auth.reason === 'MFA_REQUIRED') redirect(mfaStepUpPath('/admin/decks'))
  if (!auth.ok) notFound()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">업무 관리</h1>
        <p className="mt-1 text-sm text-muted-foreground">덱별 운영 기능을 한곳에서 관리합니다.</p>
      </div>
      <DeckManagement />
    </div>
  )
}
