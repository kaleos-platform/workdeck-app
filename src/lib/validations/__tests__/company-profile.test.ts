import { companyProfileSchema } from '../hiring-posts'

const base = { companyName: '미닝카페', showIntro: true }

it('빈 문자열 소개·URL 은 null 로 바뀐다', () => {
  const r = companyProfileSchema.parse({ ...base, intro: '  ', homepageUrl: '', blogUrl: ' ' })
  expect(r).toMatchObject({ intro: null, homepageUrl: null, blogUrl: null, instagramUrl: null })
})

it('https 가 아닌 URL 은 거부한다', () => {
  for (const url of ['http://a.com', 'javascript:alert(1)', 'a.com', 'ftp://a.com'])
    expect(companyProfileSchema.safeParse({ ...base, homepageUrl: url }).success).toBe(false)
  expect(companyProfileSchema.safeParse({ ...base, homepageUrl: 'https://a.com' }).success).toBe(
    true
  )
})

it('길이 상한: 기업명 50, 소개 1000, URL 300', () => {
  expect(companyProfileSchema.safeParse({ ...base, companyName: 'a'.repeat(51) }).success).toBe(
    false
  )
  expect(companyProfileSchema.safeParse({ ...base, companyName: '  ' }).success).toBe(false)
  expect(companyProfileSchema.safeParse({ ...base, intro: 'a'.repeat(1001) }).success).toBe(false)
  expect(companyProfileSchema.safeParse({ ...base, intro: 'a'.repeat(1000) }).success).toBe(true)
  const long = `https://a.com/${'a'.repeat(300)}`
  expect(companyProfileSchema.safeParse({ ...base, blogUrl: long }).success).toBe(false)
})

it('대문자 스킴 HTTPS:// 는 https:// 로 정규화해 저장한다', () => {
  const r = companyProfileSchema.parse({ ...base, homepageUrl: 'HTTPS://Example.com/path' })
  expect(r.homepageUrl).toBe('https://example.com/path')
})
