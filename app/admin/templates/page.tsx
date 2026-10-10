import { notFound, redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { requireOperator } from '@/lib/admin/auth'
import { mfaStepUpPath } from '@/lib/auth/mfa-policy'
import { TemplatesList } from '@/components/admin/templates-list'

export default async function AdminTemplatesPage() {
  // layout 과 page 는 병렬로 렌더되므로 layout 의 가드가 이 페이지의 prisma 읽기를 막아주지 않는다 — 자체 가드.
  const auth = await requireOperator()
  if (!auth.ok && auth.reason === 'MFA_REQUIRED') redirect(mfaStepUpPath('/admin/templates'))
  if (!auth.ok) notFound()

  const templates = await prisma.hiringDetailTemplate.findMany({
    where: { spaceId: null, isSample: true },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      name: true,
      imagePath: true,
      updatedAt: true,
      _count: { select: { contents: true } },
    },
  })

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold">모집 샘플 템플릿</h1>
        <p className="text-sm text-muted-foreground">
          전 워크스페이스에 공유되는 글로벌 샘플 템플릿을 관리합니다.
        </p>
      </div>
      <TemplatesList
        initialTemplates={templates.map((t) => ({
          id: t.id,
          name: t.name,
          imagePath: t.imagePath,
          updatedAt: t.updatedAt.toISOString(),
          blockCount: t._count.contents,
        }))}
      />
    </div>
  )
}
