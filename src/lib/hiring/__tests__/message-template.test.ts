import {
  fillMessage,
  formatPhone,
  normalizeSmsPhone,
  textToDoc,
  docToText,
} from '../message-template'

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

describe('textToDoc / docToText 왕복', () => {
  it.each([
    [''],
    ['안녕'],
    ['{이름}'],
    ['{이름}{공고명}{직무}'],
    ['{이름}님\n\n{공고명}'],
    ['끝 줄바꿈\n'],
    ['\n\n'],
    ['{기타} 는 {이름} 과 다름'],
    ['{이름'],
  ])('%j', (text) => {
    expect(docToText(textToDoc(text))).toBe(text)
  })

  it('토큰은 노드, 알 수 없는 {기타}는 텍스트, 빈 줄은 빈 문단', () => {
    const doc = textToDoc('{이름}{기타}\n')
    expect(doc.content).toEqual([
      {
        type: 'paragraph',
        content: [
          { type: 'messageVariable', attrs: { key: '이름' } },
          { type: 'text', text: '{기타}' },
        ],
      },
      { type: 'paragraph' },
    ])
  })

  it('hardBreak도 줄바꿈으로 직렬화', () => {
    expect(
      docToText({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'a' },
              { type: 'hardBreak' },
              { type: 'text', text: 'b' },
            ],
          },
        ],
      })
    ).toBe('a\nb')
  })
})

it('휴대폰은 하이픈 형식으로 보여 주고 다른 형식은 그대로 둔다', () => {
  expect(formatPhone('01000001007')).toBe('010-0000-1007')
  expect(formatPhone('011-123-4567')).toBe('011-123-4567')
  expect(formatPhone('0212345678')).toBe('0212345678')
  expect(formatPhone(null)).toBeNull()
})
