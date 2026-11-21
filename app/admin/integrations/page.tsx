import { notFound } from 'next/navigation'
import { requireOperator } from '@/lib/admin/auth'
import { loadPlatformGoogleView } from '@/lib/admin/platform-ga4'
import { PlatformGoogleCard } from '@/components/admin/platform-google-card'

export default async function AdminIntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ google?: string }>
}) {
  const auth = await requireOperator()
  if (!auth.ok) notFound()

  const { google } = await searchParams
  const view = await loadPlatformGoogleView()

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold">플랫폼 연동</h1>
        <p className="text-sm text-muted-foreground">
          워크덱 운영사 자산의 외부 연동(고객 작업 공간과 분리). 현재: 홈페이지 GA4
        </p>
      </div>
      <PlatformGoogleCard view={view} result={google ?? null} />
    </div>
  )
}
