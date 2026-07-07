import { redirect } from 'next/navigation'
import { resolveDeckContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { StoresManager, type StoreRow } from '@/components/hiring-posts/stores-manager'

// 매장 기준정보 관리
export default async function StoresSettingsPage() {
  const resolved = await resolveDeckContext('recruiting')
  if ('error' in resolved) redirect('/my-deck')

  const rows = await prisma.hiringStore.findMany({
    where: { spaceId: resolved.space.id },
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      roadAddress: true,
      detailAddress: true,
      zipcode: true,
      isActive: true,
    },
  })
  const stores: StoreRow[] = rows

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">매장 관리</h1>
        <p className="text-sm text-muted-foreground">공고에 연결할 근무 매장을 관리합니다.</p>
      </div>
      <StoresManager initialStores={stores} />
    </div>
  )
}
