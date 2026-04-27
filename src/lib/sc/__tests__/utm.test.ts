import {
  buildTargetUrl,
  deriveUtmDefaults,
  generateShortSlug,
  hashIp,
  normalizeKebab,
} from '../utm'

describe('normalizeKebab', () => {
  it('공백/대문자/특수문자 정리', () => {
    expect(normalizeKebab('Hello World_Q3')).toBe('hello-world-q3')
    expect(normalizeKebab('  Naver Main   ')).toBe('naver-main')
    expect(normalizeKebab('___multi___under___')).toBe('multi-under')
  })
  it('중복 하이픈 축약', () => {
    expect(normalizeKebab('a---b--c')).toBe('a-b-c')
  })
})

describe('buildTargetUrl', () => {
  it('UTM 파라미터를 덧붙인다', () => {
    const url = buildTargetUrl('https://example.com/landing', {
      utmSource: 'Naver Blog',
      utmMedium: 'BLOG',
      utmCampaign: 'Q3 런칭',
    })
    const u = new URL(url)
    expect(u.searchParams.get('utm_source')).toBe('naver-blog')
    expect(u.searchParams.get('utm_medium')).toBe('blog')
    expect(u.searchParams.get('utm_campaign')).toBe('q3')
  })

  it('기존 쿼리 스트링 보존', () => {
    const url = buildTargetUrl('https://example.com/landing?x=1', {
      utmSource: 'threads',
    })
    expect(url).toContain('x=1')
    expect(url).toContain('utm_source=threads')
  })
})

describe('deriveUtmDefaults', () => {
  it('channel.platformSlug → utm_source, kind → utm_medium', () => {
    const d = deriveUtmDefaults({
      channelPlatformSlug: 'naver-main',
      channelKind: 'BLOG',
      contentTitle: 'Q3 Launch',
    })
    expect(d.utmSource).toBe('naver-main')
    expect(d.utmMedium).toBe('blog')
    expect(d.utmCampaign).toBe('q3-launch')
  })
  it('한글만 남은 title 은 normalize 후 untagged 로 귀결', () => {
    const d = deriveUtmDefaults({
      channelPlatformSlug: 'naver-main',
      channelKind: 'BLOG',
      contentTitle: '새 캠페인',
    })
    expect(d.utmCampaign).toBe('untagged')
  })
  it('titleOrSlug 모두 비어 있으면 untagged', () => {
    const d = deriveUtmDefaults({
      channelPlatformSlug: 'x-account',
      channelKind: 'SOCIAL',
    })
    expect(d.utmCampaign).toBe('untagged')
  })
})

describe('generateShortSlug', () => {
  it('요청 길이만큼 반환, 유효 문자셋', () => {
    const s = generateShortSlug(12)
    expect(s).toHaveLength(12)
    expect(s).toMatch(/^[a-zA-Z0-9]+$/)
  })
  it('다른 호출은 거의 확실히 다른 값', () => {
    const a = generateShortSlug()
    const b = generateShortSlug()
    expect(a).not.toBe(b)
  })
})

describe('hashIp', () => {
  it('동일 입력 → 동일 해시, 다른 입력 → 다른 해시', () => {
    expect(hashIp('1.1.1.1')).toBe(hashIp('1.1.1.1'))
    expect(hashIp('1.1.1.1')).not.toBe(hashIp('2.2.2.2'))
  })
  it('salt 에 따라 결과가 달라진다', () => {
    expect(hashIp('1.1.1.1', 'salt-a')).not.toBe(hashIp('1.1.1.1', 'salt-b'))
  })
})
