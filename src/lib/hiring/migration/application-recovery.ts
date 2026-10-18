import type { HiringMigrationRecord } from '@/generated/prisma/client'
import { planOpeningApplication, type OpeningApplicationImport } from './application-import'
import { decodeMigrationSnapshot, migrationSourceRef } from './ledger'

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

export function recoverOpeningApplication(
  record: RecoveryRecord,
  scope: { sourceSpaceId: string; spaceId: string }
): OpeningApplicationImport {
  try {
    if (
      !scope.spaceId ||
      record.spaceId !== scope.spaceId ||
      record.targetModel !== 'HiringApplication' ||
      record.transformVersion !== 'application-v1'
    )
      throw Error()
    const stored = decodeMigrationSnapshot(record)
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) throw Error()
    const { importDecisions, ...snapshot } = stored as Record<string, unknown>
    if (!importDecisions || typeof importDecisions !== 'object' || Array.isArray(importDecisions))
      throw Error()
    const raw = { ...importDecisions, snapshot } as OpeningApplicationImport
    const { input, app } = planOpeningApplication(raw)
    if (
      input.spaceId !== scope.spaceId ||
      input.sourceSpaceId !== scope.sourceSpaceId ||
      record.sourceRef !==
        migrationSourceRef({
          sourceSystem: 'opening.work',
          sourceTable: 'application',
          sourceId: app.id,
          occurrence: '0',
        }) ||
      new Date(input.sourceSnapshotAt).getTime() !== record.sourceSnapshotAt.getTime()
    )
      throw Error()
    return raw
  } catch {
    // 복호화·검증 오류에 포함될 수 있는 고객 원문을 외부에 전달하지 않는다.
    throw new Error('APPLICATION_RECOVERY_FAILED')
  }
}
