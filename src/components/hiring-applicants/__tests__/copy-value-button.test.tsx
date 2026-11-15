import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CopyValueButton } from '../copy-value-button'

it('같은 영역의 서버 렌더 값을 DOM 에서 읽어 복사한다(값 prop 없음)', async () => {
  const writeText = jest.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  render(
    <div data-copy-root>
      <span data-copy-value>010-1234-5678</span>
      <CopyValueButton label="휴대폰" />
    </div>
  )
  await userEvent.click(screen.getByRole('button', { name: '휴대폰 복사' }))
  expect(writeText).toHaveBeenCalledWith('010-1234-5678')
})
