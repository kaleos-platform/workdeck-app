import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { requireOperator } from '@/lib/admin/auth'
import { mfaStepUpPath } from '@/lib/auth/mfa-policy'
import { getAdminMetrics } from '@/lib/admin/metrics'
import { MetricCards } from '@/components/admin/metric-cards'

const SECTIONS = [
  {
    href: '/admin/users',
    title: '사용자',
    description: '사용자 검색, 계정 상세, ban/해제, 멤버십 관리',
  },
  {
    href: '/admin/billing',
    title: '결제',
    description: 'deck 구독 현황, 과금 모드/가격 관리, 결제 이력',
  },
  {
    href: '/admin/templates',
    title: '템플릿',
    description: '모집 관리 샘플 템플릿 생성/편집',
  },
]

export default async function AdminHomePage() {
  // layout 과 page 는 병렬로 렌더되므로 layout 의 가드가 이 페이지의 prisma 읽기를 막아주지 않는다 — 자체 가드.
  const auth = await requireOperator()
  if (!auth.ok && auth.reason === 'MFA_REQUIRED') redirect(mfaStepUpPath('/admin'))
  if (!auth.ok) notFound()

  const metrics = await getAdminMetrics()

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold">운영 어드민</h1>
        <p className="text-sm text-muted-foreground">워크덱 운영사 전용 관리 도구</p>
      </div>

      <MetricCards metrics={metrics} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {SECTIONS.map((section) => (
          <Link key={section.href} href={section.href}>
            <Card className="h-full transition-colors hover:border-foreground/30">
              <CardHeader>
                <CardTitle>{section.title}</CardTitle>
                <CardDescription>{section.description}</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  )
}
