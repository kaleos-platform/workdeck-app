// CampaignSuggestions 렌더링 회귀 검증 (RTL + jsdom)
// 인시던트: 미등록 suggestion.type 이 들어오면 TYPE_CONFIG[type] === undefined →
// undefined.icon 접근으로 client-side TypeError 크래시 발생.
// (prod: "/d/coupang-ads/analysis" Application error / Cannot read properties of undefined (reading 'icon'))

import React from 'react'
import { render, screen } from '@testing-library/react'
import { CampaignSuggestions } from '../campaign-suggestions'
import type { Suggestion } from '@/types/analysis'

// suggestion.type / priority 는 LLM 생성 + DB 영속 값이라 enum 밖 값이 들어올 수 있음.
// 타입 시스템을 우회해 런타임 미등록 값(enum 밖 string)을 강제 주입한다.
type SuggestionOverrides = Omit<Partial<Suggestion>, 'type' | 'priority'> & {
  type?: string
  priority?: string
}

function makeSuggestion(overrides: SuggestionOverrides): Suggestion {
  return {
    type: 'ADJUST_BID',
    priority: 'HIGH',
    campaignId: 'camp-1',
    target: '테스트 타깃',
    reason: '테스트 사유',
    ...overrides,
  } as Suggestion
}

describe('CampaignSuggestions', () => {
  it('등록된 type/priority 제안을 정상 렌더한다', () => {
    render(<CampaignSuggestions suggestions={[makeSuggestion({})]} />)
    expect(screen.getByText('테스트 타깃')).toBeInTheDocument()
    expect(screen.getByText('입찰 조정')).toBeInTheDocument()
  })

  it('미등록 suggestion.type 이 있어도 크래시 없이 폴백 표시한다', () => {
    const suggestions = [makeSuggestion({ type: 'SOMETHING_NEW', target: '미등록 타입' })]

    // 회귀 핵심: 렌더가 throw 하지 않아야 함
    expect(() => render(<CampaignSuggestions suggestions={suggestions} />)).not.toThrow()

    // 제안을 숨기지 않고 폴백 라벨 + 원본 type 을 노출
    expect(screen.getByText('미등록 타입')).toBeInTheDocument()
    expect(screen.getByText(/기타 제안 \(SOMETHING_NEW\)/)).toBeInTheDocument()
  })

  it('미등록 suggestion.priority 가 있어도 크래시 없이 렌더한다', () => {
    const suggestions = [makeSuggestion({ priority: 'URGENT', target: '미등록 우선순위' })]

    expect(() => render(<CampaignSuggestions suggestions={suggestions} />)).not.toThrow()

    expect(screen.getByText('미등록 우선순위')).toBeInTheDocument()
    expect(screen.getByText('미정')).toBeInTheDocument()
  })

  it('미등록 type/priority 가 같은 제안에 동시에 있어도 크래시 없이 렌더한다', () => {
    const suggestions = [makeSuggestion({ type: 'FOO', priority: 'BAR', target: '둘 다 미등록' })]

    expect(() => render(<CampaignSuggestions suggestions={suggestions} />)).not.toThrow()

    expect(screen.getByText('둘 다 미등록')).toBeInTheDocument()
  })
})
