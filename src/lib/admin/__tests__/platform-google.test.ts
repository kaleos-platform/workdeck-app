/** @jest-environment node */
import { decryptField } from '@/lib/crypto/field-crypto'
import { prisma } from '@/lib/prisma'
import { writeAuditLog } from '@/lib/admin/auth'
import {
  PLATFORM_SCOPES,
  readPlatformGoogle,
  registerPlatformGoogle,
  writePlatformGoogleIf,
} from '../platform-google'

jest.mock('server-only', () => ({}))
jest.mock('@/lib/admin/auth', () => ({ writeAuditLog: jest.fn() }))

const tx = { platformCredential: { updateMany: jest.fn(), create: jest.fn() }, adminAuditLog: {} }
jest.mock('@/lib/prisma', () => ({
  prisma: {
    platformCredential: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  },
}))

const findUnique = prisma.platformCredential.findUnique as unknown as jest.Mock
const transaction = prisma.$transaction as unknown as jest.Mock
const audit = writeAuditLog as unknown as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  process.env.ENCRYPTION_KEY_V1 = 'a'.repeat(64)
  transaction.mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx))
  tx.platformCredential.updateMany.mockResolvedValue({ count: 1 })
  tx.platformCredential.create.mockResolvedValue({ id: 'new' })
})

function dbRow(plain: { secret: object; config: object }) {
  // 실제 암호화 경로로 행 생성
  const { encryptField } = jest.requireActual('@/lib/crypto/field-crypto')
  const { encrypted, iv } = encryptField('platform-credential', JSON.stringify(plain.secret))
  return { id: 'row1', encryptedPayload: encrypted, iv, config: plain.config, lastError: null }
}

describe('registerPlatformGoogle', () => {
  test('최초 create: credVersion 1, needs_auth, 감사 로그를 같은 transaction 에 기록', async () => {
    findUnique.mockResolvedValue(null)
    const r = await registerPlatformGoogle(
      { clientId: 'cid', clientSecret: 'sec', propertyId: '412345678', streamId: '9876543210' },
      'op1'
    )
    expect(r).toBe('ok')
    const data = tx.platformCredential.create.mock.calls[0][0].data
    expect(data.config).toMatchObject({
      credVersion: 1,
      status: 'needs_auth',
      propertyId: '412345678',
    })
    expect(data.iv).toBe('v1') // 평문이 아니라 v1 암호문
    expect(JSON.stringify(data)).not.toContain('sec"')
    expect(decryptField('platform-credential', data.encryptedPayload, data.iv)).toContain('"cid"')
    expect(audit).toHaveBeenCalledWith(
      'op1',
      'platform.google.save',
      'platformCredential',
      'new',
      expect.not.objectContaining({ clientSecret: expect.anything() }),
      tx
    )
    const meta = JSON.stringify(audit.mock.calls[0][4])
    expect(meta).not.toContain('sec')
    expect(meta).not.toContain('cid')
  })

  test('최초 create 동시 충돌(P2002)이면 conflict', async () => {
    findUnique.mockResolvedValue(null)
    transaction.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: 'P2002' }))
    expect(
      await registerPlatformGoogle(
        { clientId: 'c', clientSecret: 's', propertyId: '1', streamId: '2' },
        'op'
      )
    ).toBe('conflict')
  })

  test('조건부 0행이면 conflict(409 대상)이고 감사 로그도 쓰지 않는다', async () => {
    findUnique.mockResolvedValue(
      dbRow({
        secret: { clientId: 'c', clientSecret: 's', refreshToken: 'r' },
        config: {
          propertyId: '1',
          streamId: '2',
          status: 'connected',
          scopes: PLATFORM_SCOPES,
          credVersion: 3,
        },
      })
    )
    tx.platformCredential.updateMany.mockResolvedValue({ count: 0 })
    expect(
      await registerPlatformGoogle({ clientId: 'c', propertyId: '1', streamId: '2' }, 'op')
    ).toBe('conflict')
    expect(audit).not.toHaveBeenCalled()
    expect(tx.platformCredential.updateMany.mock.calls[0][0].where.config).toEqual({
      path: ['credVersion'],
      equals: 3,
    })
  })

  test('같은 clientId·같은 대상이면 토큰·상태 유지(시크릿 생략 가능), 버전 +1', async () => {
    findUnique.mockResolvedValue(
      dbRow({
        secret: { clientId: 'c', clientSecret: 's', refreshToken: 'r' },
        config: {
          propertyId: '1',
          streamId: '2',
          status: 'connected',
          connectedAt: 't',
          scopes: PLATFORM_SCOPES,
          credVersion: 3,
        },
      })
    )
    expect(
      await registerPlatformGoogle({ clientId: 'c', propertyId: '1', streamId: '2' }, 'op')
    ).toBe('ok')
    const data = tx.platformCredential.updateMany.mock.calls[0][0].data
    expect(data.config).toMatchObject({ status: 'connected', credVersion: 4 })
    expect(JSON.parse(decryptField('platform-credential', data.encryptedPayload, data.iv))).toEqual(
      {
        clientId: 'c',
        clientSecret: 's',
        refreshToken: 'r',
      }
    )
  })

  test('clientId 가 바뀌면 refresh token 을 제거하고 needs_auth', async () => {
    findUnique.mockResolvedValue(
      dbRow({
        secret: { clientId: 'c', clientSecret: 's', refreshToken: 'r' },
        config: {
          propertyId: '1',
          streamId: '2',
          status: 'connected',
          scopes: PLATFORM_SCOPES,
          credVersion: 1,
        },
      })
    )
    expect(
      await registerPlatformGoogle(
        { clientId: 'c2', clientSecret: 's2', propertyId: '1', streamId: '2' },
        'op'
      )
    ).toBe('ok')
    const data = tx.platformCredential.updateMany.mock.calls[0][0].data
    expect(data.config).toMatchObject({ status: 'needs_auth' })
    expect(decryptField('platform-credential', data.encryptedPayload, data.iv)).not.toContain(
      'refreshToken'
    )
  })

  test.each([
    ['속성', { propertyId: '9', streamId: '2' }],
    ['스트림', { propertyId: '1', streamId: '9' }],
  ])('%s 가 바뀌면 needs_check', async (_n, change) => {
    findUnique.mockResolvedValue(
      dbRow({
        secret: { clientId: 'c', clientSecret: 's', refreshToken: 'r' },
        config: {
          propertyId: '1',
          streamId: '2',
          status: 'connected',
          scopes: PLATFORM_SCOPES,
          credVersion: 1,
        },
      })
    )
    await registerPlatformGoogle({ clientId: 'c', ...change }, 'op')
    expect(tx.platformCredential.updateMany.mock.calls[0][0].data.config).toMatchObject({
      status: 'needs_check',
    })
  })

  test('새 행인데 시크릿이 없으면 secret_required', async () => {
    findUnique.mockResolvedValue(null)
    expect(
      await registerPlatformGoogle({ clientId: 'c', propertyId: '1', streamId: '2' }, 'op')
    ).toBe('secret_required')
  })
})

