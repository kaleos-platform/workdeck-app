import { render } from '@testing-library/react'
import { SpaceFetchGuard } from '../space-fetch-guard'

// 패치는 모듈당 한 번 — 원본 mock 을 먼저 심고 가드를 마운트한다.
const original = jest.fn(async (...args: unknown[]) => ({ ok: args.length >= 0 }))
window.fetch = original as unknown as typeof fetch
const mount = (id: string | null) => render(<SpaceFetchGuard spaceId={id} />)

const sentHeaders = () => new Headers((original.mock.calls.at(-1)?.[1] as RequestInit)?.headers)
beforeEach(() => {
  original.mockClear()
  mount('sp-a')
})

it('same-origin /api/ POST → 헤더 부착, 기존 헤더 보존', async () => {
  await fetch('/api/x', { method: 'POST', headers: { 'content-type': 'application/json' } })
  expect(sentHeaders().get('x-wd-space')).toBe('sp-a')
  expect(sentHeaders().get('content-type')).toBe('application/json')
})

it('GET 은 부착 안 함', async () => {
  await fetch('/api/x')
  expect(original.mock.calls[0][1]).toBeUndefined()
})

it('교차 출처 POST 는 부착 안 함', async () => {
  await fetch('https://abc.supabase.co/api/x', { method: 'POST' })
  expect(original.mock.calls[0][1]).toEqual({ method: 'POST' })
})

it('/api/ 밖 경로는 부착 안 함', async () => {
  await fetch('/other', { method: 'POST' })
  expect(original.mock.calls[0][1]).toEqual({ method: 'POST' })
})

it('이미 있는 x-wd-space 는 덮지 않음', async () => {
  await fetch('/api/x', { method: 'DELETE', headers: { 'x-wd-space': 'mine' } })
  expect(sentHeaders().get('x-wd-space')).toBe('mine')
})

it('spaceId null 이면 부착 안 함', async () => {
  mount(null)
  await fetch('/api/x', { method: 'POST' })
  expect(original.mock.calls[0][1]).toEqual({ method: 'POST' })
})
