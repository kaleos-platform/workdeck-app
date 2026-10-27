/** @jest-environment node */
import { recoveryPrisma as prisma } from '../recovery-db'
import { getRecoveryKeyStatus, manageRecoveryKey } from '../recovery-key'

jest.mock('server-only', () => ({}))
jest.mock('../recovery-db', () => ({
  recoveryPrisma: {
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
    adminAuditLog: { findFirst: jest.fn() },
  },
}))

const source = 'ab'.repeat(32)
const at = new Date('2026-10-27T00:00:00Z')
const row = { id: 'vault-id', createdAt: at }
const query = jest.fn()
const audit = jest.fn()
const tx = { $queryRaw: query, adminAuditLog: { create: audit } }
let stored: string | null
let committed: string | null

beforeEach(() => {
  jest.clearAllMocks()
  process.env.ENCRYPTION_KEY_V1 = source
  stored = null
  committed = null
  audit.mockResolvedValue({ createdAt: at })
  ;(prisma.adminAuditLog.findFirst as jest.Mock).mockResolvedValue(null)
  query.mockImplementation(async (sql: TemplateStringsArray, ...values: unknown[]) => {
    const text = sql.join('?')
    if (text.includes('current_setting'))
      return [
        {
          statement: 'ddl',
          minDuration: '-1',
          sampleDuration: '-1',
          sampleRate: '0',
          duration: 'off',
          auditParameters: 'off',
        },
      ]
    if (text.includes('vault.create_secret')) {
      stored = values[0] as string
      return [{ id: row.id }]
    }
    if (text.includes('vault.decrypted_secrets')) return stored ? [{ value: stored }] : []
    return stored ? [row] : []
  })
  ;(prisma.$queryRaw as jest.Mock).mockImplementation(query)
  ;(prisma.$transaction as jest.Mock).mockImplementation(
    async (run: (c: typeof tx) => Promise<unknown>) => {
      const prior = stored
      try {
        const result = await run(tx)
        committed = stored
        return result
      } catch (error) {
        stored = prior
        throw error
      }
    }
  )
})

afterEach(() => {
  delete process.env.ENCRYPTION_KEY_V1
})

test('미보관 조회는 metadata만 읽고 비밀값을 반환하지 않는다', async () => {
  const status = await getRecoveryKeyStatus()
  expect(status).toEqual({
    keyId: 'k1',
    stored: false,
    createdAt: null,
    lastVerifiedAt: null,
    sourceAvailable: true,
  })
  expect(JSON.stringify(status)).not.toContain(source)
  expect(
    query.mock.calls.every(
      ([sql]) => !(sql as TemplateStringsArray).join('').includes('decrypted_secrets')
    )
  ).toBe(true)
})

test('최초 등록은 같은 transaction의 감사 후 저장하고 실제 읽은 사본을 검증한다', async () => {
  const status = await manageRecoveryKey('backup', 'operator')
  expect(committed).toBe(source)
  expect(status.stored).toBe(true)
  expect(status.lastVerifiedAt).toBe(at.toISOString())
  expect(audit.mock.invocationCallOrder[0]).toBeLessThan(query.mock.invocationCallOrder[0])
  expect(
    query.mock.calls.some(([sql]) =>
      (sql as TemplateStringsArray).join('').includes('decrypted_secrets')
    )
  ).toBe(true)
  expect(JSON.stringify(status)).not.toContain(source)
})

test('같은 키 재등록은 추가 생성 없이 재검증한다', async () => {
  stored = source
  await manageRecoveryKey('backup', 'operator')
  expect(
    query.mock.calls.some(([sql]) =>
      (sql as TemplateStringsArray).join('').includes('create_secret')
    )
  ).toBe(false)
})

test('현재 키와 다른 사본은 덮어쓰지 않고 충돌을 반환한다', async () => {
  stored = 'cd'.repeat(32)
  await expect(manageRecoveryKey('backup', 'operator')).rejects.toThrow('BACKUP_MISMATCH')
  expect(stored).toBe('cd'.repeat(32))
  expect(
    query.mock.calls.some(([sql]) =>
      (sql as TemplateStringsArray).join('').includes('create_secret')
    )
  ).toBe(false)
})

test('검증은 미보관 값을 생성하지 않는다', async () => {
  await expect(manageRecoveryKey('verify', 'operator')).rejects.toThrow('BACKUP_MISSING')
  expect(stored).toBeNull()
})

test('실제 저장된 값이 손상되면 성공으로 기록하지 않는다', async () => {
  stored = 'corrupted'
  await expect(manageRecoveryKey('verify', 'operator')).rejects.toThrow('BACKUP_MISMATCH')
  expect(audit.mock.calls.some(([arg]) => arg.data.action === 'recovery-key.verify')).toBe(false)
})

test('감사 시작 실패면 Vault를 읽거나 쓰지 않는다', async () => {
  audit.mockRejectedValue(new Error('audit unavailable'))
  await expect(manageRecoveryKey('backup', 'operator')).rejects.toThrow('RECOVERY_UNAVAILABLE')
  expect(query).not.toHaveBeenCalled()
})

test('성공 감사 실패면 Vault 신규 사본도 rollback한다', async () => {
  audit.mockResolvedValueOnce({ createdAt: at }).mockRejectedValueOnce(new Error('audit failed'))
  await expect(manageRecoveryKey('backup', 'operator')).rejects.toThrow('RECOVERY_UNAVAILABLE')
  expect(stored).toBeNull()
  expect(committed).toBeNull()
})

test('runtime 키가 없거나 잘못되면 저장/조회 없이 차단한다', async () => {
  delete process.env.ENCRYPTION_KEY_V1
  await expect(manageRecoveryKey('backup', 'operator')).rejects.toThrow('RUNTIME_KEY_UNAVAILABLE')
  expect(prisma.$transaction).not.toHaveBeenCalled()
})

test('DB 예외에 키가 포함되어도 고정 오류만 전달한다', async () => {
  query.mockRejectedValue(new Error(source))
  await expect(manageRecoveryKey('backup', 'operator')).rejects.toThrow('RECOVERY_UNAVAILABLE')
})

test('parameter 로깅 가능한 DB 설정이면 키가 담긴 query를 실행하지 않는다', async () => {
  const normal = query.getMockImplementation()!
  query.mockImplementation(async (sql: TemplateStringsArray, ...values: unknown[]) => {
    if (sql.join('').includes('current_setting'))
      return [
        {
          statement: 'all',
          minDuration: '-1',
          sampleDuration: '-1',
          sampleRate: '0',
          duration: 'off',
          auditParameters: 'off',
        },
      ]
    return normal(sql, ...values)
  })
  await expect(manageRecoveryKey('backup', 'operator')).rejects.toThrow('RECOVERY_UNAVAILABLE')
  expect(
    query.mock.calls.some(([sql]) =>
      (sql as TemplateStringsArray).join('').includes('create_secret')
    )
  ).toBe(false)
})
