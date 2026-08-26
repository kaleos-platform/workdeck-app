import { DEFAULT_KEYWORD_RULES } from '../keyword-rules'
import {
  fixForViolation,
  removeDecorativeChars,
  removeRepeatedToken,
  removeTerm,
} from '../keyword-fix'

describe('removeTerm', () => {
  it('지정한 표현을 지운다', () => {
    expect(removeTerm('모노홈 무료배송 호텔 타월', '무료배송')).toBe('모노홈 호텔 타월')
  })

  it('띄어쓰기로 회피한 형태도 함께 지운다', () => {
    expect(removeTerm('모노홈 무료 배송 타월', '무료 배송')).toBe('모노홈 타월')
  })

  it('정규식 메타문자가 든 표현도 그대로 처리한다', () => {
    expect(removeTerm('타월 1+1 세트', '1+1')).toBe('타월 세트')
  })
})

describe('removeRepeatedToken', () => {
  it('두 번째 이후 등장만 지운다', () => {
    expect(removeRepeatedToken('여성 팬티 모달 팬티 속옷 팬티', '팬티')).toBe('여성 팬티 모달 속옷')
  })
})

describe('removeDecorativeChars', () => {
  it('장식 문자를 지우고 공백을 정리한다', () => {
    expect(removeDecorativeChars('★특가★ 호텔 타월', DEFAULT_KEYWORD_RULES)).toBe('특가 호텔 타월')
  })
})

describe('fixForViolation', () => {
  it('반복 토큰 위반이면 그 토큰을 정리한다', () => {
    const fixed = fixForViolation(
      '여성 팬티 모달 팬티',
      {
        code: 'NAME_REPEATED_TOKEN',
        severity: 'WARN',
        keywordIndex: null,
        message: '반복',
        conflictWith: '팬티',
      },
      DEFAULT_KEYWORD_RULES
    )
    expect(fixed).toBe('여성 팬티 모달')
  })

  it('conflictWith 가 없으면 자동 수정하지 않는다', () => {
    const fixed = fixForViolation(
      '타월',
      { code: 'NAME_PROMO_TERM', severity: 'WARN', keywordIndex: null, message: '프로모션' },
      DEFAULT_KEYWORD_RULES
    )
    expect(fixed).toBeNull()
  })

  it('장식 문자가 실제로 없으면 자동 수정하지 않는다', () => {
    const fixed = fixForViolation(
      '타월 (대형)',
      { code: 'NAME_SPECIAL_CHARS', severity: 'WARN', keywordIndex: null, message: '특수문자' },
      DEFAULT_KEYWORD_RULES
    )
    expect(fixed).toBeNull()
  })

  it('길이 위반은 자동 수정 대상이 아니다', () => {
    const fixed = fixForViolation(
      '짧은 이름',
      { code: 'NAME_BELOW_TARGET', severity: 'INFO', keywordIndex: null, message: '짧음' },
      DEFAULT_KEYWORD_RULES
    )
    expect(fixed).toBeNull()
  })
})
