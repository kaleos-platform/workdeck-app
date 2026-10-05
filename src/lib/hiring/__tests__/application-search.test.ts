/** @jest-environment node */
import { buildApplicantSearchToken, applicantSearchWhere } from '../application-search'
import { hmacHash } from '../pii'

beforeAll(() => {
  process.env.HIRING_HMAC_KEY = 'ab'.repeat(32)
})
it('이름은 정규화한 HMAC으로 검색하며 원문을 토큰에 남기지 않는다', () => {
  const token = buildApplicantSearchToken(' 홍길동 ')
  expect(token).not.toContain('홍길동')
  expect(applicantSearchWhere(token)).toEqual({ OR: [{ nameHash: hmacHash('홍길동') }] })
})
it('전화번호 구분자를 정규화하고 전체 번호를 끝자리로 확대하지 않는다', () => {
  expect(applicantSearchWhere(buildApplicantSearchToken('010-1234-5678'))).toEqual({
    OR: [{ nameHash: hmacHash('010-1234-5678') }, { phoneHash: hmacHash('01012345678') }],
  })
})
it('4자리 입력만 전화번호 끝자리 검색에 사용한다', () => {
  expect(applicantSearchWhere(buildApplicantSearchToken('5678'))).toEqual({
    OR: [{ nameHash: hmacHash('5678') }, { phoneLastDigitsHash: hmacHash('5678') }],
  })
})
it('빈 검색은 해제하고 잘못된 토큰은 전체 조회로 확대하지 않는다', () => {
  expect(buildApplicantSearchToken('  ')).toBe('')
  expect(applicantSearchWhere('')).toEqual({})
  expect(applicantSearchWhere('invalid')).toEqual({ id: { in: [] } })
  expect(() => buildApplicantSearchToken('a'.repeat(201))).toThrow()
})

it('정상 토큰 뒤에 개행이 붙어도 잘못된 검색으로 처리한다', () => {
  expect(applicantSearchWhere('a'.repeat(64) + '\n')).toEqual({ id: { in: [] } })
})
