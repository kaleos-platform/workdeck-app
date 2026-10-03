// 매핑 규칙 관리 화면(RTL + jsdom) — 전용 페이지 진입점의 핵심 동작.
// 목록 렌더 / 이름 인라인 변경(PATCH) / 삭제 확인 다이얼로그(DELETE) 를 fetch mock으로 검증.

import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MappingPresetsManager } from '../mapping-presets-manager'

jest.mock('sonner', () => ({
  toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn() },
}))

const PRESET = {
  id: 'p1',
  name: '기업은행 사업용',
  institution: '기업은행',
  kind: 'BANK',
  mapping: [
    { headerName: '거래일시', field: 'txnDate' },
    { headerName: '적요', field: 'description' },
    { headerName: '내용', field: 'description' },
  ],
  defaultAccountId: 'a1',
  updatedAt: '2026-08-08T00:00:00.000Z',
}

function mockFetch(overrides: Record<string, unknown> = {}) {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const fn = jest.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    if (url.startsWith('/api/finance/mapping-presets/')) {
      return { ok: true, status: 200, json: async () => ({ ok: true, ...overrides }) }
    }
    if (url === '/api/finance/mapping-presets') {
      return { ok: true, status: 200, json: async () => ({ presets: [PRESET] }) }
    }
    if (url === '/api/finance/accounts') {
      return { ok: true, status: 200, json: async () => ({ accounts: [{ id: 'a1', name: '기업은행 사업용 계좌' }] }) }
    }
    return { ok: false, status: 404, json: async () => ({}) }
  })
  ;(globalThis as unknown as { fetch: unknown }).fetch = fn
  return calls
}

test('규칙 목록 — 이름·종류·매핑 요약·기본 계좌 렌더', async () => {
  mockFetch()
  render(<MappingPresetsManager />)

  expect(await screen.findByText('기업은행 사업용')).toBeInTheDocument()
  expect(screen.getByText('은행')).toBeInTheDocument()
  // 다중 컬럼 적요는 하나의 필드로 묶어 표시
  expect(screen.getByText(/적요·내용 → 적요\/내용/)).toBeInTheDocument()
  expect(screen.getByText('기업은행 사업용 계좌')).toBeInTheDocument()
})

test('이름 클릭 → 인라인 편집 → PATCH 전송', async () => {
  const calls = mockFetch()
  const user = userEvent.setup()
  render(<MappingPresetsManager />)

  await user.click(await screen.findByText('기업은행 사업용'))
  const input = screen.getByDisplayValue('기업은행 사업용')
  await user.clear(input)
  await user.type(input, '기업은행 법인{Enter}')

  await waitFor(() => {
    const patch = calls.find((c) => c.init?.method === 'PATCH')
    expect(patch).toBeDefined()
    expect(patch!.url).toBe('/api/finance/mapping-presets/p1')
    expect(JSON.parse(String(patch!.init!.body))).toEqual({ name: '기업은행 법인' })
  })
  expect(await screen.findByText('기업은행 법인')).toBeInTheDocument()
})

test('삭제 → 확인 다이얼로그 후 DELETE, 목록에서 제거', async () => {
  const calls = mockFetch()
  const user = userEvent.setup()
  render(<MappingPresetsManager />)

  await screen.findByText('기업은행 사업용')
  await user.click(screen.getByRole('button', { name: '규칙 삭제' }))

  // 확인 전에는 DELETE가 나가지 않는다
  expect(calls.some((c) => c.init?.method === 'DELETE')).toBe(false)

  await user.click(await screen.findByRole('button', { name: '삭제' }))

  await waitFor(() => {
    const del = calls.find((c) => c.init?.method === 'DELETE')
    expect(del?.url).toBe('/api/finance/mapping-presets/p1')
  })
  await waitFor(() => expect(screen.queryByText('기업은행 사업용')).not.toBeInTheDocument())
})
