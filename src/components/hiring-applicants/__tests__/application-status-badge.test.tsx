import { render, screen } from '@testing-library/react'
import { ApplicationStatusBadge } from '../application-status-badge'

it('채용 단계와 결과를 하나의 배지로 보여준다', () => {
  render(<ApplicationStatusBadge stage="HIRING" hiringStage="INTERVIEW" />)
  expect(screen.getByText('면접 · 진행 중')).toBeInTheDocument()
})

it.each([
  ['HIRING', '진행 중', 'text-blue-700', 'dark:text-blue-400'],
  ['ACCEPTED', '합격', 'text-emerald-700', 'dark:text-emerald-400'],
  ['REJECTED', '불합격', 'text-red-700', 'dark:text-red-400'],
] as const)('결과 %s 는 색 짝을 쓴다', (stage, label, light, dark) => {
  render(<ApplicationStatusBadge stage={stage} hiringStage="APPLIED" />)
  const el = screen.getByText(`서류 접수 · ${label}`)
  expect(el).toHaveClass(light, dark)
})
