import {
  ALL_SCOPES,
  canPostSlack,
  isDeckWriteScope,
  parseScopes,
  parseStoredScopes,
} from '../principal'

const LEGACY = ['draft:create', 'slack:write', 'browser:read', 'browser:write']

describe('parseScopes', () => {
  it('secret:env는 유효한 scope다', () => {
    expect(parseScopes(['secret:env'])).toEqual(['secret:env'])
  })
  it.each(LEGACY)('폐지된 scope %s 는 새 입력으로 거부한다', (s) => {
    expect(() => parseScopes([s])).toThrow('알 수 없는 scope')
    expect(ALL_SCOPES).not.toContain(s)
  })
})

describe('parseStoredScopes', () => {
  it('저장된 폐지 scope 4개는 조용히 버리고 나머지는 남긴다', () => {
    expect(parseStoredScopes([...LEGACY, 'sellerhub:write', 'sellerhub:write'])).toEqual([
      'sellerhub:write',
    ])
  })
  it('폐지가 아닌 모르는 값은 여전히 거부한다', () => {
    expect(() => parseStoredScopes(['root:all'])).toThrow('알 수 없는 scope')
  })
})

describe('isDeckWriteScope / canPostSlack', () => {
  it('업무 *:write 만 deck 쓰기이고 secret:* 는 아니다', () => {
    expect(isDeckWriteScope('hiring:write')).toBe(true)
    expect(isDeckWriteScope('sellerhub:read')).toBe(false)
    expect(isDeckWriteScope('secret:write')).toBe(false)
    expect(isDeckWriteScope('secret:env')).toBe(false)
  })
  it('agent·integration·user + 업무 쓰기 scope 만 허용, system 은 거부', () => {
    const w = ['ads:write'] as const
    expect(canPostSlack({ actor: { type: 'agent', id: 'a' }, scopes: w })).toBe(true)
    expect(canPostSlack({ actor: { type: 'integration', id: 'a' }, scopes: w })).toBe(true)
    expect(canPostSlack({ actor: { type: 'agent', id: 'a' }, scopes: ['ads:read'] })).toBe(false)
    expect(
      canPostSlack({ actor: { type: 'system', id: 'workdeck-agent' }, scopes: ALL_SCOPES })
    ).toBe(false)
    expect(canPostSlack({ actor: { type: 'user', id: 'u' }, scopes: ALL_SCOPES })).toBe(true)
  })
})
