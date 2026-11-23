import { buildJobPostingJsonLd, type JobPostingInput } from '../job-posting-jsonld'

const input = (over: Partial<JobPostingInput> = {}): JobPostingInput => ({
  title: '바리스타 모집',
  status: 'ACTIVE',
  isPreview: false,
  closingDate: null,
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
    expect(r.title).toBe('바리스타 모집')
    expect(r.datePosted).toBe('2026-11-10T00:00:00.000Z')
    expect(r.hiringOrganization).toEqual({ '@type': 'Organization', name: '카페' })
    expect(r.jobLocation).toEqual([
      {
        '@type': 'Place',
        address: {
          '@type': 'PostalAddress',
          streetAddress: '서울 강남구 테헤란로 1',
          addressCountry: 'KR',
        },
      },
    ])
    expect(r.directApply).toBe(true)
    expect(r.validThrough).toBeUndefined()
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

  it('validThrough 는 마감일 KST 23:59:59', () => {
    const r = build({ closingDate: new Date('2999-12-31T00:00:00Z') })
    expect(r.validThrough).toBe('2999-12-31T23:59:59+09:00')
  })

  it.each([
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
