import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { UploadCloud } from 'lucide-react'
import { getUser } from '@/hooks/use-user'
import { prisma } from '@/lib/prisma'
import { DashboardClient } from '@/components/dashboard/dashboard-client'

export default async function DashboardPage() {
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
      {/* 페이지 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{workspace.name}</h1>
        </div>
        <Link href="/dashboard/upload">
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
