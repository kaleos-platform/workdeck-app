import { render, screen } from '@testing-library/react'
import { StepBasic } from '../step-basic'

jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh: jest.fn() }) }))
jest.mock('sonner', () => ({ toast: { error: jest.fn() } }))

it('공고 제목을 바꿀 때 본문 제목이 별도임을 안내한다', () => {
  render(<StepBasic postingId="qa" value={{ title: '기존 공고' }} onChange={jest.fn()} />)
  expect(screen.getByLabelText('공고 제목')).toHaveAccessibleDescription(
    '공고 제목을 바꿔도 본문은 자동으로 바뀌지 않습니다. 공고 꾸미기에서 본문 제목도 확인하세요.'
  )
})
