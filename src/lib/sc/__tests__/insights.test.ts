import { buildInsightPrompt, parseInsightResponse, type InsightBucket } from '../insights'

const bucket: InsightBucket = {
  key: {
    channelPlatform: 'THREADS',
    templateKind: 'SOCIAL',
    productId: 'prod-1',
  },
  deploymentIds: ['dep-1', 'dep-2'],
  sampleCount: 2,
  impressions: 10000,
  views: 8000,
  likes: 120,
  comments: 15,
  shares: 5,
  externalClicks: 180,
  internalClicks: 45,
  days: 3,
}

describe('buildInsightPrompt', () => {
  it('버킷과 활성 규칙을 system 프롬프트에 포함한다', () => {
    const built = buildInsightPrompt({
      buckets: [bucket],
      activeRules: [
        {
          id: 'r1',
          scope: 'WORKSPACE',
          title: '명사로 끝내지 말 것',
          body: '모든 제목은 동사로 끝난다.',
          weight: 8,
        },
      ],
      maxProposals: 5,
    })
    expect(built.system).toContain('THREADS')
    expect(built.system).toContain('SOCIAL')
    expect(built.system).toContain('dep-1,dep-2')
    expect(built.system).toContain('명사로 끝내지 말 것')
    expect(built.messages).toHaveLength(1)
    expect(built.messages[0]?.role).toBe('user')
  })

  it('버킷이 비어 있어도 system 프롬프트가 생성된다', () => {
    const built = buildInsightPrompt({ buckets: [], activeRules: [], maxProposals: 3 })
    expect(built.system).toContain('유효 데이터 없음')
    expect(built.traceHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('동일 입력에 대해 traceHash 가 재현된다', () => {
    const a = buildInsightPrompt({
      buckets: [bucket],
      activeRules: [],
      maxProposals: 5,
    })
    const b = buildInsightPrompt({
      buckets: [bucket],
      activeRules: [],
      maxProposals: 5,
    })
    expect(a.traceHash).toBe(b.traceHash)
  })

  it('maxProposals 가 다르면 traceHash 가 달라진다', () => {
    const a = buildInsightPrompt({ buckets: [bucket], activeRules: [], maxProposals: 3 })
    const b = buildInsightPrompt({ buckets: [bucket], activeRules: [], maxProposals: 5 })
    expect(a.traceHash).not.toBe(b.traceHash)
  })
})

describe('parseInsightResponse', () => {
  it('유효 JSON → 제안 배열 반환', () => {
    const raw = JSON.stringify({
      proposals: [
        {
          scope: 'CHANNEL',
          title: '스레드용 훅 앞 20자 강화',
          body: '스레드 노출→클릭 전환이 낮다. 훅 20자 내에 수치/질문을 배치하라.',
          weight: 7,
          targetChannelPlatform: 'THREADS',
          targetProductId: null,
          evidenceDeploymentIds: ['dep-1', 'dep-2'],
        },
      ],
    })
    const out = parseInsightResponse(raw)
    expect(out).toHaveLength(1)
    expect(out[0]?.scope).toBe('CHANNEL')
    expect(out[0]?.evidenceDeploymentIds).toEqual(['dep-1', 'dep-2'])
  })

  it('마크다운 코드블록으로 감싸진 JSON 도 파싱', () => {
    const raw = '```json\n' + JSON.stringify({ proposals: [] }) + '\n```'
    expect(parseInsightResponse(raw)).toEqual([])
  })

  it('evidenceDeploymentIds 가 비어 있으면 zod 에러', () => {
    const raw = JSON.stringify({
      proposals: [
        {
          scope: 'WORKSPACE',
          title: 't',
          body: 'b',
          weight: 5,
          evidenceDeploymentIds: [],
        },
      ],
    })
    expect(() => parseInsightResponse(raw)).toThrow()
  })

  it('잘못된 scope → zod 에러', () => {
    const raw = JSON.stringify({
      proposals: [
        {
          scope: 'UNKNOWN',
          title: 't',
          body: 'b',
          weight: 5,
          evidenceDeploymentIds: ['dep-1'],
        },
      ],
    })
    expect(() => parseInsightResponse(raw)).toThrow()
  })
})
