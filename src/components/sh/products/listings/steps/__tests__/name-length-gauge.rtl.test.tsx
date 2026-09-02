// 구간 경계 회귀 테스트.
//
// 목표가 40~70 인데 40자를 '부족' 으로 표시하던 문제(제보). '부족' 구간 상한을 nameTargetMin
// 으로 두면 length <= to 매칭에서 경계값이 두 구간에 겹쳐 앞선 구간이 먼저 잡는다.

import React from 'react'
import { render, screen } from '@testing-library/react'

import { DEFAULT_KEYWORD_RULES } from '@/lib/sh/keyword-rules'
import { NameLengthGauge } from '../name-length-gauge'

const rules = DEFAULT_KEYWORD_RULES // 목표 40~70 · 권장 상한 80 · 운영 상한 120

function bandLabelFor(length: number): string {
  const { container, unmount } = render(<NameLengthGauge length={length} rules={rules} />)
  // 상태 라벨은 progressbar 의 aria-valuetext 에 그대로 들어간다 — 범례 텍스트와 안 섞인다.
  const text = container.querySelector('[role="progressbar"]')?.getAttribute('aria-valuetext') ?? ''
  unmount()
  return text
}

describe('NameLengthGauge 구간 경계', () => {
  it('목표 하한(40자)은 목표 구간이다', () => {
    expect(bandLabelFor(rules.nameTargetMin)).toContain('목표')
  })

  it('목표 하한 직전(39자)은 부족이다', () => {
    expect(bandLabelFor(rules.nameTargetMin - 1)).toContain('부족')
  })

  it('목표 상한(70자)은 목표 구간이다', () => {
    expect(bandLabelFor(rules.nameTargetMax)).toContain('목표')
  })

  it('목표 상한 직후(71자)는 권장 상한 내다', () => {
    expect(bandLabelFor(rules.nameTargetMax + 1)).toContain('권장 상한 내')
  })

  it('권장 상한(80자)까지는 권장 상한 내, 그 다음은 운영 상한 주의다', () => {
    expect(bandLabelFor(rules.nameSoftMax)).toContain('권장 상한 내')
    expect(bandLabelFor(rules.nameSoftMax + 1)).toContain('운영 상한 초과 주의')
  })

  it('운영 상한(120자)까지는 주의, 넘으면 초과다', () => {
    expect(bandLabelFor(rules.nameHardMax)).toContain('운영 상한 초과 주의')
    expect(bandLabelFor(rules.nameHardMax + 1)).toContain('운영 상한 초과')
  })

  it('범례 구간이 겹치지 않는다', () => {
    render(<NameLengthGauge length={40} rules={rules} />)

    // 상단 요약줄에도 '목표 40~70자' 가 있으므로 범례만 스코프한다 —
    // '부족 0~39자' 는 범례에만 있으니 그 부모 행을 통째로 본다.
    const legend = screen.getByText(/부족 0~39자/).closest('span')?.parentElement
    expect(legend?.textContent).toContain('부족 0~39자')
    expect(legend?.textContent).toContain('목표 40~70자')
    expect(legend?.textContent).toContain('권장 상한 내 71~80자')
    expect(legend?.textContent).toContain('운영 상한 초과 주의 81~120자')
  })
})
