// Phase 2 Unit 16 — 콘텐츠 버전 히스토리 · 롤백
// Content 수정 직전 상태를 ContentVersion 스냅샷으로 보존하고,
// 사용자 요청 시 이전 버전으로 원자적으로 롤백한다.

import { prisma } from '@/lib/prisma'
import type { Prisma } from '@/generated/prisma/client'

// ─── 순수 유틸 ───────────────────────────────────────────────────────────────

/**
 * 기존 versionNumber 배열에서 다음 번호를 계산하는 순수 함수.
 * 빈 배열(버전 없음)이면 1을 반환.
 */
export function nextVersionNumber(existingNumbers: number[]): number {
  if (existingNumbers.length === 0) return 1
  return Math.max(...existingNumbers) + 1
}

// ─── 스냅샷 헬퍼 ─────────────────────────────────────────────────────────────

export interface SnapshotOptions {
  contentId: string
  userId?: string
  note?: string
}

/**
 * 현재 Content row를 읽어 새 ContentVersion으로 INSERT한다.
 * versionNumber 는 MAX(versionNumber)+1 로 결정. 동시성 충돌(P2002) 시 1회 재시도.
 * 반환값: 생성된 ContentVersion.id 와 versionNumber.
 */
export async function snapshotContent({
  contentId,
  userId,
  note,
}: SnapshotOptions): Promise<{ id: string; versionNumber: number }> {
  // 재시도 래퍼 — 동시 PATCH 로 인한 P2002 unique 충돌을 1회 흡수
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await prisma.$transaction(async (tx) => {
        // 현재 Content 전체 필드 읽기 (title, doc, snapshotHash, spaceId 필요)
        const content = await tx.content.findUnique({
          where: { id: contentId },
          select: { title: true, doc: true, snapshotHash: true, spaceId: true },
        })
        if (!content) throw new Error(`Content not found: ${contentId}`)

        // 현재 max versionNumber 조회
        const agg = await tx.contentVersion.aggregate({
          where: { contentId },
          _max: { versionNumber: true },
        })
        const nextNum = (agg._max.versionNumber ?? 0) + 1

        const version = await tx.contentVersion.create({
          data: {
            contentId,
            spaceId: content.spaceId,
            versionNumber: nextNum,
            title: content.title,
            doc: content.doc as Prisma.InputJsonValue,
            snapshotHash: content.snapshotHash ?? undefined,
            createdByUserId: userId ?? null,
            note: note ?? null,
          },
          select: { id: true, versionNumber: true },
        })
        return version
      })
      return result
    } catch (err: unknown) {
      // P2002 = Unique constraint 위반 → 동시 PATCH 경쟁 → 재시도
      const isUniqueViolation =
        err instanceof Error && 'code' in err && (err as { code?: string }).code === 'P2002'

      if (isUniqueViolation && attempt === 0) {
        // 짧은 대기 없이 즉시 재시도 (트랜잭션이 새 MAX를 읽을 것)
        continue
      }
      throw err
    }
  }
  // 여기에 도달하면 재시도도 실패 — TypeScript 만족용 (실제론 throw됨)
  throw new Error('snapshotContent: 재시도 한도 초과')
}

// ─── 롤백 헬퍼 ───────────────────────────────────────────────────────────────

export interface RollbackOptions {
  contentId: string
  versionId: string
  userId?: string
}

/**
 * 지정한 ContentVersion으로 Content를 롤백한다.
 * 트랜잭션 내에서:
 *   1) 현재 상태를 "롤백 직전 자동 저장" 스냅샷으로 보존
 *   2) 대상 버전의 title/doc/snapshotHash를 Content에 복사
 * 반환값: contentId 와 직전 자동 저장 스냅샷의 versionNumber.
 */
export async function rollbackContent({
  contentId,
  versionId,
  userId,
}: RollbackOptions): Promise<{ contentId: string; newVersionNumber: number }> {
  const result = await prisma.$transaction(async (tx) => {
    // 대상 버전 로드 (spaceId 검증은 호출 API에서 이미 수행)
    const targetVersion = await tx.contentVersion.findUnique({
      where: { id: versionId },
      select: {
        contentId: true,
        title: true,
        doc: true,
        snapshotHash: true,
        versionNumber: true,
      },
    })
    if (!targetVersion) throw new Error(`ContentVersion not found: ${versionId}`)
    if (targetVersion.contentId !== contentId) {
      throw new Error('ContentVersion does not belong to this content')
    }

    // 현재 Content 읽기
    const content = await tx.content.findUnique({
      where: { id: contentId },
      select: { title: true, doc: true, snapshotHash: true, spaceId: true },
    })
    if (!content) throw new Error(`Content not found: ${contentId}`)

    // (a) 현재 상태를 "롤백 직전 자동 저장" 스냅샷으로 보존
    const agg = await tx.contentVersion.aggregate({
      where: { contentId },
      _max: { versionNumber: true },
    })
    const nextNum = (agg._max.versionNumber ?? 0) + 1

    const preRollbackSnapshot = await tx.contentVersion.create({
      data: {
        contentId,
        spaceId: content.spaceId,
        versionNumber: nextNum,
        title: content.title,
        doc: content.doc as Prisma.InputJsonValue,
        snapshotHash: content.snapshotHash ?? undefined,
        createdByUserId: userId ?? null,
        note: '롤백 직전 자동 저장',
      },
      select: { id: true, versionNumber: true },
    })

    // (b) 대상 버전 → Content 복사
    await tx.content.update({
      where: { id: contentId },
      data: {
        title: targetVersion.title,
        doc: targetVersion.doc as Prisma.InputJsonValue,
        snapshotHash: targetVersion.snapshotHash ?? undefined,
      },
    })

    return { contentId, newVersionNumber: preRollbackSnapshot.versionNumber }
  })

  return result
}
