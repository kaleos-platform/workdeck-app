import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { resolveDeckContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { PersonaForm } from '@/components/sc/settings/persona-form'
import { SALES_CONTENT_PERSONAS_PATH } from '@/lib/deck-routes'

export default async function EditPersonaPage({ params }: { params: Promise<{ id: string }> }) {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) redirect('/my-deck')

  const { id } = await params
  const persona = await prisma.persona.findFirst({
    where: { id, spaceId: resolved.space.id },
  })
  if (!persona) notFound()

  const initial = {
    name: persona.name,
    jobTitle: persona.jobTitle ?? '',
    industry: persona.industry ?? '',
    customFields: (persona.customFields as { key: string; value: string }[] | null) ?? [],
    isActive: persona.isActive,
  }

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
        <h1 className="mt-2 text-2xl font-bold tracking-tight">{persona.name}</h1>
      </div>
      <PersonaForm mode="edit" personaId={persona.id} initial={initial} />
    </div>
  )
}
