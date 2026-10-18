// 판매채널 키워드 불러오기 — 중복·상한·혼합 세트 그룹 회귀 테스트.

import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { ChannelKeywordImportDialog } from '../channel-keyword-import-dialog'

const responses: Record<string, unknown> = {
  p1: {
    productName: '쿨 브라',
    cards: [
      {
        kind: 'channelProduct',
        id: 'cp1',
        channelId: 'ch-coupang',
        channelName: '쿠팡',
        searchName: '쿨 메쉬 브라',
        keywords: ['여름브라', '노와이어', '편한브라'],
      },
      {
        kind: 'listing',
        id: 'l1',
        channelId: 'ch-naver',
        channelName: '스마트스토어',
        searchName: '쿨 브라',
        keywords: ['여름 브라'],
      },
    ],
  },
  p2: {
    productName: '패드',
    cards: [
      {
        kind: 'listing',
        id: 'l2',
        channelId: 'ch-naver',
        channelName: '스마트스토어',
        searchName: '브라 패드',
        keywords: ['브라패드'],
      },
    ],
  },
}

beforeEach(() => {
  global.fetch = jest.fn((url: string) => {
    const id = url.split('/')[4]
    return Promise.resolve({ ok: true, json: () => Promise.resolve(responses[id]) })
  }) as unknown as typeof fetch
})

async function openDialog(props: Partial<React.ComponentProps<typeof ChannelKeywordImportDialog>>) {
  const onChange = jest.fn()
  const user = userEvent.setup()
  render(
    <ChannelKeywordImportDialog
      productIds={['p1']}
      currentChannelId="ch-coupang"
      value={[]}
      onChange={onChange}
      {...props}
    />
  )
  const trigger = screen.getByRole('button', { name: /판매채널 키워드 불러오기/ })
  await waitFor(() => expect(trigger).toBeEnabled())
  await user.click(trigger)
  return { onChange, user }
}

describe('ChannelKeywordImportDialog', () => {
  it('구성 상품이 없으면 비활성', () => {
    render(
      <ChannelKeywordImportDialog
        productIds={[]}
        currentChannelId={null}
        value={[]}
        onChange={jest.fn()}
      />
    )
    expect(screen.getByRole('button', { name: /판매채널 키워드 불러오기/ })).toBeDisabled()
  })

  it('이미 등록된 키워드는 비활성, 전체 선택은 나머지만 추가', async () => {
    const { onChange, user } = await openDialog({ value: ['노와이어'] })

    expect(screen.getByText('현재 채널')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /노와이어/ })).toBeDisabled()

    await user.click(screen.getAllByRole('button', { name: '전체 선택' })[0])
    await user.click(screen.getByRole('button', { name: '2개 추가' }))

    expect(onChange).toHaveBeenCalledWith(['노와이어', '여름브라', '편한브라'])
  })

  it('남은 자리를 넘겨 고를 수 없다', async () => {
    const value = Array.from({ length: 29 }, (_, i) => `kw${i}`)
    const { onChange, user } = await openDialog({ value })

    await user.click(screen.getAllByRole('button', { name: '전체 선택' })[0])

    expect(screen.getByRole('checkbox', { name: /편한브라/ })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: '1개 추가' }))
    expect(onChange).toHaveBeenCalledWith([...value, '여름브라'])
  })

  it('excludeCard 로 지정한 자기 카드는 목록에서 빠진다', async () => {
    await openDialog({ excludeCard: { kind: 'channelProduct', id: 'cp1' } })
    expect(screen.queryByText('쿠팡')).not.toBeInTheDocument()
    expect(screen.getByText('스마트스토어')).toBeInTheDocument()
  })

  it('자기 카드뿐이면 불러오기 버튼이 비활성', async () => {
    render(
      <ChannelKeywordImportDialog
        productIds={['p2']}
        currentChannelId={null}
        value={[]}
        onChange={jest.fn()}
        excludeCard={{ kind: 'listing', id: 'l2' }}
      />
    )
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.getByRole('button', { name: /판매채널 키워드 불러오기/ })).toBeDisabled()
  })

  it('혼합 세트면 상품별로 묶어 보여준다', async () => {
    await openDialog({ productIds: ['p1', 'p2'] })
    expect(screen.getByRole('heading', { name: '쿨 브라' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '패드' })).toBeInTheDocument()
  })
})
