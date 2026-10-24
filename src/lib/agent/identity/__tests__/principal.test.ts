import { parseScopes } from '../principal'

describe('parseScopes', () => {
  it('secret:env는 유효한 scope다', () => {
    expect(parseScopes(['secret:env'])).toEqual(['secret:env'])
  })
})
