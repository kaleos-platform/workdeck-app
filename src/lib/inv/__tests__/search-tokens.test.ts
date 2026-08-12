import { tokenizeProductName } from '../search-tokens'

describe('tokenizeProductName', () => {
  it('공백·슬래시로 분리하고 순서를 보존한다', () => {
    expect(tokenizeProductName('임산부 텐셀 모달 브이 팬티 1장 / 블랙 XL')).toEqual([
      '임산부',
      '텐셀',
      '모달',
      '브이',
      '팬티',
      '1장',
      '블랙',
      'XL',
    ])
  })

  it('괄호·쉼표·하이픈도 구분자로 처리한다', () => {
    expect(tokenizeProductName('세트(3입), 화이트-L')).toEqual(['세트', '3입', '화이트', 'L'])
  })

  it('중복 토큰은 대소문자 무시하고 제거한다', () => {
    expect(tokenizeProductName('BLACK black 팬티 팬티')).toEqual(['BLACK', '팬티'])
  })

  it('빈 문자열이면 빈 배열', () => {
    expect(tokenizeProductName('   ')).toEqual([])
  })

  it('토큰이 아무리 많아도 12개까지만 반환한다', () => {
    const raw = Array.from({ length: 20 }, (_, i) => `t${i}`).join(' ')
    expect(tokenizeProductName(raw)).toHaveLength(12)
  })
})
