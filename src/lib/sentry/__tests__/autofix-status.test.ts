/** @jest-environment node */
import { parseAutofixState, shouldWriteNote } from '../autofix-status'

const c = (text: string, dateCreated: string) => ({ text, dateCreated })

test('빈 목록·무관한 노트는 none', () => {
  expect(parseAutofixState([]).kind).toBe('none')
  expect(parseAutofixState([c('원인 확인 중', '2026-11-21T01:00:00Z')]).kind).toBe('none')
})

test('API 순서와 무관하게 가장 최근 autofix 노트를 쓴다', () => {
  const s = parseAutofixState([
    c('autofix:failed boom', '2026-11-21T03:00:00Z'),
    c('autofix:request', '2026-11-21T01:00:00Z'),
    c('잡담', '2026-11-21T05:00:00Z'),
  ])
  expect(s).toMatchObject({ kind: 'failed', reason: 'boom', at: '2026-11-21T03:00:00Z' })
})

test('pr URL 은 kaleos-platform GitHub 만 허용', () => {
  const ok = parseAutofixState([
    c('autofix:pr https://github.com/kaleos-platform/x/pull/1', '2026-11-21T01:00:00Z'),
  ])
  expect(ok).toMatchObject({ kind: 'pr', prUrl: 'https://github.com/kaleos-platform/x/pull/1' })
  const bad = parseAutofixState([c('autofix:pr https://evil.example/x', '2026-11-21T01:00:00Z')])
  expect(bad.kind).toBe('pr')
  expect(bad.prUrl).toBeUndefined()
})

test('running until 파싱, analysis 는 추가 텍스트 허용', () => {
  expect(
    parseAutofixState([
      c('autofix:running run=a1 until=2026-11-21T02:00:00Z', '2026-11-21T01:00:00Z'),
    ])
  ).toMatchObject({ kind: 'running', until: '2026-11-21T02:00:00Z' })
  expect(parseAutofixState([c('autofix:analysis\n원인은 ...', '2026-11-21T01:00:00Z')]).kind).toBe(
    'analysis'
  )
})

test('shouldWriteNote 는 같은 상태면 false', () => {
  expect(shouldWriteNote({ kind: 'request' }, 'request')).toBe(false)
  expect(shouldWriteNote({ kind: 'skip' }, 'skip')).toBe(false)
  expect(shouldWriteNote({ kind: 'none' }, 'request')).toBe(true)
  expect(shouldWriteNote({ kind: 'failed' }, 'skip')).toBe(true)
})
