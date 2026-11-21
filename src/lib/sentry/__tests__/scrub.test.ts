/** @jest-environment node */
import type { ErrorEvent } from '@sentry/nextjs'
import { scrubBreadcrumb, scrubEvent, scrubText } from '../scrub'

const ev = (e: Record<string, unknown>) => e as unknown as ErrorEvent

test('Error 메시지의 이메일·전화 마스킹, vars 제거', () => {
  const err = new Error('실패 a@b.com 010-1234-5678')
  const out = scrubEvent(
    ev({
      exception: {
        values: [
          { type: 'Error', value: err.message, stacktrace: { frames: [{ vars: { x: 1 } }] } },
        ],
      },
    })
  )
  const v = out.exception!.values![0]
  expect(v.value).toBe('실패 [redacted] [redacted]')
  expect(v.stacktrace!.frames![0].vars).toBeUndefined()
})

test('extra 제거, request 제거·transaction 유지, user 는 id 만', () => {
  const out = scrubEvent(
    ev({
      extra: { nested: { a: { b: 'secret' } } },
      request: { url: 'https://x/y?token=1', headers: { cookie: 'a' } },
      transaction: '/d/[id]',
      tags: { transaction: '/d/[id]', url: 'https://x', environment: 'production' },
      user: { id: 'u1', email: 'a@b.com' },
      contexts: { os: {}, device: { name: 'x' } },
    })
  )
  expect(out.extra).toBeUndefined()
  expect(out.request).toBeUndefined()
  expect(out.transaction).toBe('/d/[id]')
  expect(out.tags).toEqual({ transaction: '/d/[id]', environment: 'production' })
  expect(out.user).toEqual({ id: 'u1' })
  expect(Object.keys(out.contexts!)).toEqual(['os'])
})

test('JWT·Bearer·sntryu_ 토큰 마스킹', () => {
  expect(scrubText('t eyJhbGci.eyJzdWIi.sig_1-x')).toBe('t [redacted]')
  expect(scrubText('Authorization: Bearer abc.def-123')).toBe('Authorization: [redacted]')
  expect(scrubText('key sntryu_abcDEF123')).toBe('key [redacted]')
})

test('주민번호·사업자번호·카드·긴 숫자 마스킹', () => {
  expect(scrubText('900101-1234567')).toBe('[redacted]')
  expect(scrubText('123-45-67890')).toBe('[redacted]')
  expect(scrubText('4111 1111 1111 1111')).toBe('[redacted]')
  expect(scrubText('acct 1234567890123')).toBe('acct [redacted]')
})

test('console 문자열 전용 이벤트: 첫 인자(라벨)만 남고 extra 제거', () => {
  const out = scrubEvent(
    ev({
      logger: 'console',
      message: '[upload] failed {"name":"홍길동","addr":"서울시 강남구"}',
      extra: { arguments: ['[upload] failed', '{"name":"홍길동","addr":"서울시 강남구"}'] },
    })
  )
  expect(out.message).toBe('[upload] failed')
  expect(out.extra).toBeUndefined()
})

test('console 이벤트의 첫 인자가 문자열이 아니면 첫 줄/{ 앞까지만', () => {
  const out = scrubEvent(
    ev({ logger: 'console', message: 'label\n홍길동', extra: { arguments: [{ a: 1 }, 'x'] } })
  )
  expect(out.message).toBe('label')
})

test('console 이벤트라도 exception 이 있으면 유지(스크럽만)', () => {
  const out = scrubEvent(
    ev({
      logger: 'console',
      message: 'x',
      exception: { values: [{ type: 'Error', value: 'boom a@b.com' }] },
      extra: { arguments: [new Error('boom')] },
    })
  )
  expect(out.exception!.values![0].value).toBe('boom [redacted]')
  expect(out.message).toBe('x')
  expect(out.extra).toBeUndefined()
})

test('300자 절단, breadcrumb data 제거·message 스크럽', () => {
  expect(scrubText('a'.repeat(500))).toHaveLength(300)
  expect(scrubBreadcrumb({ message: 'a@b.com', data: { x: 1 } })).toEqual({ message: '[redacted]' })
})

test('console 브레드크럼은 첫 인자(라벨)만 남긴다', () => {
  const detail = JSON.stringify({ name: '홍길동', address: '서울시 강남구 테헤란로 1' })
  const out = scrubBreadcrumb({
    category: 'console',
    message: `업로드 오류: ${detail}`,
    data: { arguments: ['업로드 오류:', detail], logger: 'console' },
  })
  expect(out).toEqual({ category: 'console', message: '업로드 오류:' })
})
