// 일괄 삭제 버튼이 "무엇을 왜 지우는지" 밝히는지에 대한 회귀 테스트.
//
// §10 한국어 복합어 판정이 들어오면서 삭제 건수가 갑자기 뛸 수 있다(한 상품에서 2건).
// 숫자만 커지고 이유가 없으면 사용자는 버그로 읽고, 모르고 누르면 멀쩡한 키워드가 사라진다.

import React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { KeywordEditor } from '../keyword-editor'

const productName = '에이엠엘 쿨 메쉬 심리스 커버 브라 노와이어 후크없이 편안한 중년 여성 속옷'

function renderEditor(value: string[]) {
  const onChange = jest.fn()
  render(<KeywordEditor value={value} onChange={onChange} productName={productName} />)
  return { onChange }
}

describe('KeywordEditor 위반 정리 버튼', () => {
  it('위반이 없으면 버튼이 없다', () => {
    renderEditor(['티셔츠브라', '여름브라'])
    expect(screen.queryByRole('button', { name: /위반 검색어 정리/ })).not.toBeInTheDocument()
  })

  it('삭제 건수를 라벨에 드러낸다', () => {
    renderEditor(['노와이어브라', '심리스브라', '티셔츠브라'])
    expect(
      screen.getByRole('button', { name: /위반 검색어 정리 \(2개 삭제\)/ })
    ).toBeInTheDocument()
  })

  it('툴팁에 코드 그룹별 내역과 되돌릴 수 없다는 경고가 나온다', async () => {
    const user = userEvent.setup()
    renderEditor(['노와이어브라', '심리스브라', '무료배송', '티셔츠브라'])

    await user.hover(screen.getByRole('button', { name: /위반 검색어 정리/ }))

    // Radix Tooltip 은 화면용과 스크린리더용 사본을 함께 렌더하므로 getAllBy 로 받는다.
    expect((await screen.findAllByText(/되돌리려면 다시 입력해야 합니다/)).length).toBeGreaterThan(
      0
    )
    expect(screen.getAllByText(/상품명 단어 재사용 2개/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/노와이어브라, 심리스브라/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/금지 표현 1개/).length).toBeGreaterThan(0)
  })

  it('누르면 위반만 걷어낸 목록으로 onChange 한다', async () => {
    const user = userEvent.setup()
    const { onChange } = renderEditor(['노와이어브라', '티셔츠브라'])

    await user.click(screen.getByRole('button', { name: /위반 검색어 정리/ }))

    expect(onChange).toHaveBeenCalledWith(['티셔츠브라'])
  })
})
