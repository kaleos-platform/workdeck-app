import { fillMessage, normalizeSmsPhone } from '../message-template'

it('변수를 치환하고 없는 값은 빈 문자열로 둔다', () => {
  expect(
    fillMessage('{이름}님 {공고명}/{직무} {이름}', { name: '홍길동', postingTitle: '홀 모집' })
  ).toBe('홍길동님 홀 모집/ 홍길동')
})

it('빈 변수가 남긴 겹친 공백을 하나로 줄인다', () => {
  expect(fillMessage('{공고명} {직무} 지원서', { postingTitle: '홀 모집' })).toBe('홀 모집 지원서')
  expect(fillMessage('첫 줄\n둘째 줄', {})).toBe('첫 줄\n둘째 줄')
})

it.each([
  ['010-1234-5678', '01012345678'],
  ['02) 123-4567', '021234567'],
  ['123', null],
  ['010123456789', null],
  [null, null],
])('전화번호 정규화 %s', (input, expected) => {
  expect(normalizeSmsPhone(input)).toBe(expected)
})
