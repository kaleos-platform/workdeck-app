/** @jest-environment node */
// 모든 도구가 scope를 선언하고, mode와 scope 접미사가 맞는지 확인한다(새 도구 추가 시 자동 검사).
jest.mock('@/lib/prisma', () => ({ prisma: {} }))
import { toolDefinitions } from '../index'

describe('도구 scope 계약', () => {
  it('whoami만 scope가 null이다', () => {
    const nulls = toolDefinitions.filter((t) => t.scope === null).map((t) => t.name)
    expect(nulls).toEqual(['whoami'])
  })
  it.each(toolDefinitions.filter((t) => t.scope !== null).map((t) => [t.name, t] as const))(
    '%s: write면 :write, read면 :read',
    (_n, t) => {
      expect(t.scope!.endsWith(t.mode === 'write' ? ':write' : ':read')).toBe(true)
    }
  )
  it('승인·실행 도구를 MCP에 노출하지 않는다(승인은 구성원만)', () => {
    const names = toolDefinitions.map((t) => t.name)
    expect(names.filter((n) => /approve_action|execute_approved/.test(n))).toEqual([])
  })
})
