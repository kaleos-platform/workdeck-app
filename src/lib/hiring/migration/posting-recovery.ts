import type { HiringMigrationRecord } from '@/generated/prisma/client'
import { z } from 'zod'
import { decodeMigrationSnapshot, migrationSourceRef } from './ledger'
import { planOpeningPosting, type OpeningPostingPacket } from './posting-import'

const targetSchema = z
  .object({
    sourceSpaceId: z.string().regex(/^[1-9]\d{0,18}$/),
    spaceId: z.string().min(1),
    author: z.object({ sourceMemberId: z.string().min(1), userId: z.string().min(1) }).nullable(),
  })
  .strict()

type RecoveryRecord = Pick<
  HiringMigrationRecord,
  | 'spaceId'
  | 'targetModel'
  | 'transformVersion'
  | 'sourceRef'
  | 'sourceSnapshotAt'
  | 'sourceHash'
  | 'sourceSnapshotEnc'
  | 'sourceSnapshotIv'
>

export function recoverOpeningPosting(
  record: RecoveryRecord,
  scope: { sourceSpaceId: string; spaceId: string }
) {
  try {
    if (
      !scope.spaceId ||
      record.spaceId !== scope.spaceId ||
      record.targetModel !== 'HiringPosting' ||
      record.transformVersion !== 'posting-v1'
    )
      throw Error()
    const snapshot = decodeMigrationSnapshot(record)
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) throw Error()
    const { target: rawTarget, ...rawPacket } = snapshot as Record<string, unknown>
    const target = targetSchema.parse(rawTarget)
    if (target.spaceId !== scope.spaceId || target.sourceSpaceId !== scope.sourceSpaceId)
      throw Error()
    // 기존 planner가 packet schema와 폼·콘텐츠·대상 자산 범위를 다시 검증한다.
    const packet = rawPacket as OpeningPostingPacket
    planOpeningPosting(packet, target)
    if (
      record.sourceRef !==
        migrationSourceRef({
          sourceSystem: 'opening.work',
          sourceTable: 'posting',
          sourceId: packet.sourcePostingId,
          occurrence: '0',
        }) ||
      new Date(packet.sourceSnapshotAt).getTime() !== record.sourceSnapshotAt.getTime()
    )
      throw Error()
    return { packet, target }
  } catch {
    // 복호화·schema 오류에 포함될 수 있는 고객 원문을 호출자에게 전달하지 않는다.
    throw new Error('POSTING_RECOVERY_FAILED')
  }
}
