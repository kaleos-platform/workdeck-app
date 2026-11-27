import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireOperator } from '@/lib/admin/auth'
import { prisma } from '@/lib/prisma'
import { FeedbackDetail } from '@/components/admin/feedback-detail'
import { attachmentDeleteAt } from '@/lib/feedback/policy'

export default async function AdminFeedbackDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const auth = await requireOperator()
  if (!auth.ok) notFound()

  const { id } = await params
  const f = await prisma.userFeedback.findUnique({
    where: { id },
    include: { user: { select: { email: true } }, space: { select: { name: true } } },
  })
  if (!f) notFound()

  return (
    <div className="flex flex-col gap-4">
      <Link href="/admin/feedback" className="text-sm text-muted-foreground hover:text-foreground">
        ← 의견 목록
      </Link>
      <FeedbackDetail
        feedback={{
          id: f.id,
          type: f.type,
          status: f.status,
          body: f.body,
          pagePath: f.pagePath,
          userAgent: f.userAgent,
          email: f.user.email,
          spaceName: f.space?.name ?? null,
          memo: f.memo ?? '',
          createdAt: f.createdAt.toISOString(),
          deleteAt: attachmentDeleteAt(f.status, f.closedAt)?.toISOString() ?? null,
        }}
      />
    </div>
  )
}
