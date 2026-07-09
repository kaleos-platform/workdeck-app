import { NextResponse } from 'next/server'
import { resolveDeckContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

// GET /api/bo/deployments — space 범위 배포 이력 목록
export async function GET() {
  const resolved = await resolveDeckContext('blog-ops')
  if ('error' in resolved) return resolved.error

  const deployments = await prisma.boDeployment.findMany({
    where: { spaceId: resolved.space.id },
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: {
      id: true,
      status: true,
      platformUrl: true,
      scheduledAt: true,
      deletedAt: true,
      createdAt: true,
      post: { select: { id: true, title: true } },
      channel: { select: { id: true, name: true, platform: true } },
      variant: { select: { id: true, status: true } },
    },
  })

  const serialized = deployments.map((d) => ({
    id: d.id,
    status: d.status,
    platformUrl: d.platformUrl,
    scheduledAt: d.scheduledAt ? d.scheduledAt.toISOString() : null,
    deletedAt: d.deletedAt ? d.deletedAt.toISOString() : null,
    createdAt: d.createdAt.toISOString(),
    post: d.post,
    channel: d.channel,
    variant: d.variant,
  }))

  return NextResponse.json({ deployments: serialized })
}
