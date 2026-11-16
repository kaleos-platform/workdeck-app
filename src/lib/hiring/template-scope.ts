import type { Prisma } from '@/generated/prisma/client'

// 공용 콘텐츠는 전역 샘플 템플릿에 속할 때만 공용으로 취급한다.
export function templateContentScope(spaceId: string): Prisma.HiringContentWhereInput {
  return {
    sourceType: 'DETAIL_TEMPLATE',
    OR: [
      { spaceId, template: { spaceId } },
      { spaceId: null, template: { spaceId: null, isSample: true } },
    ],
  }
}

export function templateAccessScope(spaceId: string): Prisma.HiringDetailTemplateWhereInput {
  return { OR: [{ spaceId }, { spaceId: null, isSample: true }] }
}

export function templateListScope(spaceId: string): Prisma.HiringDetailTemplateWhereInput {
  return {
    OR: [
      { spaceId },
      { spaceId: null, isSample: true, contents: { some: templateContentScope(spaceId) } },
    ],
  }
}
