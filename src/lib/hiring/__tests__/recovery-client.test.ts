import { verifyRecovery } from '../recovery-client'

afterEach(() => jest.restoreAllMocks())
it('쿠키 확인 성공 시에만 제출을 허용한다', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ status: 'ready' }) })
  await expect(verifyRecovery('session-id', 'post')).resolves.toBe(true)
  expect(fetch).toHaveBeenCalledWith(
    '/api/hiring-public/upload-sessions/recover/session-id',
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        uploadSessionId: 'session-id',
        postingUuid: 'post',
        action: 'verify',
      }),
    })
  )
})
it.each([403, 409, 503])('쿠키 확인이 %s이면 제출을 차단한다', async (status) => {
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status })
  await expect(verifyRecovery('session-id', 'post')).resolves.toBe(false)
})
