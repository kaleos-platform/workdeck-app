/** @jest-environment node */

import { measureCoupangAds, withCoupangAdsTiming } from '../server-timing'

test('요청별 측정을 분리하고 기존 응답 상태와 헤더를 유지한다', async () => {
  let release!: () => void
  const barrier = new Promise<void>((resolve) => {
    release = resolve
  })
  const first = withCoupangAdsTiming(async () => {
    await measureCoupangAds('auth', async () => barrier)
    return new Response('denied', { status: 401, headers: { 'x-existing': 'yes' } })
  })
  const second = await withCoupangAdsTiming(async () => {
    await measureCoupangAds('data', async () => 42)
    return new Response('ok')
  })
  release()
  const response = await first
  expect(response.status).toBe(401)
  expect(response.headers.get('x-existing')).toBe('yes')
  expect(response.headers.get('server-timing')).toMatch(/auth;dur=\d+\.\d, total;dur=\d+\.\d/)
  expect(response.headers.get('server-timing')).not.toContain('data;')
  expect(second.headers.get('server-timing')).toContain('data;dur=')
  expect(second.headers.get('server-timing')).not.toContain('auth;')
})

test('측정 범위 밖 결과와 오류를 그대로 전달한다', async () => {
  expect(await measureCoupangAds('data', async () => 42)).toBe(42)
  const error = new Error('failed')
  await expect(
    withCoupangAdsTiming(async () => {
      await measureCoupangAds('data', async () => {
        throw error
      })
      return new Response()
    })
  ).rejects.toBe(error)
})

test('처리된 실패의 시간도 기록한다', async () => {
  const response = await withCoupangAdsTiming(async () => {
    try {
      await measureCoupangAds('data', async () => {
        throw new Error('private')
      })
    } catch {
      return new Response('failed', { status: 500 })
    }
    return new Response()
  })
  expect(response.status).toBe(500)
  expect(response.headers.get('server-timing')).toContain('data;dur=')
  expect(response.headers.get('server-timing')).not.toContain('private')
})
