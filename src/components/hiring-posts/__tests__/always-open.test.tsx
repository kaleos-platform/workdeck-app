import { useState } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StepFormSettings } from '../step-form-settings'
import { PublishDialog } from '../publish-dialog'

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }) }))
jest.mock('sonner', () => ({ toast: { error: jest.fn() } }))

const fetchMock = jest.fn()
beforeEach(() => {
  jest.useFakeTimers().setSystemTime(new Date('2026-11-02T03:00:00Z'))
  fetchMock.mockReset().mockResolvedValue({ ok: true, json: async () => ({ posting: {} }) })
  global.fetch = fetchMock as unknown as typeof fetch
})
afterEach(() => jest.useRealTimers())

function Settings({
  initial,
  ref,
}: {
  initial: string
  ref?: React.Ref<{ flush: () => Promise<void> }>
}) {
  const [value, setValue] = useState({ closingDate: initial })
  return (
    <StepFormSettings
      ref={ref}
      postingId="p1"
      value={value}
      onChange={(patch) => setValue((v) => ({ ...v, ...patch }))}
    />
  )
}

const bodies = () => fetchMock.mock.calls.map((c) => JSON.parse(c[1].body))

it('마감일이 없는 기존 공고는 상시 모집이 체크되고 날짜 입력이 비활성이다', () => {
  render(<Settings initial="" />)
  expect(screen.getByRole('checkbox', { name: '상시 모집' })).toBeChecked()
  expect(screen.getByLabelText('지원서 마감일')).toBeDisabled()
})

it('상시 모집을 켜면 null 저장, 끄면 직전 날짜를 복원한다', async () => {
  render(<Settings initial="2026-12-01" />)
  const box = screen.getByRole('checkbox', { name: '상시 모집' })
  fireEvent.click(box)
  expect(screen.getByLabelText('지원서 마감일')).toBeDisabled()
  expect(screen.getByLabelText('지원서 마감일')).toHaveValue('')
  await waitFor(() => expect(bodies()).toContainEqual({ closingDate: null }))
  await act(async () => {})
  fireEvent.click(box)
  expect(screen.getByLabelText('지원서 마감일')).toHaveValue('2026-12-01')
  await waitFor(() => expect(bodies()).toContainEqual({ closingDate: '2026-12-01' }))
})

it('처음부터 상시 모집이던 공고를 끄면 오늘+14일(KST)로 채운다', () => {
  render(<Settings initial="" />)
  fireEvent.click(screen.getByRole('checkbox', { name: '상시 모집' }))
  expect(screen.getByLabelText('지원서 마감일')).toHaveValue('2026-11-16')
})

it('해제 상태에서 날짜가 비면 flush 가 거부된다', async () => {
  const ref = { current: null as { flush: () => Promise<void> } | null }
  render(<Settings initial="2026-12-01" ref={(h) => void (ref.current = h)} />)
  fireEvent.change(screen.getByLabelText('지원서 마감일'), { target: { value: '' } })
  await expect(ref.current!.flush()).rejects.toThrow('마감일을 선택하거나 상시 모집을 선택하세요')
})

describe('PublishDialog', () => {
  const open = () => fireEvent.click(screen.getByRole('button', { name: '공고 발행' }))
  const publishBtn = () => screen.getByRole('button', { name: '발행하기' })

  it('상시 모집 체크 시 날짜를 비활성화하고 null 로 발행한다', async () => {
    render(
      <PublishDialog
        postingId="p1"
        closingDate="2026-12-01T00:00:00.000Z"
        onPublished={jest.fn()}
      />
    )
    open()
    fireEvent.click(screen.getByRole('checkbox', { name: '상시 모집' }))
    expect(screen.getByLabelText('지원서 마감일')).toBeDisabled()
    fireEvent.click(publishBtn())
    await waitFor(() => expect(bodies()).toContainEqual({ action: 'publish', closingDate: null }))
  })

  it('날짜도 상시도 없으면 발행하기가 비활성이다', () => {
    render(
      <PublishDialog
        postingId="p1"
        closingDate="2026-12-01T00:00:00.000Z"
        onPublished={jest.fn()}
      />
    )
    open()
    fireEvent.change(screen.getByLabelText('지원서 마감일'), { target: { value: '' } })
    expect(publishBtn()).toBeDisabled()
  })

  it('마감일이 없는 초안은 상시 모집이 체크된 채 열린다', () => {
    render(<PublishDialog postingId="p1" closingDate={null} onPublished={jest.fn()} />)
    open()
    expect(screen.getByRole('checkbox', { name: '상시 모집' })).toBeChecked()
    expect(publishBtn()).toBeEnabled()
  })
})
