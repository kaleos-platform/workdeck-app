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

it.each([
  '카드가 변경되었습니다. 입력을 복사한 뒤 새로고침해 저장된 내용을 확인해 주세요.',
  '다른 창에서 카드가 변경되었습니다. 입력을 복사한 뒤 새로고침해 주세요.',
  '카드 버전이 없습니다. 입력을 복사한 뒤 새로고침해 주세요.',
])('카드 충돌 시 파일 보관과 새로고침을 안내한다: %s', async (message) => {
  const onSelect = jest.fn().mockRejectedValue(new Error(message))
  const { container } = render(
    <ImageBlock imagePath={null} link={null} onSelect={onSelect} onLinkSave={async () => {}} />
  )
  fireEvent.change(container.querySelector('input[type="file"]')!, {
    target: { files: [new File(['QA'], 'qa.png', { type: 'image/png' })] },
  })
  expect(await screen.findByRole('alert')).toHaveTextContent('이미지 파일을 보관한 뒤 새로고침')
  expect(screen.queryByRole('button', { name: '이미지 다시 업로드' })).not.toBeInTheDocument()
})
