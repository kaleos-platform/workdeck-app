import type { Prisma } from '@/generated/prisma/client'

// 임시 차단(2026-11-16): opening 이관 샘플 29개에 타사 브랜드·연락처가 남아 있어 정리 완료 전까지
// 고객 목록·상세·적용·복사에서 제외한다. 정리·검증이 끝나면 이 조건을 제거한다.
// (docs/superpowers/plans/2026-11-16-recruiting-sample-template-branding.md)
// sourceRef 가 null 인 샘플(어드민이 새로 만든 것)은 NOT LIKE 가 NULL 로 평가돼 빠지므로 OR 로 살린다.
const BRAND_CLEANUP_PENDING_PREFIX = 'opening:detail_template:'
const sampleNotPendingCleanup: Prisma.HiringDetailTemplateWhereInput = {
  OR: [{ sourceRef: null }, { NOT: { sourceRef: { startsWith: BRAND_CLEANUP_PENDING_PREFIX } } }],
}

// 공용 콘텐츠는 전역 샘플 템플릿에 속할 때만 공용으로 취급한다.
export function templateContentScope(spaceId: string): Prisma.HiringContentWhereInput {
  return {
    sourceType: 'DETAIL_TEMPLATE',
    OR: [
      { spaceId, template: { spaceId } },
      { spaceId: null, template: { spaceId: null, isSample: true, ...sampleNotPendingCleanup } },
    ],
  }
}

export function templateAccessScope(spaceId: string): Prisma.HiringDetailTemplateWhereInput {
  return { OR: [{ spaceId }, { spaceId: null, isSample: true, ...sampleNotPendingCleanup }] }
}

export function templateListScope(spaceId: string): Prisma.HiringDetailTemplateWhereInput {
  return {
    OR: [
      { spaceId },
      {
        spaceId: null,
        isSample: true,
        ...sampleNotPendingCleanup,
        contents: { some: templateContentScope(spaceId) },
      },
    ],
  }
}
