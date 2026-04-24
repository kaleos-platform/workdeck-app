import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { resolveDeckContext } from '@/lib/api-helpers'
import { PersonaForm } from '@/components/sc/settings/persona-form'
import { SALES_CONTENT_PERSONAS_PATH } from '@/lib/deck-routes'

export default async function NewPersonaPage() {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) redirect('/my-deck')

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link
          href={SALES_CONTENT_PERSONAS_PATH}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          페르소나 목록으로
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">페르소나 추가</h1>
      </div>
      <PersonaForm mode="create" />
    </div>
  )
}
