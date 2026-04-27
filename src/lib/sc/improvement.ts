// 개선 규칙 병합·조회 헬퍼. Unit 4 ideation.ts 의 loadActiveRules 를 이 구현으로 교체.
// D9: 병합 순서 workspace → product → persona → channel, 충돌 시 weight 우선.

import { prisma } from '@/lib/prisma'
import type { IdeationRule } from './prompts'

// Prisma Rule → ideation 에 주입할 평탄한 rule 객체로 변환.
// scope 값 대소문자 매핑: DB enum 대문자 → 빌더 enum 소문자.
export async function loadActiveImprovementRules(params: {
  spaceId: string
  productId?: string | null
  personaId?: string | null
  channelId?: string | null
}): Promise<IdeationRule[]> {
  const rows = await prisma.improvementRule.findMany({
    where: {
      spaceId: params.spaceId,
      status: 'ACTIVE',
      OR: [
        { scope: 'WORKSPACE' },
        ...(params.productId
          ? [{ scope: 'PRODUCT' as const, targetProductId: params.productId }]
          : []),
        ...(params.personaId
          ? [{ scope: 'PERSONA' as const, targetPersonaId: params.personaId }]
          : []),
        ...(params.channelId
          ? [{ scope: 'CHANNEL' as const, targetChannelId: params.channelId }]
          : []),
        ...(params.productId && params.personaId
          ? [
              {
                scope: 'COMBINATION' as const,
                targetProductId: params.productId,
                targetPersonaId: params.personaId,
              },
            ]
          : []),
      ],
    },
    orderBy: [{ weight: 'desc' }, { updatedAt: 'desc' }],
  })

  return rows.map((r) => ({
    id: r.id,
    scope: r.scope.toLowerCase() as IdeationRule['scope'],
    text: r.title ? `${r.title} — ${r.body}` : r.body,
    weight: r.weight,
  }))
}
