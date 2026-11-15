import { render, screen } from '@testing-library/react'
import { PreQuestions } from '../pre-questions'

it('번호와 질문, 답변을 보여주고 배열은 쉼표로 잇는다', () => {
  render(
    <PreQuestions
      entries={[
        { key: 'q1', type: 'text', label: '경력', value: '있음' },
        { key: 'q2', type: 'multiselect', label: '가능 요일', value: ['월', '화'] },
      ]}
    />
  )
  expect(screen.getByText('1. 경력')).toBeInTheDocument()
  expect(screen.getByText('2. 가능 요일')).toBeInTheDocument()
  expect(screen.getByText('월, 화')).toBeInTheDocument()
})

it('질문이 없으면 구역을 숨긴다', () => {
  const { container } = render(<PreQuestions entries={[]} />)
  expect(container).toBeEmptyDOMElement()
})
