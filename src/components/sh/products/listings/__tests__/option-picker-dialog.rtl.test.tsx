// OptionPickerDialog 키워드 칩/토큰 검색 검증 (RTL + jsdom)
// 재고 조정 수동 매칭에서 파일 상품명 전체를 검색어로 밀어넣어 0건이 되던 문제의 회귀 방지.

import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { OptionPickerDialog } from '../option-picker-dialog'

const KEYWORD_SOURCE = '임산부 텐셀 모달 브이 팬티 1장 / 블랙 XL'

type FetchCall = { search: string | null; tokenized: string | null }

function setupFetch(matcher: (search: string) => boolean) {
  const calls: FetchCall[] = []
  const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://localhost')
    const search = url.searchParams.get('search')
    calls.push({ search, tokenized: url.searchParams.get('tokenized') })
    const hit = matcher(search ?? '')
    return {
      ok: true,
      json: async () => ({
        data: hit
          ? [
              {
                id: 'p1',
                name: '임산부 텐셀 모달 브이 팬티',
                internalName: '임산부 팬티',
                code: 'P-1',
                options: [{ id: 'o1', name: '블랙 XL', sku: 'SKU-1' }],
              },
            ]
          : [],
        total: hit ? 1 : 0,
      }),
    } as unknown as Response
  })
  global.fetch = fetchMock as unknown as typeof fetch
  return calls
}

function renderPicker() {
  return render(
    <OptionPickerDialog
      open
      onOpenChange={() => {}}
      mode="multi-with-qty"
      onPickMulti={() => {}}
      keywordSource={KEYWORD_SOURCE}
      tokenized
    />
  )
}

describe('OptionPickerDialog 키워드 칩', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  test('파일 상품명 전체가 아니라 앞 2개 토큰으로 검색을 시작하고 tokenized=1을 붙인다', async () => {
    const calls = setupFetch(() => true)
    renderPicker()

    await waitFor(() => expect(calls.length).toBeGreaterThan(0))
    expect(calls[0].search).toBe('임산부 텐셀')
    expect(calls[0].tokenized).toBe('1')
    expect(screen.getByLabelText('검색')).toHaveValue('임산부 텐셀')

    // 파일명의 단어들이 칩으로 노출된다
    expect(screen.getByRole('button', { name: '모달' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'XL' })).toBeInTheDocument()
  })

  test('0건이면 마지막 토큰을 떼고 자동 재검색한다', async () => {
    // '임산부'만 남았을 때 매칭 — 그 전까지는 0건
    const calls = setupFetch((s) => s === '임산부')
    renderPicker()

    await waitFor(() => expect(screen.getByLabelText('검색')).toHaveValue('임산부'))
    await waitFor(() => expect(calls.map((c) => c.search)).toEqual(['임산부 텐셀', '임산부']))
    expect(screen.getByText(/검색어를 완화했습니다/)).toBeInTheDocument()
  })

  test('토큰이 1개까지 줄어도 0건이면 더 완화하지 않는다 (무한 루프 방지)', async () => {
    const calls = setupFetch(() => false)
    renderPicker()

    await waitFor(() => expect(screen.getByLabelText('검색')).toHaveValue('임산부'))
    await waitFor(() => expect(screen.getByText('검색 결과가 없습니다')).toBeInTheDocument())
    await waitFor(() => expect(calls.map((c) => c.search)).toEqual(['임산부 텐셀', '임산부']))
    // 더 이상 요청이 늘지 않는다
    await new Promise((r) => setTimeout(r, 500))
    expect(calls).toHaveLength(2)
  })

  test('칩을 누르면 그 단어가 검색 조건에 붙고, 0건이어도 자동으로 떨어지지 않는다', async () => {
    const user = userEvent.setup()
    const calls = setupFetch((s) => s === '임산부 텐셀')
    renderPicker()

    await waitFor(() => expect(calls.length).toBe(1))
    await user.click(screen.getByRole('button', { name: '모달' }))

    await waitFor(() => expect(screen.getByLabelText('검색')).toHaveValue('임산부 텐셀 모달'))
    await waitFor(() => expect(screen.getByText('검색 결과가 없습니다')).toBeInTheDocument())
    expect(screen.getByLabelText('검색')).toHaveValue('임산부 텐셀 모달')
  })
})
