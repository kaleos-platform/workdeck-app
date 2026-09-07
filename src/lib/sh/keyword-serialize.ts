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
      // 연결 대상의 표시 이름을 함께 싣는다. id만 주면 화면이 "상품"이라고만 쓸 수밖에 없고,
      // /api/sh/products 에는 by-ids 필터가 없어 클라이언트가 이름을 되찾을 방법이 없다.
      product: { select: { id: true, name: true, internalName: true } },
      // channel.externalSource 까지 싣는 이유: non-null 이면 대표 채널을 읽기전용으로 미러링하는
      // 연동 채널이라 편집 어포던스를 숨겨야 한다. 여기서 주지 않으면 화면이 채널 목록을
      // 따로 불러 대조해야 하고, 확인 못 한 listing 을 전부 잠긴 것으로 처리하게 된다.
      listing: {
        select: {
          id: true,
          searchName: true,
          managementName: true,
          channelId: true,
          channel: { select: { id: true, name: true, externalSource: true } },
        },
      },
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
