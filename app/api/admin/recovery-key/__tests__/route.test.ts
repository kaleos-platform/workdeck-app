/** @jest-environment node */
import { NextResponse, type NextRequest } from 'next/server'
import { requireOperator } from '@/lib/admin/auth'
import { requireFreshAal2 } from '@/lib/auth/mfa'
import { getRecoveryKeyStatus, manageRecoveryKey, RecoveryKeyError } from '@/lib/admin/recovery-key'
import { GET, POST } from '../route'

jest.mock('@/lib/admin/auth', () => ({ requireOperator: jest.fn() }))
jest.mock('@/lib/auth/mfa', () => ({ requireFreshAal2: jest.fn() }))
jest.mock('@/lib/admin/recovery-key', () => ({
  getRecoveryKeyStatus: jest.fn(),
  manageRecoveryKey: jest.fn(),
  RecoveryKeyError: class extends Error {
    constructor(readonly code: string) {
      super(code)
    }
  },
}))
const state = {
  keyId: 'k1',
  stored: true,
  createdAt: '2026-10-27T00:00:00Z',
  lastVerifiedAt: null,
  sourceAvailable: true,
}
const request = (body: unknown, origin = 'https://admin.workdeck.work') =>
  new Request('https://admin.workdeck.work/api/admin/recovery-key', {
    method: 'POST',
    headers: { origin, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as NextRequest
beforeEach(() => {
  jest.clearAllMocks()
  ;(requireOperator as jest.Mock).mockResolvedValue({ ok: true, user: { id: 'op' } })
  ;(requireFreshAal2 as jest.Mock).mockResolvedValue(null)
  ;(getRecoveryKeyStatus as jest.Mock).mockResolvedValue(state)
  ;(manageRecoveryKey as jest.Mock).mockResolvedValue(state)
})
test('일반 계정/미로그인은 GET·POST에서 존재를 숨기며 Vault에 접근하지 않는다', async () => {
  ;(requireOperator as jest.Mock).mockResolvedValue({
    ok: false,
    response: NextResponse.json({}, { status: 404 }),
  })
  expect((await GET()).status).toBe(404)
  expect((await POST(request({ action: 'backup' }))).status).toBe(404)
  expect(getRecoveryKeyStatus).not.toHaveBeenCalled()
  expect(manageRecoveryKey).not.toHaveBeenCalled()
})
test('운영자 상태 조회는 no-store이고 metadata만 반환한다', async () => {
  const res = await GET()
  expect(res.headers.get('Cache-Control')).toBe('private, no-store')
  expect(await res.json()).toEqual(state)
})
test('MFA 비상 해제와 무관하게 실제 MFA 없이는 등록/검증하지 않는다', async () => {
  ;(requireFreshAal2 as jest.Mock).mockResolvedValue(
    NextResponse.json({ code: 'MFA_REQUIRED' }, { status: 403 })
  )
  const res = await POST(request({ action: 'backup' }))
  expect(res.status).toBe(403)
  expect(manageRecoveryKey).not.toHaveBeenCalled()
})
test.each(['https://attacker.example', 'null', ''])(
  'Origin %s는 변경을 거부한다',
  async (origin) => {
    expect((await POST(request({ action: 'backup' }, origin))).status).toBe(403)
    expect(manageRecoveryKey).not.toHaveBeenCalled()
  }
)
test.each([
  { action: 'reveal' },
  { action: 'backup', value: 'never-accept' },
  { action: 'backup', keyId: 'k2' },
])('허용 밖 요청은 키를 읽기 전에 거부한다: %j', async (body) => {
  expect((await POST(request(body))).status).toBe(400)
  expect(manageRecoveryKey).not.toHaveBeenCalled()
})
test('등록은 서버 세션의 운영자 ID와 고정 action으로만 수행한다', async () => {
  const res = await POST(request({ action: 'backup' }))
  expect(res.status).toBe(200)
  expect(manageRecoveryKey).toHaveBeenCalledWith('backup', 'op')
  expect(res.headers.get('Cache-Control')).toBe('private, no-store')
})
test('다른 사본이면 409이며 내부 오류/키를 반환하지 않는다', async () => {
  ;(manageRecoveryKey as jest.Mock).mockRejectedValue(new RecoveryKeyError('BACKUP_MISMATCH'))
  const res = await POST(request({ action: 'verify' }))
  expect(res.status).toBe(409)
  expect((await res.json()).code).toBe('BACKUP_MISMATCH')
})
test('미지 예외의 비밀 문자열을 응답에 포함하지 않는다', async () => {
  ;(getRecoveryKeyStatus as jest.Mock).mockRejectedValue(new Error('secret-from-driver'))
  const res = await GET()
  expect(res.status).toBe(503)
  expect(await res.text()).not.toContain('secret-from-driver')
})
