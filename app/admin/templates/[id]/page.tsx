import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { prisma } from '@/lib/prisma'
import { requireOperator } from '@/lib/admin/auth'
import { mfaStepUpPath } from '@/lib/auth/mfa-policy'
import { TemplateBlockEditor } from '@/components/admin/template-block-editor'

type Params = { params: Promise<{ id: string }> }

export default async function AdminTemplateDetailPage({ params }: Params) {
  // layout 과 page 는 병렬로 렌더되므로 layout 의 가드가 이 페이지의 prisma 읽기를 막아주지 않는다 — 자체 가드.
  const auth = await requireOperator()
  const { id } = await params
  if (!auth.ok && auth.reason === 'MFA_REQUIRED') redirect(mfaStepUpPath(`/admin/templates/${id}`))
  if (!auth.ok) notFound()

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
