import { createHash } from 'node:crypto'
import type { HiringMigrationRecord, Prisma } from '@/generated/prisma/client'
import { decryptPii, encryptPii } from '@/lib/del/encryption'

export type MigrationSource = {
  sourceSystem: string
  sourceTable: string
  sourceId: string
  occurrence: string
}

// BIGINT는 호출 경계부터 문자열로 받아 정밀도 손실을 막는다.
export function migrationSourceRef(source: MigrationSource): string {
  const parts = [source.sourceSystem, source.sourceTable, source.sourceId, source.occurrence]
  if (parts.some((part) => typeof part !== 'string' || !part.length)) {
    throw new Error('Invalid migration source reference')
  }
  return JSON.stringify(parts)
}

// JSON 이외의 값은 묵시적으로 누락하거나 변환하지 않는다. Date/BIGINT는 호출자가 문자열로 변환한다.
function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return JSON.stringify(value)
  if (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    (!Number.isInteger(value) || Number.isSafeInteger(value))
  )
    return JSON.stringify(value)
  if (Array.isArray(value)) {
    return `[${Array.from(value, canonicalJson).join(',')}]`
  }
  if (
    typeof value === 'object' &&
    value !== null &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`
      )
      .join(',')}}`
  }
  throw new Error('Migration snapshot must contain only lossless JSON values')
}

export function migrationHash(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex')
}

export function decodeMigrationSnapshot(
  record: Pick<HiringMigrationRecord, 'sourceSnapshotEnc' | 'sourceSnapshotIv' | 'sourceHash'>
): unknown {
  try {
    if (!record.sourceSnapshotEnc || !record.sourceSnapshotIv) throw new Error()
    const snapshot: unknown = JSON.parse(
      decryptPii(record.sourceSnapshotEnc, record.sourceSnapshotIv)
    )
    if (migrationHash(snapshot) !== record.sourceHash) throw new Error()
    return snapshot
  } catch {
    // 복호화 오류에 원본 개인정보가 포함되지 않도록 고정 메시지만 노출한다.
    throw new Error('Migration snapshot integrity failure')
  }
}

type MigrationInput = MigrationSource & {
  spaceId: string
  sourceSnapshotAt: Date
  transformVersion: string
  snapshot: unknown
  targetModel: string
}

/**
 * 반드시 prisma.$transaction 콜백 안에서 호출하고 오류를 바깥까지 전파한다.
 * create/read는 전달받은 tx만 사용한다. snapshot은 실제 저장된 대상의 일관된 JSON 투영이다.
 * 동시 실행의 unique 충돌은 전체 transaction을 롤백한 뒤 재시도한다.
 */
export async function importMigrationRecord<T extends { id: string; spaceId: string }>(
  tx: Prisma.TransactionClient,
  input: MigrationInput,
  target: {
    create: (tx: Prisma.TransactionClient) => Promise<T>
    read: (tx: Prisma.TransactionClient, id: string) => Promise<T | null>
    snapshot: (value: T) => unknown
  }
): Promise<{ status: 'created' | 'existing'; target: T; record: HiringMigrationRecord }> {
  const sourceRef = migrationSourceRef(input)
  if (
    !input.spaceId ||
    !input.transformVersion ||
    !input.targetModel ||
    !Number.isFinite(input.sourceSnapshotAt.getTime())
  ) {
    throw new Error('Invalid migration input')
  }
  const sourceHash = migrationHash(input.snapshot)
  const existing = await tx.hiringMigrationRecord.findUnique({ where: { sourceRef } })
  if (existing) {
    if (existing.spaceId !== input.spaceId) throw new Error('Migration space conflict')
    if (existing.sourceHash !== sourceHash || existing.transformVersion !== input.transformVersion)
      throw new Error('Migration source conflict')
    if (existing.targetModel !== input.targetModel) throw new Error('Migration target conflict')
    const current = await target.read(tx, existing.targetId)
    if (
      !current ||
      current.id !== existing.targetId ||
      current.spaceId !== input.spaceId ||
      migrationHash(target.snapshot(current)) !== existing.targetHash
    ) {
      throw new Error('Migration target conflict')
    }
    return { status: 'existing', target: current, record: existing }
  }
  // 대상 쓰기 전에 암호화 키와 원본 직렬화 오류를 확인한다.
  const encrypted = encryptPii(canonicalJson(input.snapshot))
  const created = await target.create(tx)
  if (!created.id || created.spaceId !== input.spaceId) throw new Error('Migration target conflict')
  const record = await tx.hiringMigrationRecord.create({
    data: {
      sourceRef,
      spaceId: input.spaceId,
      sourceSnapshotAt: input.sourceSnapshotAt,
      transformVersion: input.transformVersion,
      sourceHash,
      targetModel: input.targetModel,
      targetId: created.id,
      targetHash: migrationHash(target.snapshot(created)),
      sourceSnapshotEnc: encrypted.encrypted,
      sourceSnapshotIv: encrypted.iv,
    },
  })
  return { status: 'created', target: created, record }
}
