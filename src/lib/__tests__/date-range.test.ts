import { parseYmdDateKst } from '@/lib/date-range'

describe('parseYmdDateKst', () => {
  test('KST 자정을 UTC 시각으로 변환한다', () => {
    expect(parseYmdDateKst('2026-09-24')?.toISOString()).toBe('2026-09-23T15:00:00.000Z')
  })

  test.each(['2026-02-30', '2026-13-01', '2026-9-24', 'invalid'])(
    '유효하지 않은 날짜 %s를 거부한다',
    (value) => {
      expect(parseYmdDateKst(value)).toBeNull()
    }
  )
})
