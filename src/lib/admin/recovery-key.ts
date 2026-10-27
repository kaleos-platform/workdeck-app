import 'server-only'
import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto'
import { recoveryPrisma as prisma } from './recovery-db'
import { derivePurposeKey } from '@/lib/crypto/field-crypto'
import type { Prisma } from '@/generated/prisma/client'

// 플랫폼 root key는 고객 SpaceSecret·에이전트 발급 경로와 분리한다.
const VAULT_NAME = 'workdeck.platform.encryption-v1.k1'
const TARGET = 'platform-recovery-key'
const HEX_KEY = /^[a-fA-F0-9]{64}$/
type VaultMeta = { id: string; createdAt: Date }
export type RecoveryKeyStatus = {
  keyId: 'k1'
  stored: boolean
  createdAt: string | null
  lastVerifiedAt: string | null
  sourceAvailable: boolean
}
export type RecoveryErrorCode =
  | 'RUNTIME_KEY_UNAVAILABLE'
  | 'BACKUP_MISSING'
  | 'BACKUP_MISMATCH'
  | 'RECOVERY_UNAVAILABLE'

export class RecoveryKeyError extends Error {
  constructor(readonly code: RecoveryErrorCode) {
    super(code)
  }
}

const sourceKey = () => {
  const key = process.env.ENCRYPTION_KEY_V1
  return key && HEX_KEY.test(key) ? key : null
}

async function metadata(db: Pick<Prisma.TransactionClient, '$queryRaw'>) {
  const rows = await db.$queryRaw<VaultMeta[]>`
    SELECT id::text, created_at AS "createdAt" FROM vault.secrets WHERE name = ${VAULT_NAME}
  `
  return rows[0] ?? null
}

function status(row: VaultMeta | null, verified: Date | null): RecoveryKeyStatus {
  return {
    keyId: 'k1',
    stored: !!row,
    createdAt: row?.createdAt.toISOString() ?? null,
    lastVerifiedAt: verified?.toISOString() ?? null,
    sourceAvailable: !!sourceKey(),
  }
}

export async function getRecoveryKeyStatus(): Promise<RecoveryKeyStatus> {
  try {
    const row = await metadata(prisma)
    const last = row
      ? await prisma.adminAuditLog.findFirst({
          where: { action: 'recovery-key.verify', targetType: TARGET, targetId: row.id },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true },
        })
      : null
    return status(row, last?.createdAt ?? null)
  } catch {
    throw new RecoveryKeyError('RECOVERY_UNAVAILABLE')
  }
}

function verifyCopy(source: string, copy: string) {
  if (
    !HEX_KEY.test(copy) ||
    !timingSafeEqual(Buffer.from(source, 'hex'), Buffer.from(copy, 'hex'))
  ) {
    throw new RecoveryKeyError('BACKUP_MISMATCH')
  }
  // 고객 원문 대신 합성 canary로 사본의 실제 AES-GCM 복호화까지 확인한다.
  const plain = Buffer.from('workdeck-platform-recovery-k1-canary')
  const iv = randomBytes(12)
  const cipher = createCipheriv(
    'aes-256-gcm',
    derivePurposeKey(Buffer.from(source, 'hex'), 'pii'),
    iv
  )
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()])
  const decipher = createDecipheriv(
    'aes-256-gcm',
    derivePurposeKey(Buffer.from(copy, 'hex'), 'pii'),
    iv
  )
  decipher.setAuthTag(cipher.getAuthTag())
  const restored = Buffer.concat([decipher.update(encrypted), decipher.final()])
  if (!timingSafeEqual(plain, restored)) throw new RecoveryKeyError('BACKUP_MISMATCH')
}

export async function manageRecoveryKey(
  action: 'backup' | 'verify',
  actorUserId: string
): Promise<RecoveryKeyStatus> {
  const source = sourceKey()
  if (!source) throw new RecoveryKeyError('RUNTIME_KEY_UNAVAILABLE')
  try {
    return await prisma.$transaction(
      async (tx) => {
        // 감사와 Vault 쓰기는 같은 transaction이다. 감사 실패 시 사본도 남기지 않는다.
        await tx.adminAuditLog.create({
          data: {
            actorUserId,
            action: `recovery-key.${action}.started`,
            targetType: TARGET,
            targetId: VAULT_NAME,
            meta: { keyId: 'k1' },
          },
        })
        // 권한 없는 전역 logging 변경 대신 현재 연결의 안전한 로그 조건을 확인한다.
        const [logging] = await tx.$queryRaw<
          Array<{
            statement: string
            minDuration: string
            sampleDuration: string
            sampleRate: string
            duration: string
            auditParameters: string | null
          }>
        >`SELECT current_setting('log_statement') AS statement,
        current_setting('log_min_duration_statement') AS "minDuration",
        current_setting('log_min_duration_sample') AS "sampleDuration",
        current_setting('log_transaction_sample_rate') AS "sampleRate",
        current_setting('log_duration') AS duration,
        current_setting('pgaudit.log_parameter', true) AS "auditParameters"`
        if (
          !logging ||
          !['none', 'ddl'].includes(logging.statement) ||
          logging.minDuration !== '-1' ||
          logging.sampleDuration !== '-1' ||
          Number(logging.sampleRate) !== 0 ||
          logging.duration !== 'off' ||
          (logging.auditParameters != null &&
            !['off', 'false', ''].includes(logging.auditParameters))
        ) {
          throw new RecoveryKeyError('RECOVERY_UNAVAILABLE')
        }
        await tx.$queryRaw`SELECT set_config('log_parameter_max_length_on_error', '0', true)`
        let row = await metadata(tx)
        if (!row && action === 'verify') throw new RecoveryKeyError('BACKUP_MISSING')
        if (!row) {
          // 새 사본만 생성한다. 충돌/기존 값에 update나 delete를 수행하지 않는다.
          await tx.$queryRaw`SELECT vault.create_secret(${source}, ${VAULT_NAME}, ${'Workdeck platform k1 recovery copy'})::text AS id`
          row = await metadata(tx)
        }
        if (!row) throw new RecoveryKeyError('RECOVERY_UNAVAILABLE')
        const copies = await tx.$queryRaw<Array<{ value: string }>>`
        SELECT decrypted_secret AS value FROM vault.decrypted_secrets
        WHERE id = ${row.id}::uuid AND name = ${VAULT_NAME}
      `
        if (copies.length !== 1) throw new RecoveryKeyError('RECOVERY_UNAVAILABLE')
        verifyCopy(source, copies[0].value)
        const verified = await tx.adminAuditLog.create({
          data: {
            actorUserId,
            action: 'recovery-key.verify',
            targetType: TARGET,
            targetId: row.id,
            meta: { keyId: 'k1', operation: action, canaryVerified: true },
          },
          select: { createdAt: true },
        })
        return status(row, verified.createdAt)
      },
      { timeout: 10000 }
    )
  } catch (error) {
    // Prisma 예외에는 bind 값이 들어갈 수 있다. 원문을 로깅/전파하지 않는다.
    if (error instanceof RecoveryKeyError) throw error
    throw new RecoveryKeyError('RECOVERY_UNAVAILABLE')
  }
}
