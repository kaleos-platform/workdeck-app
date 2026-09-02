// 일괄 삭제 버튼이 "무엇을 왜 지우는지" 밝히는지에 대한 회귀 테스트.
//
// §10 한국어 복합어 판정이 들어오면서 삭제 건수가 갑자기 뛸 수 있다(한 상품에서 2건).
// 숫자만 커지고 이유가 없으면 사용자는 버그로 읽고, 모르고 누르면 멀쩡한 키워드가 사라진다.

import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
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

// 사용자가 "왜 걸렸는지 알 수 없다" 고 한 지점. 칩의 아이콘 툴팁만으로는 hover 하기 전까지
// 이유가 보이지 않았다.
describe('KeywordEditor 위반 사유 상시 노출', () => {
  it('위반마다 이유를 문장으로 보여준다', () => {
    renderEditor(['노와이어브라', '여름브라'])

    expect(
      screen.getByText(/'노와이어브라'는 상품명 단어\(노와이어 \+ 브라\)만으로/)
    ).toBeInTheDocument()
    expect(
      screen.getByText(/'여름브라'에는 상품명 단어\(브라\)가 들어 있습니다/)
    ).toBeInTheDocument()
  })

  it('위반이 없으면 목록도 없다', () => {
    renderEditor(['레이스'])
    expect(screen.queryByText(/상품명 단어/)).not.toBeInTheDocument()
  })

  it('제안이 있으면 그 자리에서 바로 고칠 수 있다', async () => {
    const user = userEvent.setup()
    const { onChange } = renderEditor(['여름브라', '레이스'])

    // 조사는 받침에 따라 달라진다 — '여름' 은 받침 ㅁ 이라 '으로'.
    await user.click(screen.getByRole('button', { name: /'여름'으로 변경/ }))

    expect(onChange).toHaveBeenCalledWith(['여름', '레이스'])
  })

  it('제안이 없으면 제거 버튼을 준다', async () => {
    const user = userEvent.setup()
    const { onChange } = renderEditor(['노와이어브라', '레이스'])

    await user.click(screen.getByRole('button', { name: '제거' }))

    expect(onChange).toHaveBeenCalledWith(['레이스'])
  })
})

describe('KeywordEditor 예외 단어 등록', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
    jest.restoreAllMocks()
  })

  it('상품명 단어로 쪼개진 검색어에 등록 버튼이 뜬다', () => {
    // '쿨링' → 상품명 단어 '쿨' 을 빼면 '링' 한 글자만 남는다(KW_NAME_COMPOUND).
    renderEditor(['쿨링'])
    expect(screen.getByRole('button', { name: /'쿨링' 한 단어로 등록/ })).toBeInTheDocument()
  })

  it('공통 어절 위반에는 등록 버튼을 주지 않는다 (예외 등록으로 해소되지 않는다)', () => {
    // '허리'는 상품명 단어가 아니므로 공통 어절 위반만 뜬다(상품명 판정이 섞이지 않는다).
    renderEditor(['허리보정', '허리압박'])
    expect(screen.getByText(/'허리'를 공유합니다/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /한 단어로 등록/ })).not.toBeInTheDocument()
  })

  it('등록을 누르면 사전 API 로 POST 한다', async () => {
    const user = userEvent.setup()
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ words: [] }) })
    global.fetch = fetchMock as unknown as typeof fetch

    renderEditor(['쿨링'])
    await user.click(screen.getByRole('button', { name: /'쿨링' 한 단어로 등록/ }))

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/sh/keyword-atomic-words',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ word: '쿨링' }) })
    )
    // 등록 후 사전을 다시 읽어 다른 에디터까지 재검증시킨다(구독자 방송).
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  })
})
