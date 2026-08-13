// 키워드 마스터 API 응답 직렬화 — 라우트마다 select/매핑이 어긋나지 않도록 한곳에 모은다.

import { Prisma } from '@/generated/prisma/client'

export const keywordSelect = {
  id: true,
  keyword: true,
  normalized: true,
  despaced: true,
  sortedKey: true,
  category: true,
  type: true,
  source: true,
  status: true,
  score: true,
  scoreInputs: true,
  researchedAt: true,
  memo: true,
  createdAt: true,
  updatedAt: true,
  links: {
    select: {
      id: true,
      productId: true,
      listingId: true,
      role: true,
      sortOrder: true,
    },
    orderBy: [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }],
  },
} satisfies Prisma.KeywordMasterSelect

type KeywordRow = Prisma.KeywordMasterGetPayload<{ select: typeof keywordSelect }>

export function serializeKeyword(row: KeywordRow) {
  return {
    ...row,
    researchedAt: row.researchedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export type SerializedKeyword = ReturnType<typeof serializeKeyword>
