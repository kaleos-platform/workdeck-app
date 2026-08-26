import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { requireOperator } from '@/lib/admin/auth'
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
  // layout이 이미 requireOperator를 통과시키지만, MFA_REQUIRED 상태에서도 children이 렌더될 수 있어
  // prisma를 직접 읽는 이 페이지는 자체 가드가 필요하다.
  const auth = await requireOperator()
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
