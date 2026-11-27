import {
  buildJobPostingJsonLd,
  parseKoreanAddress,
  type JobPostingInput,
} from '../job-posting-jsonld'

const input = (over: Partial<JobPostingInput> = {}): JobPostingInput => ({
  status: 'ACTIVE',
  isPreview: false,
  closingDate: new Date('2999-12-31T00:00:00Z'),
  publishedAt: new Date('2026-11-10T00:00:00Z'),
  createdAt: new Date('2026-11-01T00:00:00Z'),
  companyName: '카페',
  positions: [
    {
      name: '바리스타',
      jobType: 'PART_TIME',
      payFrequency: 'HOURLY',
      payAmount: 11000,
      workDays: [1, 2],
      workStartAt: '09:00',
      workEndAt: '15:00',
      experience: null,
      education: null,
      jobDescription: '커피 제조 <b>',
    },
  ],
  positionsBlockRendered: true,
  hasInternalApplyLink: true,
  stores: [{ roadAddress: '서울 강남구 테헤란로 1' }],
  textBlocksHtml: ['<p>안내</p>'],
  ...over,
})

// 중첩 필드를 단언하기 쉽게 JSON 왕복(any 반환)
const build = (over?: Partial<JobPostingInput>) =>
  JSON.parse(JSON.stringify(buildJobPostingJsonLd(input(over))))

describe('buildJobPostingJsonLd', () => {
  it('필수 필드를 채운다', () => {
    const r = build()
    expect(r['@type']).toBe('JobPosting')
    expect(r.title).toBe('바리스타')
    expect(r.datePosted).toBe('2026-11-10T00:00:00.000Z')
    expect(r.hiringOrganization).toEqual({ '@type': 'Organization', name: '카페' })
    expect(r.jobLocation).toEqual([
      {
        '@type': 'Place',
        address: {
          '@type': 'PostalAddress',
          streetAddress: '서울 강남구 테헤란로 1',
          addressRegion: '서울',
          addressLocality: '강남구',
          addressCountry: 'KR',
        },
      },
    ])
    expect(r.directApply).toBe(true)
    expect(r.validThrough).toBe('2999-12-31T23:59:59+09:00')
    expect(r.description).toContain('커피 제조 &lt;b&gt;')
    expect(r.description).toContain('<p>안내</p>')
  })

  it('employmentType 매핑 · 단일 포지션 baseSalary', () => {
    const r = build()
    expect(r.employmentType).toEqual(['PART_TIME'])
    expect(r.baseSalary).toEqual({
      '@type': 'MonetaryAmount',
      currency: 'KRW',
      value: { '@type': 'QuantitativeValue', value: 11000, unitText: 'HOUR' },
    })
    const freelancer = build({
      positions: [{ ...input().positions[0], jobType: 'FREELANCER', payFrequency: 'TBD' }],
    })
    expect(freelancer.employmentType).toEqual(['CONTRACTOR'])
    expect(freelancer.baseSalary).toBeUndefined()
  })

  it.each([
    ['상시 모집(마감일 없음)', { closingDate: null }],
    ['회사명 공백', { companyName: '  ' }],
    ['CLOSED', { status: 'CLOSED' }],
    ['DRAFT', { status: 'DRAFT' }],
    ['미리보기', { isPreview: true }],
    ['마감 경과', { closingDate: new Date('2020-01-01T00:00:00Z') }],
    ['포지션 없음', { positions: [] }],
    ['포지션 2개', { positions: [input().positions[0], input().positions[0]] }],
    ['positions 블록 미렌더', { positionsBlockRendered: false }],
    ['내부 지원 링크 없음', { hasInternalApplyLink: false }],
    ['도로명 주소 없음', { stores: [{ roadAddress: null }, { roadAddress: '  ' }] }],
    [
      '설명 없음',
      { textBlocksHtml: [], positions: [{ ...input().positions[0], jobDescription: null }] },
    ],
  ])('%s 이면 null', (_n, over) => {
    expect(buildJobPostingJsonLd(input(over as Partial<JobPostingInput>))).toBeNull()
  })
})

describe('parseKoreanAddress', () => {
  it.each([
    ['서울특별시 강남구 테헤란로 1', { addressRegion: '서울특별시', addressLocality: '강남구' }],
    ['서울 강남구 테헤란로 1', { addressRegion: '서울', addressLocality: '강남구' }],
    ['경기도 성남시 분당구 판교로 1', { addressRegion: '경기도', addressLocality: '성남시' }],
    ['세종특별자치시 한누리대로 2130', { addressRegion: '세종특별자치시' }],
    [
      '제주특별자치도 제주시 중앙로 1',
      { addressRegion: '제주특별자치도', addressLocality: '제주시' },
    ],
    [
      '강원특별자치도 춘천시 중앙로 1',
      { addressRegion: '강원특별자치도', addressLocality: '춘천시' },
    ],
    ['테헤란로 1', {}],
    ['여의도 영등포구 1', {}],
    ['울릉도 1', {}],
    ['', {}],
  ])('%s', (road, expected) => {
    expect(parseKoreanAddress(road)).toEqual(expected)
  })
})
