/** @jest-environment node */
import { redirectIfMfaRequired } from '../mfa-client'

const go = jest.fn()
const nav = { currentPath: () => '/settings/integrations?tab=coupang', go }

beforeEach(() => go.mockClear())

test('403 MFA_REQUIRED → 단계 인증 페이지로 이동하고 true', async () => {
  const res = new Response(JSON.stringify({ code: 'MFA_REQUIRED' }), { status: 403 })
  await expect(redirectIfMfaRequired(res, nav)).resolves.toBe(true)
  expect(go).toHaveBeenCalledWith('/auth/mfa?next=%2Fsettings%2Fintegrations%3Ftab%3Dcoupang')
})

test('다른 403·200 은 false, 이동 없음', async () => {
  await expect(redirectIfMfaRequired(new Response('{}', { status: 403 }), nav)).resolves.toBe(false)
  await expect(redirectIfMfaRequired(new Response('{}', { status: 200 }), nav)).resolves.toBe(false)
  expect(go).not.toHaveBeenCalled()
})

test('호출부가 본문을 다시 읽을 수 있다(clone 사용)', async () => {
  const res = new Response(JSON.stringify({ code: 'OTHER' }), { status: 403 })
  await redirectIfMfaRequired(res, nav)
  await expect(res.json()).resolves.toEqual({ code: 'OTHER' })
})
