import type { HiringMigrationRecord } from '@/generated/prisma/client'
import { decodeMigrationSnapshot } from './ledger'
import { recoverOpeningPosting } from './posting-recovery'
import { recoverOpeningApplication } from './application-recovery'

const sourceTables = {
  HiringPosting: 'posting',
  HiringApplication: 'application',
  HiringStore: 'store',
} as const
type Model = keyof typeof sourceTables
const empty = () => ({
  checked: 0,
  integrityVerified: 0,
  integrityFailed: 0,
  recoveryFailed: 0,
  scopeFailed: 0,
  unsupported: 0,
})
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export function auditMigrationRecords(
  records: HiringMigrationRecord[],
  scope: { spaceId: string; sourceSpaceId: string }
) {
  const result = {
    ...empty(),
    models: { HiringPosting: empty(), HiringApplication: empty(), HiringStore: empty() },
  }
  for (const record of records) {
    result.checked++
    if (!Object.hasOwn(sourceTables, record.targetModel)) {
      result.unsupported++
      continue
    }
    const model = record.targetModel as Model
    const stats = result.models[model]
    stats.checked++
    let ref: unknown
    try {
      ref = JSON.parse(record.sourceRef)
    } catch {
      ref = null
    }
    if (
      record.spaceId !== scope.spaceId ||
      !Array.isArray(ref) ||
      ref.length !== 4 ||
      ref[0] !== 'opening.work' ||
      ref[1] !== sourceTables[model] ||
      typeof ref[2] !== 'string' ||
      !/^[1-9]\d{0,18}$/.test(ref[2]) ||
      ref[3] !== '0'
    ) {
      result.scopeFailed++
      stats.scopeFailed++
      continue
    }
    let snapshot: unknown
    try {
      snapshot = decodeMigrationSnapshot(record)
    } catch {
      result.integrityFailed++
      stats.integrityFailed++
      continue
    }
    const source = object(snapshot)
      ? (snapshot.sourceSpaceId ??
        (object(snapshot.importDecisions) ? snapshot.importDecisions.sourceSpaceId : undefined))
      : undefined
    if (source !== undefined && source !== scope.sourceSpaceId) {
      result.scopeFailed++
      stats.scopeFailed++
      continue
    }
    result.integrityVerified++
    stats.integrityVerified++
    try {
      if (model === 'HiringPosting') recoverOpeningPosting(record, scope)
      if (model === 'HiringApplication') recoverOpeningApplication(record, scope)
    } catch {
      result.recoveryFailed++
      stats.recoveryFailed++
    }
  }
  return result
}
