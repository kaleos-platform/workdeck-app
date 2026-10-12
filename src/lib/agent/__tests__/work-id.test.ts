/** @jest-environment node */
import { normalizeWorkId, newWorkId } from '../work-id'

describe('workId', () => {
  it('클라이언트 값이 형식에 맞으면 그대로 쓴다', () => {
    expect(normalizeWorkId('slack:C1:1712.33')).toBe('slack:C1:1712.33')
  })
  it.each([[''], ['a b'], ['x'.repeat(101)], [123], [null]])('잘못된 값 %p → null', (v) => {
    expect(normalizeWorkId(v)).toBeNull()
  })
  it('발급 값은 wk_ 접두사', () => expect(newWorkId()).toMatch(/^wk_[0-9a-f-]{36}$/))
})
