import { useState } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StepBasic } from '../step-basic'

jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh: jest.fn() }) }))
jest.mock('sonner', () => ({ toast: { error: jest.fn() } }))

function Form() {
  const [value, setValue] = useState({ title: '원래 제목' })
  return (
    <StepBasic
      postingId="test"
      value={value}
      onChange={(patch) => setValue({ ...value, ...patch })}
    />
  )
}

it('이전 제목을 저장 중이어도 마지막으로 입력한 제목을 순서대로 저장한다', async () => {
  let finishFirst!: (value: Response) => void
  const originalFetch = global.fetch
  const fetchMock = jest
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          finishFirst = resolve
        })
    )
    .mockResolvedValue({ ok: true })
  global.fetch = fetchMock
  try {
    render(<Form />)
    const input = screen.getByLabelText('공고 제목')
    fireEvent.change(input, { target: { value: '첫 수정' } })
    fireEvent.blur(input)
    fireEvent.change(input, { target: { value: '최종 수정' } })
    fireEvent.blur(input)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await act(async () => {
      finishFirst({ ok: true } as Response)
    })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ title: '최종 수정' })
  } finally {
    global.fetch = originalFetch
  }
})