describe('감사 transaction', () => {
  test('writeAuditLog 가 실패하면 transaction 이 reject 되어 자격증명 변경도 롤백된다', async () => {
    findUnique.mockResolvedValue(
      dbRow({
        secret: { clientId: 'c', clientSecret: 's' },
        config: { propertyId: '1', streamId: '2', status: 'needs_auth', credVersion: 1 },
      })
    )
    audit.mockRejectedValueOnce(new Error('audit down'))
    // 실제 DB transaction 처럼: 콜백이 throw 하면 전체가 reject (변경은 커밋되지 않는다)
    await expect(
      registerPlatformGoogle({ clientId: 'c', propertyId: '1', streamId: '3' }, 'op')
    ).rejects.toThrow('audit down')
    // updateMany 와 audit 이 같은 tx 객체로 호출됐다(별도 클라이언트 아님)
    expect(audit.mock.calls[0][5]).toBe(tx)
    expect(transaction).toHaveBeenCalledTimes(1)
  })

  test('readPlatformGoogle: 없으면 null', async () => {
    findUnique.mockResolvedValue(null)
    expect(await readPlatformGoogle()).toBeNull()
  })

  test('writePlatformGoogleIf 는 0행이면 false', async () => {
    tx.platformCredential.updateMany.mockResolvedValue({ count: 0 })
    const row = {
      id: 'r',
      lastError: null,
      secret: { clientId: 'c', clientSecret: 's' },
      config: { propertyId: '1', streamId: '2', status: 'needs_auth' as const, credVersion: 2 },
    }
    expect(
      await writePlatformGoogleIf(
        row,
        row.secret,
        { propertyId: '1', streamId: '2', status: 'needs_auth' },
        {
          actorUserId: 'op',
          action: 'x',
        }
      )
    ).toBe(false)
  })
})
