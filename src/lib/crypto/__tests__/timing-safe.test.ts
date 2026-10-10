/** @jest-environment node */
import { timingSafeEqualString } from '../timing-safe'

test('같으면 true, 다르거나 길이가 다르면 false', () => {
  expect(timingSafeEqualString('abc', 'abc')).toBe(true)
  expect(timingSafeEqualString('abc', 'abd')).toBe(false)
  expect(timingSafeEqualString('abc', 'abcd')).toBe(false)
})
