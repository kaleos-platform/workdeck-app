// NameDraftDialog 의 mode 분리 회귀 테스트.
//
// 상품명 다이얼로그에 키워드 섹션이 새어 나오면(그 반대도) 버튼을 둘로 나눈 의미가 없어진다.
// 그리고 "적용해도 닫히지 않는다"는 사용자 피드백으로 확정된 동작이라 회귀로 되돌아가면 안 된다.

import React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { NameDraftDialog } from '../name-draft-dialog'

const NAMES = [{ value: '쿨 메쉬 브라 노와이어', violations: [] }]
const KEYWORDS = [
  {
    value: '여름브라',
    violations: [],
    intent: 'PURPOSE' as const,
    intentLabel: '용도',
    reason: '여름 착용',
  },
  { value: '이미담긴', violations: [], intent: 'TARGET' as const, intentLabel: '대상', reason: '' },
]

const review = (
  keyword: string,
  overrides: Partial<React.ComponentProps<typeof NameDraftDialog>['reviews'][number]> = {}
) => ({
  keyword,
  label: 'KEEP' as const,
  labelText: '유지',
  reason: '',
  violations: [],
  recommendRemove: false,
  ...overrides,
})

function renderDialog(overrides: Partial<React.ComponentProps<typeof NameDraftDialog>> = {}) {
  const onApplyName = jest.fn()
  const onAddKeyword = jest.fn()
  const onOpenChange = jest.fn()
  render(
    <NameDraftDialog
      open
      onOpenChange={onOpenChange}
      mode="name"
      status="success"
      names={NAMES}
      keywords={KEYWORDS}
      reviews={[]}
      existingKeywords={['이미담긴']}
      currentSearchName="현재 상품명"
      onApplyName={onApplyName}
      onAddKeyword={onAddKeyword}
      {...overrides}
    />
  )
  return { onApplyName, onAddKeyword, onOpenChange }
}

