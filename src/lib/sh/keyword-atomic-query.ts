// Space 의 예외 단어(분해 금지 단어) 사전.
//
// 행이 없는 것이 정상 상태다(= 사전 없이 검증). 그래서 조회 결과가 비어도 오류가 아니다.

import { prisma } from '@/lib/prisma'

export async function loadAtomicWords(spaceId: string): Promise<string[]> {
  const rows = await prisma.spaceAtomicWord.findMany({
    where: { spaceId },
    select: { word: true },
    orderBy: { word: 'asc' },
  })
  return rows.map((r) => r.word)
}
