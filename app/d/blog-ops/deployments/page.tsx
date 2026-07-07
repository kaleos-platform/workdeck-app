import { redirect } from 'next/navigation'
import { getUser } from '@/hooks/use-user'
import { resolveDeckContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { DeploymentsTable } from '@/components/bo/deployments/deployments-table'

export default async function BlogOpsDeploymentsPage() {
  const user = await getUser()
  if (!user) redirect('/login')

  const resolved = await resolveDeckContext('blog-ops')
  if ('error' in resolved) redirect('/my-deck')

  const deployments = await prisma.boDeployment.findMany({
    where: { spaceId: resolved.space.id },
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: {
      id: true,
      status: true,
      platformUrl: true,
      createdAt: true,
      post: { select: { id: true, title: true } },
      channel: { select: { id: true, name: true, platform: true } },
      variant: { select: { id: true, status: true } },
    },
  })

  const serialized = deployments.map((d) => ({
    id: d.id,
    status: d.status as string,
    platformUrl: d.platformUrl,
    createdAt: d.createdAt.toISOString(),
    post: d.post,
    channel: { ...d.channel, platform: d.channel.platform as string },
    variant: { ...d.variant, status: d.variant.status as string },
  }))

  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-lg font-semibold">배포 이력</h1>
        <p className="text-sm text-muted-foreground">채널별 포스트 내보내기 및 게시 이력입니다.</p>
      </div>

      <DeploymentsTable deployments={serialized} />
    </div>
  )
}
