// channel-profiles + channel-schemas 단위 테스트.
// Prisma 연결 없이 순수 로직만 검증.

import { DEFAULT_PROFILES, type FormatProfile } from '../channel-profiles'
import {
  formatProfileSchema,
  createChannelBodySchema,
  updateChannelBodySchema,
} from '../channel-schemas'

// ─── DEFAULT_PROFILES ────────────────────────────────────────────────────────

describe('DEFAULT_PROFILES', () => {
  const platforms = ['NAVER_BLOG', 'TISTORY', 'OWN_HOMEPAGE'] as const

  test.each(platforms)('%s 프로필이 존재하고 필수 필드를 갖는다', (platform) => {
    const profile = DEFAULT_PROFILES[platform]
    expect(profile).toBeDefined()
    expect(typeof profile.toneGuide).toBe('string')
    expect(typeof profile.structureGuide).toBe('string')
    expect(typeof profile.ctaStyle).toBe('string')
    expect(typeof profile.headingStyle).toBe('string')
    expect(Array.isArray(profile.forbiddenExpressions)).toBe(true)
    expect(typeof profile.lengthRange.min).toBe('number')
    expect(typeof profile.lengthRange.max).toBe('number')
    expect(profile.lengthRange.min).toBeGreaterThanOrEqual(0)
    expect(profile.lengthRange.max).toBeGreaterThanOrEqual(profile.lengthRange.min)
  })

  test('OWN_HOMEPAGE는 passthrough=true이다', () => {
    expect(DEFAULT_PROFILES.OWN_HOMEPAGE.passthrough).toBe(true)
  })

  test('NAVER_BLOG과 TISTORY는 passthrough가 false이다', () => {
    expect(DEFAULT_PROFILES.NAVER_BLOG.passthrough).toBe(false)
    expect(DEFAULT_PROFILES.TISTORY.passthrough).toBe(false)
  })

  test('모든 프로필이 formatProfileSchema 검증을 통과한다', () => {
    for (const platform of platforms) {
      const result = formatProfileSchema.safeParse(DEFAULT_PROFILES[platform])
      expect(result.success).toBe(true)
    }
  })
})

// ─── formatProfileSchema ─────────────────────────────────────────────────────

describe('formatProfileSchema', () => {
  const validProfile: FormatProfile = {
    toneGuide: '친근한 말투',
    structureGuide: '짧은 문단',
    lengthRange: { min: 800, max: 2000 },
    headingStyle: '### 수준 소제목',
    forbiddenExpressions: ['저는'],
    ctaStyle: '부드러운 권유형',
    passthrough: false,
  }

  test('유효한 프로필을 통과시킨다', () => {
    expect(formatProfileSchema.safeParse(validProfile).success).toBe(true)
  })

  test('toneGuide가 빈 문자열이면 실패한다', () => {
    const result = formatProfileSchema.safeParse({ ...validProfile, toneGuide: '' })
    expect(result.success).toBe(false)
  })

  test('lengthRange.min이 음수이면 실패한다', () => {
    const result = formatProfileSchema.safeParse({
      ...validProfile,
      lengthRange: { min: -1, max: 2000 },
    })
    expect(result.success).toBe(false)
  })

  test('passthrough는 선택 필드다', () => {
    const withoutPassthrough = {
      toneGuide: validProfile.toneGuide,
      structureGuide: validProfile.structureGuide,
      lengthRange: validProfile.lengthRange,
      headingStyle: validProfile.headingStyle,
      forbiddenExpressions: validProfile.forbiddenExpressions,
      ctaStyle: validProfile.ctaStyle,
    }
    expect(formatProfileSchema.safeParse(withoutPassthrough).success).toBe(true)
  })
})

// ─── createChannelBodySchema ──────────────────────────────────────────────────

describe('createChannelBodySchema', () => {
  test('유효한 채널 생성 요청을 통과시킨다', () => {
    const result = createChannelBodySchema.safeParse({
      platform: 'NAVER_BLOG',
      name: '공식 블로그',
    })
    expect(result.success).toBe(true)
  })

  test('알 수 없는 플랫폼이면 실패한다', () => {
    const result = createChannelBodySchema.safeParse({
      platform: 'UNKNOWN_PLATFORM',
      name: '테스트',
    })
    expect(result.success).toBe(false)
  })

  test('name이 빈 문자열이면 실패한다', () => {
    const result = createChannelBodySchema.safeParse({
      platform: 'TISTORY',
      name: '',
    })
    expect(result.success).toBe(false)
  })

  test('formatProfile이 없어도 통과한다 (기본값 사용 의도)', () => {
    const result = createChannelBodySchema.safeParse({
      platform: 'OWN_HOMEPAGE',
      name: '자사 홈페이지',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.formatProfile).toBeUndefined()
    }
  })

  test('publisherMode가 올바르지 않으면 실패한다', () => {
    const result = createChannelBodySchema.safeParse({
      platform: 'TISTORY',
      name: '테스트',
      publisherMode: 'AUTO',
    })
    expect(result.success).toBe(false)
  })
})

// ─── updateChannelBodySchema ──────────────────────────────────────────────────

describe('updateChannelBodySchema', () => {
  test('빈 객체도 통과한다 (모든 필드 optional)', () => {
    expect(updateChannelBodySchema.safeParse({}).success).toBe(true)
  })

  test('isActive만 변경하는 요청을 통과시킨다', () => {
    const result = updateChannelBodySchema.safeParse({ isActive: false })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.isActive).toBe(false)
    }
  })

  test('name이 100자를 초과하면 실패한다', () => {
    const result = updateChannelBodySchema.safeParse({ name: 'a'.repeat(101) })
    expect(result.success).toBe(false)
  })
})
