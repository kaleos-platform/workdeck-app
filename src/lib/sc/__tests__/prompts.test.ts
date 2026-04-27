import { buildIdeationPrompt, computePromptTraceHash } from '../prompts'

describe('buildIdeationPrompt', () => {
  const baseProduct = {
    id: 'prod1',
    name: '테스트 제품',
    valueProposition: '시간을 아껴줍니다',
    differentiators: ['빠름', '저렴'],
  }
  const basePersona = {
    id: 'per1',
    name: '중소기업 운영팀장',
    industry: '이커머스',
    painPoints: ['재고 파악 어려움'],
  }

  it('상품·페르소나가 system 프롬프트에 포함된다', () => {
    const built = buildIdeationPrompt({
      product: baseProduct,
      persona: basePersona,
      rules: [],
      count: 5,
    })
    expect(built.system).toContain('[상품]')
    expect(built.system).toContain('테스트 제품')
    expect(built.system).toContain('시간을 아껴줍니다')
    expect(built.system).toContain('[페르소나]')
    expect(built.system).toContain('중소기업 운영팀장')
    expect(built.system).toContain('재고 파악 어려움')
    expect(built.system).toContain('글감 후보 5개')
  })

  it('count 는 1..10 으로 클램핑된다', () => {
    const hi = buildIdeationPrompt({ product: baseProduct, count: 999, rules: [] })
    expect(hi.system).toContain('글감 후보 10개')
    const lo = buildIdeationPrompt({ product: baseProduct, count: 0, rules: [] })
    expect(lo.system).toContain('글감 후보 1개')
  })

  it('사용자 프롬프트가 user 메시지에 들어간다', () => {
    const built = buildIdeationPrompt({
      product: baseProduct,
      userPromptInput: '고객 이탈 방지에 초점',
      count: 5,
      rules: [],
    })
    expect(built.messages).toHaveLength(1)
    expect(built.messages[0].role).toBe('user')
    expect(built.messages[0].content).toContain('고객 이탈 방지에 초점')
  })

  it('JSON 응답 지시가 포함된다', () => {
    const built = buildIdeationPrompt({ product: baseProduct, count: 5, rules: [] })
    expect(built.system).toMatch(/순수 JSON/)
    expect(built.system).toMatch(/targetChannel/)
  })

  it('활성 규칙이 weight 내림차순으로 렌더된다', () => {
    const built = buildIdeationPrompt({
      product: baseProduct,
      count: 5,
      rules: [
        { id: 'r1', scope: 'workspace', text: '낮은 가중치', weight: 1 },
        { id: 'r2', scope: 'persona', text: '높은 가중치', weight: 10 },
      ],
    })
    const hi = built.system.indexOf('높은 가중치')
    const lo = built.system.indexOf('낮은 가중치')
    expect(hi).toBeGreaterThanOrEqual(0)
    expect(lo).toBeGreaterThan(hi)
    expect(built.ruleIds).toEqual(['r1', 'r2'])
  })

  it('같은 의미 입력은 같은 traceHash 를 만든다', () => {
    const a = buildIdeationPrompt({
      product: baseProduct,
      persona: basePersona,
      count: 5,
      rules: [],
    })
    const b = buildIdeationPrompt({
      persona: basePersona,
      product: baseProduct,
      count: 5,
      rules: [],
    })
    expect(a.traceHash).toBe(b.traceHash)
  })

  it('다른 count 는 다른 traceHash 를 만든다', () => {
    const a = buildIdeationPrompt({ product: baseProduct, count: 5, rules: [] })
    const b = buildIdeationPrompt({ product: baseProduct, count: 6, rules: [] })
    expect(a.traceHash).not.toBe(b.traceHash)
  })
})

describe('computePromptTraceHash', () => {
  it('키 순서에 영향을 받지 않는다', () => {
    expect(computePromptTraceHash({ a: 1, b: 2 })).toBe(computePromptTraceHash({ b: 2, a: 1 }))
  })
  it('값이 다르면 해시가 다르다', () => {
    expect(computePromptTraceHash({ a: 1 })).not.toBe(computePromptTraceHash({ a: 2 }))
  })
})
