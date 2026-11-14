// 지원자 교차 목록(server component) — 목록 조회·필터는 공유 섹션이 처리한다.
import { resolveDeckContext } from '@/lib/api-helpers'
import { redirect } from 'next/navigation'
import {
  ApplicationsListSection,
  type ApplicationsSearchParams,
} from '@/components/hiring-applicants/applications-list-section'

type Props = { searchParams: Promise<ApplicationsSearchParams> }

export default async function ApplicationsPage({ searchParams }: Props) {
  const resolved = await resolveDeckContext('recruiting')
  if ('error' in resolved) redirect('/my-deck')
  const raw = await searchParams

  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-2xl font-semibold">지원자 목록</h1>
        <p className="text-sm text-muted-foreground">
          전체 공고의 지원서를 한 곳에서 검토하고 단계를 관리합니다.
        </p>
      </div>

      <ApplicationsListSection
        spaceId={resolved.space.id}
        canExportExcel={resolved.role === 'OWNER' || resolved.role === 'ADMIN'}
        raw={raw}
      />
    </div>
  )
}
