import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ImageBlock } from '../block-editors'

jest.mock('next/dynamic', () => () => () => null)
jest.mock('sonner', () => ({ toast: { error: jest.fn() } }))

it('이미지 업로드 실패 후 파일을 다시 선택하지 않고 재시도할 수 있다', async () => {
  const onSelect = jest
    .fn()
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue(undefined)
  const { container } = render(
    <ImageBlock imagePath={null} link={null} onSelect={onSelect} onLinkSave={async () => {}} />
  )
  const file = new File(['QA'], 'qa.png', { type: 'image/png' })
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [file] } })
  await screen.findByRole('button', { name: '이미지 다시 업로드' })
  fireEvent.click(screen.getByRole('button', { name: '이미지 다시 업로드' }))
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: '이미지 다시 업로드' })).not.toBeInTheDocument()
  )
  expect(onSelect.mock.calls).toEqual([[file], [file]])
})
