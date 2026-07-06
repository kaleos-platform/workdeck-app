import { redirect } from 'next/navigation'
import { resolveDeckContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { PositionsManager, type PositionRow } from '@/components/hiring-posts/positions-manager'

// 직무 기준정보 관리
export default async function PositionsSettingsPage() {
  const resolved = await resolveDeckContext('hiring-posts')
  if ('error' in resolved) redirect('/my-deck')

  const rows = await prisma.hiringPosition.findMany({
    where: { spaceId: resolved.space.id },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, category: true, isActive: true },
  })
  const positions: PositionRow[] = rows

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">직무 관리</h1>
        <p className="text-sm text-muted-foreground">
          공고 직무에 재사용할 기준 직무를 관리합니다.
        </p>
      </div>
      <PositionsManager initialPositions={positions} />
    </div>
  )
}
