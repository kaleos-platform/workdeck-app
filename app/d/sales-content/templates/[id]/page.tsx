import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { resolveDeckContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { TemplatePreview } from '@/components/sc/templates/template-preview'
import { TemplateForm } from '@/components/sc/templates/template-form'
import { CloneSystemTemplateButton } from '@/components/sc/templates/clone-system-template-button'
import { SALES_CONTENT_TEMPLATES_PATH } from '@/lib/deck-routes'

type Props = { params: Promise<{ id: string }> }

export default async function TemplateDetailPage({ params }: Props) {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) redirect('/my-deck')

  const { id } = await params
  const template = await prisma.template.findFirst({
    where: {
      id,
      OR: [{ spaceId: null, isSystem: true }, { spaceId: resolved.space.id }],
    },
  })
  if (!template) notFound()

  const isSystem = template.spaceId === null && template.isSystem

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            {isSystem && <Badge variant="outline">시스템</Badge>}
            <Badge variant="outline" className="text-xs">
              {template.kind}
            </Badge>
          </div>
          <h1 className="mt-2 text-xl font-bold tracking-tight">{template.name}</h1>
          <p className="mt-1 font-mono text-xs text-muted-foreground">/{template.slug}</p>
        </div>
        <Button asChild variant="ghost">
          <Link href={SALES_CONTENT_TEMPLATES_PATH}>← 목록</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">섹션 구성</CardTitle>
        </CardHeader>
        <CardContent>
          <TemplatePreview kind={template.kind} sections={template.sections} />
        </CardContent>
      </Card>

      {isSystem ? (
        <CloneSystemTemplateButton templateId={template.id} />
      ) : (
        <TemplateForm
          mode="edit"
          templateId={template.id}
          initial={{
            name: template.name,
            slug: template.slug,
            kind: template.kind,
            sections: template.sections,
            isActive: template.isActive,
          }}
        />
      )}
    </div>
  )
}
