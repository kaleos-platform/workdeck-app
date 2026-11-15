import { render, screen } from '@testing-library/react'
import { PreviewFrame } from '../preview-frame'

it('기본 초기 모드는 PC 다(빌드 위저드 유지)', () => {
  render(<PreviewFrame>내용</PreviewFrame>)
  expect(screen.getByRole('button', { name: /PC/ })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('button', { name: /모바일/ })).toHaveAttribute('aria-pressed', 'false')
})

it('defaultMode="mobile" 이면 모바일로 시작한다', () => {
  render(<PreviewFrame defaultMode="mobile">내용</PreviewFrame>)
  expect(screen.getByRole('button', { name: /모바일/ })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('button', { name: /PC/ })).toHaveAttribute('aria-pressed', 'false')
})
