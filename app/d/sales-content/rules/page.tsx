import { redirect } from 'next/navigation'
import { resolveDeckContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { RuleList } from '@/components/sc/rules/rule-list'
import { RuleForm } from '@/components/sc/rules/rule-form'

export default async function RulesPage() {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) redirect('/my-deck')

  const rules = await prisma.improvementRule.findMany({
    where: { spaceId: resolved.space.id },
    orderBy: [{ status: 'asc' }, { weight: 'desc' }, { updatedAt: 'desc' }],
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">개선 규칙</h1>
        <p className="text-sm text-muted-foreground">
          ACTIVE 규칙은 모든 아이데이션·섹션 생성 프롬프트에 자동 주입됩니다. AI 제안
          규칙(PROPOSED)은 승인 후 활성화하세요.
        </p>
      </div>

      <RuleList rules={rules} />

      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-muted-foreground">규칙 추가</h2>
        <RuleForm />
      </div>
    </div>
  )
}
