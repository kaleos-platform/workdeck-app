import { redirect } from 'next/navigation'
import { getUser } from '@/hooks/use-user'
import { prisma } from '@/lib/prisma'
import { ReportUploadForm } from '@/components/dashboard/report-upload-form'
import { UploadHistoryCard } from '@/components/dashboard/upload-history-card'

export default async function CoupangAdsUploadPage() {
  const user = await getUser()
  if (!user) redirect('/login')

  const workspace = await prisma.workspace.findUnique({
    where: { ownerId: user.id },
    select: { id: true },
  })
  if (!workspace) redirect('/workspace-setup')

  const uploadRows = await prisma.reportUpload.findMany({
    where: { workspaceId: workspace.id },
    orderBy: { uploadedAt: 'desc' },
    take: 10,
    select: {
      id: true,
      fileName: true,
      uploadedAt: true,
      periodStart: true,
      periodEnd: true,
      totalRows: true,
      insertedRows: true,
      duplicateRows: true,
    },
  })

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">리포트 업로드</h1>
        <p className="mt-1 text-gray-600 dark:text-gray-400">
          쿠팡 광고 리포트 Excel 파일을 업로드하세요
        </p>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <UploadHistoryCard rows={uploadRows} />
        <ReportUploadForm />
      </div>
    </div>
  )
}
