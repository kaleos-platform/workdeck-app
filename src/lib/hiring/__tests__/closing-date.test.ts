import { isHiringDeadlinePassed } from '../closing-date'
it('KST 마감 당일까지 접수를 허용하고 다음 날 마감한다', () => {
  const closing = new Date('2026-10-05T00:00:00Z')
  expect(isHiringDeadlinePassed(closing, new Date('2026-10-05T14:59:59Z'))).toBe(false)
  expect(isHiringDeadlinePassed(closing, new Date('2026-10-05T15:00:00Z'))).toBe(true)
  expect(isHiringDeadlinePassed(null)).toBe(false)
})
