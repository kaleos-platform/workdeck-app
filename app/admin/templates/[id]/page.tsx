import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { prisma } from '@/lib/prisma'
import { TemplateBlockEditor } from '@/components/admin/template-block-editor'

type Params = { params: Promise<{ id: string }> }

export default async function AdminTemplateDetailPage({ params }: Params) {
  const { id } = await params

  const template = await prisma.hiringDetailTemplate.findFirst({
    where: { id, spaceId: null, isSample: true },
    select: {
      id: true,
      name: true,
      contents: {
        where: { sourceType: 'DETAIL_TEMPLATE' },
        orderBy: { sortOrder: 'asc' },
        select: {
          id: true,
          contentType: true,
          title: true,
          data: true,
          imagePath: true,
          sortOrder: true,
        },
      },
    },
  })
  if (!template) notFound()

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/admin/templates"
          className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" /> 템플릿 목록
        </Link>
        <h1 className="text-lg font-semibold">{template.name}</h1>
      </div>
      <TemplateBlockEditor
        templateId={template.id}
        contents={template.contents.map((c) => ({
          ...c,
          contentType: c.contentType as 'image' | 'text' | 'button' | 'positions' | 'design',
        }))}
      />
    </div>
  )
}
