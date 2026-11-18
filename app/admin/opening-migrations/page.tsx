import { notFound, redirect } from 'next/navigation'
import { mfaStepUpPath } from '@/lib/auth/mfa-policy'
import { requireOperator } from '@/lib/admin/auth'
import { listOpeningMigrationJobs } from '@/lib/admin/opening-migrations'
import { OpeningMigrationsQueue } from '@/components/admin/opening-migrations-queue'
import type { OpeningMigrationJobRow } from '@/components/admin/opening-migrations-queue'

export const dynamic = 'force-dynamic'

export default async function AdminOpeningMigrationsPage() {
  // layout 가드와 별개로 연락처 조각을 복호화하는 페이지라 한 번 더 확정 검증한다
  const auth = await requireOperator()
  if (!auth.ok && auth.reason === 'MFA_REQUIRED')
    redirect(mfaStepUpPath('/admin/opening-migrations'))
  if (!auth.ok) notFound()

  const jobs: OpeningMigrationJobRow[] = (await listOpeningMigrationJobs()).map((job) => ({
    id: job.id,
    openingBrandId: job.openingBrandId,
    userEmail: job.userEmail,
    targetSpaceName: job.targetSpaceName,
    status: job.status,
    summary: job.summary,
    hasSnapshot: job.hasSnapshot,
    blockReasons: job.blockReasons,
    contactHits: job.contactHits,
    error: job.error,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
  }))

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold">오프닝 이전</h1>
        <p className="text-sm text-muted-foreground">
          오프닝 관리자 이메일과 일치한 가입자의 이전 계획
        </p>
      </div>
      <OpeningMigrationsQueue jobs={jobs} />
    </div>
  )
}
