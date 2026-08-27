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
  { value: '여름브라', violations: [] },
  { value: '이미담긴', violations: [] },
]

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
