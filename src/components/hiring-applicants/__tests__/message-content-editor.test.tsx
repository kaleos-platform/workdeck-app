import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MessageContentEditor, MessagePreview } from '../message-content-editor'

it('초기값의 토큰이 칩으로 렌더된다', async () => {
  const { container } = render(<MessageContentEditor value="안녕 {이름}님" onChange={() => {}} />)
  await waitFor(() => expect(container.querySelector('[data-variable="이름"]')).toBeTruthy())
  expect(screen.getByRole('textbox', { name: '내용' })).toBeTruthy()
  expect(screen.getByText('992자 남음')).toBeTruthy()
})

it('툴바 버튼으로 칩을 넣으면 onChange에 평문 토큰이 담긴다', async () => {
  const onChange = jest.fn()
  render(<MessageContentEditor value="" onChange={onChange} />)
  await screen.findByRole('textbox', { name: '내용' })
  fireEvent.click(screen.getByRole('button', { name: '공고명' }))
  await waitFor(() => expect(onChange).toHaveBeenLastCalledWith('{공고명}'))
})

it('MessagePreview는 토큰을 칩으로, 나머지는 평문으로 보여준다', () => {
  const { container } = render(<MessagePreview content={'{이름}님\n{기타} {직무}'} />)
  expect(
    Array.from(container.querySelectorAll('[data-variable]')).map((e) => e.textContent)
  ).toEqual(['이름', '직무'])
  expect(container.textContent).toBe('이름님\n{기타} 직무')
})

it('최대 글자 수를 넘기는 칩 삽입은 거부된다', async () => {
  const onChange = jest.fn()
  render(<MessageContentEditor value="abcd" onChange={onChange} maxLength={5} />)
  await screen.findByRole('textbox', { name: '내용' })
  fireEvent.click(screen.getByRole('button', { name: '이름' }))
  expect(onChange).not.toHaveBeenCalled()
})
