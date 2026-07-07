// 포스트 버전 스냅샷 헬퍼.
// content-versions.ts 의 BoPost 대응 구현체.

import type { Prisma } from '@/generated/prisma/client'

// ─── 스냅샷 헬퍼 ─────────────────────────────────────────────────────────────

export interface BoPostSnapshot {
  id: string
  spaceId: string
  title: string
  doc: unknown
}

/**
 * 현재 BoPost row 상태를 BoPostVersion으로 INSERT한다.
 * versionNumber는 MAX(versionNumber)+1 로 결정.
 * tx(트랜잭션 클라이언트)를 직접 받아 호출측 트랜잭션에 참여한다.
 * 반환값: 생성된 BoPostVersion의 id와 versionNumber.
 */
export async function createBoPostVersion(
  tx: Prisma.TransactionClient,
  post: BoPostSnapshot,
  note?: string,
  userId?: string
): Promise<{ id: string; versionNumber: number }> {
  const agg = await tx.boPostVersion.aggregate({
    where: { postId: post.id },
    _max: { versionNumber: true },
  })
  const nextNum = (agg._max.versionNumber ?? 0) + 1

  const version = await tx.boPostVersion.create({
    data: {
      postId: post.id,
      spaceId: post.spaceId,
      versionNumber: nextNum,
      title: post.title,
      doc: post.doc as Prisma.InputJsonValue,
      note: note ?? null,
      createdByUserId: userId ?? null,
    },
    select: { id: true, versionNumber: true },
  })

  return version
}
