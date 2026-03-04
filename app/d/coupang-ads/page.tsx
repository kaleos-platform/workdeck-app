import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { UploadCloud } from 'lucide-react'
import { getUser } from '@/hooks/use-user'
import { prisma } from '@/lib/prisma'
import { DashboardClient } from '@/components/dashboard/dashboard-client'
import { COUPANG_ADS_UPLOAD_PATH } from '@/lib/deck-routes'

export default async function CoupangAdsHomePage() {
  const user = await getUser()
  if (!user) redirect('/login')

  const workspace = await prisma.workspace.findUnique({
    where: { ownerId: user.id },
    select: { id: true, name: true },
  })
  if (!workspace) redirect('/workspace-setup')

  const hasData = (await prisma.adRecord.count({ where: { workspaceId: workspace.id } })) > 0

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold tracking-tight">쿠팡 광고 관리자</h1>
          <p className="text-sm text-muted-foreground">
            {workspace.name} 계정의 광고 성과를 분석합니다.
          </p>
        </div>
        <Link href={COUPANG_ADS_UPLOAD_PATH}>
          <Button className="gap-2">
            <UploadCloud className="h-4 w-4" />
            리포트 업로드
          </Button>
        </Link>
      </div>

      <DashboardClient hasData={hasData} />
    </div>
  )
}
