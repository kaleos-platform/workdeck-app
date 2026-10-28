import { keywordLimitForChannel } from '@/lib/sh/schemas'

describe('keywordLimitForChannel', () => {
  test.each([
    ['쿠팡', 20],
    ['쿠팡 로켓그로스', 20],
    ['스마트스토어', 30],
    [null, 30],
    [undefined, 30],
  ])('%s → %i', (name, limit) => {
    expect(keywordLimitForChannel(name)).toBe(limit)
  })
})