describe('NameDraftDialog mode 분리', () => {
  it("mode='name' 은 상품명 후보만 보여준다 — 키워드 섹션이 없다", () => {
    renderDialog({ mode: 'name' })

    expect(screen.getByText('상품명(검색용) 후보')).toBeInTheDocument()
    expect(screen.queryByText('AI 추천 키워드')).not.toBeInTheDocument()
    expect(screen.queryByText(/현재 키워드/)).not.toBeInTheDocument()
  })

  it("mode='keyword' 는 키워드 섹션만 보여준다 — 상품명 후보가 없다", () => {
    renderDialog({ mode: 'keyword' })

    expect(screen.getByText('AI 추천 키워드')).toBeInTheDocument()
    expect(screen.queryByText('상품명(검색용) 후보')).not.toBeInTheDocument()
  })

  it('상품명을 적용해도 다이얼로그가 닫히지 않는다', async () => {
    const user = userEvent.setup()
    const { onApplyName, onOpenChange } = renderDialog({ mode: 'name' })

    await user.click(screen.getByRole('button', { name: '적용' }))

    expect(onApplyName).toHaveBeenCalledWith(NAMES[0].value)
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('키워드 칩을 눌러도 다이얼로그가 닫히지 않는다', async () => {
    const user = userEvent.setup()
    const { onAddKeyword, onOpenChange } = renderDialog({ mode: 'keyword' })

    await user.click(screen.getByText('여름브라'))

    expect(onAddKeyword).toHaveBeenCalledWith('여름브라')
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('이미 담긴 키워드는 눌러도 다시 추가되지 않는다', async () => {
    const user = userEvent.setup()
    const { onAddKeyword } = renderDialog({ mode: 'keyword' })

    // 현재 키워드 섹션과 AI 추천 섹션 양쪽에 같은 문자열이 있을 수 있어 전부 눌러 본다.
    for (const el of screen.getAllByText('이미담긴')) {
      await user.click(el)
    }

    expect(onAddKeyword).not.toHaveBeenCalled()
  })

  it('unavailable 이면 안내 문구만 뜬다 (두 모드 모두)', () => {
    const { unmount } = render(
      <NameDraftDialog
        open
        onOpenChange={jest.fn()}
        mode="name"
        status="unavailable"
        names={[]}
        keywords={[]}
        reviews={[]}
        existingKeywords={[]}
        currentSearchName="현재 상품명"
        onApplyName={jest.fn()}
        onAddKeyword={jest.fn()}
      />
    )
    expect(screen.getByText(/AI 초안을 사용할 수 없습니다/)).toBeInTheDocument()
    expect(screen.queryByText('상품명(검색용) 후보')).not.toBeInTheDocument()
    unmount()

    renderDialog({ mode: 'keyword', status: 'unavailable', names: [], keywords: [] })
    expect(screen.getByText(/AI 초안을 사용할 수 없습니다/)).toBeInTheDocument()
    expect(screen.queryByText('AI 추천 키워드')).not.toBeInTheDocument()
  })
})

describe('NameDraftDialog 등록 검색어 진단', () => {
  const flagged = review('이미담긴', {
    label: 'LOW_INTENT',
    labelText: '구매의도 낮음',
    reason: '정보 탐색성 표현',
    recommendRemove: true,
  })

  it('제거 권장 키워드에 라벨과 제거 버튼이 붙는다', () => {
    renderDialog({ mode: 'keyword', reviews: [flagged], onRemoveKeyword: jest.fn() })

    expect(screen.getByText('구매의도 낮음')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '이미담긴 제거' })).toBeInTheDocument()
    expect(screen.getByText(/정리 권장 1/)).toBeInTheDocument()
  })

  it('KEEP 판정에는 제거 버튼이 없다', () => {
    renderDialog({ mode: 'keyword', reviews: [review('이미담긴')], onRemoveKeyword: jest.fn() })

    expect(screen.queryByRole('button', { name: '이미담긴 제거' })).not.toBeInTheDocument()
    expect(screen.queryByText(/정리 권장/)).not.toBeInTheDocument()
  })

  it('제거를 누르면 원문 키워드로 콜백이 1회 불린다', async () => {
    const user = userEvent.setup()
    const onRemoveKeyword = jest.fn()
    renderDialog({ mode: 'keyword', reviews: [flagged], onRemoveKeyword })

    await user.click(screen.getByRole('button', { name: '이미담긴 제거' }))

    expect(onRemoveKeyword).toHaveBeenCalledTimes(1)
    expect(onRemoveKeyword).toHaveBeenCalledWith('이미담긴')
  })

  it('onRemoveKeyword 가 없으면 제거 버튼을 그리지 않는다', () => {
    renderDialog({ mode: 'keyword', reviews: [flagged] })

    expect(screen.getByText('구매의도 낮음')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '이미담긴 제거' })).not.toBeInTheDocument()
  })

  it('등록 목록에 없는 진단(방금 제거된 것)은 렌더하지 않는다', () => {
    renderDialog({
      mode: 'keyword',
      reviews: [
        review('유령키워드', {
          label: 'FALSE_CLAIM',
          labelText: '없는 기능',
          recommendRemove: true,
        }),
      ],
      onRemoveKeyword: jest.fn(),
    })

    expect(screen.queryByText('유령키워드')).not.toBeInTheDocument()
    expect(screen.queryByText('없는 기능')).not.toBeInTheDocument()
  })

  it('진단이 없는 등록 키워드도 평범한 배지로 그린다', () => {
    renderDialog({ mode: 'keyword', reviews: [], onRemoveKeyword: jest.fn() })

    // 현재 키워드 섹션의 배지 — AI 추천 칩과 같은 문자열이라 getAllByText 로 확인한다.
    expect(screen.getAllByText('이미담긴').length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: '이미담긴 제거' })).not.toBeInTheDocument()
  })

  it('AI 추천 칩에 생성 축 라벨이 붙는다', () => {
    renderDialog({ mode: 'keyword' })

    expect(screen.getByText('용도')).toBeInTheDocument()
    expect(screen.getByText('대상')).toBeInTheDocument()
  })
})
